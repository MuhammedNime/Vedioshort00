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
  isIdleAfterSpeech?: boolean;
}

const loadedMediaCache = new Map<string, LoadedAiPresenterMedia>();
const pendingMediaLoads = new Map<string, Promise<LoadedAiPresenterMedia | null>>();
const decodedAudioBuffers = new WeakMap<BaseAudioContext, Map<string, AudioBuffer | null>>();
const speechEnvelopeCache = new Map<string, { fps: number; bins: Float32Array }>();
const frameReadyListeners = new Set<() => void>();
const lastHardSeekPerfMap = new WeakMap<HTMLVideoElement, number>();
const lastPausedSeekTargetMap = new WeakMap<HTMLVideoElement, number>();

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

let hiddenVideoHost: HTMLDivElement | null = null;

function getOrCreateHiddenVideoHost(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (hiddenVideoHost && document.body?.contains(hiddenVideoHost)) {
    return hiddenVideoHost;
  }
  if (!document.body) return null;
  const host = document.createElement('div');
  host.setAttribute('data-ai-presenter-video-host', '1');
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '0';
  host.style.width = '2px';
  host.style.height = '2px';
  host.style.opacity = '0.001';
  host.style.pointerEvents = 'none';
  host.style.overflow = 'hidden';
  host.style.zIndex = '-1';
  document.body.appendChild(host);
  hiddenVideoHost = host;
  return host;
}

function attachVideoToHiddenHost(videoEl: HTMLVideoElement): void {
  const host = getOrCreateHiddenVideoHost();
  if (!host) return;
  videoEl.style.width = '2px';
  videoEl.style.height = '2px';
  videoEl.style.display = 'block';
  if (videoEl.parentElement !== host) {
    host.appendChild(videoEl);
  }
}

export function subscribeAiPresenterFrameReady(listener: () => void): () => void {
  frameReadyListeners.add(listener);
  return () => {
    frameReadyListeners.delete(listener);
  };
}

function notifyAiPresenterFrameReady(): void {
  frameReadyListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore listener errors
    }
  });
}

function buildSpeechEnvelope(audioBuffer: AudioBuffer): { fps: number; bins: Float32Array } {
  const fps = 60;
  const duration = Math.max(0.1, audioBuffer.duration);
  const binCount = Math.max(1, Math.ceil(duration * fps));
  const bins = new Float32Array(binCount);
  const ch = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;
  const winSamples = Math.max(1, Math.floor(sr / fps));

  let peakMax = 0.001;
  for (let b = 0; b < binCount; b++) {
    const start = Math.floor((b / fps) * sr);
    const end = Math.min(ch.length, start + winSamples);
    let sumSq = 0;
    let cnt = 0;
    for (let i = start; i < end; i++) {
      const s = ch[i];
      sumSq += s * s;
      cnt += 1;
    }
    const rms = cnt > 0 ? Math.sqrt(sumSq / cnt) : 0;
    bins[b] = rms;
    if (rms > peakMax) peakMax = rms;
  }

  const normScale = 1 / Math.max(0.05, peakMax * 0.85);
  for (let b = 0; b < binCount; b++) {
    bins[b] = Math.max(0, Math.min(1, bins[b] * normScale));
  }
  return { fps, bins };
}

export function getAiPresenterSpeechEnvelope(mediaKey?: string, videoTimeSec = 0): number {
  if (!mediaKey) return 0;
  const env = speechEnvelopeCache.get(mediaKey);
  if (!env || env.bins.length === 0) return 0;
  const idx = Math.max(0, Math.min(env.bins.length - 1, Math.floor(Math.max(0, videoTimeSec) * env.fps)));
  return env.bins[idx] ?? 0;
}

