import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';

const isCapacitorNative =
  typeof window !== 'undefined' &&
  Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());

if (typeof window !== 'undefined' && !isCapacitorNative && 'serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    void navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const reg of regs) {
        void reg.unregister();
      }
    });
  } else {
    registerSW({ immediate: true });
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
