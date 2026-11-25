import { loadAiMediaBlob, saveAiMediaBlob } from '../storage/projectStore';
import {
  AiPresenterOverlay,
  AudioSettings,
  QuestionSlide,
  TemplateSettings,
  TimingSettings,
  computeProjectTimeline,
  getIntroHookDuration,
  getSlidesContentDuration,
  getTotalDuration,
} from '../types/quiz';

export interface LoadedAiPresenterMedia {
  mediaKey: string;
  blob: Blob;
  objectUrl: string;
  mimeType: 'video/mp4' | 'video/webm';
  videoEl: HTMLVideoElement;
  duration: number;
  width: number;
  height: number;
  ready: boolean;
}

export interface AiPresenterPlaybackWindow {
  timelineStart: number;
  timelineEnd: number;
  trimStart: number;
  trimEnd: number;
  volume: number;
}

export interface AiPresenterFrameTiming {
  visible: boolean;
  videoTimeSec: number;
  timelineStart: number;
  timelineEnd: number;
  isFullscreenHero: boolean;
}

const loadedMediaCache = new Map<string, LoadedAiPresenterMedia>();
const pendingMediaLoads = new Map<string, Promise<LoadedAiPresenterMedia | null>>();
const decodedAudioBuffers = new WeakMap<BaseAudioContext, Map<string, AudioBuffer | null>>();

function loadVideoMetadata(videoEl: HTMLVideoElement, srcUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      videoEl.onloadeddata = null;
      videoEl.onloadedmetadata = null;
      videoEl.onerror = null;
      resolve(ok);
    };
    const timer = window.setTimeout(() => {
      finish(videoEl.readyState >= 1);
    }, 6000);

    videoEl.onloadeddata = () => finish(true);
    videoEl.onloadedmetadata = () => {
      if (videoEl.readyState >= 2) {
        finish(true);
      }
    };
    videoEl.onerror = () => finish(false);
    videoEl.src = srcUrl;
    try {
      videoEl.load();
    } catch {
      // ignore
    }
  });
}

export async function registerAiPresenterBlob(
  mediaKey: string,
  blob: Blob,
  mimeType: 'video/mp4' | 'video/webm',
  persistToDb = true
): Promise<LoadedAiPresenterMedia | null> {
  if (!mediaKey || !blob || blob.size === 0 || typeof document === 'undefined') return null;

  const existing = loadedMediaCache.get(mediaKey);
  if (existing && existing.blob.size === blob.size && existing.ready) {
    return existing;
  }
  if (existing?.objectUrl) {
    try {
      URL.revokeObjectURL(existing.objectUrl);
    } catch {
      // ignore
    }
  }

  if (persistToDb) {
    await saveAiMediaBlob(mediaKey, blob);
  }

  const objectUrl = URL.createObjectURL(blob);
  const videoEl = document.createElement('video');
  videoEl.preload = 'auto';
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.setAttribute('playsinline', '');
  videoEl.crossOrigin = 'anonymous';

  const ok = await loadVideoMetadata(videoEl, objectUrl);
  const duration = Number.isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : 5;
  const entry: LoadedAiPresenterMedia = {
    mediaKey,
    blob,
    objectUrl,
    mimeType,
    videoEl,
    duration,
    width: videoEl.videoWidth || 720,
    height: videoEl.videoHeight || 720,
    ready: ok && videoEl.readyState >= 1,
  };
  loadedMediaCache.set(mediaKey, entry);
  return entry;
}

export async function preloadAiPresenterMedia(
  aiPresenter?: AiPresenterOverlay
): Promise<LoadedAiPresenterMedia | null> {
  if (!aiPresenter?.enabled || !aiPresenter.mediaKey) return null;

  const cached = loadedMediaCache.get(aiPresenter.mediaKey);
  if (cached && cached.ready) {
    return cached;
  }

  const inflight = pendingMediaLoads.get(aiPresenter.mediaKey);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      const blob = await loadAiMediaBlob(aiPresenter.mediaKey);
      if (!blob) return null;
      return await registerAiPresenterBlob(
        aiPresenter.mediaKey,
        blob,
        aiPresenter.mimeType || 'video/mp4',
        false
      );
    } finally {
      pendingMediaLoads.delete(aiPresenter.mediaKey);
    }
  })();

  pendingMediaLoads.set(aiPresenter.mediaKey, task);
  return task;
}

export function getCachedAiPresenterMedia(mediaKey?: string): LoadedAiPresenterMedia | null {
  if (!mediaKey) return null;
  return loadedMediaCache.get(mediaKey) ?? null;
}

