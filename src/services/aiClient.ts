import { soundEngine } from '../audio/soundEngine';
import { getAvoidQuestionsForCategory } from '../storage/questionBankVault';
import { QUIZ_CATEGORIES, QuestionSlide, QuizCategory, SlideAudioClip } from '../types/quiz';

export type AiVoiceName = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
export type AiVoiceMode = 'questionOnly' | 'questionAndAnswer' | 'full';

export const AI_VOICE_OPTIONS: { id: AiVoiceName; label: string }[] = [
  { id: 'Kore', label: 'كوري (واضح واحترافي)' },
  { id: 'Puck', label: 'باك (حماسي سريع)' },
  { id: 'Charon', label: 'شارون (عميق رصين)' },
  { id: 'Zephyr', label: 'زيفير (هادئ سلس)' },
  { id: 'Fenrir', label: 'فنرير (جهوري قوي)' },
];

export interface TtsKeyQuotaInfo {
  index: number;
  label: string;
  tail: string;
  limit: number;
  used: number;
  remaining: number;
  status: 'ready' | 'cooldown' | 'exhausted' | 'invalid';
  cooldownRemainingSec: number;
  beyondFreeTier: boolean;
}

export interface TtsQuotaSnapshot {
  utcDate: string;
  perKeyDailyLimit: number;
  totalKeys: number;
  activeKeys: number;
  totalDailyLimit: number;
  usedToday: number;
  remainingToday: number;
  allExhausted: boolean;
  beyondFreeTier: boolean;
  nextResetAtIso: string;
  updatedAtIso: string;
  keys: TtsKeyQuotaInfo[];
}

export class AiApiError extends Error {
  public readonly status: number;
  public readonly quotaExhausted: boolean;

  constructor(message: string, status = 500, quotaExhausted = false) {
    super(message);
    this.name = 'AiApiError';
    this.status = status;
    this.quotaExhausted = quotaExhausted;
  }
}

let cachedTtsQuota: TtsQuotaSnapshot | null = null;
const ttsQuotaListeners = new Set<(q: TtsQuotaSnapshot) => void>();

export function getCachedTtsQuota(): TtsQuotaSnapshot | null {
  return cachedTtsQuota;
}

export function updateCachedTtsQuota(snapshot: TtsQuotaSnapshot | null | undefined): void {
  if (!snapshot) return;
  cachedTtsQuota = snapshot;
  ttsQuotaListeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      // ignore listener error
    }
  });
}

export function subscribeTtsQuota(listener: (q: TtsQuotaSnapshot) => void): () => void {
  ttsQuotaListeners.add(listener);
  if (cachedTtsQuota) {
    listener(cachedTtsQuota);
  }
  return () => {
    ttsQuotaListeners.delete(listener);
  };
}

const ENV_MAP = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const BUILD_API_BASE = (ENV_MAP.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');

function parseEmbeddedClientKeys(names: string[]): string[] {
  const combined = names.map((n) => ENV_MAP[n] || '').join('\n');
  const seen = new Set<string>();
  const list: string[] = [];
  for (const part of combined.split(/[\s,;]+/)) {
    const clean = part.trim();
    if (!clean || clean === 'MY_GEMINI_API_KEY' || seen.has(clean)) continue;
    seen.add(clean);
    list.push(clean);
  }
  return list;
}

const EMBEDDED_CLIENT_GEMINI_KEYS = parseEmbeddedClientKeys([
  'VITE_GEMINI_API_KEY',
  'VITE_GEMINI_API_KEYS',
  ...Array.from({ length: 10 }, (_, idx) => `VITE_GEMINI_API_KEY_${idx + 1}`),
]);

const EMBEDDED_CLIENT_GROQ_KEYS = parseEmbeddedClientKeys([
  'VITE_GROQ_API_KEY',
  'VITE_GROQ_API_KEYS',
]);

const EMBEDDED_CLIENT_OPENROUTER_KEYS = parseEmbeddedClientKeys([
  'VITE_OPENROUTER_API_KEY',
  'VITE_OPENROUTER_API_KEYS',
]);

function hasAnyEmbeddedTextAiKeys(): boolean {
  return (
    EMBEDDED_CLIENT_GEMINI_KEYS.length > 0 ||
    EMBEDDED_CLIENT_GROQ_KEYS.length > 0 ||
    EMBEDDED_CLIENT_OPENROUTER_KEYS.length > 0
  );
}

function extractClientJsonPayload(rawText: string): unknown {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const startObj = cleaned.indexOf('{');
    const startArr = cleaned.indexOf('[');
    const start =
      startObj !== -1 && startArr !== -1
        ? Math.min(startObj, startArr)
        : Math.max(startObj, startArr);
    if (start === -1) throw new Error('لم يُرجع الذكاء الاصطناعي بيانات JSON صالحة.');
    const openChar = cleaned[start];
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
      }
    }
    throw new Error('تعذر قراءة JSON من استجابة الذكاء الاصطناعي.');
  }
}

