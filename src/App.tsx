import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Columns2,
  Github,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Share2,
  SplitSquareHorizontal,
  Upload,
  X,
} from 'lucide-react';
import { emptyMetadata, type Config, type LocalImage, type Metadata } from '../shared/model';
import { API_URL, fetchComparison, publicImageUrl } from './lib/api';
import { formatBytes, loadImage } from './lib/images';
import { Viewer } from './components/Viewer';
import { Modal } from './components/Modal';
import { MetadataEditor } from './components/MetadataEditor';
import { readDeletionKey, ShareDialog, type Published } from './components/ShareDialog';

const SOURCE = 'https://github.com/Kuba25x/upscale-compare';
const initialConfig: Config = {
  mode: 'split',
  selected: [0, 1],
  divider: 0.5,
  view: { zoom: null, center: { x: 0, y: 0 } },
};
type UploadAction = { kind: 'all' | 'add' | 'one'; index?: number };
export default function App() {
  const [images, setImages] = useState<LocalImage[]>([]);
  const [metadata, setMetadata] = useState<Metadata>(emptyMetadata);
  const [config, setConfig] = useState<Config>(initialConfig);
  const [modal, setModal] = useState<'upload' | 'metadata' | 'share' | 'help' | 'privacy' | null>(
    null,
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [route, setRoute] = useState(location.hash);
  const [published, setPublished] = useState<Published>();
  const [publishedSnapshot, setPublishedSnapshot] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadAction = useRef<UploadAction>({ kind: 'all' });
  const currentImages = useRef(images);
  currentImages.current = images;
  const dragDepth = useRef(0);
  const updateConfig = useCallback((update: (previous: Config) => Config) => setConfig(update), []);
  const help = useCallback(() => setModal('help'), []);
  const details = useCallback(() => setModal('metadata'), []);
  useEffect(() => {
    const hashChange = () => setRoute(location.hash);
    window.addEventListener('hashchange', hashChange);
    return () => {
      window.removeEventListener('hashchange', hashChange);
      for (const image of currentImages.current) if (image.file) URL.revokeObjectURL(image.url);
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!route) return;
    setModal(null);
    const match = route.match(/^#c\/([a-f0-9]{16})$/);
    if (!match) {
      setError('This comparison link is invalid.');
      return;
    }
    setLoading(true);
    setError('');
    fetchComparison(match[1])
      .then(async (comparison) => {
        const loaded = await Promise.all(
          comparison.images.map(async (image, index) => {
            const url = publicImageUrl(comparison.id, index),
              bitmap = new Image();
            bitmap.src = url;
            await bitmap.decode();
            return { ...image, url };
          }),
        );
        if (!active) return;
        currentImages.current.forEach((image) => {
          if (image.file) URL.revokeObjectURL(image.url);
        });
        setImages(loaded);
        setMetadata(comparison.metadata);
        setConfig(comparison.config);
        setReadOnly(true);
        setPublished({
          id: comparison.id,
          shareUrl: `${API_URL}/s/${comparison.id}`,
          deleteToken: readDeletionKey(comparison.id),
        });
        document.title = `${comparison.metadata.game || 'Shared comparison'} — Upscale Compare`;
      })
      .catch((reason) => {
        if (active) setError(reason.message || 'The comparison images could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [route]);
  const requestFiles = (action: UploadAction) => {
    uploadAction.current = action;
    fileInput.current!.multiple = action.kind !== 'one';
    fileInput.current!.value = '';
    fileInput.current!.click();
  };
  const upload = async (files: File[], action: UploadAction) => {
    if (!files.length) return;
    setError('');
    const replacingAll = action.kind === 'all' || readOnly;
    const total = replacingAll
      ? files.length
      : action.kind === 'one'
        ? images.length
        : images.length + files.length;
    if (total < 2 || total > 4 || (action.kind === 'one' && files.length !== 1)) {
      setError(
        'Select two to four images for a comparison. You can replace one image at a time in Upload Images.',
      );
      return;
    }
    setLoading(true);
    const results = await Promise.allSettled(files.map(loadImage));
    const loaded = results
      .filter(
        (result): result is PromiseFulfilledResult<LocalImage> => result.status === 'fulfilled',
      )
      .map((result) => result.value);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') {
      loaded.forEach((image) => URL.revokeObjectURL(image.url));
      setError(failed.reason.message);
      setLoading(false);
      return;
    }
    if (replacingAll) {
      images.forEach((image) => {
        if (image.file) URL.revokeObjectURL(image.url);
      });
      setImages(loaded);
      setMetadata(emptyMetadata());
      setConfig({
        ...initialConfig,
        view: {
          zoom: null,
          center: {
            x: Math.max(...loaded.slice(0, 2).map((image) => image.width)) / 2,
            y: Math.max(...loaded.slice(0, 2).map((image) => image.height)) / 2,
          },
        },
      });
      setReadOnly(false);
      setPublished(undefined);
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      setRoute('');
      document.title = 'Upscale Compare — Image quality, side by side';
    } else if (action.kind === 'one') {
      const old = images[action.index!];
      if (old.file) URL.revokeObjectURL(old.url);
      setImages((previous) => previous.map((image, i) => (i === action.index ? loaded[0] : image)));
      setPublished(undefined);
    } else {
      setImages((previous) => [...previous, ...loaded]);
      setPublished(undefined);
    }
    setModal(null);
    setLoading(false);
  };
  const editLabel = (index: number, label: string) => {
    setImages((previous) =>
      previous.map((image, i) => (i === index ? { ...image, label } : image)),
    );
    setPublished(undefined);
  };
  const select = (slot: 0 | 1, index: number) =>
    setConfig((previous) => {
      const selected: [number, number] = [...previous.selected];
      if (selected[1 - slot] === index) selected[1 - slot] = selected[slot];
      selected[slot] = index;
      const chosen = selected.map((i) => images[i]);
      return {
        ...previous,
        selected,
        view:
          previous.view.zoom === null
            ? {
                zoom: null,
                center: {
                  x: Math.max(...chosen.map((image) => image.width)) / 2,
                  y: Math.max(...chosen.map((image) => image.height)) / 2,
                },
              }
            : previous.view,
      };
    });
  const ready = images.length >= 2;
  const manifest = {
    images: images.map((image) => ({ label: image.label, metadata: image.metadata })),
    metadata,
    config,
  };
  return (
    <div
      className={`app ${ready ? 'has-images' : ''}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current--;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (!loading)
          void upload([...event.dataTransfer.files], { kind: ready && !readOnly ? 'add' : 'all' });
      }}
    >
      <input
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        ref={fileInput}
        data-testid="file-input"
        aria-label="Choose comparison images"
        onChange={(event) =>
          void upload([...(event.currentTarget.files || [])], uploadAction.current)
        }
      />
      <header className="app-header">
        {ready && (
          <div className="mode-controls">
            <span className="eyebrow">MODE</span>
            <div className="segmented">
              <button
                aria-pressed={config.mode === 'split'}
                className={config.mode === 'split' ? 'active' : ''}
                onClick={() => setConfig((previous) => ({ ...previous, mode: 'split' }))}
              >
                <SplitSquareHorizontal size={16} />
                Split Screen
              </button>
              <button
                aria-pressed={config.mode === 'side'}
                className={config.mode === 'side' ? 'active' : ''}
                onClick={() => setConfig((previous) => ({ ...previous, mode: 'side' }))}
              >
                <Columns2 size={16} />
                Side-by-Side
              </button>
            </div>
          </div>
        )}
        <h1>
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          Upscale Compare
        </h1>
        {ready && (
          <div className="header-actions">
            <button
              className="share-button"
              onClick={() => setModal('share')}
              disabled={loading || images.some((image) => !image.label.trim())}
              title={
                images.some((image) => !image.label.trim())
                  ? 'Give each image a label before sharing.'
                  : 'Create or copy a public comparison link'
              }
            >
              <Share2 size={16} />
              <span>Share Comparison</span>
            </button>
            <button className="primary" onClick={() => setModal('upload')} disabled={loading}>
              <ImagePlus size={17} />
              <span>Upload Images</span>
            </button>
          </div>
        )}
      </header>
      {ready ? (
        <main className="comparison-layout">
          <Viewer
            images={images}
            config={config}
            onChange={updateConfig}
            onMetadata={details}
            onHelp={help}
          />
          <div className="image-selection-bar">
            {([0, 1] as const).map((slot) => {
              const index = config.selected[slot],
                image = images[index];
              return (
                <div className={`image-selector selector-${slot}`} key={slot}>
                  <span className={`slot-letter slot-${slot}`}>{slot === 0 ? 'A' : 'B'}</span>
                  <div className="image-selector-fields">
                    <label className="select-image">
                      <span className="sr-only">Image {slot === 0 ? 'A' : 'B'}</span>
                      <select
                        aria-label={`Select image ${slot === 0 ? 'A' : 'B'}`}
                        value={index}
                        onChange={(event) => select(slot, Number(event.target.value))}
                      >
                        {images.map((item, i) => (
                          <option value={i} key={i}>
                            {item.label || item.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} />
                    </label>
                    <span className="file-info">
                      {image.width} × {image.height}
                      <span>
                        {' '}
                        · {formatBytes(image.size)} · {image.type.split('/')[1].toUpperCase()}
                      </span>
                    </span>
                  </div>
                  {!readOnly && (
                    <label className="rename-label" title="Customize screenshot label">
                      <Pencil size={13} />
                      <input
                        aria-label={`Label for image ${slot === 0 ? 'A' : 'B'}`}
                        value={image.label}
                        maxLength={120}
                        placeholder="Screenshot label"
                        onChange={(event) => editLabel(index, event.target.value)}
                        onBlur={() => {
                          if (!image.label.trim())
                            editLabel(
                              index,
                              image.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Screenshot',
                            );
                        }}
                      />
                    </label>
                  )}
                </div>
              );
            })}
            <button
              className="swap-button icon-button"
              aria-label="Swap images"
              title="Swap A and B (X)"
              onClick={() =>
                setConfig((previous) => ({
                  ...previous,
                  selected: [previous.selected[1], previous.selected[0]],
                }))
              }
            >
              <ArrowLeftRight size={16} />
            </button>
          </div>
          {readOnly && (
            <div className="published-notice">
              <Check size={12} />
              {published?.deleted
                ? 'Deleted comparison · local preview'
                : 'Published comparison · read-only'}
              <span>Your zoom and image selection are local to this view.</span>
            </div>
          )}
        </main>
      ) : (
        <main className="landing">
          <div className="upload-center">
            <button
              className="primary upload-hero"
              onClick={() => requestFiles({ kind: 'all' })}
              disabled={loading}
            >
              <Upload size={23} strokeWidth={1.6} />
              Upload Images
            </button>
            <p>Drop 2–4 screenshots here to compare</p>
            <span className="landing-hint">
              PNG recommended · Original quality · Private until shared
            </span>
          </div>
          <footer className="landing-footer">
            <button className="text-button" onClick={() => setModal('privacy')}>
              Local first. Yours to share.
            </button>
            <a href={SOURCE} target="_blank" rel="noreferrer">
              <Github size={14} />
              Open source · AGPL-3.0
            </a>
          </footer>
        </main>
      )}
      {loading && (
        <div className="loading-indicator" role="status">
          <LoaderCircle size={17} className="spinner" />
          {route ? 'Opening comparison…' : 'Loading original images…'}
        </div>
      )}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <Upload size={35} />
          <h2>Drop your screenshots</h2>
          <p>
            {ready && !readOnly
              ? 'Add images to this comparison · Up to 4 total'
              : '2–4 images · PNG, JPEG, or WebP'}
          </p>
        </div>
      )}
      {modal === 'upload' && (
        <Modal
          title={readOnly ? 'Start your own comparison' : 'Your images'}
          onClose={() => setModal(null)}
          busy={loading}
        >
          <p className="muted">
            {readOnly
              ? 'Choose two to four screenshots to start a new local comparison.'
              : 'Add or replace screenshots. Files stay in your browser until you publish.'}
          </p>
          {!readOnly && (
            <div className="upload-list">
              {images.map((image, index) => (
                <div className="upload-list-item" key={index}>
                  <img src={image.url} alt="" />
                  <div>
                    <b>{image.label}</b>
                    <span className="muted">
                      {image.width} × {image.height} · {formatBytes(image.size)}
                    </span>
                  </div>
                  <button disabled={loading} onClick={() => requestFiles({ kind: 'one', index })}>
                    Replace
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="muted small">
            PNG, JPEG, WebP · 20 MB per image · 40 MB total when sharing · 36 MP per image
          </p>
          <div className="modal-actions">
            {!readOnly && images.length < 4 && (
              <button disabled={loading} onClick={() => requestFiles({ kind: 'add' })}>
                <ImagePlus size={16} />
                Add images
              </button>
            )}
            <button
              className="primary"
              disabled={loading}
              onClick={() => requestFiles({ kind: 'all' })}
            >
              {readOnly ? 'Upload Images' : 'Replace all images'}
            </button>
          </div>
        </Modal>
      )}
      {modal === 'metadata' && (
        <MetadataEditor
          images={images}
          metadata={metadata}
          readOnly={readOnly}
          onClose={() => setModal(null)}
          onSave={(nextMetadata, nextImages) => {
            setMetadata(nextMetadata);
            setImages(nextImages);
            setPublished(undefined);
            setModal(null);
          }}
        />
      )}
      {modal === 'share' && (
        <ShareDialog
          images={images}
          manifest={manifest}
          existing={
            readOnly || publishedSnapshot === JSON.stringify(manifest) ? published : undefined
          }
          readOnly={readOnly}
          onDeleted={() =>
            setPublished((previous) => (previous ? { ...previous, deleted: true } : previous))
          }
          onPublished={(value) => {
            setPublished(value);
            setPublishedSnapshot(JSON.stringify(manifest));
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'help' && (
        <Modal title="A closer look at every pixel" onClose={() => setModal(null)}>
          <p className="muted">
            Drag the image to pan. Scroll to zoom at the cursor. On touchscreens, drag with one
            finger and pinch with two.
          </p>
          <dl className="shortcuts">
            <dt>0</dt>
            <dd>Fit the complete images</dd>
            <dt>1 / 2 / 4</dt>
            <dd>100% / 200% / 400% source-pixel zoom</dd>
            <dt>+ / −</dt>
            <dd>Zoom in / out</dd>
            <dt>Arrow keys</dt>
            <dd>Pan the images</dd>
            <dt>S / V</dt>
            <dd>Split Screen / Side-by-Side</dd>
            <dt>X</dt>
            <dd>Swap image A and B</dd>
            <dt>[ / ]</dt>
            <dd>Previous / next image for A</dd>
            <dt>F</dt>
            <dd>Toggle fullscreen</dd>
            <dt>?</dt>
            <dd>Show this guide</dd>
          </dl>
          <p className="muted small">
            100% (1:1) maps one source pixel to one physical display pixel, including on
            high-density displays. Fit adapts to your window. Different image sizes share one scale
            and the same top-left origin; they are never stretched to match. Browser color
            management may affect displayed colors; HDR inspection is not supported.
          </p>
          <div className="modal-actions">
            <a className="text-link" href={SOURCE} target="_blank" rel="noreferrer">
              Source code · AGPL-3.0 ↗
            </a>
            <button onClick={() => setModal('privacy')}>Privacy</button>
            <button className="primary" onClick={() => setModal(null)}>
              Got it
            </button>
          </div>
        </Modal>
      )}
      {modal === 'privacy' && (
        <Modal title="Your images, your choice" onClose={() => setModal(null)}>
          <div className="privacy-copy">
            <h3>Compare privately</h3>
            <p>
              Local images are decoded in your browser. They are not sent to a server until you
              explicitly publish. Closing or refreshing the page clears an unpublished comparison.
            </p>
            <h3>Share publicly</h3>
            <p>
              Publishing sends the unmodified files and comparison metadata to the configured
              sharing service. Anyone with the link can view or download them. Files may include
              embedded EXIF or other metadata.
            </p>
            <h3>Stay in control</h3>
            <p>
              A private deletion key is saved in this browser and can be downloaded after
              publishing. Keep it private. Deleted links stop working, but copies already saved by
              other people cannot be removed.
            </p>
            <h3>Service protection</h3>
            <p>
              The sharing service temporarily stores hashed network identifiers to enforce rate
              limits. Production publishing uses Cloudflare Turnstile. Hosting providers may process
              connection logs under their own policies.
            </p>
            <p>
              For abuse reports, contact the operator of your sharing service with the comparison
              URL. This open-source project does not operate a hosted upload service.
            </p>
          </div>
          <div className="modal-actions">
            <a
              className="text-link"
              href={`${SOURCE}/blob/main/docs/PRIVACY.md`}
              target="_blank"
              rel="noreferrer"
            >
              Privacy documentation ↗
            </a>
            <button className="primary" onClick={() => setModal(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
