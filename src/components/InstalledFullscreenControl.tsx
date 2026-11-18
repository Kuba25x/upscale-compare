import {
  cloneElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type ReactElement,
} from 'react';
import { Shrink } from 'lucide-react';
import { Modal } from './Modal';

/** Web-only options on the existing control; no extra toolbar button or launch prompt. */
export function InstalledFullscreenControl({
  trigger,
  active,
  pending,
  error,
  onEnter,
  onLeave,
  onMinimalist,
}: {
  trigger: ReactElement<ComponentPropsWithRef<'button'>>;
  active: boolean;
  pending: boolean;
  error: string;
  onEnter: () => Promise<boolean>;
  onLeave: () => Promise<void>;
  onMinimalist: () => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const originalRef = trigger.props.ref;
  const setButton = useCallback(
    (node: HTMLButtonElement | null) => {
      button.current = node;
      if (typeof originalRef === 'function') return originalRef(node);
      if (originalRef) originalRef.current = node;
    },
    [originalRef],
  );
  const close = () => {
    restoreFocus.current = true;
    setOpen(false);
  };
  useLayoutEffect(() => {
    if (!open && restoreFocus.current) {
      restoreFocus.current = false;
      button.current?.focus({ preventScroll: true });
    }
  }, [open]);
  const supported =
    typeof document.documentElement.requestFullscreen === 'function' &&
    typeof document.exitFullscreen === 'function' &&
    document.fullscreenEnabled !== false;
  return (
    <>
      {cloneElement(trigger, {
        ref: setButton,
        'aria-label': 'Fullscreen options',
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        title: 'Fullscreen options',
        onClick: () => setOpen(true),
        children: active ? <Shrink size={16} /> : trigger.props.children,
      })}
      {open && (
        <Modal title="Fullscreen" onClose={close}>
          <div className="web-fullscreen-options">
            {active ? (
              <button
                onClick={() => {
                  void onLeave();
                  close();
                }}
              >
                {pending ? 'Cancel fullscreen request' : 'Exit fullscreen'}
              </button>
            ) : (
              <button
                disabled={!supported}
                onClick={() => {
                  // Start directly in this click, preserving transient user activation.
                  void onEnter().then((entered) => {
                    if (entered) close();
                  });
                }}
              >
                Fullscreen with controls
              </button>
            )}
            <button
              onClick={() => {
                onMinimalist();
                close();
              }}
            >
              Minimalist mode
            </button>
          </div>
          {(!supported || error) && (
            <p className="muted small" role="status">
              {error || 'This browser cannot expand the app window. Minimalist mode is available.'}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