async function runApkExternalJsonFallback(
  systemInstruction: string,
  userPrompt: string
): Promise<unknown> {
  const providers: Array<{
    name: 'groq' | 'openrouter';
    endpoint: string;
    keys: string[];
    models: string[];
  }> = [
    {
      name: 'groq',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      keys: EMBEDDED_CLIENT_GROQ_KEYS,
      models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    },
    {
      name: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      keys: EMBEDDED_CLIENT_OPENROUTER_KEYS,
      models: [
        'meta-llama/llama-3.3-70b-instruct:free',
        'google/gemma-3-27b-it:free',
        'openrouter/free',
      ],
    },
  ];

  let lastErr: unknown = new AiApiError('لا توجد مفاتيح احتياطية مضافة.', 500, false);
  for (const provider of providers) {
    if (provider.keys.length === 0) continue;
    for (const apiKey of provider.keys) {
      for (const model of provider.models) {
        try {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          };
          if (provider.name === 'openrouter') {
            headers['X-Title'] = 'Shorts Quiz Studio';
          }
          const res = await fetch(provider.endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model,
              temperature: 0.95,
              ...(provider.name === 'groq' ? { response_format: { type: 'json_object' } } : {}),
              messages: [
                { role: 'system', content: systemInstruction },
                { role: 'user', content: userPrompt },
              ],
            }),
          });
          const bodyText = await res.text();
          if (!res.ok) {
            throw new Error(`${provider.name} HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
          }
          const parsed = JSON.parse(bodyText) as {
            choices?: Array<{ message?: { content?: string | null } }>;
          };
          const content = (parsed.choices?.[0]?.message?.content ?? '').trim();
          if (!content) throw new Error(`${provider.name} empty response`);
          return extractClientJsonPayload(content);
        } catch (err) {
          lastErr = err;
        }
      }
    }
  }
  throw lastErr;
}

const APK_COOLDOWN_STORAGE_KEY = 'apk_gemini_key_cooldowns_v1';
const apkMemoryCooldowns = new Map<string, number>();

function getApkKeyCooldowns(): Record<string, number> {
  const out: Record<string, number> = {};
  apkMemoryCooldowns.forEach((v, k) => {
    out[k] = v;
  });
  if (typeof localStorage === 'undefined') return out;
  try {
    const raw = localStorage.getItem(APK_COOLDOWN_STORAGE_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, number>;
    return { ...parsed, ...out };
  } catch {
    return out;
  }
}

function setApkKeyCooldown(apiKey: string, untilMs: number): void {
  const keyTag = apiKey.slice(-8);
  apkMemoryCooldowns.set(keyTag, untilMs);
  if (typeof localStorage === 'undefined') return;
  try {
    const existing = getApkKeyCooldowns();
    existing[keyTag] = untilMs;
    localStorage.setItem(APK_COOLDOWN_STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // ignore
  }
}

function getNextUtcResetMs(): number {
  const now = new Date();
  const nextUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    5,
    0
  );
  return Math.max(60_000, nextUtcMidnight - Date.now());
}

const APK_TTS_USAGE_STORAGE_KEY = 'apk_tts_daily_usage_v1';
const APK_TTS_DAILY_LIMIT = 10;

interface ApkTtsUsageMap {
  utcDate: string;
  usedByTag: Record<string, number>;
}

function readApkTtsUsageMap(): ApkTtsUsageMap {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const empty: ApkTtsUsageMap = { utcDate: todayUtc, usedByTag: {} };
  if (typeof localStorage === 'undefined') return empty;
  try {
    const raw = localStorage.getItem(APK_TTS_USAGE_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<ApkTtsUsageMap>;
    if (parsed.utcDate !== todayUtc || !parsed.usedByTag) return empty;
    return { utcDate: todayUtc, usedByTag: parsed.usedByTag };
  } catch {
    return empty;
  }
}

function incrementApkTtsUsage(apiKey: string, exhaust = false): void {
  const tag = apiKey.slice(-8);
  const map = readApkTtsUsageMap();
  const prev = map.usedByTag[tag] ?? 0;
  map.usedByTag[tag] = exhaust ? Math.max(prev, APK_TTS_DAILY_LIMIT) : prev + 1;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(APK_TTS_USAGE_STORAGE_KEY, JSON.stringify(map));
    } catch {
      // ignore
    }
  }
  updateCachedTtsQuota(buildApkTtsQuotaSnapshot());
}

function buildApkTtsQuotaSnapshot(): TtsQuotaSnapshot {
  const now = Date.now();
  const map = readApkTtsUsageMap();
  const cooldowns = getApkKeyCooldowns();
  let activeKeys = 0;
  let totalDailyLimit = 0;
  let usedToday = 0;
  let remainingToday = 0;
  let anyBeyondFree = false;

  const keys: TtsKeyQuotaInfo[] = EMBEDDED_CLIENT_GEMINI_KEYS.map((apiKey, idx) => {
    const tag = apiKey.slice(-8);
    const cdUntil = cooldowns[tag] ?? 0;
    const rawUsed = map.usedByTag[tag] ?? 0;
    const beyondFreeTier = rawUsed > APK_TTS_DAILY_LIMIT;
    if (beyondFreeTier) anyBeyondFree = true;
    const limit = beyondFreeTier ? rawUsed + 10 : APK_TTS_DAILY_LIMIT;
    const isExhausted = !beyondFreeTier && cdUntil > now + 120_000;
    const used = isExhausted ? limit : Math.min(limit, rawUsed);
    const remaining = isExhausted ? 0 : Math.max(0, limit - used);
    const cooldownRemainingSec = cdUntil > now ? Math.ceil((cdUntil - now) / 1000) : 0;
    const status: TtsKeyQuotaInfo['status'] =
      isExhausted || remaining === 0 ? 'exhausted' : cdUntil > now ? 'cooldown' : 'ready';
    if (status === 'ready') activeKeys += 1;
    totalDailyLimit += limit;
    usedToday += used;
    remainingToday += remaining;
    return {
      index: idx + 1,
      label: `مفتاح ${idx + 1}`,
      tail: apiKey.length > 6 ? `••${apiKey.slice(-4)}` : '••••',
      limit,
      used,
      remaining,
      status,
      cooldownRemainingSec,
      beyondFreeTier,
    };
  });

  return {
    utcDate: map.utcDate,
    perKeyDailyLimit: APK_TTS_DAILY_LIMIT,
    totalKeys: EMBEDDED_CLIENT_GEMINI_KEYS.length,
    activeKeys,
    totalDailyLimit,
    usedToday,
    remainingToday,
    allExhausted: EMBEDDED_CLIENT_GEMINI_KEYS.length > 0 && remainingToday === 0,
    beyondFreeTier: anyBeyondFree,
    nextResetAtIso: new Date(now + getNextUtcResetMs()).toISOString(),
    updatedAtIso: new Date(now).toISOString(),
    keys,
  };
}

async function runApkGeminiWithRotation<T>(
  apiTask: (apiKey: string) => Promise<T>,
  bucket: 'text' | 'tts' = 'text'
): Promise<T> {
  if (EMBEDDED_CLIENT_GEMINI_KEYS.length === 0) {
    throw new AiApiError(
      'مفاتيح Gemini API غير مضبوطة في GitHub Secrets. أضف GEMINI_API_KEY أو GEMINI_API_KEYS (أو GEMINI_API_KEY_1..5) ثم أعد تشغيل البناء.',
      0,
      false
    );
  }
  const now = Date.now();
  const cooldowns = getApkKeyCooldowns();
  const healthy = EMBEDDED_CLIENT_GEMINI_KEYS.filter(
    (k) => (cooldowns[k.slice(-8)] ?? 0) <= now
  );
  const candidates = healthy.length > 0 ? healthy : EMBEDDED_CLIENT_GEMINI_KEYS;

  let lastErr: unknown;
  for (const key of candidates) {
    try {
      const res = await apiTask(key);
      if (bucket === 'tts') {
        incrementApkTtsUsage(key, false);
      }
      return res;
    } catch (err) {
      lastErr = err;
      const raw = err instanceof Error ? err.message : String(err);
      const isDaily =
        raw.includes('PerDay') || raw.includes('per day') || raw.includes('free_tier_requests');
      const isQuotaOrRate = raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED');
      const isAuth =
        raw.includes('403') ||
        raw.includes('PERMISSION_DENIED') ||
        raw.includes('API_KEY_INVALID') ||
        raw.includes('API key not valid');

      if (isDaily) {
        setApkKeyCooldown(key, Date.now() + getNextUtcResetMs());
        if (bucket === 'tts') incrementApkTtsUsage(key, true);
        continue;
      }
      if (isQuotaOrRate) {
        setApkKeyCooldown(key, Date.now() + 45_000);
        continue;
      }
      if (isAuth) {
        setApkKeyCooldown(key, Date.now() + 24 * 60 * 60_000);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export function isNativeApkRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
    AndroidNativeBridge?: unknown;
  };
  return Boolean(w.Capacitor?.isNativePlatform?.() || w.AndroidNativeBridge);
}

function isStaticPagesRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return host.endsWith('.github.io') || host === 'github.io';
}

function normalizeLatexToSpokenArabic(text: string): string {
  let out = text;
  for (let pass = 0; pass < 3; pass++) {
    out = out.replace(/\\(?:d|t)?frac\{([^{}]+)\}\{([^{}]+)\}/g, ' $1 على $2 ');
  }
  out = out.replace(/\\sqrt\{([^{}]+)\}/g, ' الجذر التربيعي لـ $1 ');
  out = out.replace(/\^\{2\}|\^2|²/g, ' تربيع ');
  out = out.replace(/\^\{3\}|\^3|³/g, ' تكعيب ');
  out = out.replace(/\^\{([^{}]+)\}/g, ' أس $1 ');
  out = out.replace(/\^([0-9a-zA-Z])/g, ' أس $1 ');
  out = out.replace(/_\{([^{}]+)\}/g, ' $1 ');
  return out
    .replace(/\\times|×/g, ' ضرب ')
    .replace(/\\cdot/g, ' ضرب ')
    .replace(/\\div|÷/g, ' تقسيم ')
    .replace(/\\pm|±/g, ' زائد أو ناقص ')
    .replace(/\\pi|π/g, ' باي ')
    .replace(/\\theta|θ/g, ' ثيتا ')
    .replace(/\\alpha/g, ' ألفا ')
    .replace(/\\beta/g, ' بيتا ')
    .replace(/\\leq|≤/g, ' أصغر من أو يساوي ')
    .replace(/\\geq|≥/g, ' أكبر من أو يساوي ')
    .replace(/\\neq|≠/g, ' لا يساوي ')
    .replace(/\\approx|≈/g, ' يساوي تقريباً ')
    .replace(/\\infty|∞/g, ' ما لا نهاية ')
    .replace(/\\circ|\\degree|°/g, ' درجة ')
    .replace(/√/g, ' الجذر التربيعي لـ ')
    .replace(/%/g, ' بالمئة ')
    .replace(/−/g, ' ناقص ')
    .replace(/(\d|\s)-(\s|\d)/g, '$1 ناقص $2')
    .replace(/\\left|\\right/g, '')
    .replace(/\$/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\\/g, ' ')
    .replace(/\+/g, ' زائد ')
    .replace(/=/g, ' يساوي ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatGeminiClientError(err: unknown, kind: 'text' | 'tts' = 'text'): AiApiError {
  const raw = err instanceof Error ? err.message : String(err);
  const isDailyQuota =
    raw.includes('PerDay') || raw.includes('per day') || raw.includes('free_tier_requests');
  if (
    raw.includes('403') ||
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('API_KEY_INVALID') ||
    raw.includes('API key not valid')
  ) {
    return new AiApiError(
      'مفتاح Gemini API المضاف في GitHub Secrets غير صالح أو مرفوض (403). تأكد من صحة المفتاح وقيود النطاق.',
      403,
      false
    );
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    if (isDailyQuota) {
      const keyNote =
        EMBEDDED_CLIENT_GEMINI_KEYS.length > 1
          ? `على جميع المفاتيح المضافة (${EMBEDDED_CLIENT_GEMINI_KEYS.length} مفاتيح)`
          : 'على الباقة المجانية';
      return new AiApiError(
        kind === 'tts'
          ? `اكتملت الحصة اليومية لتوليد الصوت ${keyNote}. يمكنك إضافة مفاتيح إضافية في GitHub Secrets باسم GEMINI_API_KEYS أو GEMINI_API_KEY_1..10.`
          : `اكتملت الحصة اليومية لتوليد الأسئلة والنصوص ${keyNote}. يمكنك استخدام الاستيراد السريع أو الإدخال اليدوي، أو إضافة مفاتيح إضافية في Secrets.`,
        429,
        true
      );
    }
    return new AiApiError('تم تجاوز حد الطلبات مؤقتاً (429). انتظر ثوانٍ وأعد المحاولة.', 429, false);
  }
  if (
    raw.includes('503') ||
    raw.includes('UNAVAILABLE') ||
    raw.includes('high demand') ||
    raw.includes('overloaded')
  ) {
    return new AiApiError(
      'خوادم الذكاء الاصطناعي مزدحمة مؤقتاً الآن (503). أعد المحاولة خلال بضع ثوانٍ.',
      503,
      false
    );
  }
  return new AiApiError(raw || 'تعذر الاتصال بخدمة Gemini.', 500, false);
}

function wrapPcmBase64ToWavDataUrl(base64Audio: string, mimeType: string): string {
  if (!mimeType.includes('L16') && !mimeType.includes('pcm')) {
    return `data:${mimeType};base64,${base64Audio}`;
  }
  const binary = atob(base64Audio);
  const pcmLen = binary.length;
  const rateMatch = mimeType.match(/rate=(\d+)/);
  const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;

  const wavBytes = new Uint8Array(44 + pcmLen);
  const view = new DataView(wavBytes.buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) wavBytes[offset + i] = s.charCodeAt(i);
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcmLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcmLen, true);

  for (let i = 0; i < pcmLen; i++) {
    wavBytes[44 + i] = binary.charCodeAt(i);
  }

  let outBin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < wavBytes.length; i += CHUNK) {
    outBin += String.fromCharCode(...wavBytes.subarray(i, i + CHUNK));
  }
  return `data:audio/wav;base64,${btoa(outBin)}`;
}

const RECENT_AI_QUESTIONS_KEY = 'shorts_quiz_ai_recent_questions_v1';

function normalizeQuestionForDedup(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isDuplicateQuestion(candidate: string, existingNormalized: Set<string>): boolean {
  const norm = normalizeQuestionForDedup(candidate);
  if (!norm) return true;
  if (existingNormalized.has(norm)) return true;

  const candWords = norm.split(' ').filter((w) => w.length > 2);
  if (candWords.length < 3) return false;
  const candSet = new Set(candWords);

  for (const prev of existingNormalized) {
    const prevWords = prev.split(' ').filter((w) => w.length > 2);
    if (prevWords.length < 3) continue;
    let shared = 0;
    for (const w of candSet) {
      if (prevWords.includes(w)) shared += 1;
    }
    const ratio = shared / Math.max(candSet.size, prevWords.length);
    if (ratio >= 0.72) return true;
  }
  return false;
}

function getRecentAiQuestions(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_AI_QUESTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function recordRecentAiQuestions(questions: string[]): void {
  try {
    const current = getRecentAiQuestions();
    const seen = new Set(current.map((q) => normalizeQuestionForDedup(q)));
    const merged = [...current];
    for (const q of questions) {
      const clean = q.trim();
      const norm = normalizeQuestionForDedup(clean);
      if (clean && norm && !seen.has(norm)) {
        seen.add(norm);
        merged.push(clean);
      }
    }
    localStorage.setItem(RECENT_AI_QUESTIONS_KEY, JSON.stringify(merged.slice(-45)));
  } catch {
    // ignore storage quota errors
  }
}

export function clearRecentAiQuestionHistory(): void {
  try {
    localStorage.removeItem(RECENT_AI_QUESTIONS_KEY);
  } catch {
    // ignore
  }
}

const CLIENT_VARIETY_ANGLES = [
  'موقف حياتي شائع يختلف الناس في الحكم عليه',
  'تحدٍّ غير متوقع أو زاوية نفسية واجتماعية عميقة',
  'اختيار صعب بين قيمتين أو خيارين متقاربين',
  'معلومة أو مفارقة نادرة تثير فضول المشاهدين',
  'سؤال يمس التجارب اليومية والشخصية للجمهور',
  'زاوية تاريخية أو مستقبلية أو ثقافية مبتكرة',
  'سؤال ذكي يكسر التوقعات المعتادة ويدفع للتعليق',
  'مقارنة مثيرة بين أسلوبين في الحياة أو التفكير',
];

function getCategoryMeta(category: QuizCategory = 'general') {
  return QUIZ_CATEGORIES.find((c) => c.id === category) ?? QUIZ_CATEGORIES[0];
}

const FALLBACK_CATEGORY_SUBTOPICS: Record<QuizCategory, string[]> = {
  general: [
    'معلومات غريبة وحقائق مدهشة',
    'ألغاز ذكاء وسرعة بديهة',
    'أوائل واختراعات غيرت العالم',
    'عجائب الطبيعة والمحيطات',
    'ثقافة عربية وعالمية متنوعة',
    'أرقام قياسية ومقارنات مذهلة',
  ],
  discussion: [
    'مواقف حياتية وعملية محيرة',
    'لو خيروك بين قيمتين أو خيارين صعبين',
    'العلاقات والصداقة والثقة',
    'التقنية والسوشيال ميديا وتأثيرها',
    'الطموح والمال وإدارة الوقت',
    'قرارات مصيرية وسرعة التصرف',
  ],
  sports: [
    'كأس العالم والبطولات القارية',
    'أساطير كرة القدم والأرقام القياسية',
    'دوري أبطال أوروبا والأندية الكبرى',
    'رياضات أولمبية وعالمية متنوعة',
    'المنتخبات العربية وإنجازاتها التاريخية',
    'قوانين كرة القدم ومواقف تحكيمية',
  ],
  geography: [
    'عواصم ودول عربية وعالمية',
    'الأنهار والبحار والمضائق الشهيرة',
    'أعلى الجبال وأكبر الصحاري',
    'معالم سياحية وعجائب الدنيا',
    'أعلام الدول ومواقعها على الخريطة',
    'دول غريبة ومعلومات جغرافية نادرة',
  ],
  science: [
    'الفضاء والكواكب والثقوب السوداء',
    'جسم الإنسان وأسرار الدماغ',
    'الفيزياء وقوانين الطبيعة المدهشة',
    'الكيمياء والعناصر والمواد',
    'عالم الحيوان والكائنات البحرية',
    'الطب والاختراعات العلمية الحديثة',
  ],
  history: [
    'الحضارة الإسلامية والعصر الذهبي',
    'الحضارات القديمة (الفراعنة وبابل)',
    'شخصيات وقادة عبر التاريخ',
    'معارك وأحداث غيرت مجرى التاريخ',
    'تاريخ الاكتشافات والرحلات',
    'مدن ومعالم تاريخية عريقة',
  ],
  islamic: [
    'القرآن الكريم والسور والآيات',
    'السيرة النبوية والغزوات',
    'قصص الأنبياء عليهم السلام',
    'الصحابة والتابعين ومواقفهم',
    'الفقه والعبادات ومعلومات دينية',
    'تاريخ المساجد والمعالم الإسلامية',
  ],
  technology: [
    'الذكاء الاصطناعي والمستقبل الرقمي',
    'تاريخ الحواسيب والهواتف الذكية',
    'الشركات التقنية الكبرى ومؤسسوها',
    'الأمن السيبراني والإنترنت',
    'تطبيقات وألعاب شهيرة وأسرارها',
    'اختراعات تقنية غيّرت حياتنا اليومية',
  ],
  literature: [
    'أمثال عربية وحكم مأثورة',
    'شعراء العرب وقصائد خالدة',
    'معاني الكلمات والمفردات الفصحى',
    'روايات وكتب عالمية وعربية',
    'النحو والبلاغة بأسلوب ممتع',
    'أقوال مأثورة ومن قائلها',
  ],
  math: [
    'الكسور والعمليات السريعة',
    'الجذور التربيعية والقوى والأسس',
    'المعادلات الجبرية البسيطة',
    'المساحة والمحيط والهندسة',
    'النسبة المئوية والاحتمالات',
    'ألغاز حسابية وذكاء رياضي',
  ],
};

async function generateQuizDirectlyInApk(
  topic: string,
  count: number,
  difficulty: string,
  contentType: 'general' | 'math' | 'multiple3' | 'trueFalse' | 'clues' | 'versus',
  avoidQuestions: string[] = [],
  category: QuizCategory = 'general'
): Promise<QuestionSlide[]> {
  try {
    const { GoogleGenAI, ThinkingLevel, Type } = await import('@google/genai');

    const safeCount = Math.max(1, Math.min(12, Math.round(Number(count) || 3)));
    const requestCount = safeCount <= 3 ? Math.min(5, safeCount + 2) : safeCount;
    const cleanAvoidList = avoidQuestions.map((q) => q.trim()).filter(Boolean).slice(-50);
    const avoidNormalizedSet = new Set(
      cleanAvoidList.map((q) => normalizeQuestionForDedup(q)).filter(Boolean)
    );

    const categoryMeta = getCategoryMeta(category);
    const diffLabel = difficulty && difficulty.trim() ? difficulty.trim() : 'متنوع';
    const isTrueFalse = contentType === 'trueFalse';
    const isClues = contentType === 'clues';
    const isVersus = contentType === 'versus';
    const isMultiple3 = contentType === 'multiple3';
    const isMath =
      !isTrueFalse &&
      !isClues &&
      !isVersus &&
      !isMultiple3 &&
      (contentType === 'math' ||
        category === 'math' ||
        /رياضيات|جبر|معادل|كسر|كسور|جذر|جذور|حساب|هندسة|مثلث|مشتق|تكامل/i.test(topic));
    const isDiscussion =
      !isMath &&
      !isTrueFalse &&
      !isClues &&
      (category === 'discussion' ||
        /نقاش|جدل|رأي|رأيك|رايك|لو خي|لو خيروك|تفاعل|تعليقات|تفضل|موقف|اجتماعي/i.test(topic));

    const mathGuidelines = isMath
      ? `\nملاحظات مهمة لأسئلة الرياضيات:
- ضع التعابير الرياضية والكسور والجذور والأسس بصيغة LaTeX واضحة بين علامتي دولار مثل: $\\frac{3}{4} + \\frac{1}{2}$ أو $\\sqrt{81}$ أو $2x + 5 = 15$ أو $5^{2}$.
- اجعل الخيارات الأربعة قصيرة وواضحة (سواء رقمية أو بصيغة LaTeX بين $...$).
- تأكد رياضياً 100% أن الخيار عند correctIndex هو الحل الصحيح الوحيد.`
      : '';

    const discussionGuidelines = isDiscussion
      ? `\nملاحظات مهمة لأسئلة النقاش والتفاعل في التعليقات:
- المطلوب أسئلة نقاشية / «لو خُيّرت» / «ما رأيك» تحفّز المشاهدين على النقاش وكتابة اختياراتهم في التعليقات، وتجنب تماماً الأسئلة المستهلكة المكررة (مثل المال أم السعادة أو السفر للماضي أم المستقبل).
- نوّع الموضوعات بين: العمل، الصداقة، التقنية، العائلة، اتخاذ القرارات، الطموح، العادات اليومية، والمواقف المحيّرة.
- اجعل الخيارات الأربعة (أو الطرفين في VS) تمثل اختيارات/آراء واضحة ومتقاربة القوة تدفع كل شخص لاختيار موقف والدفاع عنه في التعليقات.
- اجعل explanationText عبارة قصيرة مشوقة تدعو المشاهد لكتابة رأيه وسببه في التعليقات.`
      : '';

    const angleHint =
      CLIENT_VARIETY_ANGLES[Math.floor(Math.random() * CLIENT_VARIETY_ANGLES.length)];
    const varietySeed = Math.floor(10000 + Math.random() * 90000);
    const avoidBlock =
      cleanAvoidList.length > 0
        ? `\n\nتنبيه صارم — ممنوع تكرار أو إعادة صياغة أي من الأسئلة التالية التي طُرحت سابقاً:\n${cleanAvoidList
            .map((q, i) => `${i + 1}. ${q}`)
            .join('\n')}\nابتكر أسئلة جديدة ومختلفة كلياً عن القائمة أعلاه.`
        : '';
    const categoryDirective = `\nالمجال / التصنيف المطلوب الالتزام به بدقة: ${categoryMeta.label} (${categoryMeta.promptHint}).`;
    const diversityDirective = `${categoryDirective}\nزاوية التنويع المطلوبة لهذا الطلب (#${varietySeed}): ${angleHint}.${avoidBlock}`;

    const promptText = isTrueFalse
      ? `الموضوع أو الفكرة المطلوبة: "${topic}"
عدد الأسئلة المطلوبة: ${requestCount}
مستوى الصعوبة: ${diffLabel}
${diversityDirective}

أنشئ ${requestCount} سؤالاً مختلفاً بنمط (صح أم خطأ) باللغة العربية الفصحى السلسة والمناسبة لفيديوهات الأسئلة.
أرجع مصفوفة JSON فقط (JSON Array) بدون أي نص إضافي خارج JSON، بحيث يحتوي كل عنصر على:
- badgeText: عنوان قصير للشارة العلوية (مثال: صح أم خطأ · سؤال 1)
- question: جملة خبرية أو سؤال قصير مشوق يحتمل الصواب أو الخطأ (أقل من 16 كلمة)
- options: مصفوفة تحتوي خيارين بالضبط هما ["صح", "خطأ"]
- correctIndex: 0 إذا كانت العبارة صحيحة، أو 1 إذا كانت خاطئة (نوّع بين 0 و 1)
- explanationText: تصحيح أو توضيح قصير جداً (أقل من 12 كلمة)`
      : isClues
        ? `الموضوع أو الفكرة المطلوبة: "${topic}"
عدد الألغاز المطلوبة: ${requestCount}
مستوى الصعوبة: ${diffLabel}
${diversityDirective}

أنشئ ${requestCount} لغزاً مختلفاً بنمط (3 تلميحات / من أنا؟) باللغة العربية الفصحى المشوقة والمناسبة لفيديوهات يوتيوب شورتس.
أرجع مصفوفة JSON فقط (JSON Array) بدون أي نص إضافي خارج JSON، بحيث يحتوي كل عنصر على:
- badgeText: عنوان قصير للشارة العلوية (مثال: 3 تلميحات · لغز 1)
- question: سؤال قصير ومشوق (مثال: من أنا؟ أو ما هي هذه الدولة؟ - أقل من 10 كلمات)
- options: مصفوفة من 4 عناصر نصية بالضبط بهذا الترتيب:
  * العنصر [0]: التلميح الأول (غريب وقصير، أقل من 10 كلمات)
  * العنصر [1]: التلميح الثاني (أقرب قليلاً للحل وقصير، أقل من 10 كلمات)
  * العنصر [2]: التلميح الثالث (تلميح واضح يكاد يكشف الحل، أقل من 10 كلمات)
  * العنصر [3]: الإجابة الصحيحة النهائية (كلمة أو كلمتان فقط، بدون شرح)
- correctIndex: دائماً الرقم 3
- explanationText: حقيقة سريعة ومدهشة عن الإجابة (أقل من 12 كلمة)`
        : isVersus
          ? `الموضوع أو الفكرة المطلوبة: "${topic}"
عدد المقارنات المطلوبة: ${requestCount}
مستوى الصعوبة: ${diffLabel}
${discussionGuidelines}
${diversityDirective}

أنشئ ${requestCount} تحدياً مختلفاً بنمط (مقارنة VS بين طرفين) باللغة العربية الفصحى السلسة والمناسبة لفيديوهات الشورتس.
أرجع مصفوفة JSON فقط (JSON Array) بدون أي نص إضافي خارج JSON، بحيث يحتوي كل عنصر على:
- badgeText: عنوان قصير للشارة العلوية (مثال: مقارنة VS · تحدي 1)
- question: سؤال مقارنة قصير ومباشر (مثال: أيهما أكبر مساحة؟ أو أيهما أسرع؟ أو أيهما تفضل؟ - أقل من 12 كلمة)
- options: مصفوفة تحتوي اسمَي الطرفين المتنافسين بالضبط (اسمان قصيران واضحان)
- correctIndex: 0 إذا كان الطرف الأول هو الصحيح/الأكثر اختياراً، أو 1 إذا كان الطرف الثاني (نوّع بين 0 و 1)
- explanationText: معلومة رقمية أو سبب سريع للفوز أو دعوة للنقاش (أقل من 12 كلمة)`
          : isMultiple3
            ? `الموضوع أو الفكرة المطلوبة: "${topic}"
عدد الأسئلة المطلوبة: ${requestCount}
مستوى الصعوبة: ${diffLabel}
${mathGuidelines}
${discussionGuidelines}
${diversityDirective}

أنشئ ${requestCount} سؤالاً مختلفاً ومتنوعاً بنمط (3 خيارات فقط) باللغة العربية الفصحى السلسة والمناسبة لفيديوهات الأسئلة.
أرجع مصفوفة JSON فقط (JSON Array) بدون أي نص إضافي خارج JSON، بحيث يحتوي كل عنصر على:
- badgeText: عنوان قصير للشارة العلوية (مثال: تحدي المعلومات · سؤال 1)
- question: نص السؤال القصير والمشوق (أقل من 15 كلمة)
- options: مصفوفة من 3 خيارات نصية قصيرة بالضبط
- correctIndex: رقم صحيح من 0 إلى 2 يمثل الإجابة الصحيحة
- explanationText: توضيح قصير جداً للإجابة (أقل من 12 كلمة)`
            : `الموضوع أو الفكرة المطلوبة: "${topic}"
عدد الأسئلة المطلوبة: ${requestCount}
مستوى الصعوبة: ${diffLabel}
${mathGuidelines}
${discussionGuidelines}
${diversityDirective}

أنشئ ${requestCount} سؤالاً مختلفاً ومتنوعاً باللغة العربية الفصحى السلسة والمناسبة لفيديوهات الأسئلة.
أرجع مصفوفة JSON فقط (JSON Array) بدون أي نص إضافي خارج JSON، بحيث يحتوي كل عنصر على:
- badgeText: عنوان قصير للشارة العلوية (مثال: تحدي المعلومات · سؤال 1)
- question: نص السؤال القصير والمشوق (أقل من 15 كلمة)
- options: مصفوفة من 4 خيارات نصية قصيرة بالضبط
- correctIndex: رقم صحيح من 0 إلى 3 يمثل الإجابة الصحيحة
- explanationText: توضيح قصير جداً للإجابة (أقل من 12 كلمة)`;

    const quizSystemInstruction =
      'أنت خبير في إعداد أسئلة المسابقات والنقاشات التفاعلية والتحديات والرياضيات لفيديوهات يوتيوب باللغة العربية. التزم بالدقة والابتكار وتجنب تكرار الأسئلة المستهلكة والاختصار الواضح.';

    type RawApkQuizItem = {
      badgeText?: string;
      question?: string;
      options?: string[];
      correctIndex?: number;
      explanationText?: string;
    };

    let parsed: RawApkQuizItem[] = [];
    let geminiErr: unknown = null;

    if (EMBEDDED_CLIENT_GEMINI_KEYS.length > 0) {
      try {
        const response = await runApkGeminiWithRotation(async (apiKey) => {
          const ai = new GoogleGenAI({ apiKey });
          try {
            return await ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: promptText,
              config: {
                temperature: isMath ? 0.85 : 1.05,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                systemInstruction: quizSystemInstruction,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      badgeText: { type: Type.STRING },
                      question: { type: Type.STRING },
                      options: { type: Type.ARRAY, items: { type: Type.STRING } },
                      correctIndex: { type: Type.INTEGER },
                      explanationText: { type: Type.STRING },
                    },
                    required: ['badgeText', 'question', 'options', 'correctIndex', 'explanationText'],
                  },
                },
              },
            });
          } catch {
            return ai.models.generateContent({
              model: 'gemini-3.1-flash-lite',
              contents: promptText,
              config: {
                temperature: isMath ? 0.85 : 1.05,
                thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
                systemInstruction: quizSystemInstruction,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      badgeText: { type: Type.STRING },
                      question: { type: Type.STRING },
                      options: { type: Type.ARRAY, items: { type: Type.STRING } },
                      correctIndex: { type: Type.INTEGER },
                      explanationText: { type: Type.STRING },
                    },
                    required: ['badgeText', 'question', 'options', 'correctIndex', 'explanationText'],
                  },
                },
              },
            });
          }
        });

        const rawJson = extractClientJsonPayload(response.text ?? '[]');
        parsed = Array.isArray(rawJson) ? (rawJson as RawApkQuizItem[]) : [];
      } catch (err) {
        geminiErr = err;
      }
    }

    if (parsed.length === 0) {
      if (EMBEDDED_CLIENT_GROQ_KEYS.length > 0 || EMBEDDED_CLIENT_OPENROUTER_KEYS.length > 0) {
        const extPayload = await runApkExternalJsonFallback(
          quizSystemInstruction,
          `${promptText}\n\nتنسيق الإرجاع المطلوب (JSON Object فقط بدون أي نص إضافي):\n{\n  "slides": [\n    {\n      "badgeText": "...",\n      "question": "...",\n      "options": ["..."],\n      "correctIndex": 0,\n      "explanationText": "..."\n    }\n  ]\n}`
        );
        parsed = Array.isArray(extPayload)
          ? (extPayload as RawApkQuizItem[])
          : extPayload && typeof extPayload === 'object'
            ? (((extPayload as { slides?: unknown; questions?: unknown }).slides ??
                (extPayload as { questions?: unknown }).questions ??
                []) as RawApkQuizItem[])
            : [];
      } else if (geminiErr) {
        throw geminiErr;
      }
    }

    const minOpts = isTrueFalse || isVersus ? 2 : isMultiple3 ? 3 : 4;
    const validRaw = parsed.filter(
      (item) =>
        item &&
        item.question &&
        Array.isArray(item.options) &&
        item.options.length >= minOpts
    );

    const seenInBatch = new Set(avoidNormalizedSet);
    const uniqueCandidates: RawApkQuizItem[] = [];
    const fallbackCandidates: RawApkQuizItem[] = [];
    for (const item of validRaw) {
      const qText = String(item.question || '').trim();
      if (!isDuplicateQuestion(qText, seenInBatch)) {
        uniqueCandidates.push(item);
        seenInBatch.add(normalizeQuestionForDedup(qText));
      } else {
        fallbackCandidates.push(item);
      }
    }

    const normalized = [...uniqueCandidates, ...fallbackCandidates]
      .slice(0, safeCount)
      .map((item, idx) => {
        if (isTrueFalse) {
          const rawIdx = Number(item.correctIndex);
          const cIdx = (rawIdx === 1 ? 1 : 0) as 0 | 1;
          const o0 = String(item.options?.[0] ?? 'صح').trim() || 'صح';
          const o1 = String(item.options?.[1] ?? 'خطأ').trim() || 'خطأ';
          return {
            id: `ai-slide-${Date.now()}-${idx}`,
            slideType: 'trueFalse' as const,
            category,
            badgeText: (item.badgeText ?? `صح أم خطأ · ${idx + 1}`).trim(),
            question: item.question!.trim(),
            options: [o0, o1, '', ''] as [string, string, string, string],
            correctIndex: cIdx,
            explanationText: (item.explanationText ?? '').trim(),
          };
        }

        if (isVersus) {
          const rawIdx = Number(item.correctIndex);
          const cIdx = (rawIdx === 1 ? 1 : 0) as 0 | 1;
          const o0 = String(item.options?.[0] ?? 'الطرف الأول').trim() || 'الطرف الأول';
          const o1 = String(item.options?.[1] ?? 'الطرف الثاني').trim() || 'الطرف الثاني';
          return {
            id: `ai-slide-${Date.now()}-${idx}`,
            slideType: 'versus' as const,
            category,
            badgeText: (item.badgeText ?? `مقارنة VS · ${idx + 1}`).trim(),
            question: item.question!.trim(),
            options: [o0, o1, '', ''] as [string, string, string, string],
            correctIndex: cIdx,
            explanationText: (item.explanationText ?? '').trim(),
          };
        }

        if (isClues) {
          const opts = item.options!.slice(0, 4).map((o) => String(o).trim()) as [
            string,
            string,
            string,
            string
          ];
          return {
            id: `ai-slide-${Date.now()}-${idx}`,
            slideType: 'clues' as const,
            category,
            badgeText: (item.badgeText ?? `3 تلميحات · ${idx + 1}`).trim(),
            question: item.question!.trim(),
            options: opts,
            correctIndex: 3 as const,
            explanationText: (item.explanationText ?? '').trim(),
          };
        }

        if (isMultiple3) {
          const raw3 = item.options!.slice(0, 3).map((o) => String(o).trim());
          const opts: [string, string, string, string] = [
            raw3[0] || 'خيار 1',
            raw3[1] || 'خيار 2',
            raw3[2] || 'خيار 3',
            '',
          ];
          const numIdx = Number(item.correctIndex);
          const cIdx = Math.max(0, Math.min(2, Math.round(Number.isFinite(numIdx) ? numIdx : 0))) as
            | 0
            | 1
            | 2;
          return {
            id: `ai-slide-${Date.now()}-${idx}`,
            slideType: 'multiple3' as const,
            category,
            badgeText: (item.badgeText ?? `السؤال ${idx + 1}`).trim(),
            question: item.question!.trim(),
            options: opts,
            correctIndex: cIdx,
            explanationText: (item.explanationText ?? '').trim(),
          };
        }

        const opts = item.options!.slice(0, 4).map((o) => String(o).trim()) as [
          string,
          string,
          string,
          string
        ];
        const numIdx = Number(item.correctIndex);
        const cIdx = Math.max(0, Math.min(3, Math.round(Number.isFinite(numIdx) ? numIdx : 0))) as
          | 0
          | 1
          | 2
          | 3;
        return {
          id: `ai-slide-${Date.now()}-${idx}`,
          slideType: 'multiple' as const,
          category,
          badgeText: (item.badgeText ?? `السؤال ${idx + 1}`).trim(),
          question: item.question!.trim(),
          options: opts,
          correctIndex: cIdx,
          explanationText: (item.explanationText ?? '').trim(),
        };
      });

    if (normalized.length === 0) {
      throw new AiApiError('لم يتمكن الذكاء الاصطناعي من توليد أسئلة صالحة، حاول صياغة الفكرة بشكل أوضح.', 502);
    }
    return normalized;
  } catch (err) {
    if (err instanceof AiApiError) throw err;
    throw formatGeminiClientError(err);
  }
}

