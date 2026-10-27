import { memo, useRef, useState } from 'react';
import { gestureDiagnostics, browserIdentity } from '../lib/gesture-diagnostics';
import { Modal } from './Modal';

export const GestureDiagnostics = memo(function GestureDiagnostics() {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [log, setLog] = useState('');
  const [message, setMessage] = useState('');
  const text = useRef<HTMLTextAreaElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const recorder = gestureDiagnostics;
  if (!recorder) return null;
  const reveal = () => {
    recorder.stop();
    setRecording(false);
    setLog(recorder.export());
    setOpen(true);
  };
  const select = () => {
    if (details.current) details.current.open = true;
    text.current?.focus();
    text.current?.select();
    text.current?.setSelectionRange(0, text.current.value.length);
  };
  const copy = async () => {
    const content = recorder.export();
    setLog(content);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(content);
      setMessage('Log copied.');
    } catch {
      // Local HTTP may lack Clipboard API. Keep a manual text-selection fallback.
      setMessage('Select the log below and use Copy, or download the JSON file.');
      requestAnimationFrame(() => {
        select();
        try {
          if (document.execCommand?.('copy')) setMessage('Log copied.');
        } catch {
          /* Manual selection remains available. */
        }
      });
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([recorder.export()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `upscale-compare-${browserIdentity(navigator.userAgent).name.toLowerCase()}-${recorder.recordedMode}-gestures.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setMessage('Log saved to your browser downloads.');
  };
  return (
    <>
      <button className="diagnostics-toggle" onClick={reveal}>
        {recording ? 'Stop diagnostic log' : 'Diagnostics'}
      </button>
      {open && (
        <Modal title="Gesture diagnostics" onClose={() => setOpen(false)} wide>
          <p>
            Local diagnostic mode. Nothing is sent automatically. Images, filenames, labels and
            metadata are not recorded.
          </p>
          <p className="muted small">
            Record a short session (about 15–20 seconds). Calculations may be evaluated more than
            once in development; only commit entries describe the committed view. Recording adds
            bounded in-memory work. Lift both fingers before stopping.
          </p>
          <p role="status">{message || `${recorder.count} entries recorded.`}</p>
          {recorder.truncated && <p role="alert">Log limit reached. Record a shorter session.</p>}
          <div className="diagnostics-actions">
            <button
              className="primary"
              onClick={() => {
                recorder.start();
                setRecording(true);
                setOpen(false);
                setLog('');
                setMessage('');
              }}
              disabled={!recorder.ready}
            >
              Start recording
            </button>
            <button onClick={download} disabled={!recorder.count}>
              Download log
            </button>
            <button onClick={copy} disabled={!recorder.count}>
              Copy log
            </button>
            <button
              onClick={() => {
                recorder.clear();
                setLog('');
                setMessage('Log cleared.');
              }}
            >
              Clear log
            </button>
          </div>
          {!!recorder.count && (
            <details ref={details}>
              <summary>View log</summary>
              <button onClick={select}>Select all log text</button>
              <textarea
                ref={text}
                aria-label="Diagnostic log JSON"
                readOnly
                value={log}
                rows={8}
                spellCheck={false}
              />
            </details>
          )}
        </Modal>
      )}
    </>
  );
});
