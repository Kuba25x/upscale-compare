import { useLayoutEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { ChoiceMenu } from './ChoiceMenu';

export function DesktopImageName({
  slot,
  imageUrl,
  label,
  choices,
  selected,
  onSelect,
  onRename,
}: {
  slot: 'A' | 'B';
  imageUrl: string;
  label: string;
  choices: { value: number; label: string }[];
  selected: number;
  onSelect: (index: number) => void;
  onRename?: (label: string) => void;
}) {
  const [draft, setDraft] = useState<{ url: string; label: string }>();
  const editor = useRef<HTMLInputElement>(null);
  const pencil = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const editing = Boolean(onRename) && draft?.url === imageUrl;

  useLayoutEffect(() => {
    if (editing) {
      editor.current?.focus({ preventScroll: true });
      editor.current?.select();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      pencil.current?.focus({ preventScroll: true });
    }
  }, [editing]);

  return (
    <div className="desktop-image-name">
      {editing ? (
        <input
          ref={editor}
          className="desktop-label-editor"
          aria-label={`Label for image ${slot}`}
          placeholder="Screenshot label"
          maxLength={120}
          value={draft?.label ?? ''}
          onChange={(event) => setDraft({ url: imageUrl, label: event.currentTarget.value })}
          onBlur={(event) => {
            if (!restoreFocus.current) onRename?.(event.currentTarget.value);
            setDraft(undefined);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || (event.key !== 'Enter' && event.key !== 'Escape'))
              return;
            event.preventDefault();
            event.stopPropagation();
            restoreFocus.current = true;
            if (event.key === 'Enter') onRename?.(event.currentTarget.value);
            setDraft(undefined);
          }}
        />
      ) : (
        <>
          <ChoiceMenu
            label={`Select image ${slot}`}
            menuLabel={`Image ${slot} screenshots`}
            value={
              <span className="desktop-image-label" title={label}>
                {label}
              </span>
            }
            choices={choices}
            selected={selected}
            triggerClass="desktop-image-trigger"
            menuClass="desktop-image-choices"
            onSelect={onSelect}
            focusOnPointer
          />
          {onRename && (
            <button
              ref={pencil}
              type="button"
              className="desktop-rename-button"
              aria-label={`Edit label for image ${slot}`}
              title="Edit screenshot label"
              onClick={() => setDraft({ url: imageUrl, label })}
            >
              <Pencil size={13} aria-hidden="true" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