export async function decodeAiPresenterAudioBuffer(
  mediaKey: string,
  targetCtx: BaseAudioContext
): Promise<AudioBuffer | null> {
  if (!mediaKey) return null;
  let ctxMap = decodedAudioBuffers.get(targetCtx);
  if (!ctxMap) {
    ctxMap = new Map<string, AudioBuffer | null>();
    decodedAudioBuffers.set(targetCtx, ctxMap);
  }
  if (ctxMap.has(mediaKey)) {
    return ctxMap.get(mediaKey) ?? null;
  }

  try {
    let blob = loadedMediaCache.get(mediaKey)?.blob;
    if (!blob) {
      blob = await loadAiMediaBlob(mediaKey);
    }
    if (!blob) {
      ctxMap.set(mediaKey, null);
      return null;
    }
    const arrBuf = await blob.arrayBuffer();
    const decoded = await targetCtx.decodeAudioData(arrBuf.slice(0));
    ctxMap.set(mediaKey, decoded);
    return decoded;
  } catch {
    ctxMap.set(mediaKey, null);
    return null;
  }
}

export function getAiPresenterPlaybackWindows(
  slides: QuestionSlide[],
  template: TemplateSettings,
  timing: TimingSettings,
  audio: AudioSettings
): AiPresenterPlaybackWindow[] {
  const ai = template.aiPresenter;
  if (!ai?.enabled || !ai.mediaKey) return [];

  const totalDur = getTotalDuration(slides, timing, audio, template);
  if (totalDur <= 0) return [];

  const trimStart = Math.max(0, ai.trimStart || 0);
  const maxNat = Math.max(trimStart + 0.25, ai.naturalDuration || 60);
  const trimEnd = Math.max(trimStart + 0.2, Math.min(maxNat, ai.trimEnd || maxNat));
  const trimmedLen = trimEnd - trimStart;
  const maxShowLen = ai.displayDuration > 0 ? Math.min(trimmedLen, ai.displayDuration) : trimmedLen;
  const offset = Math.max(0, ai.startOffset || 0);
  const volume = Math.max(0, Math.min(1.5, ai.volume ?? 1));

  const introDur = getIntroHookDuration(template, timing);
  const contentEnd = getSlidesContentDuration(slides, timing, audio, template);
  const schedules = computeProjectTimeline(slides, timing, audio, template);
  const windows: AiPresenterPlaybackWindow[] = [];

  if (ai.scope === 'fullTimeline') {
    const start = Math.min(totalDur, offset);
    const end = Math.min(totalDur, start + maxShowLen);
    if (end > start + 0.05) {
      windows.push({ timelineStart: start, timelineEnd: end, trimStart, trimEnd, volume });
    }
  } else if (ai.scope === 'intro') {
    if (introDur > 0.05) {
      const start = Math.min(introDur, offset);
      const end = Math.min(introDur, start + maxShowLen);
      if (end > start + 0.05) {
        windows.push({ timelineStart: start, timelineEnd: end, trimStart, trimEnd, volume });
      }
    }
  } else if (ai.scope === 'outro') {
    if (template.showEndCard && totalDur > contentEnd + 0.05) {
      const start = Math.min(totalDur, contentEnd + offset);
      const end = Math.min(totalDur, start + maxShowLen);
      if (end > start + 0.05) {
        windows.push({ timelineStart: start, timelineEnd: end, trimStart, trimEnd, volume });
      }
    }
  } else if (ai.scope === 'slide') {
    const idx = Math.max(0, Math.min(schedules.length - 1, ai.targetSlideIndex ?? 0));
    const sched = schedules[idx];
    if (sched) {
      const start = Math.min(sched.endTime, sched.startTime + offset);
      const end = Math.min(sched.endTime, start + maxShowLen);
      if (end > start + 0.05) {
        windows.push({ timelineStart: start, timelineEnd: end, trimStart, trimEnd, volume });
      }
    }
  } else if (ai.scope === 'allSlides') {
    for (const sched of schedules) {
      const start = Math.min(sched.endTime, sched.startTime + offset);
      const end = Math.min(sched.endTime, start + maxShowLen);
      if (end > start + 0.05) {
        windows.push({ timelineStart: start, timelineEnd: end, trimStart, trimEnd, volume });
      }
    }
  }

  return windows;
}

