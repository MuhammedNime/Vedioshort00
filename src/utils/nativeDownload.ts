interface AndroidNativeBridgeApi {
  requestAudioPermission?: () => boolean;
  openExternalUrl?: (url: string) => boolean;
  beginSaveFile?: (fileName: string, mimeType: string) => string;
  appendSaveChunk?: (uploadId: string, base64Chunk: string) => boolean;
  abortSaveFile?: (uploadId: string) => void;
  finishSaveFile?: (uploadId: string) => string;
  finishShareFile?: (uploadId: string) => string;
  finishShareFileWithText?: (uploadId: string, extraText: string) => string;
  saveFile?: (base64Data: string, fileName: string, mimeType: string) => string;
  shareFile?: (base64Data: string, fileName: string, mimeType: string) => string;
}

function getAndroidBridge(): AndroidNativeBridgeApi | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AndroidNativeBridge?: AndroidNativeBridgeApi };
  return w.AndroidNativeBridge ?? null;
}

export function isAndroidNativeApp(): boolean {
  return Boolean(getAndroidBridge()?.saveFile || getAndroidBridge()?.beginSaveFile);
}

export function openExternalBrowserUrl(url: string): boolean {
  const clean = (url || '').trim();
  if (!/^https?:\/\//i.test(clean)) return false;
  const bridge = getAndroidBridge();
  if (bridge?.openExternalUrl) {
    return Boolean(bridge.openExternalUrl(clean));
  }
  if (typeof document === 'undefined') return false;
  try {
    const a = document.createElement('a');
    a.href = clean;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch {
    return false;
  }
}

export function normalizeExportMime(mimeType?: string, fileName?: string): string {
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (base && base !== 'application/octet-stream') {
    return base;
  }
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  return 'application/octet-stream';
}

export function canShareNatively(fileName: string, mimeType: string, blob: Blob): boolean {
  if (getAndroidBridge()?.shareFile || getAndroidBridge()?.finishShareFile) return true;
  const safeMime = normalizeExportMime(mimeType || blob.type, fileName);
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    try {
      const testFile = new File([blob], fileName, { type: safeMime });
      return navigator.canShare({ files: [testFile] });
    } catch {
      return false;
    }
  }
  return false;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const blockSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += blockSize) {
    const sub = bytes.subarray(i, Math.min(i + blockSize, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof blob.arrayBuffer === 'function') {
    try {
      const buf = await blob.arrayBuffer();
      return uint8ToBase64(new Uint8Array(buf));
    } catch {
      // fall back to FileReader
    }
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const marker = result.indexOf(';base64,');
      resolve(marker >= 0 ? result.slice(marker + 8) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

async function streamBlobToAndroidBridge(
  bridge: AndroidNativeBridgeApi,
  blob: Blob,
  fileName: string,
  safeMime: string
): Promise<string | null> {
  if (!bridge.beginSaveFile || !bridge.appendSaveChunk) return null;
  const uploadId = bridge.beginSaveFile(fileName, safeMime);
  if (!uploadId) return null;

  const CHUNK_SIZE = 256 * 1024; // 256 KB chunks keep Android WebView JNI responsive
  try {
    let chunkCount = 0;
    for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
      const slice = blob.slice(offset, Math.min(offset + CHUNK_SIZE, blob.size));
      const b64 = await blobToBase64(slice);
      const ok = bridge.appendSaveChunk(uploadId, b64);
      if (!ok) {
        throw new Error('تعذر كتابة بيانات الملف على الجهاز');
      }
      chunkCount += 1;
      if (chunkCount % 4 === 0) {
        await new Promise((r) => window.setTimeout(r, 0));
      }
    }
    return uploadId;
  } catch (err) {
    try {
      bridge.abortSaveFile?.(uploadId);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

export async function saveOrDownloadBlob(
  blob: Blob,
  fileName: string,
  mimeType?: string
): Promise<{
  savedNatively: boolean;
  ok: boolean;
  fileName?: string;
  savedLocation?: string;
  error?: string;
}> {
  const bridge = getAndroidBridge();
  const safeMime = normalizeExportMime(mimeType || blob.type, fileName);

  if (bridge?.beginSaveFile && bridge?.appendSaveChunk && bridge?.finishSaveFile) {
    try {
      const uploadId = await streamBlobToAndroidBridge(bridge, blob, fileName, safeMime);
      if (uploadId) {
        const raw = bridge.finishSaveFile(uploadId);
        const parsed = JSON.parse(raw) as {
          ok?: boolean;
          fileName?: string;
          savedLocation?: string;
          error?: string;
        };
        return {
          savedNatively: true,
          ok: Boolean(parsed.ok),
          fileName: parsed.fileName ?? fileName,
          savedLocation: parsed.savedLocation,
          error: parsed.error,
        };
      }
    } catch (err) {
      return {
        savedNatively: true,
        ok: false,
        error: err instanceof Error ? err.message : 'تعذر حفظ الملف على الجهاز',
      };
    }
  }

  if (bridge?.saveFile) {
    try {
      const base64 = await blobToBase64(blob);
      const raw = bridge.saveFile(base64, fileName, safeMime);
      const parsed = JSON.parse(raw) as {
        ok?: boolean;
        fileName?: string;
        savedLocation?: string;
        error?: string;
      };
      return {
        savedNatively: true,
        ok: Boolean(parsed.ok),
        fileName: parsed.fileName ?? fileName,
        savedLocation: parsed.savedLocation,
        error: parsed.error,
      };
    } catch (err) {
      return {
        savedNatively: true,
        ok: false,
        error: err instanceof Error ? err.message : 'تعذر حفظ الملف على الجهاز',
      };
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { savedNatively: false, ok: true, fileName };
}

export async function shareBlobNatively(
  blob: Blob,
  fileName: string,
  mimeType: string,
  title = 'فيديو شورتس الأسئلة',
  shareText = ''
): Promise<boolean> {
  const bridge = getAndroidBridge();
  const safeMime = normalizeExportMime(mimeType || blob.type, fileName);

  if (
    bridge?.beginSaveFile &&
    bridge?.appendSaveChunk &&
    (bridge?.finishShareFileWithText || bridge?.finishShareFile)
  ) {
    const uploadId = await streamBlobToAndroidBridge(bridge, blob, fileName, safeMime);
    if (uploadId) {
      const raw = bridge.finishShareFileWithText
        ? bridge.finishShareFileWithText(uploadId, shareText)
        : bridge.finishShareFile!(uploadId);
      try {
        const parsed = JSON.parse(raw) as { ok?: boolean };
        return Boolean(parsed.ok);
      } catch {
        return true;
      }
    }
  }

  if (bridge?.shareFile) {
    const base64 = await blobToBase64(blob);
    const raw = bridge.shareFile(base64, fileName, safeMime);
    try {
      const parsed = JSON.parse(raw) as { ok?: boolean };
      return Boolean(parsed.ok);
    } catch {
      return true;
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const file = new File([blob], fileName, { type: safeMime });
    await navigator.share({ title, text: shareText || undefined, files: [file] });
    return true;
  }
  return false;
}