async function generateTtsDirectlyInApk(
  text: string,
  voiceName: AiVoiceName,
  fileName: string,
  style?: string
): Promise<SlideAudioClip> {
  const cleanText = normalizeLatexToSpokenArabic(text) || text.trim();
  if (!cleanText) {
    throw new AiApiError('النص المطلوب تحويله إلى صوت فارغ.', 400);
  }

  const allowedVoices = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];
  const chosenVoice = allowedVoices.includes(voiceName) ? voiceName : 'Kore';

  try {
    const { GoogleGenAI } = await import('@google/genai');

    const response = await runApkGeminiWithRotation(async (apiKey) => {
      const ai = new GoogleGenAI({ apiKey });
      return ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanText,
                speechMetadata: {
                  style:
                    style ||
                    'Clear, natural, articulate Modern Standard Arabic quiz presenter; read only the exact provided text cleanly without extra words',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: chosenVoice,
              },
            },
          },
        },
      });
    }, 'tts');

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const audioPart = parts.find((p) => p.inlineData?.data);
    const base64Audio = audioPart?.inlineData?.data;
    const mimeType = audioPart?.inlineData?.mimeType || 'audio/wav';

    if (!base64Audio) {
      throw new AiApiError('تعذر توليد الصوت من النموذج حالياً.', 502);
    }

    const dataUrl = wrapPcmBase64ToWavDataUrl(base64Audio, mimeType);
    const duration = await soundEngine.getAudioDuration(dataUrl);
    return {
      fileName,
      dataUrl,
      duration: duration > 0 ? duration : 1.5,
    };
  } catch (err) {
    if (err instanceof AiApiError) throw err;
    throw formatGeminiClientError(err, 'tts');
  }
}

