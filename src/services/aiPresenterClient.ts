const ENV_MAP = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const BUILD_API_BASE = (ENV_MAP.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');

export function resolvePresenterApiUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  return `${BUILD_API_BASE}${path}`;
}

export interface AiPresenterStatusResponse {
  ok: boolean;
  provider: 'tavus';
  providerName: string;
  configured: boolean;
  keyCount: number;
  canHostTempAudio: boolean;
  freeTierSummary: {
    planName: string;
    renews: 'monthly';
    requiresCreditCard: boolean;
    autoCharge: boolean;
    monthlyFreeMinutes: number;
    stockReplicasIncluded: boolean;
    supportsTransparentWebm: boolean;
    supportsArabicScript: boolean;
    supportsExternalAudioUrl: boolean;
  };
}

export interface TavusReplicaItem {
  replicaId: string;
  replicaName: string;
  replicaType: 'system' | 'user';
  status: string;
  thumbnailVideoUrl?: string;
  proxiedThumbnailUrl?: string;
  createdAt?: string;
}

export type AiPresenterApiBackgroundMode =
  | 'transparent'
  | 'white'
  | 'color'
  | 'customImage'
  | 'original';

export interface AiPresenterBackgroundSettingsPayload {
  mode: AiPresenterApiBackgroundMode;
  transparent_background: boolean;
  bake_into_video: boolean;
  color?: string;
  background_url?: string;
  has_custom_image?: boolean;
  matched_editor_scene?: boolean;
}

export interface GenerateAiPresenterRequest {
  replica_id: string;
  script?: string;
  audio_url?: string;
  audio_data_url?: string;
  video_name?: string;
  fast?: boolean;
  transparent_background?: boolean;
  background_url?: string;
  background_mode?: AiPresenterApiBackgroundMode;
  background_color?: string;
  background_data_url?: string;
  background_settings?: AiPresenterBackgroundSettingsPayload;
}

export interface GenerateAiPresenterJob {
  provider: 'tavus';
  videoId: string;
  videoName: string;
  status: string;
  hostedUrl?: string;
  createdAt?: string;
}

export interface AiPresenterVideoStatus {
  provider: 'tavus';
  videoId: string;
  status: 'queued' | 'generating' | 'ready' | 'error' | 'deleted' | string;
  statusDetails?: string;
  generationProgress?: string;
  downloadUrl?: string;
  streamUrl?: string;
  hostedUrl?: string;
  proxiedDownloadUrl?: string;
  proxiedStreamUrl?: string;
}

export class AiPresenterApiError extends Error {
  public readonly status: number;
  public readonly missingKey: boolean;
  public readonly quotaExhausted: boolean;

  constructor(message: string, status = 500, missingKey = false, quotaExhausted = false) {
    super(message);
    this.name = 'AiPresenterApiError';
    this.status = status;
    this.missingKey = missingKey;
    this.quotaExhausted = quotaExhausted;
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AiPresenterApiError(
      res.ok ? 'استجابة الخادم غير صالحة.' : `خطأ من الخادم (${res.status})`,
      res.status
    );
  }
  if (!res.ok) {
    throw new AiPresenterApiError(
      String(parsed.error || `تعذر إتمام الطلب (${res.status})`),
      res.status,
      Boolean(parsed.missingKey),
      Boolean(parsed.quotaExhausted)
    );
  }
  return parsed as unknown as T;
}

export async function fetchAiPresenterStatus(): Promise<AiPresenterStatusResponse> {
  const res = await fetch(resolvePresenterApiUrl('/api/ai-presenter/status'), {
    method: 'GET',
    cache: 'no-store',
  });
  return parseJsonOrThrow<AiPresenterStatusResponse>(res);
}

export async function fetchTavusReplicas(): Promise<TavusReplicaItem[]> {
  const res = await fetch(resolvePresenterApiUrl('/api/ai-presenter/replicas'), {
    method: 'GET',
    cache: 'no-store',
  });
  const data = await parseJsonOrThrow<{ replicas: TavusReplicaItem[] }>(res);
  return Array.isArray(data.replicas) ? data.replicas : [];
}

export async function submitAiPresenterGeneration(
  payload: GenerateAiPresenterRequest
): Promise<GenerateAiPresenterJob> {
  const res = await fetch(resolvePresenterApiUrl('/api/ai-presenter/generate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<GenerateAiPresenterJob>(res);
}

export async function fetchAiPresenterVideoStatus(
  videoId: string
): Promise<AiPresenterVideoStatus> {
  const res = await fetch(
    resolvePresenterApiUrl(`/api/ai-presenter/videos/${encodeURIComponent(videoId)}`),
    {
      method: 'GET',
      cache: 'no-store',
    }
  );
  return parseJsonOrThrow<AiPresenterVideoStatus>(res);
}

export async function downloadAiPresenterMediaBlob(
  proxiedOrDirectUrl: string
): Promise<{ blob: Blob; mimeType: 'video/mp4' | 'video/webm' }> {
  const targetUrl = resolvePresenterApiUrl(proxiedOrDirectUrl);
  const res = await fetch(targetUrl, { method: 'GET' });
  if (!res.ok) {
    throw new AiPresenterApiError(`فشل تحميل ملف الفيديو المُنشأ (${res.status}).`, res.status);
  }
  const rawBlob = await res.blob();
  const contentType = (res.headers.get('content-type') || rawBlob.type || '').toLowerCase();
  const isWebm = contentType.includes('webm') || proxiedOrDirectUrl.toLowerCase().includes('.webm');
  const mimeType: 'video/mp4' | 'video/webm' = isWebm ? 'video/webm' : 'video/mp4';
  const typedBlob =
    rawBlob.type === mimeType ? rawBlob : new Blob([rawBlob], { type: mimeType });
  if (typedBlob.size < 1024) {
    throw new AiPresenterApiError('ملف الفيديو المُحمّل فارغ أو غير مكتمل.', 502);
  }
  return { blob: typedBlob, mimeType };
}
