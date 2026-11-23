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
  const [draft, setDraft] = useState<{ url: string; label: string; width: number }>();
  const visibleLabel = useRef<HTMLSpanElement>(null);
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

  function startEditing() {
    const name = visibleLabel.current!;
    const width = name.getBoundingClientRect().width;
    setDraft({
      url: imageUrl,
      label,
      // Only expand short labels that already fit without truncation.
      width: name.scrollWidth > name.clientWidth ? width : Math.max(96, width),
    });
  }

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
          style={{ width: draft?.width }}
          onChange={(event) => {
            const label = event.currentTarget.value;
            setDraft((current) => current && { ...current, label });
          }}
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
            valueRef={visibleLabel}
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
              onClick={startEditing}
            >
              <Pencil size={13} aria-hidden="true" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
