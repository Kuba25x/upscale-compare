import { useState } from 'react';
import type { LocalImage, Metadata } from '../../shared/model';
import { metadataSchema, imageMetadataSchema } from '../../shared/model';
import { Modal } from './Modal';
import { formatBytes } from '../lib/images';
export function MetadataEditor({
  images,
  metadata,
  readOnly,
  onSave,
  onClose,
}: {
  images: LocalImage[];
  metadata: Metadata;
  readOnly: boolean;
  onSave: (metadata: Metadata, images: LocalImage[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(metadata);
  const [screenshots, setScreenshots] = useState(images);
  const [error, setError] = useState('');
  return (
    <Modal
      title={readOnly ? 'Comparison details' : 'Edit comparison details'}
      onClose={onClose}
      wide
    >
      <p className="muted">
        All fields are optional. Image dimensions are read from the original files.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = metadataSchema.safeParse(draft);
          if (
            !parsed.success ||
            screenshots.some((image) => !imageMetadataSchema.safeParse(image.metadata).success)
          ) {
            setError('Check the metadata values and remove control characters.');
            return;
          }
          onSave(parsed.data, screenshots);
        }}
      >
        <fieldset disabled={readOnly} className="form-fields">
          <div className="form-grid">
            <label>
              Game title
              <input
                maxLength={120}
                value={draft.game}
                onChange={(event) => setDraft({ ...draft, game: event.target.value })}
                placeholder="e.g. Cyberpunk 2077"
              />
            </label>
            <label>
              GPU / hardware
              <input
                maxLength={160}
                value={draft.gpu}
                onChange={(event) => setDraft({ ...draft, gpu: event.target.value })}
                placeholder="e.g. GeForce RTX 5080"
              />
            </label>
          </div>
          {screenshots.map((image, index) => (
            <div className="metadata-image" key={index}>
              <div className="metadata-image-heading">
                <b>{image.label}</b>
                <span className="muted">
                  {image.width} × {image.height} · {formatBytes(image.size)} ·{' '}
                  {image.type.split('/')[1].toUpperCase()}
                </span>
              </div>
              <div className="form-grid three">
                {(['technology', 'preset', 'renderingResolution'] as const).map((key) => (
                  <label key={key}>
                    {
                      {
                        technology: 'Upscaling technology',
                        preset: 'Quality preset',
                        renderingResolution: 'Rendering resolution',
                      }[key]
                    }
                    <input
                      maxLength={80}
                      value={image.metadata[key]}
                      onChange={(event) =>
                        setScreenshots((previous) =>
                          previous.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  metadata: { ...item.metadata, [key]: event.target.value },
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
          <label>
            Graphics settings
            <textarea
              maxLength={2000}
              rows={3}
              value={draft.settings}
              onChange={(event) => setDraft({ ...draft, settings: event.target.value })}
            />
          </label>
          <label>
            Description
            <textarea
              maxLength={2000}
              rows={3}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {readOnly ? (
            <button type="button" onClick={onClose}>
              Close
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="primary" type="submit">
                Save details
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