function loadVideoMetadata(videoEl: HTMLVideoElement, srcUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let kickedSeek = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      videoEl.onloadeddata = null;
      videoEl.oncanplay = null;
      videoEl.onseeked = null;
      videoEl.onloadedmetadata = null;
      videoEl.onerror = null;
      resolve(ok);
    };
    const timer = window.setTimeout(() => {
      finish(videoEl.readyState >= 1);
    }, 4500);

    const handleFrameDecoded = () => {
      if (videoEl.readyState >= 2) {
        finish(true);
      }
    };

    videoEl.onloadeddata = handleFrameDecoded;
    videoEl.oncanplay = handleFrameDecoded;
    videoEl.onseeked = handleFrameDecoded;
    videoEl.onloadedmetadata = () => {
      if (videoEl.readyState >= 2) {
        finish(true);
        return;
      }
      if (!kickedSeek) {
        kickedSeek = true;
        try {
          const targetT =
            Number.isFinite(videoEl.duration) && videoEl.duration > 0.1 ? 0.02 : 0;
          videoEl.currentTime = targetT;
        } catch {
          // ignore
        }
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
  if (existing?.videoEl && existing.videoEl.parentElement) {
    try {
      existing.videoEl.pause();
      existing.videoEl.parentElement.removeChild(existing.videoEl);
    } catch {
      // ignore
    }
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
  videoEl.setAttribute('webkit-playsinline', '');
  videoEl.crossOrigin = 'anonymous';
  attachVideoToHiddenHost(videoEl);

  const ok = await loadVideoMetadata(videoEl, objectUrl);
  videoEl.addEventListener('seeked', () => {
    if (videoEl.paused) {
      notifyAiPresenterFrameReady();
    }
  });
  videoEl.addEventListener('loadeddata', () => {
    if (videoEl.paused) {
      notifyAiPresenterFrameReady();
    }
  });
  const rvfcEl = videoEl as VideoWithFrameCallback;
  if (typeof rvfcEl.requestVideoFrameCallback === 'function') {
    const onDecodedFrame = () => {
      notifyAiPresenterFrameReady();
      if (loadedMediaCache.get(mediaKey)?.videoEl === videoEl) {
        rvfcEl.requestVideoFrameCallback?.(onDecodedFrame);
      }
    };
    rvfcEl.requestVideoFrameCallback(onDecodedFrame);
  }

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
  notifyAiPresenterFrameReady();
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
    if (!speechEnvelopeCache.has(mediaKey)) {
      speechEnvelopeCache.set(mediaKey, buildSpeechEnvelope(decoded));
    }
    return decoded;
  } catch {
    ctxMap.set(mediaKey, null);
    return null;
  }
}

function resolveEffectiveAfterSpeechBehavior(
  ai: AiPresenterOverlay
): 'stayIdle' | 'loop' | 'hide' {
  if (ai.afterSpeechBehavior) return ai.afterSpeechBehavior;
  return ai.scope === 'fullTimeline' || ai.scope === 'allSlides' ? 'stayIdle' : 'hide';
}

function appendLoopOrSingleWindows(
  windows: AiPresenterPlaybackWindow[],
  windowStart: number,
  windowBoundEnd: number,
  clipLen: number,
  trimStart: number,
  trimEnd: number,
  volume: number,
  loop: boolean
): void {
  if (windowBoundEnd <= windowStart + 0.05 || clipLen <= 0.05) return;
  if (!loop) {
    const end = Math.min(windowBoundEnd, windowStart + clipLen);
    if (end > windowStart + 0.05) {
      windows.push({ timelineStart: windowStart, timelineEnd: end, trimStart, trimEnd, volume });
    }
    return;
  }
  let cursor = windowStart;
  let guard = 0;
  while (cursor < windowBoundEnd - 0.05 && guard < 60) {
    const end = Math.min(windowBoundEnd, cursor + clipLen);
    if (end <= cursor + 0.05) break;
    windows.push({ timelineStart: cursor, timelineEnd: end, trimStart, trimEnd, volume });
    cursor = end;
    guard += 1;
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
  const shouldLoop = resolveEffectiveAfterSpeechBehavior(ai) === 'loop';

  const introDur = getIntroHookDuration(template, timing);
  const contentEnd = getSlidesContentDuration(slides, timing, audio, template);
  const schedules = computeProjectTimeline(slides, timing, audio, template);
  const windows: AiPresenterPlaybackWindow[] = [];

  if (ai.scope === 'fullTimeline') {
    const phaseBase = ai.startPhase === 'firstQuestion' ? introDur : 0;
    const start = Math.min(totalDur, phaseBase + offset);
    appendLoopOrSingleWindows(
      windows,
      start,
      totalDur,
      maxShowLen,
      trimStart,
      trimEnd,
      volume,
      shouldLoop
    );
  } else if (ai.scope === 'intro') {
    if (introDur > 0.05) {
      const start = Math.min(introDur, offset);
      appendLoopOrSingleWindows(
        windows,
        start,
        introDur,
        maxShowLen,
        trimStart,
        trimEnd,
        volume,
        shouldLoop
      );
    }
  } else if (ai.scope === 'outro') {
    if (template.showEndCard && totalDur > contentEnd + 0.05) {
      const start = Math.min(totalDur, contentEnd + offset);
      appendLoopOrSingleWindows(
        windows,
        start,
        totalDur,
        maxShowLen,
        trimStart,
        trimEnd,
        volume,
        shouldLoop
      );
    }
  } else if (ai.scope === 'slide') {
    const idx = Math.max(0, Math.min(schedules.length - 1, ai.targetSlideIndex ?? 0));
    const sched = schedules[idx];
    if (sched) {
      const start = Math.min(sched.endTime, sched.startTime + offset);
      appendLoopOrSingleWindows(
        windows,
        start,
        sched.endTime,
        maxShowLen,
        trimStart,
        trimEnd,
        volume,
        shouldLoop
      );
    }
  } else if (ai.scope === 'allSlides') {
    for (const sched of schedules) {
      const start = Math.min(sched.endTime, sched.startTime + offset);
      appendLoopOrSingleWindows(
        windows,
        start,
        sched.endTime,
        maxShowLen,
        trimStart,
        trimEnd,
        volume,
        shouldLoop
      );
    }
  }

  return windows;
}

export function isTimeCoveredByAiPresenterAudio(
  globalTime: number,
  slides: QuestionSlide[],
  template: TemplateSettings,
  timing: TimingSettings,
  audio: AudioSettings
): boolean {
  const ai = template.aiPresenter;
  if (!ai?.enabled || !ai.mediaKey || (ai.volume ?? 1) <= 0.01) return false;
  if (ai.muteOtherVoices === false) return false;
  const windows = getAiPresenterPlaybackWindows(slides, template, timing, audio);
  return windows.some((w) => globalTime >= w.timelineStart - 0.12 && globalTime <= w.timelineEnd - 0.05);
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
  const totalDur = getTotalDuration(slides, timing, audio, template);
  const windows = getAiPresenterPlaybackWindows(slides, template, timing, audio);
  if (windows.length === 0) return null;

  const inIntro = introDur > 0 && globalTime < introDur;
  const inOutro = Boolean(template.showEndCard) && globalTime >= contentEnd;
  const isFullscreenHero =
    (inIntro && Boolean(ai.fullscreenInIntro)) || (inOutro && Boolean(ai.fullscreenInOutro));

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
        isIdleAfterSpeech: false,
      };
    }
  }

  // Keep real presenter calmly visible after speech finishes when stayIdle is active
  if (resolveEffectiveAfterSpeechBehavior(ai) === 'stayIdle') {
    const firstWin = windows[0];
    const idleHoldSec = Math.max(firstWin.trimStart, firstWin.trimEnd - 0.12);
    if (ai.scope === 'fullTimeline') {
      const lastWin = windows[windows.length - 1];
      if (globalTime > lastWin.timelineEnd && globalTime <= totalDur + 0.02) {
        return {
          visible: true,
          videoTimeSec: idleHoldSec,
          timelineStart: lastWin.timelineStart,
          timelineEnd: totalDur,
          isFullscreenHero,
          isIdleAfterSpeech: true,
        };
      }
      if (ai.startPhase === 'firstQuestion' && globalTime >= 0 && globalTime < firstWin.timelineStart) {
        return {
          visible: true,
          videoTimeSec: Math.min(firstWin.trimEnd - 0.05, firstWin.trimStart + 0.06),
          timelineStart: 0,
          timelineEnd: firstWin.timelineStart,
          isFullscreenHero,
          isIdleAfterSpeech: true,
        };
      }
    } else if (ai.scope === 'allSlides' || ai.scope === 'slide') {
      const schedules = computeProjectTimeline(slides, timing, audio, template);
      const matchingSched =
        ai.scope === 'slide'
          ? schedules[Math.max(0, Math.min(schedules.length - 1, ai.targetSlideIndex ?? 0))]
          : schedules.find((s) => globalTime >= s.startTime - 0.02 && globalTime <= s.endTime + 0.02);
      if (matchingSched && globalTime >= matchingSched.startTime - 0.02 && globalTime <= matchingSched.endTime + 0.02) {
        const winForSched = windows.find(
          (w) => w.timelineStart >= matchingSched.startTime - 0.05 && w.timelineStart <= matchingSched.endTime + 0.05
        );
        if (winForSched && globalTime > winForSched.timelineEnd) {
          return {
            visible: true,
            videoTimeSec: idleHoldSec,
            timelineStart: winForSched.timelineStart,
            timelineEnd: matchingSched.endTime,
            isFullscreenHero,
            isIdleAfterSpeech: true,
          };
        }
      }
    }
  }

  return null;
}

