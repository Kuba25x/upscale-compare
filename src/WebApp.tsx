import App from './App';
import { useWebViewport } from './lib/web-viewport';
import { useMobileFullscreen } from './lib/web-fullscreen';
import { InstalledFullscreenControl } from './components/InstalledFullscreenControl';

export default function WebApp() {
  const { presentation, mobile, installedLandscape } = useWebViewport();
  const { minimalist, setMinimalist, withControls, pending, error, enterWithControls, leave } =
    useMobileFullscreen(mobile || installedLandscape, installedLandscape);
  return (
    <App
      presentation={{
        ...presentation,
        edgeToEdge: presentation.edgeToEdge || minimalist,
        minimalist,
      }}
      onSetMinimalist={setMinimalist}
      renderFullscreenControl={
        installedLandscape || withControls
          ? (trigger) => (
              <InstalledFullscreenControl
                trigger={trigger}
                active={withControls}
                pending={pending}
                error={error}
                onEnter={enterWithControls}
                onLeave={leave}
                onMinimalist={() => void setMinimalist?.(true)}
              />
            )
          : undefined
      }
    />
  );
}