async function parseJsonSafe<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    if (res.status === 401 || res.status === 403) {
      throw new AiApiError(
        'تم رفض الاتصال بالخادم (خطأ صلاحية). تأكد من تحديث الصفحة، أو مراجعة مفاتيح Gemini في Settings > Secrets.',
        res.status,
        false
      );
    }
    if (res.status === 404 || res.status === 405) {
      throw new AiApiError(
        'لا يوجد خادم خلفي على هذا الرابط. أضف مفاتيح Gemini في GitHub (Settings > Secrets and variables > Actions) ثم أعد تشغيل النشر.',
        res.status,
        false
      );
    }
    const isHtmlWarmup = /<!doctype|<html/i.test(text);
    throw new AiApiError(
      isHtmlWarmup
        ? 'الخادم يعيد التجهيز مؤقتاً، حاول مرة أخرى خلال ثوانٍ.'
        : res.ok
          ? 'استجابة غير صالحة من الخادم.'
          : `تعذر الاتصال بالخادم (رمز ${res.status}).`,
      res.status,
      false
    );
  }
}

function buildApiUrl(path: string): string {
  return BUILD_API_BASE ? `${BUILD_API_BASE}${path}` : path;
}

async function fetchAi(path: string, payload: unknown): Promise<Response> {
  if ((isNativeApkRuntime() || isStaticPagesRuntime()) && !BUILD_API_BASE) {
    throw new AiApiError(
      'لتشغيل الذكاء الاصطناعي على GitHub Pages أو APK، أضف GEMINI_API_KEY أو GEMINI_API_KEYS (أو GEMINI_API_KEY_1..10) في GitHub (Settings > Secrets and variables > Actions) ثم أعد تشغيل البناء.',
      0,
      false
    );
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45_000);
  try {
    return await fetch(buildApiUrl(path), {
      method: 'POST',
      credentials: BUILD_API_BASE ? 'omit' : 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AiApiError(
        'انتهت مهلة الاتصال بخادم الذكاء الاصطناعي (45 ثانية) بسبب الضغط على الخدمة.',
        500,
        false
      );
    }
    throw new AiApiError(
      'تعذر الوصول إلى خادم الذكاء الاصطناعي. تأكد من الاتصال بالإنترنت، أو أضف أسئلتك يدوياً / عبر الاستيراد السريع.',
      0,
      false
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface BankAdviseResult {
  reply: string;
  subtopics: string[];
  isFallback?: boolean;
}

export async function adviseQuestionBankPlan(params: {
  category: QuizCategory;
  targetCount: number;
  userMessage: string;
  existingSubtopics?: string[];
}): Promise<BankAdviseResult> {
  const meta = getCategoryMeta(params.category);
  const safeTarget = Math.max(10, Math.min(500, Math.round(params.targetCount || 100)));
  const fallbackSubs = FALLBACK_CATEGORY_SUBTOPICS[params.category] ?? FALLBACK_CATEGORY_SUBTOPICS.general;
  const fallbackResult: BankAdviseResult = {
    reply: `جهّزت لك خطة مقترحة لتوليد ${safeTarget} سؤال في مجال «${meta.label}» مقسّمة على ${fallbackSubs.length} محاور فرعية مختلفة حتى نضمن عدم التكرار. يمكنك تعديل أي محور أو الضغط على «اعتماد وتوليد الدفعات الآن».`,
    subtopics: fallbackSubs,
    isFallback: true,
  };

  try {
    if (hasAnyEmbeddedTextAiKeys() && !BUILD_API_BASE) {
      const { GoogleGenAI, ThinkingLevel, Type } = await import('@google/genai');
      const prevTopics = (params.existingSubtopics ?? []).slice(0, 10).join('، ');
      const advisePrompt = `أنت مستشار محتوى لقنوات يوتيوب شورتس العربية.
المستخدم يريد بناء بنك ذاكرة كبير (${safeTarget} سؤال) في مجال: "${meta.label} (${meta.promptHint})".
رسالة المستخدم: "${params.userMessage || `أريد تجهيز ${safeTarget} سؤال متنوع`}"
${prevTopics ? `المحاور المقترحة مسبقاً: ${prevTopics}` : ''}

استشر المستخدم بأسلوب ودي مختصر (3 جمل) واقترح عليه 6 إلى 8 محاور فرعية متنوعة تضمن عدم تكرار الأسئلة.
أرجع JSON فقط بالشكل:
{
  "reply": "...",
  "subtopics": ["...", "..."]
}`;
      const sysInst = 'أنت مستشار تخطيط محتوى مسابقات عربية على يوتيوب شورتس. ردودك عملية ومختصرة.';
      let parsed: { reply?: unknown; subtopics?: unknown } | null = null;
      if (EMBEDDED_CLIENT_GEMINI_KEYS.length > 0) {
        try {
          const response = await runApkGeminiWithRotation(async (apiKey) => {
            const ai = new GoogleGenAI({ apiKey });
            return ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: advisePrompt,
              config: {
                temperature: 0.9,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                systemInstruction: sysInst,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    reply: { type: Type.STRING },
                    subtopics: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ['reply', 'subtopics'],
                },
              },
            });
          });
          parsed = extractClientJsonPayload(response.text ?? '{}') as {
            reply?: unknown;
            subtopics?: unknown;
          };
        } catch {
          parsed = null;
        }
      }
      if (!parsed && (EMBEDDED_CLIENT_GROQ_KEYS.length > 0 || EMBEDDED_CLIENT_OPENROUTER_KEYS.length > 0)) {
        parsed = (await runApkExternalJsonFallback(sysInst, advisePrompt)) as {
          reply?: unknown;
          subtopics?: unknown;
        };
      }
      if (parsed) {
        const subtopics = Array.isArray(parsed.subtopics)
          ? parsed.subtopics.map((s) => String(s).trim()).filter(Boolean).slice(0, 10)
          : [];
        if (subtopics.length > 0) {
          return {
            reply:
              typeof parsed.reply === 'string' && parsed.reply.trim()
                ? parsed.reply.trim()
                : fallbackResult.reply,
            subtopics,
          };
        }
      }
      return fallbackResult;
    }

    const res = await fetchAi('/api/ai/advise-bank', {
      categoryLabel: `${meta.label} (${meta.promptHint})`,
      targetCount: safeTarget,
      userMessage: params.userMessage,
      existingSubtopics: params.existingSubtopics,
    });
    const data = await parseJsonSafe<{ reply?: string; subtopics?: string[]; error?: string }>(res);
    if (!res.ok || !Array.isArray(data.subtopics) || data.subtopics.length === 0) {
      return fallbackResult;
    }
    return {
      reply: data.reply?.trim() || fallbackResult.reply,
      subtopics: data.subtopics.map((s) => s.trim()).filter(Boolean).slice(0, 10),
    };
  } catch {
    return fallbackResult;
  }
}

export async function generateAiQuizSlides(
  topic: string,
  count: number,
  difficulty: string,
  contentType: 'general' | 'math' | 'multiple3' | 'trueFalse' | 'clues' | 'versus' = 'general',
  existingQuestions: string[] = [],
  category: QuizCategory = 'general'
): Promise<QuestionSlide[]> {
  const bankAvoid = await getAvoidQuestionsForCategory(category, 45);
  const mergedAvoid = Array.from(
    new Set(
      [...getRecentAiQuestions(), ...existingQuestions, ...bankAvoid]
        .map((q) => q.trim())
        .filter((q) => q.length >= 4)
    )
  ).slice(-55);

  const categoryMeta = getCategoryMeta(category);

  let slides: QuestionSlide[];
  if (hasAnyEmbeddedTextAiKeys() && !BUILD_API_BASE) {
    slides = await generateQuizDirectlyInApk(
      topic,
      count,
      difficulty,
      contentType,
      mergedAvoid,
      category
    );
  } else {
    const res = await fetchAi('/api/ai/generate-quiz', {
      topic,
      count,
      difficulty,
      contentType,
      category,
      categoryHint: `${categoryMeta.label} (${categoryMeta.promptHint})`,
      avoidQuestions: mergedAvoid,
    });

    const data = await parseJsonSafe<{
      slides?: QuestionSlide[];
      error?: string;
      quotaExhausted?: boolean;
    }>(res);
    if (!res.ok || !data.slides) {
      throw new AiApiError(
        data.error || 'تعذر توليد الأسئلة من الخادم.',
        res.status,
        Boolean(data.quotaExhausted)
      );
    }
    slides = data.slides.map((s) => ({
      ...s,
      category: s.category ?? category,
    }));
  }

  recordRecentAiQuestions(slides.map((s) => s.question));
  return slides;
}

export async function generateSingleTtsClip(
  text: string,
  voiceName: AiVoiceName,
  fileName: string
): Promise<SlideAudioClip> {
  const consistentStyle =
    'Clear, steady, articulate Modern Standard Arabic quiz presenter; read only the exact provided text cleanly at a natural pace';
  return generateTtsClip(text, voiceName, fileName, consistentStyle);
}

export async function fetchTtsQuota(): Promise<TtsQuotaSnapshot | null> {
  if (EMBEDDED_CLIENT_GEMINI_KEYS.length > 0 && !BUILD_API_BASE) {
    const snap = buildApkTtsQuotaSnapshot();
    updateCachedTtsQuota(snap);
    return snap;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(buildApiUrl('/api/ai/tts-quota'), {
      method: 'GET',
      credentials: BUILD_API_BASE ? 'omit' : 'same-origin',
      signal: controller.signal,
    });
    if (!res.ok) return cachedTtsQuota;
    const data = await parseJsonSafe<TtsQuotaSnapshot>(res);
    if (typeof data?.totalKeys === 'number') {
      updateCachedTtsQuota(data);
      return data;
    }
    return cachedTtsQuota;
  } catch {
    return cachedTtsQuota;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateTtsClip(
  text: string,
  voiceName: AiVoiceName,
  fileName: string,
  style?: string
): Promise<SlideAudioClip> {
  if (EMBEDDED_CLIENT_GEMINI_KEYS.length > 0 && !BUILD_API_BASE) {
    return generateTtsDirectlyInApk(text, voiceName, fileName, style);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchAi('/api/ai/tts', { text, voiceName, style });

      const data = await parseJsonSafe<{
        dataUrl?: string;
        error?: string;
        quotaExhausted?: boolean;
        quota?: TtsQuotaSnapshot;
      }>(res);

      if (data.quota) {
        updateCachedTtsQuota(data.quota);
      }

      if (!res.ok || !data.dataUrl) {
        const errMsg = data.error || 'تعذر توليد الصوت بالذكاء الاصطناعي.';
        if (data.quotaExhausted || res.status === 403 || res.status === 400) {
          throw new AiApiError(errMsg, res.status, Boolean(data.quotaExhausted));
        }
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await new Promise((r) => setTimeout(r, res.status === 429 ? 2000 : 800));
          continue;
        }
        throw new AiApiError(errMsg, res.status, false);
      }

      const duration = await soundEngine.getAudioDuration(data.dataUrl);
      return {
        fileName,
        dataUrl: data.dataUrl,
        duration: duration > 0 ? duration : 1.5,
      };
    } catch (err) {
      if (err instanceof AiApiError && (err.quotaExhausted || err.status === 403 || err.status === 400)) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      break;
    }
  }

  throw lastError ?? new AiApiError('تعذر توليد الصوت بالذكاء الاصطناعي.', 500, false);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface VoiceoverResult {
  slide: QuestionSlide;
  warning?: string;
  quotaExhausted?: boolean;
}

export async function generateSlideVoiceoverSafe(
  slide: QuestionSlide,
  voiceName: AiVoiceName,
  mode: AiVoiceMode,
  onStep?: (label: string) => void
): Promise<VoiceoverResult> {
  const voiceover = {
    question: slide.voiceover?.question,
    options: [...(slide.voiceover?.options ?? [undefined, undefined, undefined, undefined])] as [
      SlideAudioClip | undefined,
      SlideAudioClip | undefined,
      SlideAudioClip | undefined,
      SlideAudioClip | undefined
    ],
    answer: slide.voiceover?.answer,
  };

  const consistentStyle =
    'Clear, steady, articulate Modern Standard Arabic quiz presenter; read only the exact provided text cleanly at a natural pace';

  try {
    if (slide.question.trim()) {
      onStep?.('جارٍ توليد صوت السؤال...');
      voiceover.question = await generateTtsClip(
        slide.question,
        voiceName,
        'ai-question.wav',
        consistentStyle
      );
    }

    if (mode === 'full') {
      const optCount =
        slide.slideType === 'trueFalse' || slide.slideType === 'versus'
          ? 2
          : slide.slideType === 'clues' || slide.slideType === 'multiple3'
            ? 3
            : 4;
      const itemLabel =
        slide.slideType === 'clues'
          ? 'التلميح'
          : slide.slideType === 'versus'
            ? 'الطرف'
            : 'الخيار';
      for (let i = 0; i < optCount; i++) {
        const optText = (slide.options[i] ?? '').trim();
        if (!optText) continue;
        await pause(280);
        onStep?.(`جارٍ توليد صوت ${itemLabel} ${i + 1} من ${optCount}...`);
        voiceover.options[i] = await generateTtsClip(
          optText,
          voiceName,
          `ai-option-${i + 1}.wav`,
          consistentStyle
        );
      }
    }

    if (mode === 'questionAndAnswer' || mode === 'full') {
      const ansIdx = slide.slideType === 'clues' ? 3 : slide.correctIndex;
      const correctOptText = (slide.options[ansIdx] ?? '').trim();
      if (correctOptText) {
        await pause(280);
        onStep?.('جارٍ توليد صوت الإجابة الصحيحة...');
        const ansText = `الإجابة الصحيحة هي: ${correctOptText}`;
        voiceover.answer = await generateTtsClip(
          ansText,
          voiceName,
          'ai-answer.wav',
          consistentStyle
        );
      }
    }

    return {
      slide: { ...slide, voiceover },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'تعذر إكمال توليد الصوت.';
    const quotaExhausted = err instanceof AiApiError ? err.quotaExhausted : false;
    return {
      slide: { ...slide, voiceover },
      warning: message,
      quotaExhausted,
    };
  }
}

export interface YoutubePublishKit {
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
  pinnedComment: string;
}

export async function generateYoutubePublishKit(
  slides: QuestionSlide[],
  aspectRatio: '9:16' | '16:9',
  hookText?: string
): Promise<YoutubePublishKit> {
  const validSlides = slides.filter((s) => (s.question || '').trim().length > 0).slice(0, 15);
  if (validSlides.length === 0) {
    throw new AiApiError('لا توجد أسئلة صالحة لتوليد بيانات النشر.', 400);
  }

  if (hasAnyEmbeddedTextAiKeys() && !BUILD_API_BASE) {
    try {
      const { GoogleGenAI, ThinkingLevel, Type } = await import('@google/genai');
      const isShorts = aspectRatio !== '16:9';
      const summaryLines = validSlides
        .map((q, i) => {
          const opts = (q.options || []).filter(Boolean).join(' / ');
          return `${i + 1}) ${q.question.trim()}${opts ? ` [${opts}]` : ''}`;
        })
        .join('\n');

      const promptText = `لدينا فيديو مسابقة أسئلة باللغة العربية بصيغة ${isShorts ? 'YouTube Shorts (عمودي 9:16)' : 'YouTube أفقي (16:9)'}.
${hookText?.trim() ? `عبارة البداية (Hook): ${hookText.trim()}\n` : ''}الأسئلة الموجودة في الفيديو:
${summaryLines}

المطلوب إنشاء حزمة نشر احترافية باللغة العربية تزيد نسبة النقر والتعليقات على يوتيوب، بصيغة JSON فقط تحتوي الحقول التالية:
- title: عنوان جذاب ومشوق (أقل من 65 حرفاً${isShorts ? '، مع إضافة #Shorts في نهايته' : ''})
- description: وصف متكامل وجذاب للجمهور يوضح التحدي ويدعو للاشتراك والتفاعل، مع تضمين الهاشتاغات المناسبة في نهايته
- hashtags: مصفوفة من 5 إلى 8 هاشتاغات عربية وإنجليزية مناسبة تبدأ بـ #
- tags: مصفوفة من 8 إلى 12 كلمة مفتاحية قوية للبحث في يوتيوب بدون علامة #
- pinnedComment: تعليق تفاعلي قصير وممتع جاهز للتثبيت تحت الفيديو يدفع المشاهدين لكتابة نتيجتهم في التعليقات`;

      const kitSystemInstruction =
        'أنت خبير سيو يوتيوب وصناعة محتوى شورتس المسابقات باللغة العربية. اكتب عناوين عالية النقر بدون حشو، وأوصافاً طبيعية، وتعليقات تفاعلية ذكية.';

      let parsed: Partial<YoutubePublishKit> | null = null;
      let geminiErr: unknown = null;

      if (EMBEDDED_CLIENT_GEMINI_KEYS.length > 0) {
        try {
          const response = await runApkGeminiWithRotation(async (apiKey) => {
            const ai = new GoogleGenAI({ apiKey });
            return ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: promptText,
              config: {
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                systemInstruction: kitSystemInstruction,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    pinnedComment: { type: Type.STRING },
                  },
                  required: ['title', 'description', 'hashtags', 'tags', 'pinnedComment'],
                },
              },
            });
          });
          parsed = extractClientJsonPayload(response.text ?? '{}') as Partial<YoutubePublishKit>;
        } catch (err) {
          geminiErr = err;
        }
      }

      if (!parsed || (!parsed.title && !parsed.description)) {
        if (EMBEDDED_CLIENT_GROQ_KEYS.length > 0 || EMBEDDED_CLIENT_OPENROUTER_KEYS.length > 0) {
          parsed = (await runApkExternalJsonFallback(
            kitSystemInstruction,
            `${promptText}\n\nأرجع JSON Object صالح فقط بالحقول: title, description, hashtags, tags, pinnedComment.`
          )) as Partial<YoutubePublishKit>;
        } else if (geminiErr) {
          throw geminiErr;
        } else {
          parsed = {};
        }
      }
      const hashtags = Array.isArray(parsed.hashtags)
        ? parsed.hashtags
            .map((h) => String(h).trim())
            .filter(Boolean)
            .map((h) => (h.startsWith('#') ? h : `#${h.replace(/\s+/g, '_')}`))
            .slice(0, 10)
        : [];
      const tags = Array.isArray(parsed.tags)
        ? parsed.tags
            .map((t) => String(t).replace(/^#/, '').trim())
            .filter(Boolean)
            .slice(0, 15)
        : [];

      return {
        title: (parsed.title || 'اختبر ذكاءك في هذا التحدي! #Shorts').trim().slice(0, 100),
        description: (parsed.description || '').trim(),
        hashtags,
        tags,
        pinnedComment: (parsed.pinnedComment || 'كم إجابة صحيحة جبت؟ اكتب نتيجتك في التعليقات 👇').trim(),
      };
    } catch (err) {
      if (err instanceof AiApiError) throw err;
      throw formatGeminiClientError(err);
    }
  }

  const res = await fetchAi('/api/ai/generate-publish-kit', {
    questions: validSlides.map((s) => ({
      question: s.question,
      options: s.options,
      correctIndex: s.correctIndex,
      explanationText: s.explanationText,
    })),
    aspectRatio,
    hookText,
  });

  const data = await parseJsonSafe<Partial<YoutubePublishKit> & { error?: string; quotaExhausted?: boolean }>(res);
  if (!res.ok || !data.title) {
    throw new AiApiError(
      data.error || 'تعذر توليد حزمة النشر من الخادم.',
      res.status,
      Boolean(data.quotaExhausted)
    );
  }

  return {
    title: data.title,
    description: data.description || '',
    hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
    pinnedComment: data.pinnedComment || '',
  };
}

function sanitizeClientSvg(rawSvg: string): string {
  const cleaned = String(rawSvg || '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:xlink:)?href\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '')
    .trim();
  const match = cleaned.match(/<svg[\s\S]*<\/svg>/i);
  if (!match) return '';
  let svg = match[0];
  if (!/viewBox=/i.test(svg)) {
    svg = svg.replace(/<svg/i, '<svg viewBox="0 0 600 450"');
  }
  if (!/xmlns=/i.test(svg)) {
    svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return svg;
}

async function rasterizeSvgToPngDataUrl(svgString: string): Promise<string> {
  const safeSvg = sanitizeClientSvg(svgString);
  if (!safeSvg) {
    throw new Error('صيغة الرسم التوضيحي غير صالحة.');
  }
  if (typeof document === 'undefined') {
    throw new Error('تعذر تحويل الرسم إلى صورة في هذه البيئة.');
  }

  const blob = new Blob([safeSvg], { type: 'image/svg+xml;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('تعذر تحميل الرسم لتحويله لصورة PNG.'));
      image.src = blobUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 450;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('تعذر تهيئة لوحة الرسم.');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 600, 450);
    ctx.drawImage(img, 0, 0, 600, 450);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export async function generateSlidePuzzleIllustration(
  question: string,
  categoryLabel?: string,
  hint?: string
): Promise<{ dataUrl: string; imageName: string }> {
  const cleanQuestion = question.trim();
  if (!cleanQuestion) {
    throw new AiApiError('اكتب نص السؤال أولاً قبل توليد صورة اللغز.', 400);
  }

  if (hasAnyEmbeddedTextAiKeys() && !BUILD_API_BASE) {
    try {
      const { GoogleGenAI, ThinkingLevel, Type } = await import('@google/genai');
      const sys =
        'You are an expert flat-vector geometric illustrator. Output valid JSON with a clean, colorful, recognizable <svg viewBox="0 0 600 450" xmlns="http://www.w3.org/2000/svg"> illustration representing the quiz subject without revealing the answer as written text.';
      const prompt = `Quiz Question (Arabic): ${cleanQuestion}
${categoryLabel ? `Category: ${categoryLabel}\n` : ''}${hint ? `Visual clue hint: ${hint}\n` : ''}
Create a vivid high-contrast vector illustration SVG (viewBox="0 0 600 450") for a blurred mystery quiz card.
NEVER include <text> or <tspan> or written words/numbers inside the SVG.
Return JSON: {"svg": "<svg ...>...</svg>", "title": "..."}`;

      let parsed: { svg?: string; title?: string } | null = null;
      if (EMBEDDED_CLIENT_GEMINI_KEYS.length > 0) {
        const response = await runApkGeminiWithRotation(async (apiKey) => {
          const ai = new GoogleGenAI({ apiKey });
          return ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: prompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction: sys,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  svg: { type: Type.STRING },
                  title: { type: Type.STRING },
                },
                required: ['svg', 'title'],
              },
            },
          });
        });
        parsed = extractClientJsonPayload(response.text ?? '{}') as { svg?: string; title?: string };
      } else {
        parsed = (await runApkExternalJsonFallback(sys, prompt)) as { svg?: string; title?: string };
      }
      const pngDataUrl = await rasterizeSvgToPngDataUrl(parsed?.svg || '');
      return {
        dataUrl: pngDataUrl,
        imageName: `${(parsed?.title || 'لغز بالذكاء').trim()}.png`,
      };
    } catch (err) {
      if (err instanceof AiApiError) throw err;
      throw formatGeminiClientError(err);
    }
  }

  const res = await fetchAi('/api/ai/generate-puzzle-svg', {
    question: cleanQuestion,
    categoryLabel,
    hint,
  });

  const data = await parseJsonSafe<{
    svg?: string;
    title?: string;
    error?: string;
    quotaExhausted?: boolean;
  }>(res);

  if (!res.ok || !data.svg) {
    throw new AiApiError(
      data.error || 'تعذر توليد صورة اللغز من الخادم.',
      res.status,
      Boolean(data.quotaExhausted)
    );
  }

  const pngDataUrl = await rasterizeSvgToPngDataUrl(data.svg);
  return {
    dataUrl: pngDataUrl,
    imageName: `${(data.title || 'صورة لغز بالذكاء').trim()}.png`,
  };
}

