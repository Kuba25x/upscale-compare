import App from './App';
import { useWebViewport } from './lib/web-viewport';
import { useMobileFullscreen } from './lib/web-fullscreen';
import { InstalledFullscreenControl } from './components/InstalledFullscreenControl';
import { cloneElement } from 'react';
import { Minimize2 } from 'lucide-react';

export default function WebApp() {
  const { presentation, mobile, desktop, installedLandscape, installedFullscreen } =
    useWebViewport();
  const { minimalist, setMinimalist, withControls, pending, error, enterWithControls, leave } =
    useMobileFullscreen(mobile || installedLandscape || installedFullscreen, installedLandscape);
  return (
    <App
      desktopImageControls={desktop}
      className={installedFullscreen ? 'installed-fullscreen' : ''}
      installedAndroidFullscreen={installedFullscreen && /\bAndroid\b/i.test(navigator.userAgent)}
      minimalistExitLabel={installedFullscreen ? 'Show controls' : undefined}
      presentation={{
        ...presentation,
        edgeToEdge: presentation.edgeToEdge || minimalist || installedFullscreen,
        minimalist,
      }}
      onSetMinimalist={setMinimalist}
      renderFullscreenControl={
        installedFullscreen
          ? (trigger) =>
              cloneElement(trigger, {
                'aria-label': 'Minimalist mode',
                title: 'Minimalist mode (F)',
                onClick: () => void setMinimalist?.(true),
                children: <Minimize2 size={16} />,
              })
          : installedLandscape || withControls
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
