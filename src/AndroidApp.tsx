import { useCallback, useState } from 'react';
import App from './App';
import { useAndroidDisplay } from './lib/android-display';
import { androidServices } from './lib/android-services';

export default function AndroidApp() {
  const [displayError, setDisplayError] = useState<{ message: string }>();
  // Forward each failure, including a repeated message after the toast was dismissed.
  const reportError = useCallback((message: string) => setDisplayError({ message }), []);
  const { presentation, setMinimalist } = useAndroidDisplay(reportError);
  return (
    <App
      android={androidServices}
      presentation={presentation}
      onSetMinimalist={setMinimalist}
      displayError={displayError}
    />
  );
}
