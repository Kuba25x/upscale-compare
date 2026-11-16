import App from './App';
import { useWebViewport } from './lib/web-viewport';
import { useMobileFullscreen } from './lib/web-fullscreen';

export default function WebApp() {
  const { presentation, mobile } = useWebViewport();
  const { minimalist, setMinimalist } = useMobileFullscreen(mobile);
  return (
    <App
      presentation={{
        ...presentation,
        edgeToEdge: presentation.edgeToEdge || minimalist,
        minimalist,
      }}
      onSetMinimalist={setMinimalist}
    />
  );
}
