import { useCallback, useEffect, useRef, useState } from 'react';

/** Exit only the fullscreen element requested by this adapter. */
async function exitPageFullscreen() {
  if (document.fullscreenElement !== document.documentElement) return;
  try {
    await document.exitFullscreen?.();
  } catch {
    // The browser may already have exited, or may require its own system exit control.
  }
}

type Mode = 'minimalist' | 'controls';
const unavailable = 'Fullscreen is unavailable. Your comparison is unchanged.';

export function useMobileFullscreen(eligible: boolean, controlsEligible = false) {
  const [mode, setView] = useState<Mode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const session = useRef<{
    mode: Mode;
    cancelled: boolean;
    entered: boolean;
    pending: boolean;
  } | null>(null);
  const exitPending = useRef<Promise<void> | null>(null);
  const exitOwned = useCallback(() => {
    if (exitPending.current) return exitPending.current;
    if (document.fullscreenElement !== document.documentElement) return Promise.resolve();
    const pending = exitPageFullscreen();
    exitPending.current = pending;
    void pending.then(() => {
      if (exitPending.current === pending) exitPending.current = null;
    });
    return pending;
  }, []);
  const leave = useCallback(async () => {
    const current = session.current;
    if (current) current.cancelled = true;
    setView(null);
    setError('');
    await exitOwned();
    if (
      session.current === current &&
      current?.mode === 'controls' &&
      document.fullscreenElement === document.documentElement
    ) {
      // Keep an explicit exit available when the browser rejects programmatic exit.
      current.cancelled = false;
      setView('controls');
      setError('Use the browser or system fullscreen exit control.');
    }
    if (
      session.current === current &&
      current &&
      !current.pending &&
      document.fullscreenElement !== document.documentElement
    )
      session.current = null;
  }, [exitOwned]);
  const setMode = useCallback(
    async (next: Mode): Promise<boolean> => {
      if (next === 'controls' ? !controlsEligible : !eligible) return false;
      const current = session.current;
      if (current && !current.cancelled) {
        // Transfer the same native session to minimalist presentation, including
        // an in-flight request. Never race a second fullscreen request against it.
        if (next === 'minimalist' || document.fullscreenElement === document.documentElement) {
          current.mode = next;
          setView(next);
          setError('');
        }
        return document.fullscreenElement === document.documentElement;
      }
      const attempt = { mode: next, cancelled: false, entered: false, pending: false };
      session.current = attempt;
      setView(next);
      setError('');
      const fail = () => {
        if (session.current === attempt && !attempt.cancelled && attempt.mode === 'controls') {
          session.current = null;
          setView(null);
          setError(unavailable);
        }
      };
      // A previous native exit may still be settling; keep a new CSS session independent.
      if (exitPending.current) {
        fail();
        return false;
      }
      const root = document.documentElement;
      if (document.fullscreenElement === root) {
        attempt.entered = true;
        return true;
      }
      try {
        if (
          typeof root.requestFullscreen === 'function' &&
          typeof document.exitFullscreen === 'function' &&
          (next !== 'controls' || document.fullscreenEnabled !== false)
        ) {
          attempt.pending = true;
          setPending(true);
          // Invoke within the user action, before yielding or waiting for a React effect.
          await root.requestFullscreen(next === 'controls' ? { navigationUI: 'hide' } : undefined);
          if (
            session.current === attempt &&
            !attempt.cancelled &&
            document.fullscreenElement === root
          )
            attempt.entered = true;
          else fail();
        } else fail();
      } catch {
        // A denied/missing API leaves the comparison-only CSS view usable.
        fail();
      } finally {
        attempt.pending = false;
        if (session.current === attempt || !session.current) setPending(false);
        // A delayed request must not reopen fullscreen after the user has left the view.
        if (session.current === attempt && attempt.cancelled) {
          await leave();
        }
      }
      return session.current === attempt && !attempt.cancelled && attempt.entered;
    },
    [eligible, controlsEligible, leave],
  );

  const setMinimalist = useCallback(
    async (next: boolean) => {
      if (next) await setMode('minimalist');
      else await leave();
    },
    [setMode, leave],
  );
  const enterWithControls = useCallback(() => setMode('controls'), [setMode]);

  useEffect(() => {
    // Rotation never grants user activation. Exit this opt-in mode on portrait;
    // do not automatically re-enter when the device returns to landscape.
    if (!controlsEligible && session.current?.mode === 'controls') void leave();
  }, [controlsEligible, leave]);

  useEffect(() => {
    const change = () => {
      const current = session.current;
      if (!current) return;
      if (document.fullscreenElement === document.documentElement) {
        if (current.cancelled) void exitOwned();
        else current.entered = true;
      } else if (current.entered && !current.cancelled) void leave();
      else if (current.cancelled && !current.pending) session.current = null;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !session.current || session.current.cancelled) return;
      if (document.querySelector('[popover][data-open]')) return;
      if (session.current.mode === 'controls' && document.querySelector('dialog[open]')) return;
      event.preventDefault();
      event.stopPropagation();
      void leave();
    };
    document.addEventListener('fullscreenchange', change);
    window.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('fullscreenchange', change);
      window.removeEventListener('keydown', escape, true);
      if (session.current) {
        session.current.cancelled = true;
        void exitOwned();
      }
    };
  }, [leave, exitOwned]);

  return {
    minimalist: mode === 'minimalist',
    withControls: mode === 'controls',
    pending,
    error,
    setMinimalist: eligible || mode === 'minimalist' ? setMinimalist : undefined,
    enterWithControls,
    leave,
  };
}
