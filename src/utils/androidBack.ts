type BackHandler = () => boolean;

const subHandlers: BackHandler[] = [];
let rootHandler: BackHandler | null = null;

export function registerBackHandler(handler: BackHandler): () => void {
  subHandlers.push(handler);
  return () => {
    const idx = subHandlers.lastIndexOf(handler);
    if (idx >= 0) {
      subHandlers.splice(idx, 1);
    }
  };
}

export function setRootBackHandler(handler: BackHandler): () => void {
  rootHandler = handler;
  if (typeof window !== 'undefined') {
    (window as unknown as { __handleAndroidBack?: () => boolean }).__handleAndroidBack = () => {
      for (let i = subHandlers.length - 1; i >= 0; i--) {
        if (subHandlers[i]()) {
          return true;
        }
      }
      if (rootHandler) {
        return rootHandler();
      }
      return false;
    };
  }
  return () => {
    if (rootHandler === handler) {
      rootHandler = null;
    }
  };
}
