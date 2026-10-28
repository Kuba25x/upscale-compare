import { useState } from 'react';
import { API_URL, recoverPublication } from '../lib/api';
import {
  completePublication,
  forgetPublication,
  pendingPublications,
  type PublicationAttempt,
} from '../lib/publication-journal';
import { Modal } from './Modal';
import { ShareDialog, type Published } from './ShareDialog';
import { emptyMetadata } from '../../shared/model';

export function PublicationRecoveryDialog({ onClose }: { onClose: () => void }) {
  const [attempts, setAttempts] = useState(pendingPublications);
  const [published, setPublished] = useState<Published>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState<string[]>([]);
  const check = async (attempt: PublicationAttempt) => {
    setBusy(true);
    setMessage('');
    try {
      const result = await recoverPublication(attempt);
      if (result.status === 'pending') {
        setMessage('Publication is still processing. Check again in a few seconds.');
        return;
      }
      try {
        completePublication(attempt, result.id);
      } catch {
        /* Keep the journal and show the private key for manual backup. */
      }
      setPublished({ ...result, deleteToken: attempt.deleteToken });
    } catch (reason) {
      setMessage((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (published)
    return (
      <ShareDialog
        images={[]}
        manifest={{
          metadata: emptyMetadata(),
          images: [],
          config: {
            mode: 'split',
            selected: [0, 1],
            divider: 0.5,
            view: { zoom: null, center: { x: 0, y: 0 } },
          },
        }}
        existing={published}
        readOnly
        onPublished={() => undefined}
        onDeleted={() => setPublished({ ...published, deleted: true })}
        onClose={onClose}
      />
    );
  return (
    <Modal title="Recover publication" onClose={onClose} busy={busy}>
      <p>
        Check whether an interrupted publication finished. This sends no images and needs no new
        verification. Recovery is available for 24 hours after the first attempt.
      </p>
      <p className="muted">
        If no publication is found, reopen the same original images and settings to retry. Keep the
        saved key until the result is known.
      </p>
      {attempts.map((attempt) => (
        <div key={attempt.key}>
          <p>Started {new Date(attempt.createdAt).toLocaleString()}</p>
          <div className="modal-actions">
            <button disabled={busy} onClick={() => void check(attempt)}>
              Check publication result
            </button>
            <button
              disabled={busy}
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob(
                    [
                      `Upscale Compare — private recovery key\nAPI: ${API_URL}\nPublication identifier: ${attempt.key}\nDeletion key: ${attempt.deleteToken}\n\nKeep private. Recovery is available for 24 hours from the timestamp in the identifier.\n`,
                    ],
                    { type: 'text/plain' },
                  ),
                );
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `upscale-compare-recovery-${attempt.createdAt}.txt`;
                anchor.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Download recovery key
            </button>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={saved.includes(attempt.key)}
              onChange={(event) =>
                setSaved(
                  event.target.checked
                    ? [...saved, attempt.key]
                    : saved.filter((key) => key !== attempt.key),
                )
              }
            />
            I saved the key or accept losing control of this publication.
          </label>
          <button
            disabled={busy || !saved.includes(attempt.key)}
            onClick={() => {
              try {
                forgetPublication(attempt);
                setAttempts(pendingPublications());
              } catch {
                setMessage('Your browser could not remove this recovery record.');
              }
            }}
          >
            Remove recovery record
          </button>
        </div>
      ))}
      {attempts.length === 0 && <p>No pending publications remain.</p>}
      {message && <p role="status">{message}</p>}
    </Modal>
  );
}