export function computeAiPresenterFrameTiming(
  globalTime: number,
  slides: QuestionSlide[],
  template: TemplateSettings,
  timing: TimingSettings,
  audio: AudioSettings
): AiPresenterFrameTiming | null {
  const ai = template.aiPresenter;
  if (!ai?.enabled || !ai.mediaKey) return null;

  const introDur = getIntroHookDuration(template, timing);
  const contentEnd = getSlidesContentDuration(slides, timing, audio, template);
  const windows = getAiPresenterPlaybackWindows(slides, template, timing, audio);
  if (windows.length === 0) return null;

  const inIntro = introDur > 0 && globalTime < introDur;
  const inOutro = Boolean(template.showEndCard) && globalTime >= contentEnd;
  const isFullscreenHero =
    (inIntro && ai.fullscreenInIntro !== false) || (inOutro && ai.fullscreenInOutro !== false);

  for (const w of windows) {
    if (globalTime >= w.timelineStart - 0.02 && globalTime <= w.timelineEnd + 0.02) {
      const rel = Math.max(0, globalTime - w.timelineStart);
      const vTime = Math.min(w.trimEnd - 0.02, Math.max(w.trimStart, w.trimStart + rel));
      return {
        visible: true,
        videoTimeSec: vTime,
        timelineStart: w.timelineStart,
        timelineEnd: w.timelineEnd,
        isFullscreenHero,
      };
    }
  }

  return null;
}

export function syncAiPresenterPreviewVideo(
  globalTime: number,
  isPlaying: boolean,
  slides: QuestionSlide[],
  template: TemplateSettings,
  timing: TimingSettings,
  audio: AudioSettings,
  isMuted: boolean,
  hasWebAudioTrack: boolean
): void {
  const ai = template.aiPresenter;
  if (!ai?.enabled || !ai.mediaKey) return;
  const entry = loadedMediaCache.get(ai.mediaKey);
  if (!entry || !entry.ready) return;
  const video = entry.videoEl;

  const frameTiming = computeAiPresenterFrameTiming(globalTime, slides, template, timing, audio);
  if (!frameTiming) {
    if (!video.paused) {
      try {
        video.pause();
      } catch {
        // ignore
      }
    }
    return;
  }

  // Only unmute HTML5 video element if Web Audio decoded buffer isn't already handling playback
  video.muted = isMuted || hasWebAudioTrack;
  if (!video.muted) {
    video.volume = Math.max(0, Math.min(1, ai.volume ?? 1));
  }

  const target = frameTiming.videoTimeSec;
  if (isPlaying) {
    if (video.paused) {
      if (Math.abs(video.currentTime - target) > 0.08) {
        try {
          video.currentTime = target;
        } catch {
          // ignore
        }
      }
      void video.play().catch(() => undefined);
    } else if (Math.abs(video.currentTime - target) > 0.28) {
      try {
        video.currentTime = target;
      } catch {
        // ignore
      }
    }
  } else {
    if (!video.paused) {
      try {
        video.pause();
      } catch {
        // ignore
      }
    }
    if (Math.abs(video.currentTime - target) > 0.04 && !video.seeking) {
      try {
        video.currentTime = target;
      } catch {
        // ignore
      }
    }
  }
}

export function pauseAllCachedAiPresenterVideos(): void {
  loadedMediaCache.forEach((entry) => {
    try {
      if (!entry.videoEl.paused) {
        entry.videoEl.pause();
      }
    } catch {
      // ignore
    }
  });
}

export async function seekAiPresenterVideoForExportFrame(
  globalTime: number,
  slides: QuestionSlide[],
  template: TemplateSettings,
  timing: TimingSettings,
  audio: AudioSettings
): Promise<void> {
  const ai = template.aiPresenter;
  if (!ai?.enabled || !ai.mediaKey) return;
  const entry = loadedMediaCache.get(ai.mediaKey) ?? (await preloadAiPresenterMedia(ai));
  if (!entry || !entry.ready) return;

  const frameTiming = computeAiPresenterFrameTiming(globalTime, slides, template, timing, audio);
  if (!frameTiming) return;

  const video = entry.videoEl;
  video.muted = true;
  if (!video.paused) {
    try {
      video.pause();
    } catch {
      // ignore
    }
  }

  const target = frameTiming.videoTimeSec;
  if (Math.abs(video.currentTime - target) <= 0.015 && video.readyState >= 2) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener('seeked', done);
      resolve();
    };
    const timer = window.setTimeout(done, 180);
    video.addEventListener('seeked', done, { once: true });
    try {
      video.currentTime = target;
    } catch {
      done();
    }
  });
}
