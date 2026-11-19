import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { emptyMetadata, type Config, type LocalImage, type Metadata } from '../../shared/model';
import { Modal } from '../../src/components/Modal';
import { Viewer } from '../../src/components/Viewer';
import { loadImage } from '../../src/lib/images';
import '../../src/styles.css';
import png from '../../tests/fixtures/fidelity/rgba-metadata.png?url';
import jpeg from '../../tests/fixtures/fidelity/baseline.jpg?url';
import webp from '../../tests/fixtures/fidelity/lossless-alpha.webp?url';
import png16 from '../../tests/fixtures/fidelity/rgb16.png?url';
import { APP_URL, FIXTURE_NAMES } from './settings';
import { openComparison, publish, releaseImages } from './transfer';
import './style.css';

const fixtures = [png, jpeg, webp, png16];
const types = ['image/png', 'image/jpeg', 'image/webp', 'image/png'];
const initialConfig: Config = {
  mode: 'split',
  selected: [0, 1],
  divider: 0.5,
  view: { zoom: null, center: { x: 0, y: 0 } },
};

function Experiment({ hash }: { hash: string }) {
  const [selectedFixtures, setSelectedFixtures] = useState([true, true, true, false]);
  const [loaded, setLoaded] = useState<{ selection: boolean[]; images: LocalImage[] }>();
  const [config, setConfig] = useState(initialConfig);
  const [metadata, setMetadata] = useState<Metadata>(emptyMetadata);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof publish>>>();
  const [dialog, setDialog] = useState<'details' | 'help'>();
  const publisher = useRef<AbortController>(null);
  const reading = Boolean(hash);
  const images = loaded?.selection === selectedFixtures ? loaded.images : [];

  useEffect(() => {
    const controller = new AbortController();
    let owned: LocalImage[] = [];
    setError('');
    setLoaded(undefined);
    setResult(undefined);
    setConsent(false);
    async function load() {
      if (hash) {
        const comparison = await openComparison(hash, controller.signal);
        if (controller.signal.aborted) {
          releaseImages(comparison.images);
          return;
        }
        owned = comparison.images;
        setMetadata(comparison.metadata);
        setConfig(comparison.config);
        setLoaded({ selection: selectedFixtures, images: owned });
        return;
      }
      setMetadata(emptyMetadata());
      setConfig(initialConfig);
      if (selectedFixtures.filter(Boolean).length < 2) return;
      for (const [index, enabled] of selectedFixtures.entries()) {
        if (!enabled) continue;
        const response = await fetch(fixtures[index], { signal: controller.signal });
        if (!response.ok) throw new Error('A synthetic fixture could not be loaded.');
        const file = new File([await response.arrayBuffer()], FIXTURE_NAMES[index], {
          type: types[index],
        });
        const image = await loadImage(file);
        if (controller.signal.aborted) {
          releaseImages([image]);
          return;
        }
        owned.push(image);
      }
      setLoaded({ selection: selectedFixtures, images: owned });
    }
    void load().catch((failure: Error) => {
      releaseImages(owned);
      owned = [];
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => {
      controller.abort();
      publisher.current?.abort();
      releaseImages(owned);
      owned = [];
    };
  }, [hash, selectedFixtures]);

  async function createLink() {
    if (!consent || publisher.current) return;
    const controller = new AbortController();
    publisher.current = controller;
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      const published = await publish(images, metadata, config, controller.signal);
      if (!controller.signal.aborted) setResult(published);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(
          failure instanceof Error ? failure.message : 'The comparison could not be published.',
        );
      }
    } finally {
      publisher.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function selectImage(side: 0 | 1, index: number) {
    setConfig((previous) => {
      const selected: Config['selected'] = [...previous.selected];
      if (selected[1 - side] === index) selected[1 - side] = selected[side];
      selected[side] = index;
      return { ...previous, selected };
    });
  }

  return (
    <main className="app experiment">
      <section className="experiment-controls">
        <h1>Uploadcare sharing experiment</h1>
        {reading ? (
          <a href={APP_URL}>New mock comparison</a>
        ) : (
          <>
            <fieldset disabled={busy}>
              <legend>Synthetic fixtures</legend>
              <div className="experiment-row">
                {FIXTURE_NAMES.map((name, index) => (
                  <label key={name}>
                    <input
                      type="checkbox"
                      checked={selectedFixtures[index]}
                      onChange={(event) =>
                        setSelectedFixtures((previous) =>
                          previous.map((value, position) =>
                            position === index ? event.target.checked : value,
                          ),
                        )
                      }
                    />
                    {name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="experiment-description">
              Description
              <textarea
                disabled={busy}
                maxLength={2000}
                value={metadata.description}
                onChange={(event) => setMetadata({ ...metadata, description: event.target.value })}
              />
            </label>
            <div className="experiment-row">
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                I understand that anyone with the link can read its description and access the
                synthetic images while this mock server runs.
              </label>
              <button
                className="primary"
                disabled={busy || !consent || images.length < 2}
                onClick={() => void createLink()}
              >
                {busy ? 'Verifying originals…' : 'Publish mock comparison'}
              </button>
            </div>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {result && (
          <div className="experiment-row" role="status">
            <a href={result.url} target="_blank" rel="noreferrer">
              Open verified comparison
            </a>
            <input aria-label="Comparison link" readOnly value={result.url} />
            <span>SHA-256 verified for {result.originals.length} originals.</span>
          </div>
        )}
        {images.length >= 2 && (
          <div className="experiment-row">
            {([0, 1] as const).map((side) => (
              <label key={side}>
                Image {side === 0 ? 'A' : 'B'}{' '}
                <select
                  value={config.selected[side]}
                  onChange={(event) => selectImage(side, Number(event.target.value))}
                >
                  {images.map(({ label }, index) => (
                    <option key={index} value={index}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button
              type="button"
              aria-pressed={config.mode === 'split'}
              onClick={() => setConfig({ ...config, mode: 'split' })}
            >
              Split
            </button>
            <button
              type="button"
              aria-pressed={config.mode === 'side'}
              onClick={() => setConfig({ ...config, mode: 'side' })}
            >
              Side by side
            </button>
          </div>
        )}
      </section>
      {images.length >= 2 ? (
        <div className="comparison-layout">
          <Viewer
            images={images}
            config={config}
            onChange={setConfig}
            onMetadata={() => setDialog('details')}
            onHelp={() => setDialog('help')}
          />
        </div>
      ) : (
        !error && (
          <p className="experiment-controls" role="status">
            {reading
              ? 'Verifying shared originals…'
              : selectedFixtures.filter(Boolean).length < 2
                ? 'Select at least two fixtures.'
                : 'Loading fixtures…'}
          </p>
        )
      )}
      {dialog && (
        <Modal
          title={dialog === 'details' ? 'Comparison details' : 'Viewer controls'}
          onClose={() => setDialog(undefined)}
        >
          {dialog === 'details' ? (
            <p className="experiment-notes">{metadata.description || 'No description.'}</p>
          ) : (
            <p>
              Drag to pan, scroll to zoom, or use the zoom controls. In split view, drag the divider
              to compare the images.
            </p>
          )}
        </Modal>
      )}
    </main>
  );
}

function Route() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const change = () => setHash(location.hash);
    addEventListener('hashchange', change);
    return () => removeEventListener('hashchange', change);
  }, []);
  return <Experiment key={hash} hash={hash} />;
}

createRoot(document.getElementById('root')!).render(<Route />);
