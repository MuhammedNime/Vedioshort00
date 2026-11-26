import { idbDelete, idbGet, idbSet } from './projectStore';

const TTS_INDEX_KEY = 'tts_audio_cache_index_v1';
const TTS_ENTRY_PREFIX = 'tts_audio_entry_';
const MAX_TTS_CACHE_ENTRIES = 150;

export interface CachedTtsAudio {
  dataUrl: string;
  duration: number;
  voiceName: string;
  createdAt: number;
}

function hashTtsKey(voiceName: string, text: string): string {
  const normalized = `${voiceName.trim().toLowerCase()}|${text.trim().replace(/\s+/g, ' ')}`;
  let h1 = 2166136261;
  let h2 = 3735928559;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 16777619);
    h2 ^= ch + (i & 255);
    h2 = Math.imul(h2, 2246822519);
  }
  return `${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}_${normalized.length}`;
}

export async function getCachedTtsAudio(
  voiceName: string,
  text: string
): Promise<CachedTtsAudio | null> {
  const clean = text.trim();
  if (!clean) return null;
  const key = hashTtsKey(voiceName, clean);
  try {
    const entry = await idbGet<CachedTtsAudio>(`${TTS_ENTRY_PREFIX}${key}`);
    if (entry && typeof entry.dataUrl === 'string' && entry.dataUrl.startsWith('data:audio/')) {
      return entry;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export async function saveCachedTtsAudio(
  voiceName: string,
  text: string,
  dataUrl: string,
  duration: number
): Promise<void> {
  const clean = text.trim();
  if (!clean || !dataUrl || !dataUrl.startsWith('data:audio/')) return;
  const key = hashTtsKey(voiceName, clean);
  const entry: CachedTtsAudio = {
    dataUrl,
    duration,
    voiceName,
    createdAt: Date.now(),
  };

  try {
    await idbSet(`${TTS_ENTRY_PREFIX}${key}`, entry);
    const index = (await idbGet<string[]>(TTS_INDEX_KEY)) ?? [];
    const nextIndex = [key, ...index.filter((k) => k !== key)];
    if (nextIndex.length > MAX_TTS_CACHE_ENTRIES) {
      const evicted = nextIndex.slice(MAX_TTS_CACHE_ENTRIES);
      for (const oldKey of evicted) {
        await idbDelete(`${TTS_ENTRY_PREFIX}${oldKey}`);
      }
    }
    await idbSet(TTS_INDEX_KEY, nextIndex.slice(0, MAX_TTS_CACHE_ENTRIES));
  } catch {
    // ignore quota errors
  }
}

export function isBrowserSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function stopBrowserPreview(): void {
  if (!isBrowserSpeechAvailable()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}

export function speakFreeBrowserPreview(text: string): boolean {
  if (!isBrowserSpeechAvailable()) return false;
  const clean = text
    .replace(/\$\$?/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return false;

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    const hasArabic = /[\u0600-\u06FF]/.test(clean);
    utterance.lang = hasArabic ? 'ar-SA' : 'en-US';
    utterance.rate = 1.02;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices?.() ?? [];
    if (voices.length > 0) {
      const preferred = voices.find((v) =>
        hasArabic ? v.lang.toLowerCase().startsWith('ar') : v.lang.toLowerCase().startsWith('en')
      );
      if (preferred) utterance.voice = preferred;
    }

    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
