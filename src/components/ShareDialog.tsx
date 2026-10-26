import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Globe, Link, ShieldCheck, Trash2 } from 'lucide-react';
import type { LocalImage, Manifest } from '../../shared/model';
import { apiFetch, API_URL, publish } from '../lib/api';
import { Modal } from './Modal';
export interface Published {
  id: string;
  shareUrl: string;
  deleteToken?: string;
  deleted?: boolean;
}
interface Turnstile {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
export function readDeletionKey(id: string): string | undefined {
  try {
    return localStorage.getItem(`upscale-compare:delete:${API_URL}:${id}`) || undefined;
  } catch {
    return undefined;
  }
}
export function ShareDialog({
  images,
  manifest,
  existing,
  readOnly,
  onPublished,
  onDeleted,
  onClose,
}: {
  images: LocalImage[];
  manifest: Manifest;
  existing?: Published;
  readOnly: boolean;
  onPublished: (value: Published) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [published, setPublished] = useState(existing);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [health, setHealth] = useState<{
    uploadsEnabled: boolean;
    verificationRequired: boolean;
  }>();
  const [challenge, setChallenge] = useState('');
  const [deleteToken, setDeleteToken] = useState(existing?.deleteToken || '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(existing?.deleted || false);
  const challengeElement = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (readOnly || existing) return;
    let active = true;
    apiFetch('/api/health')
      .then((response) => response.json())
      .then((value) => {
        if (active) setHealth(value as { uploadsEnabled: boolean; verificationRequired: boolean });
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!health?.verificationRequired || !import.meta.env.VITE_TURNSTILE_SITE_KEY || published)
      return;
    let disposed = false;
    const render = () => {
      if (disposed || !window.turnstile || !challengeElement.current) return;
      widget.current = window.turnstile.render(challengeElement.current, {
        sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
        theme: 'dark',
        action: 'publish',
        callback: (token: string) => setChallenge(token),
        'expired-callback': () => setChallenge(''),
        'error-callback': () => {
          setChallenge('');
          setError('Verification could not load. Check your connection and try again.');
        },
      });
    };
    if (window.turnstile) render();
    else {
      let script = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.dataset.turnstile = 'true';
        document.head.append(script);
      }
      script.addEventListener('load', render, { once: true });
      script.addEventListener(
        'error',
        () => {
          if (!disposed) setError('Verification could not load. Please try again later.');
        },
        { once: true },
      );
    }
    return () => {
      disposed = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = undefined;
    };
  }, [health?.verificationRequired, Boolean(published)]);
  const share = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await publish(images, manifest, challenge);
      let storageSaved = true;
      try {
        localStorage.setItem(`upscale-compare:delete:${API_URL}:${result.id}`, result.deleteToken);
      } catch {
        storageSaved = false;
      }
      setPublished(result);
      setDeleteToken(result.deleteToken);
      onPublished(result);
      if (!storageSaved)
        setError(
          'Your browser could not save the deletion key. Download it now to keep control of this comparison.',
        );
    } catch (reason) {
      setError((reason as Error).message);
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
      setChallenge('');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/comparisons/${published!.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${deleteToken}` },
      });
      setDeleted(true);
      onDeleted();
      try {
        localStorage.removeItem(`upscale-compare:delete:${API_URL}:${published!.id}`);
      } catch {
        /* Browser storage may be disabled. */
      }
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const downloadKey = () => {
    const text = `Upscale Compare — private deletion key\n\nPublic URL: ${published!.shareUrl}\nComparison ID: ${published!.id}\nAPI: ${API_URL}\nDeletion key: ${deleteToken}\n\nKeep this file private. Open the public comparison, select Share Comparison, and paste this key under Manage published comparison to delete it.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `upscale-compare-${published!.id}-private-key.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Modal
      title={published ? 'Share comparison' : 'Publish your comparison'}
      onClose={onClose}
      busy={busy}
    >
      {deleted ? (
        <div className="share-success">
          <Check size={28} />
          <h3>Comparison deleted</h3>
          <p>
            The public link no longer works. Copies already downloaded by others cannot be recalled.
          </p>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      ) : published ? (
        <>
          <div className="share-success">
            <span className="success-icon">
              <Link size={23} />
            </span>
            <h3>Your comparison is ready to share</h3>
            <p className="muted">
              Anyone with the link can view the original images. No account needed.
            </p>
          </div>
          <label>
            Public comparison link
            <div className="copy-field">
              <input
                aria-label="Public comparison link"
                value={published.shareUrl}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                className="primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(published.shareUrl);
                    setCopied(true);
                  } catch {
                    setError('Copy the link from the text field. Clipboard access is unavailable.');
                  }
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </label>
          <a
            className="text-link open-comparison"
            href={published.shareUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open public comparison ↗
          </a>
          <details className="manage-published">
            <summary>Manage published comparison</summary>
            <p className="muted">
              The deletion key is private and is never included in the shared link. Save a backup:
              clearing browser data removes the saved key.
            </p>
            <label>
              Private deletion key
              <input
                type="password"
                autoComplete="off"
                aria-label="Private deletion key"
                value={deleteToken}
                maxLength={256}
                onChange={(event) => setDeleteToken(event.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button disabled={!deleteToken || busy} onClick={downloadKey}>
                <Download size={16} />
                Download key
              </button>
              <button
                className="danger"
                disabled={!deleteToken || busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={16} />
                Delete comparison
              </button>
            </div>
            {confirmDelete && (
              <div className="delete-confirm">
                <p>Permanently remove the public comparison and its images?</p>
                <button className="danger" disabled={busy} onClick={() => void remove()}>
                  {busy ? 'Deleting…' : 'Permanently delete'}
                </button>
              </div>
            )}
          </details>
        </>
      ) : (
        <>
          <div className="publish-info">
            <Globe size={25} />
            <div>
              <h3>Create a public, read-only link</h3>
              <p>
                Your original files, labels, metadata, selected images, mode, divider, and view will
                be published together.
              </p>
            </div>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={18} />
            <p>
              Your images have stayed in this browser so far. Publishing uploads them to the sharing
              service. Original files may contain embedded metadata. Remove private information
              before publishing.
            </p>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            I have permission to publish these images and understand they will be public.
          </label>
          <div ref={challengeElement} className="challenge" />
          {health && !health.uploadsEnabled && (
            <p className="error">
              Public uploads are currently disabled. You can keep comparing locally.
            </p>
          )}
          {health?.verificationRequired && !import.meta.env.VITE_TURNSTILE_SITE_KEY && (
            <p className="error">
              The site operator needs to configure verification before publishing.
            </p>
          )}
          <div className="modal-actions">
            <button disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                !consent ||
                !health?.uploadsEnabled ||
                (health.verificationRequired && !challenge)
              }
              onClick={() => void share()}
            >
              <Globe size={16} />
              {busy ? 'Publishing original images…' : 'Publish comparison'}
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
