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

export function useMobileFullscreen(eligible: boolean) {
  const [minimalist, setMinimalist] = useState(false);
  const session = useRef<{ cancelled: boolean; entered: boolean; pending: boolean } | null>(null);
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
    setMinimalist(false);
    await exitOwned();
    if (
      session.current === current &&
      current &&
      !current.pending &&
      document.fullscreenElement !== document.documentElement
    )
      session.current = null;
  }, [exitOwned]);
  const setMode = useCallback(
    async (next: boolean) => {
      if (!next) return leave();
      if (!eligible || (session.current && !session.current.cancelled)) return;
      const attempt = { cancelled: false, entered: false, pending: false };
      session.current = attempt;
      setMinimalist(true);
      // A previous native exit may still be settling; keep a new CSS session independent.
      if (exitPending.current) return;
      const root = document.documentElement;
      if (document.fullscreenElement === root) {
        attempt.entered = true;
        return;
      }
      try {
        if (
          typeof root.requestFullscreen === 'function' &&
          typeof document.exitFullscreen === 'function'
        ) {
          attempt.pending = true;
          // Invoke within the user action, before yielding or waiting for a React effect.
          await root.requestFullscreen();
          if (
            session.current === attempt &&
            !attempt.cancelled &&
            document.fullscreenElement === root
          )
            attempt.entered = true;
        }
      } catch {
        // A denied/missing API leaves the comparison-only CSS view usable.
      } finally {
        attempt.pending = false;
        // A delayed request must not reopen fullscreen after the user has left the view.
        if (session.current === attempt && attempt.cancelled) {
          await exitOwned();
          if (session.current === attempt && document.fullscreenElement !== root)
            session.current = null;
        }
      }
    },
    [eligible, leave, exitOwned],
  );

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

  return { minimalist, setMinimalist: eligible || minimalist ? setMode : undefined };
}
