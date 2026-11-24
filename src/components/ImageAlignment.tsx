import { useId, useState } from 'react';
import type { AlignmentMode } from '../../shared/model';
import { alignmentOptions } from '../lib/alignment';
import type { Size } from '../lib/geometry';
import { Modal } from './Modal';

export function AlignmentOptions({
  mode,
  onSelect,
  disabled,
  descriptions = false,
}: {
  mode: AlignmentMode;
  onSelect: (mode: AlignmentMode) => void;
  disabled?: boolean;
  descriptions?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="image-alignment" disabled={disabled}>
      <legend>Image Alignment</legend>
      <div className={descriptions ? 'alignment-options detailed' : 'alignment-options'}>
        {alignmentOptions.map((option) => (
          <label key={option.mode}>
            <input
              type="radio"
              name={name}
              checked={mode === option.mode}
              aria-label={option.label}
              aria-describedby={descriptions ? `${name}-${option.mode}` : undefined}
              onChange={() => onSelect(option.mode)}
              onClick={() => {
                if (mode === option.mode) onSelect(option.mode);
              }}
            />
            <span>
              {option.label}
              {descriptions && (
                <span className="muted" id={`${name}-${option.mode}`}>
                  {option.description}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AlignmentDialog({
  a,
  b,
  mode,
  onApply,
  onClose,
}: {
  a: Size;
  b: Size;
  mode: AlignmentMode;
  onApply: (mode: AlignmentMode) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(mode);
  return (
    <Modal title="Image size mismatch" onClose={onClose}>
      <p className="image-alignment-dimensions">
        <span>
          Image A{' '}
          <b>
            {a.width} × {a.height}
          </b>
        </span>
        <span>
          Image B{' '}
          <b>
            {b.width} × {b.height}
          </b>
        </span>
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply(draft);
        }}
      >
        <AlignmentOptions mode={draft} onSelect={setDraft} descriptions />
        <div className="modal-actions">
          <button className="primary" type="submit">
            Apply
          </button>
        </div>
      </form>
    </Modal>
  );
}