export async function prepareAiPresenterPlaybackAt(
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

  const video = entry.videoEl;
  attachVideoToHiddenHost(video);
  const frameTiming = computeAiPresenterFrameTiming(globalTime, slides, template, timing, audio);
  if (!frameTiming) return;

  const target = frameTiming.videoTimeSec;
  video.muted = true;
  video.playbackRate = 1.0;
  if (Math.abs(video.currentTime - target) <= 0.025 && video.readyState >= 2) {
    lastPausedSeekTargetMap.set(video, target);
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener('seeked', done);
      lastPausedSeekTargetMap.set(video, target);
      resolve();
    };
    const timer = window.setTimeout(done, 450);
    video.addEventListener('seeked', done, { once: true });
    try {
      video.currentTime = target;
    } catch {
      done();
    }
  });
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
  attachVideoToHiddenHost(video);

  const frameTiming = computeAiPresenterFrameTiming(globalTime, slides, template, timing, audio);
  if (!frameTiming) {
    if (!video.paused) {
      try {
        video.playbackRate = 1.0;
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
  const nowPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const lastHardSeek = lastHardSeekPerfMap.get(video) ?? 0;

  if (isPlaying && !frameTiming.isIdleAfterSpeech) {
    if (video.seeking) {
      return;
    }
    const drift = target - video.currentTime;
    if (video.paused) {
      try {
        video.playbackRate = 1.0;
      } catch {
        // ignore
      }
      if (Math.abs(drift) > 0.04 && nowPerf - lastHardSeek >= 250) {
        lastHardSeekPerfMap.set(video, nowPerf);
        try {
          video.currentTime = target;
        } catch {
          // ignore
        }
      }
      void video.play().catch(() => undefined);
    } else if (Math.abs(drift) > 0.35 && nowPerf - lastHardSeek >= 650) {
      lastHardSeekPerfMap.set(video, nowPerf);
      try {
        video.playbackRate = 1.0;
        video.currentTime = target;
      } catch {
        // ignore
      }
    } else if (Math.abs(drift) > 0.025) {
      // Smoothly converge lip-sync without choppy keyframe re-seek stutters
      try {
        const rate = Math.max(0.8, Math.min(1.2, 1 + drift * 1.8));
        if (Math.abs(video.playbackRate - rate) > 0.01) {
          video.playbackRate = rate;
        }
      } catch {
        // ignore
      }
    } else {
      try {
        if (Math.abs(video.playbackRate - 1.0) > 0.005) {
          video.playbackRate = 1.0;
        }
      } catch {
        // ignore
      }
    }
  } else {
    if (!video.paused) {
      try {
        video.playbackRate = 1.0;
        video.pause();
      } catch {
        // ignore
      }
    }
    if (video.seeking) {
      return;
    }
    const prevPausedTarget = lastPausedSeekTargetMap.get(video);
    const alreadyTriedThisTarget =
      prevPausedTarget !== undefined && Math.abs(prevPausedTarget - target) < 0.015;
    if (!alreadyTriedThisTarget && Math.abs(video.currentTime - target) > 0.03) {
      lastPausedSeekTargetMap.set(video, target);
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
      entry.videoEl.playbackRate = 1.0;
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
      video.playbackRate = 1.0;
      video.pause();
    } catch {
      // ignore
    }
  }

  const target = frameTiming.videoTimeSec;
  if (Math.abs(video.currentTime - target) <= 0.012 && video.readyState >= 2) {
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
    const timer = window.setTimeout(done, 900);
    video.addEventListener('seeked', done, { once: true });
    try {
      video.currentTime = target;
    } catch {
      done();
    }
  });
}
