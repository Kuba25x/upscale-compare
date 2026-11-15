import App from './App';
import { useWebViewport } from './lib/web-viewport';

export default function WebApp() {
  const presentation = useWebViewport();
  return <App presentation={presentation} />;
}
