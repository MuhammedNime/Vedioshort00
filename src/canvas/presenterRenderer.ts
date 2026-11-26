import {
  AiPresenterOverlay,
  PRESENTER_PORTRAIT_URLS,
  PresenterActionCue,
  PresenterBeardStyle,
  PresenterFrameShape,
  PresenterGender,
  PresenterGestureCommand,
  PresenterPlacement,
  PresenterPoseId,
  PresenterSkinTone,
  PresenterStyle,
  QuestionSlide,
  SlideSchedule,
  TemplateSettings,
} from '../types/quiz';
import {
  getAiPresenterSpeechEnvelope,
  getCachedAiPresenterMedia,
  preloadAiPresenterMedia,
} from './aiPresenterMedia';

export type PresenterPose = PresenterPoseId;

export type PresenterPhase =
  | 'intro'
  | 'readingQuestion'
  | 'readingOptions'
  | 'thinking'
  | 'suspense'
  | 'reveal'
  | 'outro';

export interface PresenterChoreography {
  phase: PresenterPhase;
  pose: PresenterPose;
  isSpeaking: boolean;
  mouthOpen: number; // 0..1
  mouthSpread: number; // -1 (rounded O) .. +1 (wide smile E/A)
  speechEnergy: number; // 0..1
  blinkClosed: number; // 0..1 (1 = fully closed blink)
  gazeX: number; // -1..1
  gazeY: number; // -1..1
  eyebrowLift: number; // -0.5..1
  browFurrow: number; // 0..1 (thoughtful brow knit)
  breathe: number; // -1..1
  headTiltRad: number;
  headNodY: number;
  handPhase: number;
  bubbleText: string;
  activeOptionIndex?: number;
}

const ENVELOPE_RATE_HZ = 40;
const envelopeCache = new Map<string, Float32Array>();
const pendingEnvelopes = new Map<string, Promise<Float32Array | null>>();
const portraitCache = new Map<string, HTMLImageElement>();
const pendingPortraits = new Map<string, Promise<HTMLImageElement | null>>();

let cachedJawCanvas: HTMLCanvasElement | null = null;
function getJawScratchCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (!cachedJawCanvas) {
    cachedJawCanvas = document.createElement('canvas');
    cachedJawCanvas.width = 160;
    cachedJawCanvas.height = 120;
  }
  return cachedJawCanvas;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

function adjustHexColor(hex: string, amount: number): string {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hex;
  const num = parseInt(clean, 16);
  const r = clamp(((num >> 16) & 255) + amount, 0, 255);
  const g = clamp(((num >> 8) & 255) + amount, 0, 255);
  const b = clamp((num & 255) + amount, 0, 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

interface SkinPalette {
  highlight: string;
  mid: string;
  shadow: string;
  deepShadow: string;
  blush: string;
  lipUpper: string;
  lipLower: string;
  lipLine: string;
  noseShadow: string;
}

const SKIN_PALETTES: Record<PresenterSkinTone, SkinPalette> = {
  fair: {
    highlight: '#ffe8d8',
    mid: '#f6ccb2',
    shadow: '#db9f7f',
    deepShadow: '#b87656',
    blush: 'rgba(235, 118, 114, 0.20)',
    lipUpper: '#b85c5e',
    lipLower: '#d47475',
    lipLine: '#84363b',
    noseShadow: '#b87656',
  },
  warmWheat: {
    highlight: '#fcd8b8',
    mid: '#eab58c',
    shadow: '#c98860',
    deepShadow: '#9d5e3a',
    blush: 'rgba(224, 108, 92, 0.18)',
    lipUpper: '#a64d4e',
    lipLower: '#c46767',
    lipLine: '#722c30',
    noseShadow: '#a0603e',
  },
  olive: {
    highlight: '#f1c9a2',
    mid: '#dca576',
    shadow: '#b87c4e',
    deepShadow: '#8c532e',
    blush: 'rgba(205, 98, 82, 0.16)',
    lipUpper: '#984746',
    lipLower: '#b65e5d',
    lipLine: '#68282b',
    noseShadow: '#8e5632',
  },
  tan: {
    highlight: '#dfa87d',
    mid: '#c6875a',
    shadow: '#9f6139',
    deepShadow: '#733e1f',
    blush: 'rgba(186, 84, 72, 0.16)',
    lipUpper: '#853c3d',
    lipLower: '#a15051',
    lipLine: '#562124',
    noseShadow: '#774222',
  },
  deep: {
    highlight: '#a86e4b',
    mid: '#875032',
    shadow: '#63351d',
    deepShadow: '#422010',
    blush: 'rgba(155, 68, 62, 0.15)',
    lipUpper: '#6b2e33',
    lipLower: '#843f44',
    lipLine: '#3d1519',
    noseShadow: '#472211',
  },
};

function dataUrlCacheKey(dataUrl: string): string {
  return `${dataUrl.slice(0, 48)}:${dataUrl.length}:${dataUrl.slice(-24)}`;
}

function loadPortraitImage(src: string): Promise<HTMLImageElement | null> {
  if (!src || typeof Image === 'undefined') return Promise.resolve(null);
  const existing = portraitCache.get(src);
  if (existing && existing.complete && existing.naturalWidth > 0) {
    return Promise.resolve(existing);
  }
  const inflight = pendingPortraits.get(src);
  if (inflight) return inflight;

  const p = new Promise<HTMLImageElement | null>((resolve) => {
    let settled = false;
    const finish = (img: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      pendingPortraits.delete(src);
      resolve(img);
    };
    const timer = window.setTimeout(() => finish(null), 8000);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      portraitCache.set(src, img);
      finish(img);
    };
    img.onerror = () => finish(null);
    img.src = src;
  });

  pendingPortraits.set(src, p);
  return p;
}

function getCachedPortrait(src: string): HTMLImageElement | null {
  if (!src) return null;
  const cached = portraitCache.get(src);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return cached;
  }
  void loadPortraitImage(src);
  return null;
}

export function getPresenterPortraitUrl(template: TemplateSettings): string | null {
  const style: PresenterStyle = template.presenterStyle || 'stylized3d';
  if (style === 'stylized3d') return null;
  if (style === 'customPhoto' && template.presenterPhotoDataUrl) {
    return template.presenterPhotoDataUrl;
  }
  if (style === 'photoFemale') {
    return PRESENTER_PORTRAIT_URLS.photoFemale;
  }
  return PRESENTER_PORTRAIT_URLS.photoMale;
}

function decodeBase64ToArrayBuffer(dataUrl: string): ArrayBuffer | null {
  try {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx < 0) return null;
    const base64 = dataUrl.slice(commaIdx + 1);
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes.buffer;
  } catch {
    return null;
  }
}

let sharedDecodeCtx: BaseAudioContext | null = null;
function getEnvelopeDecodeContext(): BaseAudioContext | null {
  if (sharedDecodeCtx) return sharedDecodeCtx;
  if (typeof OfflineAudioContext !== 'undefined') {
    sharedDecodeCtx = new OfflineAudioContext(1, 1, 22050);
    return sharedDecodeCtx;
  }
  if (typeof AudioContext !== 'undefined') {
    sharedDecodeCtx = new AudioContext();
    return sharedDecodeCtx;
  }
  return null;
}

export async function preloadSpeechEnvelope(dataUrl?: string): Promise<Float32Array | null> {
  if (!dataUrl || !dataUrl.startsWith('data:audio')) return null;
  const key = dataUrlCacheKey(dataUrl);
  const existing = envelopeCache.get(key);
  if (existing) return existing;
  const inflight = pendingEnvelopes.get(key);
  if (inflight) return inflight;

  const task = (async (): Promise<Float32Array | null> => {
    try {
      const ctx = getEnvelopeDecodeContext();
      if (!ctx) return null;
      const buf = decodeBase64ToArrayBuffer(dataUrl);
      if (!buf) return null;
      const decoded = await ctx.decodeAudioData(buf);
      const ch0 = decoded.getChannelData(0);
      const sr = decoded.sampleRate || 22050;
      const winSize = Math.max(128, Math.round(sr / ENVELOPE_RATE_HZ));
      const frameCount = Math.max(1, Math.ceil(ch0.length / winSize));
      const env = new Float32Array(frameCount);

      let maxRms = 0.04;
      for (let f = 0; f < frameCount; f++) {
        const start = f * winSize;
        const end = Math.min(ch0.length, start + winSize);
        let sumSq = 0;
        for (let i = start; i < end; i++) {
          sumSq += ch0[i] * ch0[i];
        }
        const rms = Math.sqrt(sumSq / Math.max(1, end - start));
        env[f] = rms;
        if (rms > maxRms) maxRms = rms;
      }

      let prev = 0;
      const norm = Math.max(0.06, maxRms * 0.82);
      for (let f = 0; f < frameCount; f++) {
        const target = clamp01(env[f] / norm);
        prev = target > prev ? prev * 0.3 + target * 0.7 : prev * 0.58 + target * 0.42;
        env[f] = prev;
      }

      envelopeCache.set(key, env);
      return env;
    } catch {
      return null;
    } finally {
      pendingEnvelopes.delete(key);
    }
  })();

  pendingEnvelopes.set(key, task);
  return task;
}

export async function preloadPresenterAssets(
  template: TemplateSettings,
  slides?: QuestionSlide[]
): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (template.presenterEnabled) {
    const portraitUrl = getPresenterPortraitUrl(template);
    if (portraitUrl) {
      tasks.push(loadPortraitImage(portraitUrl));
    }
  }
  if (template.aiPresenter?.enabled && template.aiPresenter.mediaKey) {
    tasks.push(preloadAiPresenterMedia(template.aiPresenter));
    if (template.aiPresenter.customBgDataUrl) {
      tasks.push(loadPortraitImage(template.aiPresenter.customBgDataUrl));
    }
  }

  if (template.introHookAudio?.dataUrl) {
    tasks.push(preloadSpeechEnvelope(template.introHookAudio.dataUrl));
  }
  if (template.endCardAudio?.dataUrl) {
    tasks.push(preloadSpeechEnvelope(template.endCardAudio.dataUrl));
  }
  if (slides && slides.length > 0) {
    for (const s of slides) {
      if (s.voiceover?.question?.dataUrl) {
        tasks.push(preloadSpeechEnvelope(s.voiceover.question.dataUrl));
      }
      if (s.voiceover?.answer?.dataUrl) {
        tasks.push(preloadSpeechEnvelope(s.voiceover.answer.dataUrl));
      }
      s.voiceover?.options?.forEach((o) => {
        if (o?.dataUrl) {
          tasks.push(preloadSpeechEnvelope(o.dataUrl));
        }
      });
    }
  }

  await Promise.all(tasks);
}

export function getSpeechAmplitude(dataUrl: string | undefined, offsetSec: number): number | null {
  if (!dataUrl || offsetSec < 0) return null;
  const key = dataUrlCacheKey(dataUrl);
  const env = envelopeCache.get(key);
  if (!env) {
    void preloadSpeechEnvelope(dataUrl);
    return null;
  }
  const idx = Math.floor(offsetSec * ENVELOPE_RATE_HZ);
  if (idx < 0 || idx >= env.length) return 0;
  return env[idx];
}

function syntheticSyllableWave(t: number): number {
  const syl1 = Math.max(0, Math.sin(t * 14.2));
  const syl2 = Math.max(0, Math.sin(t * 9.1 + 0.85));
  const stress = 0.65 + 0.35 * Math.sin(t * 4.4);
  const pause = Math.sin(t * 2.15) > -0.76 ? 1 : 0.04;
  return clamp01((0.26 + 0.74 * syl1 * (0.5 + 0.5 * syl2)) * stress * pause);
}

function computeBlinkState(globalTime: number): number {
  const period = 3.45;
  const phase = (globalTime + 0.4) % period;
  if (phase < 0.08) return phase / 0.08;
  if (phase < 0.17) return 1 - (phase - 0.08) / 0.09;
  const cycleIdx = Math.floor((globalTime + 0.4) / period);
  if (cycleIdx % 3 === 1 && phase >= 0.25 && phase < 0.41) {
    const p2 = phase - 0.25;
    if (p2 < 0.07) return p2 / 0.07;
    return 1 - (p2 - 0.07) / 0.09;
  }
  return 0;
}

function resolveDefaultPhasePose(phase: PresenterPhase): PresenterPose {
  switch (phase) {
    case 'intro':
      return 'waveSpeak';
    case 'readingQuestion':
      return 'pointUp';
    case 'readingOptions':
      return 'explain';
    case 'thinking':
      return 'thinkForehead';
    case 'suspense':
      return 'leanSuspense';
    case 'reveal':
      return 'celebrate';
    case 'outro':
      return 'pointSubscribe';
  }
}

function resolveCommandPose(
  cmd: PresenterGestureCommand | undefined,
  fallback: PresenterPose
): PresenterPose {
  if (!cmd || cmd === 'auto') return fallback;
  return cmd;
}

function resolveActiveSlideCue(
  slide: QuestionSlide | undefined,
  phase: PresenterPhase,
  localTime: number
): PresenterActionCue | null {
  const cues = slide?.presenterCues;
  if (!cues || cues.length === 0) return null;

  for (let i = cues.length - 1; i >= 0; i--) {
    const c = cues[i];
    if (c.trigger === 'atSecond') {
      const start = Math.max(0, c.atSecond ?? 0);
      const dur = Math.max(0.4, c.duration ?? 2.2);
      if (localTime >= start && localTime < start + dur) {
        return c;
      }
    }
  }

  for (let i = cues.length - 1; i >= 0; i--) {
    const c = cues[i];
    if (c.trigger !== 'atSecond' && c.trigger === phase) {
      return c;
    }
  }

  return null;
}

function resolveVoiceDriver(
  dataUrl: string | undefined,
  offsetSec: number,
  fallbackTime: number,
  allowReadingFallback: boolean
): { isSpeaking: boolean; speechEnergy: number } {
  if (dataUrl) {
    const amp = getSpeechAmplitude(dataUrl, offsetSec);
    if (amp !== null) {
      const speaking = amp > 0.032;
      return {
        isSpeaking: speaking,
        speechEnergy: speaking ? clamp01(amp * 1.18) : 0,
      };
    }
  }
  if (allowReadingFallback) {
    return {
      isSpeaking: true,
      speechEnergy: syntheticSyllableWave(fallbackTime) * 0.72,
    };
  }
  return { isSpeaking: false, speechEnergy: 0 };
}

export function computePresenterChoreography(
  globalTime: number,
  template: TemplateSettings,
  phase: PresenterPhase,
  phaseElapsed: number,
  slide?: QuestionSlide,
  schedule?: SlideSchedule,
  localTime = 0,
  demoOverride?: {
    forcedPose?: PresenterPose | null;
    animClock?: number;
  }
): PresenterChoreography {
  const animClock = demoOverride?.animClock ?? globalTime;
  const blinkClosed = computeBlinkState(animClock);
  const breathe = Math.sin(animClock * 1.95);
  const expScale = clamp((template.presenterExpressiveness ?? 100) / 100, 0.2, 1.5);
  const lipSyncMode =
    template.presenterLipSyncMode ??
    (template.presenterContinuousTalk === false ? 'audioOnly' : 'audioAndReading');
  const allowFallbackSpeech = lipSyncMode === 'audioAndReading';

  let isSpeaking = false;
  let speechEnergy = 0;
  let gazeX = 0;
  let gazeY = 0;
  let eyebrowLift = 0;
  let defaultBubbleText = '';
  let activeOptionIndex: number | undefined = undefined;

  if (phase === 'intro') {
    const drv = resolveVoiceDriver(
      template.introHookAudio?.dataUrl,
      phaseElapsed,
      phaseElapsed,
      allowFallbackSpeech
    );
    isSpeaking = drv.isSpeaking;
    speechEnergy = drv.speechEnergy;
    eyebrowLift = 0.45 + 0.28 * speechEnergy;
    gazeX = 0;
    gazeY = -0.03;
  } else if (phase === 'outro') {
    const drv = resolveVoiceDriver(
      template.endCardAudio?.dataUrl,
      phaseElapsed,
      phaseElapsed,
      allowFallbackSpeech
    );
    isSpeaking = drv.isSpeaking;
    speechEnergy = drv.speechEnergy;
    eyebrowLift = 0.52;
    gazeX = 0;
    gazeY = 0.05;
    defaultBubbleText = 'اشترك 🔔';
  } else if (phase === 'readingQuestion') {
    const drv = resolveVoiceDriver(
      slide?.voiceover?.question?.dataUrl,
      phaseElapsed,
      phaseElapsed,
      allowFallbackSpeech
    );
    isSpeaking = drv.isSpeaking;
    speechEnergy = drv.speechEnergy;
    gazeX = -0.18;
    gazeY = -0.22;
    eyebrowLift = 0.3 + 0.25 * speechEnergy;
  } else if (phase === 'readingOptions' && slide && schedule) {
    const optCount =
      slide.slideType === 'trueFalse' || slide.slideType === 'versus'
        ? 2
        : slide.slideType === 'clues' || slide.slideType === 'multiple3'
          ? 3
          : 4;
    let activeOptIdx = 0;
    let activeOptElapsed = phaseElapsed;
    let matchedSeq = false;
    let optCursor = schedule.tOptionStarts[0] ?? 0;

    for (let i = 0; i < optCount; i++) {
      const tOpt = schedule.tOptionStarts[i];
      const oClip = slide.voiceover?.options?.[i];
      const sameAsPrev = i > 0 && Math.abs(tOpt - schedule.tOptionStarts[i - 1]) < 0.01;
      const isGroupedSame =
        i < optCount - 1 && Math.abs(schedule.tOptionStarts[i + 1] - tOpt) < 0.01;
      let groupEndBoundary = schedule.tThinkingStart;
      for (let k = i + 1; k < optCount; k++) {
        if (schedule.tOptionStarts[k] > tOpt + 0.01) {
          groupEndBoundary = schedule.tOptionStarts[k];
          break;
        }
      }
      if (oClip?.dataUrl) {
        const schedStart = isGroupedSame || sameAsPrev ? Math.max(tOpt, optCursor) : tOpt;
        const maxBound = Math.max(schedStart + 0.15, groupEndBoundary - 0.02);
        const clipDur = oClip.duration > 0.05 ? oClip.duration : 1.0;
        const schedEnd = Math.min(maxBound, schedStart + clipDur + 0.04);
        if (localTime >= schedStart && localTime <= schedEnd) {
          activeOptIdx = i;
          activeOptElapsed = localTime - schedStart;
          matchedSeq = true;
          break;
        }
        optCursor = schedEnd;
      }
    }

    if (!matchedSeq) {
      for (let i = optCount - 1; i >= 0; i--) {
        if (localTime >= schedule.tOptionStarts[i]) {
          activeOptIdx = i;
          activeOptElapsed = localTime - schedule.tOptionStarts[i];
          break;
        }
      }
    }

    activeOptionIndex = activeOptIdx;
    const optClip = slide.voiceover?.options?.[activeOptIdx];
    const drv = resolveVoiceDriver(
      optClip?.dataUrl,
      activeOptElapsed,
      animClock,
      allowFallbackSpeech
    );
    isSpeaking = drv.isSpeaking;
    speechEnergy = drv.speechEnergy;
    gazeX = activeOptIdx % 2 === 0 ? 0.3 : -0.3;
    gazeY = 0.08;
    eyebrowLift = 0.22 + 0.22 * speechEnergy;
  } else if (phase === 'thinking') {
    isSpeaking = false;
    speechEnergy = 0;
    gazeX = 0.36 * Math.sin(phaseElapsed * 0.85);
    gazeY = -0.38;
    eyebrowLift = 0.22;
    defaultBubbleText = '؟';
  } else if (phase === 'suspense') {
    isSpeaking = false;
    speechEnergy = 0;
    gazeX = 0;
    gazeY = 0;
    eyebrowLift = 0.62;
    defaultBubbleText = '⏳';
  } else if (phase === 'reveal') {
    const drv = resolveVoiceDriver(
      slide?.voiceover?.answer?.dataUrl,
      phaseElapsed,
      phaseElapsed,
      allowFallbackSpeech
    );
    isSpeaking = drv.isSpeaking;
    speechEnergy = drv.speechEnergy;
    gazeX = 0;
    gazeY = -0.04;
    eyebrowLift = 0.74;
    defaultBubbleText = '✓';
  }

  let autoPose = resolveDefaultPhasePose(phase);
  if (phase === 'thinking' && schedule) {
    const thinkingDur = Math.max(0.1, schedule.thinkingDuration);
    const thinkingRemaining = Math.max(0, schedule.tSuspenseStart - localTime);
    if (thinkingDur >= 3.0 && thinkingRemaining <= 1.85) {
      autoPose = 'tapWatch';
      defaultBubbleText = '⏳';
    } else if (thinkingDur >= 4.2 && phaseElapsed > thinkingDur * 0.45) {
      autoPose = 'thinkChin';
    }
  } else if (phase === 'readingOptions' && activeOptionIndex !== undefined) {
    // Alternate between open conversational gestures and direct option pointing on later options
    if (activeOptionIndex % 2 === 1 && phaseElapsed > 0.3) {
      autoPose = 'pointSide';
    }
  }

  const templateCmd = template.presenterCommands?.[phase];
  const stagePose = resolveCommandPose(templateCmd, autoPose);
  const activeCue =
    phase !== 'intro' && phase !== 'outro'
      ? resolveActiveSlideCue(slide, phase, localTime)
      : null;

  const pose: PresenterPose = demoOverride?.forcedPose
    ? demoOverride.forcedPose
    : activeCue
      ? activeCue.gesture
      : stagePose;

  // When demonstrating a speaking gesture live in editor, ensure lips & speech energy animate cleanly
  if (demoOverride?.forcedPose) {
    const silentDemoPose =
      pose === 'thinkForehead' ||
      pose === 'thinkChin' ||
      pose === 'tapWatch' ||
      pose === 'leanSuspense';
    if (silentDemoPose) {
      isSpeaking = false;
      speechEnergy = 0;
    } else {
      isSpeaking = true;
      speechEnergy = syntheticSyllableWave(animClock);
    }
  }

  const isThinkingPose = pose === 'thinkForehead' || pose === 'thinkChin';

  const bubbleText =
    !demoOverride?.forcedPose && activeCue?.bubbleText && activeCue.bubbleText.trim()
      ? activeCue.bubbleText.trim()
      : isThinkingPose
        ? defaultBubbleText || '؟'
        : pose === 'tapWatch'
          ? '⏳'
          : pose === 'pointSubscribe'
            ? 'اشترك 🔔'
            : pose === 'celebrate'
              ? '✓'
              : defaultBubbleText;

  if (pose === 'pointUp') {
    gazeX = -0.08;
    gazeY = -0.45;
  } else if (pose === 'pointSide') {
    const optSide = activeOptionIndex !== undefined && activeOptionIndex % 2 === 0 ? 1 : -1;
    gazeX = optSide * 0.48;
    gazeY = 0.08;
  } else if (pose === 'tapWatch') {
    gazeX = -0.28;
    gazeY = 0.34;
  } else if (isThinkingPose) {
    gazeX = 0.34 * Math.sin(animClock * 0.9);
    gazeY = -0.42;
  } else if (pose === 'celebrate') {
    eyebrowLift = 0.78;
    gazeX = 0;
    gazeY = -0.04;
  }

  const browFurrow = isThinkingPose ? 0.85 : pose === 'leanSuspense' ? 0.58 : 0;

  const mouthSpread = isSpeaking
    ? clamp(Math.sin(animClock * 11.4) * 0.58 + Math.cos(animClock * 6.2) * 0.36, -0.85, 1)
    : pose === 'celebrate' || pose === 'waveSpeak' || pose === 'pointSubscribe'
      ? 0.58
      : isThinkingPose
        ? -0.15
        : 0.2;

  const headTiltRad =
    (pose === 'thinkForehead'
      ? -0.09 + Math.sin(animClock * 1.15) * 0.022
      : pose === 'thinkChin'
        ? -0.07 + Math.sin(animClock * 1.2) * 0.024
        : pose === 'waveSpeak' || pose === 'celebrate'
          ? Math.sin(animClock * 2.8) * 0.042 + speechEnergy * 0.026
          : pose === 'leanSuspense'
            ? 0.04 + Math.sin(animClock * 4.4) * 0.018
            : Math.sin(animClock * 1.65) * 0.025 + speechEnergy * 0.024) * expScale;

  const headNodY =
    (breathe * 2.0 + (isSpeaking ? Math.sin(animClock * 10.8) * speechEnergy * 4.2 : 0)) *
    expScale;

  return {
    phase,
    pose,
    isSpeaking,
    mouthOpen: clamp01(speechEnergy),
    mouthSpread,
    speechEnergy: clamp01(speechEnergy),
    blinkClosed,
    gazeX,
    gazeY,
    eyebrowLift: eyebrowLift * expScale,
    browFurrow,
    breathe,
    headTiltRad,
    headNodY,
    handPhase: animClock,
    bubbleText,
    activeOptionIndex,
  };
}

function drawRoundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function drawStudioCondenserMic(
  ctx: CanvasRenderingContext2D,
  cx: number,
  bottomY: number,
  scale: number,
  speechEnergy: number,
  isSpeaking: boolean
): void {
  ctx.save();
  ctx.translate(cx, bottomY);
  ctx.scale(scale, scale);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -44);
  ctx.stroke();

  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, -68, 25, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();

  const bodyGrad = ctx.createLinearGradient(-16, -98, 16, -42);
  bodyGrad.addColorStop(0, '#334155');
  bodyGrad.addColorStop(0.5, '#1e293b');
  bodyGrad.addColorStop(1, '#0f172a');
  drawRoundedPath(ctx, -16, -96, 32, 50, 14);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(237, 214, 162, 0.45)';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  const meshGrad = ctx.createLinearGradient(-14, -104, 14, -74);
  meshGrad.addColorStop(0, '#94a3b8');
  meshGrad.addColorStop(0.5, '#cbd5e1');
  meshGrad.addColorStop(1, '#475569');
  drawRoundedPath(ctx, -14, -104, 28, 28, 12);
  ctx.fillStyle = meshGrad;
  ctx.fill();

  const glowAlpha = isSpeaking ? 0.55 + 0.45 * speechEnergy : 0.35;
  ctx.beginPath();
  ctx.arc(0, -64, 4.2, 0, Math.PI * 2);
  ctx.fillStyle = isSpeaking
    ? `rgba(16, 185, 129, ${glowAlpha.toFixed(2)})`
    : 'rgba(237, 214, 162, 0.5)';
  ctx.fill();

  ctx.restore();
}

function drawGestureOverlayProps(
  ctx: CanvasRenderingContext2D,
  choreo: PresenterChoreography,
  centerX: number,
  centerY: number,
  radiusW: number,
  radiusH: number,
  fontStack: string,
  targetPointX?: number,
  targetPointY?: number
): void {
  const { pose, handPhase, bubbleText } = choreo;
  const isThinkingPose = pose === 'thinkForehead' || pose === 'thinkChin';

  // Clean thought bubble or custom script cue (zero detached cartoon hands!)
  const hasCustomBubble = Boolean(
    bubbleText && bubbleText !== '✓' && bubbleText !== 'اشترك 🔔'
  );
  if (isThinkingPose || hasCustomBubble) {
    const label = bubbleText || '؟';
    const isShort = label.length <= 2;
    const floatY = Math.sin(handPhase * 3.1) * 5;
    const bx = centerX - radiusW * 0.72;
    const by = centerY - radiusH * 0.6 + floatY;
    ctx.save();

    if (isThinkingPose) {
      for (let d = 0; d < 3; d++) {
        const dr = 4.5 + d * 3;
        const dx = bx + (2 - d) * 13;
        const dy = by + 38 - d * 11;
        ctx.beginPath();
        ctx.arc(dx, dy, dr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    if (isShort) {
      ctx.beginPath();
      ctx.arc(bx - 6, by - 4, 24, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFDF5';
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.strokeStyle = '#D4A73A';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.font = `900 26px ${fontStack}`;
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx - 6, by - 2);
    } else {
      ctx.font = `800 22px ${fontStack}`;
      const metrics = ctx.measureText(label);
      const pw = Math.min(260, Math.max(96, metrics.width + 32));
      const ph = 44;
      drawRoundedPath(ctx, bx - pw / 2, by - ph / 2, pw, ph, 20);
      ctx.fillStyle = '#FFFDF5';
      ctx.shadowColor = 'rgba(0,0,0,0.38)';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.strokeStyle = '#00B050';
      ctx.lineWidth = 2.8;
      ctx.stroke();

      ctx.direction = 'rtl';
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx, by + 1, pw - 18);
    }
    ctx.restore();
  }

  // Animated Subscribe arrow pointer on Outro
  if (pose === 'pointSubscribe' && targetPointX !== undefined && targetPointY !== undefined) {
    const bob = Math.sin(handPhase * 6.2) * 8;
    const px = targetPointX;
    const py = targetPointY + bob;
    ctx.save();
    ctx.translate(px, py);
    ctx.shadowColor = 'rgba(239, 68, 68, 0.55)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(0, 26);
    ctx.lineTo(-20, 2);
    ctx.lineTo(-9, 2);
    ctx.lineTo(-9, -22);
    ctx.lineTo(9, -22);
    ctx.lineTo(9, 2);
    ctx.lineTo(20, 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

type HandPoseVariant = 'open' | 'point' | 'foreheadRest' | 'chinRest' | 'relaxed';

function solveTwoBoneIK(
  sx: number,
  sy: number,
  wx: number,
  wy: number,
  L1: number,
  L2: number,
  bendSign: 1 | -1
): { ex: number; ey: number; wx: number; wy: number } {
  const dx = wx - sx;
  const dy = wy - sy;
  const rawDist = Math.hypot(dx, dy);
  const maxReach = L1 + L2 - 2.5;
  const minReach = Math.abs(L1 - L2) + 8;
  const dist = clamp(rawDist, minReach, maxReach);
  const scale = rawDist > 0.001 ? dist / rawDist : 1;
  const clampedWx = sx + dx * scale;
  const clampedWy = sy + dy * scale;

  const cosA = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
  const baseAngle = Math.atan2(clampedWy - sy, clampedWx - sx);
  const elbowAngle = baseAngle + bendSign * Math.acos(cosA);
  return {
    ex: sx + Math.cos(elbowAngle) * L1,
    ey: sy + Math.sin(elbowAngle) * L1,
    wx: clampedWx,
    wy: clampedWy,
  };
}

function drawRealisticHand(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  angleRad: number,
  mirrorX: 1 | -1,
  variant: HandPoseVariant,
  skin: SkinPalette,
  time: number
): void {
  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(angleRad);
  ctx.scale(mirrorX, 1);

  const skinGrad = ctx.createLinearGradient(-12, -16, 14, 18);
  skinGrad.addColorStop(0, skin.highlight);
  skinGrad.addColorStop(0.55, skin.mid);
  skinGrad.addColorStop(1, skin.shadow);

  ctx.fillStyle = skinGrad;
  ctx.strokeStyle = skin.deepShadow;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (variant === 'point') {
    // Thumb tucked + palm + curled other fingers + crisp pointing index finger along -Y
    // Curled fingers fist shadow
    ctx.beginPath();
    ctx.ellipse(2, 2, 11.5, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Extended Index finger pointing straight along -Y
    ctx.beginPath();
    ctx.moveTo(-7.5, -2);
    ctx.lineTo(-6.2, -26);
    ctx.arc(-2.5, -26, 3.7, Math.PI, 0);
    ctx.lineTo(1.2, -2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Curled middle/ring/pinky finger ridges
    for (let f = 0; f < 3; f++) {
      const fx = 3.5 + f * 3.1;
      const fy = -2.5 + f * 1.4;
      ctx.beginPath();
      ctx.ellipse(fx, fy, 2.7, 5.2, 0.1, 0, Math.PI * 2);
      ctx.fillStyle = skin.mid;
      ctx.fill();
      ctx.stroke();
    }

    // Thumb folded cleanly across side
    ctx.beginPath();
    ctx.ellipse(-8.5, 0, 4.2, 7.2, -0.45, 0, Math.PI * 2);
    ctx.fillStyle = skin.highlight;
    ctx.fill();
    ctx.stroke();
  } else if (variant === 'foreheadRest' || variant === 'chinRest') {
    // Graceful curved 4-finger hand resting softly on temple/forehead or jawline
    const fingerSpread = variant === 'foreheadRest' ? 0.08 : 0.05;
    // Palm base
    ctx.beginPath();
    ctx.ellipse(0, 4, 10.5, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Gently arched fingers touching forehead/chin
    const fingerSpecs = [
      { x: -7, len: 19, w: 2.7, a: -0.18 - fingerSpread },
      { x: -2.2, len: 22, w: 2.8, a: -0.06 },
      { x: 2.8, len: 20, w: 2.6, a: 0.05 },
      { x: 7.2, len: 16, w: 2.4, a: 0.16 },
    ];
    for (const fs of fingerSpecs) {
      ctx.save();
      ctx.translate(fs.x, -4);
      ctx.rotate(fs.a);
      ctx.beginPath();
      ctx.moveTo(-fs.w, 2);
      ctx.quadraticCurveTo(-fs.w * 0.9, -fs.len * 0.6, -fs.w * 0.5, -fs.len);
      ctx.arc(0, -fs.len, fs.w * 0.85, Math.PI, 0);
      ctx.quadraticCurveTo(fs.w * 0.9, -fs.len * 0.6, fs.w, 2);
      ctx.closePath();
      ctx.fillStyle = skinGrad;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Soft thumb along side
    ctx.save();
    ctx.translate(-10, 4);
    ctx.rotate(-0.55);
    ctx.beginPath();
    ctx.ellipse(0, -5, 3.1, 7.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = skin.highlight;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else {
    // Open natural broadcast hand ('open' or 'relaxed')
    const microFan = variant === 'open' ? Math.sin(time * 5.5) * 0.04 : 0;
    ctx.beginPath();
    ctx.ellipse(0, 4, 11.5, 11.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const fingers = [
      { x: -7.6, len: variant === 'relaxed' ? 14 : 18, w: 2.7, a: -0.18 - microFan },
      { x: -2.5, len: variant === 'relaxed' ? 16 : 21, w: 2.8, a: -0.04 },
      { x: 2.6, len: variant === 'relaxed' ? 15 : 19.5, w: 2.7, a: 0.08 + microFan * 0.5 },
      { x: 7.4, len: variant === 'relaxed' ? 12 : 15.5, w: 2.4, a: 0.22 + microFan },
    ];
    for (const fn of fingers) {
      ctx.save();
      ctx.translate(fn.x, -4);
      ctx.rotate(fn.a);
      drawRoundedPath(ctx, -fn.w, -fn.len, fn.w * 2, fn.len + 2, fn.w);
      ctx.fillStyle = skinGrad;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Thumb
    ctx.save();
    ctx.translate(-10.5, 3);
    ctx.rotate(-0.72 - microFan);
    drawRoundedPath(ctx, -3, -12, 6, 14, 3);
    ctx.fillStyle = skin.highlight;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

function drawRiggedArm(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  targetWx: number,
  targetWy: number,
  bendSign: 1 | -1,
  suitColor: string,
  suitShadow: string,
  skin: SkinPalette,
  handVariant: HandPoseVariant,
  handMirrorX: 1 | -1,
  handAngleOffsetRad: number,
  showWatch: boolean,
  time: number
): void {
  const { ex, ey, wx, wy } = solveTwoBoneIK(sx, sy, targetWx, targetWy, 66, 60, bendSign);
  const forearmAngle = Math.atan2(wy - ey, wx - ex);

  ctx.save();
  // Soft drop shadow for sleeve depth over torso
  ctx.shadowColor = 'rgba(0, 0, 0, 0.32)';
  ctx.shadowBlur = 9;
  ctx.shadowOffsetY = 3;

  // Tailored suit sleeve (upper arm -> elbow -> forearm)
  const sleeveGrad = ctx.createLinearGradient(sx, sy, wx, wy);
  sleeveGrad.addColorStop(0, suitColor);
  sleeveGrad.addColorStop(1, suitShadow);
  ctx.strokeStyle = sleeveGrad;
  ctx.lineWidth = 24;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.lineTo(wx - Math.cos(forearmAngle) * 7, wy - Math.sin(forearmAngle) * 7);
  ctx.stroke();

  // Subtle fabric crease at elbow
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  // Crisp White Dress Shirt Cuff peeking at wrist
  const cuffX = wx - Math.cos(forearmAngle) * 6;
  const cuffY = wy - Math.sin(forearmAngle) * 6;
  ctx.save();
  ctx.translate(cuffX, cuffY);
  ctx.rotate(forearmAngle + Math.PI / 2);
  drawRoundedPath(ctx, -10.5, -5, 21, 10, 3);
  ctx.fillStyle = '#f8fafc';
  ctx.fill();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Metallic Studio Wristwatch on wrist (great for tapWatch & realism!)
  if (showWatch) {
    drawRoundedPath(ctx, -11, -9, 22, 5.5, 2);
    ctx.fillStyle = '#475569';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -6.5, 5.8, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.strokeStyle = '#EDD6A2';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // Watch hands
    const wAngle = (time * 4.5) % (Math.PI * 2);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -6.5);
    ctx.lineTo(Math.sin(wAngle) * 3.5, -6.5 - Math.cos(wAngle) * 3.5);
    ctx.stroke();
  }
  ctx.restore();

  // Articulated 5-Finger Realistic Hand attached seamlessly to wrist
  const handOrient = forearmAngle + Math.PI / 2 + handAngleOffsetRad;
  drawRealisticHand(ctx, wx, wy, handOrient, handMirrorX, handVariant, skin, time);

  ctx.restore();
}

function drawRealisticStudioHost(
  ctx: CanvasRenderingContext2D,
  template: TemplateSettings,
  cx: number,
  cy: number,
  boxW: number,
  boxH: number,
  choreo: PresenterChoreography,
  talkIntensity: number
): void {
  const s = Math.min(boxW / 286, boxH / 334);
  const {
    pose,
    mouthOpen,
    mouthSpread,
    blinkClosed,
    gazeX,
    gazeY,
    eyebrowLift,
    browFurrow,
    breathe,
    headTiltRad,
    headNodY,
    handPhase,
    speechEnergy,
    isSpeaking,
    activeOptionIndex,
  } = choreo;

  const gender: PresenterGender = template.presenterGender === 'female' ? 'female' : 'male';
  const skinKey: PresenterSkinTone = template.presenterSkinTone || 'warmWheat';
  const skin = SKIN_PALETTES[skinKey] || SKIN_PALETTES.warmWheat;
  const hairColor = template.presenterHairColor || '#1c1816';
  const hairHighlight = adjustHexColor(hairColor, 42);
  const hairShadow = adjustHexColor(hairColor, -22);
  const eyeColor = template.presenterEyeColor || '#4b2f1c';
  const suitColor = template.presenterSuitColor || '#14284b';
  const suitHighlight = adjustHexColor(suitColor, 26);
  const suitShadow = adjustHexColor(suitColor, -24);
  const tieColor = template.presenterTieColor || '#d4a73a';
  const tieShadow = adjustHexColor(tieColor, -42);
  const beard: PresenterBeardStyle =
    gender === 'female' ? 'none' : template.presenterBeard || 'trimmed';
  const hasGlasses = Boolean(template.presenterGlasses);

  const leanZoom = pose === 'leanSuspense' ? 1.09 : 1.0;
  const scaledOpen = clamp01(mouthOpen * (talkIntensity / 100) * 1.24);
  const jawDropPx = scaledOpen * 5.8;
  const torsoSpeechBob = isSpeaking ? -speechEnergy * 2.4 : 0;

  ctx.save();
  ctx.translate(cx, cy + boxH * 0.045 + (breathe * 2.2 + torsoSpeechBob) * s);
  ctx.scale(s * leanZoom, s * leanZoom);

  // Studio Three-Point Rim & Key Glow Behind Presenter
  const auraColor =
    pose === 'celebrate'
      ? `rgba(0, 176, 80, ${(0.28 + speechEnergy * 0.14).toFixed(2)})`
      : pose === 'thinkForehead' || pose === 'thinkChin'
        ? 'rgba(56, 189, 248, 0.24)'
        : isSpeaking
          ? `rgba(237, 214, 162, ${(0.18 + speechEnergy * 0.22).toFixed(2)})`
          : 'rgba(237, 214, 162, 0.16)';
  const auraGrad = ctx.createRadialGradient(0, -34, 14, 0, -24, 165);
  auraGrad.addColorStop(0, auraColor);
  auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = auraGrad;
  ctx.beginPath();
  ctx.arc(0, -24, 165, 0, Math.PI * 2);
  ctx.fill();

  // Back Hair Layer for Female Persona (falls gracefully behind shoulders)
  if (gender === 'female') {
    const backHairGrad = ctx.createLinearGradient(0, -135, 0, 62);
    backHairGrad.addColorStop(0, hairColor);
    backHairGrad.addColorStop(1, hairShadow);
    ctx.beginPath();
    ctx.moveTo(-58, -62);
    ctx.quadraticCurveTo(-76, -12, -70, 56);
    ctx.quadraticCurveTo(-48, 72, -32, 54);
    ctx.lineTo(32, 54);
    ctx.quadraticCurveTo(48, 72, 70, 56);
    ctx.quadraticCurveTo(76, -12, 58, -62);
    ctx.closePath();
    ctx.fillStyle = backHairGrad;
    ctx.fill();
  }

  // Tailored Studio Blazer / Suit Torso
  const shoulderW = gender === 'female' ? 88 : 98;
  const suitGrad = ctx.createLinearGradient(-shoulderW, 12, shoulderW, 158);
  suitGrad.addColorStop(0, suitHighlight);
  suitGrad.addColorStop(0.45, suitColor);
  suitGrad.addColorStop(1, suitShadow);

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.moveTo(-shoulderW, 158);
  ctx.quadraticCurveTo(-shoulderW + 4, 40, -40, 24);
  ctx.lineTo(40, 24);
  ctx.quadraticCurveTo(shoulderW - 4, 40, shoulderW, 158);
  ctx.closePath();
  ctx.fillStyle = suitGrad;
  ctx.fill();
  ctx.restore();

  // Studio rim light along jacket shoulders
  ctx.strokeStyle = 'rgba(237, 214, 162, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-shoulderW + 6, 130);
  ctx.quadraticCurveTo(-shoulderW + 8, 42, -39, 25);
  ctx.moveTo(shoulderW - 6, 130);
  ctx.quadraticCurveTo(shoulderW - 8, 42, 39, 25);
  ctx.stroke();

  // Crisp Shirt / Blouse Opening + Windsor Tie (male) or Elegant V-Blouse (female)
  ctx.beginPath();
  ctx.moveTo(-28, 22);
  ctx.lineTo(0, gender === 'female' ? 88 : 104);
  ctx.lineTo(28, 22);
  ctx.closePath();
  const shirtGrad = ctx.createLinearGradient(0, 20, 0, 100);
  shirtGrad.addColorStop(0, '#e2e8f0');
  shirtGrad.addColorStop(0.28, '#ffffff');
  shirtGrad.addColorStop(1, '#f1f5f9');
  ctx.fillStyle = shirtGrad;
  ctx.fill();

  if (gender === 'male') {
    const tieGrad = ctx.createLinearGradient(0, 32, 0, 122);
    tieGrad.addColorStop(0, tieColor);
    tieGrad.addColorStop(1, tieShadow);
    // Tie blade
    ctx.beginPath();
    ctx.moveTo(-8, 36);
    ctx.lineTo(8, 36);
    ctx.lineTo(13, 102);
    ctx.lineTo(0, 126);
    ctx.lineTo(-13, 102);
    ctx.closePath();
    ctx.fillStyle = tieGrad;
    ctx.fill();
    // Tie Windsor Knot
    drawRoundedPath(ctx, -10.5, 26, 21, 16, 5);
    ctx.fillStyle = tieColor;
    ctx.fill();
    ctx.strokeStyle = tieShadow;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Shirt collar flaps
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.2;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dir * 26, 22);
      ctx.lineTo(dir * 8, 28);
      ctx.lineTo(dir * 16, 44);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else {
    // Subtle gold pendant necklace
    ctx.strokeStyle = tieColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 40, 20, 0.25, Math.PI - 0.25);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 62, 3.8, 0, Math.PI * 2);
    ctx.fillStyle = tieColor;
    ctx.fill();
  }

  // Suit Lapel Notches & Pocket Square
  ctx.fillStyle = suitShadow;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(dir * 38, 25);
    ctx.lineTo(dir * 5, 104);
    ctx.lineTo(dir * 34, 92);
    ctx.lineTo(dir * 45, 58);
    ctx.lineTo(dir * 34, 54);
    ctx.lineTo(dir * 48, 36);
    ctx.closePath();
    ctx.fill();
  }

  // Pocket square accent
  ctx.beginPath();
  ctx.moveTo(42, 76);
  ctx.lineTo(50, 64);
  ctx.lineTo(58, 73);
  ctx.lineTo(65, 67);
  ctx.lineTo(66, 78);
  ctx.closePath();
  ctx.fillStyle = tieColor;
  ctx.fill();

  // Anatomical Neck with Realistic Cast Chin Shadow
  const neckW = gender === 'female' ? 15 : 19;
  const neckGrad = ctx.createLinearGradient(-neckW, -8, neckW, 38);
  neckGrad.addColorStop(0, skin.shadow);
  neckGrad.addColorStop(0.45, skin.mid);
  neckGrad.addColorStop(1, skin.shadow);
  drawRoundedPath(ctx, -neckW, -12, neckW * 2, 48, 12);
  ctx.fillStyle = neckGrad;
  ctx.fill();

  // Cast shadow from head under chin
  const chinCast = ctx.createLinearGradient(0, -10, 0, 18);
  chinCast.addColorStop(0, 'rgba(20, 8, 4, 0.42)');
  chinCast.addColorStop(1, 'rgba(20, 8, 4, 0)');
  ctx.fillStyle = chinCast;
  ctx.fillRect(-neckW, -10, neckW * 2, 28);

  // ==================== ARTICULATED HEAD ====================
  ctx.save();
  ctx.translate(0, -56 + headNodY);
  ctx.rotate(headTiltRad);

  // Realistic Ears (outer helix + shaded concha)
  for (const dir of [-1, 1]) {
    ctx.save();
    ctx.translate(dir * (gender === 'female' ? 46 : 50), 3);
    ctx.rotate(dir * 0.1);
    ctx.beginPath();
    ctx.ellipse(0, 0, 9.5, 16.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = skin.shadow;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-dir * 1.5, 1, 5, 10, 0, 0, Math.PI * 2);
    ctx.fillStyle = skin.deepShadow;
    ctx.fill();
    ctx.restore();
  }

  // Sculpted Cranial & Jawline Contour (cheekbones + tapered chin that moves subtly with jaw!)
  const faceW = gender === 'female' ? 47 : 51;
  const chinY = 55 + jawDropPx;
  const jawY = 26 + jawDropPx * 0.55;
  const faceGrad = ctx.createRadialGradient(-16, -28, 8, 0, 4, 78);
  faceGrad.addColorStop(0, skin.highlight);
  faceGrad.addColorStop(0.58, skin.mid);
  faceGrad.addColorStop(0.92, skin.shadow);
  faceGrad.addColorStop(1, skin.deepShadow);

  ctx.beginPath();
  ctx.moveTo(-faceW, -20);
  ctx.bezierCurveTo(-faceW - 2, -64, -26, -80, 0, -80);
  ctx.bezierCurveTo(26, -80, faceW + 2, -64, faceW, -20);
  ctx.bezierCurveTo(faceW, 6, faceW - 6, jawY, 22, chinY - 6);
  ctx.quadraticCurveTo(0, chinY + 4, -22, chinY - 6);
  ctx.bezierCurveTo(-faceW + 6, jawY, -faceW, 6, -faceW, -20);
  ctx.closePath();
  ctx.fillStyle = faceGrad;
  ctx.fill();

  // Subsurface Cheek Warmth & Forehead Studio Key Light
  for (const dir of [-1, 1]) {
    const blushGrad = ctx.createRadialGradient(dir * 27, 10, 2, dir * 27, 10, 22);
    blushGrad.addColorStop(0, skin.blush);
    blushGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = blushGrad;
    ctx.beginPath();
    ctx.arc(dir * 27, 10, 22, 0, Math.PI * 2);
    ctx.fill();
  }

  // Groomed Beard & Mustache (strictly below upper cheek / leaving lips completely free)
  if (beard !== 'none') {
    const beardAlpha = beard === 'trimmed' ? 0.55 : 0.24;
    ctx.save();
    ctx.globalAlpha = beardAlpha;
    ctx.fillStyle = hairColor;
    ctx.beginPath();
    ctx.moveTo(-faceW + 3, 2);
    ctx.bezierCurveTo(-faceW + 4, jawY + 2, -24, chinY - 2, 0, chinY + 3);
    ctx.bezierCurveTo(24, chinY - 2, faceW - 4, jawY + 2, faceW - 3, 2);
    ctx.lineTo(faceW - 9, 6);
    ctx.quadraticCurveTo(32, 34 + jawDropPx * 0.5, 0, 38 + jawDropPx * 0.5);
    ctx.quadraticCurveTo(-32, 34 + jawDropPx * 0.5, -faceW + 9, 6);
    ctx.closePath();
    ctx.fill();

    // Subtle trimmed mustache curve cleanly above upper lip
    ctx.beginPath();
    ctx.moveTo(-19, 20);
    ctx.quadraticCurveTo(0, 13, 19, 20);
    ctx.quadraticCurveTo(0, 19, -19, 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Realistic Almond Eyes + Sclera Shading + Iris + Catchlights + Eyelids + Brows
  const openH = Math.max(0.06, 1 - blinkClosed);
  for (const dir of [-1, 1]) {
    const ex = dir * 20.5;
    const ey = -14;
    ctx.save();
    ctx.translate(ex, ey);

    // Subtle orbital socket shadow
    const socketGrad = ctx.createRadialGradient(0, -1, 3, 0, 0, 18);
    socketGrad.addColorStop(0, 'rgba(85, 38, 22, 0.14)');
    socketGrad.addColorStop(1, 'rgba(85, 38, 22, 0)');
    ctx.fillStyle = socketGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // Expressive Tapered Eyebrow (lifts + furrows inward when thinking!)
    const browBaseY = -16.5 - eyebrowLift * 4.8;
    const furrowDrop = browFurrow * 3.4;
    ctx.beginPath();
    ctx.moveTo(-12 * dir, browBaseY + furrowDrop);
    ctx.quadraticCurveTo(0, browBaseY - 4.2, 12.5 * dir, browBaseY + 1.2);
    ctx.quadraticCurveTo(0, browBaseY - 0.5, -12 * dir, browBaseY + furrowDrop + 2.8);
    ctx.closePath();
    ctx.fillStyle = hairColor;
    ctx.fill();

    // Almond Eye Opening Clip
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-11.5, 0);
    ctx.quadraticCurveTo(0, -8.5 * openH, 11.5, 0);
    ctx.quadraticCurveTo(0, 7.2 * openH, -11.5, 0);
    ctx.closePath();

    // Sclera gradient (never flat stark white)
    const scleraGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 12);
    scleraGrad.addColorStop(0, '#ffffff');
    scleraGrad.addColorStop(0.75, '#f1f5f9');
    scleraGrad.addColorStop(1, '#cbd5e1');
    ctx.fillStyle = scleraGrad;
    ctx.fill();
    ctx.clip();

    if (openH > 0.22) {
      const px = gazeX * 3.8;
      const py = gazeY * 2.5;
      // Limbal ring + Iris gradient
      const irisGrad = ctx.createRadialGradient(px, py + 0.5, 1, px, py, 5.8);
      irisGrad.addColorStop(0, adjustHexColor(eyeColor, 26));
      irisGrad.addColorStop(0.65, eyeColor);
      irisGrad.addColorStop(1, adjustHexColor(eyeColor, -35));
      ctx.beginPath();
      ctx.arc(px, py, 5.7, 0, Math.PI * 2);
      ctx.fillStyle = irisGrad;
      ctx.fill();

      // Pupil
      ctx.beginPath();
      ctx.arc(px, py, 2.7, 0, Math.PI * 2);
      ctx.fillStyle = '#09090b';
      ctx.fill();

      // Dual Studio Softbox Catchlights
      ctx.beginPath();
      ctx.arc(px - 1.9, py - 1.9, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px + 1.8, py + 1.6, 0.75, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fill();

      // Upper eyelid shadow cast onto top of eyeball
      const lidCast = ctx.createLinearGradient(0, -9, 0, -2);
      lidCast.addColorStop(0, 'rgba(15, 12, 20, 0.34)');
      lidCast.addColorStop(1, 'rgba(15, 12, 20, 0)');
      ctx.fillStyle = lidCast;
      ctx.fillRect(-13, -9, 26, 7);
    }
    ctx.restore();

    // Crisp Upper Eyelash & Crease Line
    ctx.strokeStyle = hairShadow;
    ctx.lineWidth = gender === 'female' ? 2.6 : 1.9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-11.5, 0.5);
    ctx.quadraticCurveTo(0, -8.5 * openH - 0.5, 12.2, 0.5);
    ctx.stroke();

    // Subtle upper eyelid skin crease
    ctx.strokeStyle = skin.deepShadow;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-9, -4.5 * openH - 2.5);
    ctx.quadraticCurveTo(0, -10.5 * openH - 2.2, 9, -4.5 * openH - 2.5);
    ctx.stroke();

    ctx.restore();
  }

  // Optional Brushed-Titanium Studio Eyeglasses
  if (hasGlasses) {
    ctx.save();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.2;
    for (const dir of [-1, 1]) {
      const gx = dir * 21 - 15;
      const gy = -24;
      drawRoundedPath(ctx, gx, gy, 30, 21, 7);
      ctx.fillStyle = 'rgba(224, 242, 254, 0.14)';
      ctx.fill();
      ctx.stroke();

      // Subtle diagonal glass specular reflection
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(gx + 5, gy + 16);
      ctx.lineTo(gx + 14, gy + 4);
      ctx.stroke();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2.2;
    }
    // Bridge
    ctx.beginPath();
    ctx.moveTo(-6, -15);
    ctx.quadraticCurveTo(0, -18, 6, -15);
    ctx.stroke();
    ctx.restore();
  }

  // Sculpted Volumetric Nose (Bridge Highlight + Tip + Nostrils + Cast Shadow above philtrum)
  ctx.save();
  // Soft shadow along right side of nose bridge
  ctx.strokeStyle = skin.shadow;
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(2.4, -12);
  ctx.lineTo(4.2, 5);
  ctx.stroke();

  // Bright nose bridge & tip catchlight
  ctx.strokeStyle = skin.highlight;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-0.5, -11);
  ctx.lineTo(-0.8, 5);
  ctx.stroke();

  // Underside nostrils & tip contour (cleanly stops at y = 10, far above mouth y = 27.5)
  ctx.fillStyle = skin.noseShadow;
  ctx.beginPath();
  ctx.ellipse(-4.6, 7.6, 2.2, 1.3, -0.25, 0, Math.PI * 2);
  ctx.ellipse(4.6, 7.6, 2.2, 1.3, 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = skin.deepShadow;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-7.2, 6.2);
  ctx.quadraticCurveTo(0, 10.6, 7.2, 6.2);
  ctx.stroke();
  ctx.restore();

  // ==================== ARTICULATED MULTI-PHONEME MOUTH ====================
  const mY = 27.5;
  const spreadFactor = 1 + mouthSpread * 0.22;
  const mouthW = (13.5 + scaledOpen * 2.5) * spreadFactor;
  const cavityH = scaledOpen * 10.2;
  const cornerSmileY =
    pose === 'celebrate' || pose === 'waveSpeak' || pose === 'pointSubscribe'
      ? -2.8
      : pose === 'thinkForehead' || pose === 'thinkChin'
        ? 0.8
        : -1.4;

  ctx.save();
  ctx.translate(0, mY);

  // Subtle smile nasolabial dimple hints
  ctx.strokeStyle = 'rgba(130, 72, 48, 0.18)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-mouthW - 4, cornerSmileY - 2);
  ctx.quadraticCurveTo(-mouthW - 6, cornerSmileY + 3, -mouthW - 3, cornerSmileY + 7);
  ctx.moveTo(mouthW + 4, cornerSmileY - 2);
  ctx.quadraticCurveTo(mouthW + 6, cornerSmileY + 3, mouthW + 3, cornerSmileY + 7);
  ctx.stroke();

  if (scaledOpen > 0.05) {
    // Dark oral cavity clipped cleanly
    ctx.beginPath();
    ctx.moveTo(-mouthW, cornerSmileY);
    ctx.quadraticCurveTo(0, -2.5, mouthW, cornerSmileY);
    ctx.quadraticCurveTo(0, cavityH * 1.45 + 2.5, -mouthW, cornerSmileY);
    ctx.closePath();
    ctx.fillStyle = '#470d14';
    ctx.fill();

    ctx.save();
    ctx.clip();
    // Upper teeth row
    ctx.fillStyle = '#f8fafc';
    drawRoundedPath(ctx, -mouthW + 2.2, -3.5, mouthW * 2 - 4.4, Math.min(5.2, 2.2 + cavityH * 0.45), 2);
    ctx.fill();

    // Warm tongue
    ctx.beginPath();
    ctx.ellipse(0, cavityH * 0.95 + 1.5, mouthW * 0.58, Math.max(3, cavityH * 0.55), 0, 0, Math.PI * 2);
    ctx.fillStyle = '#d15c6b';
    ctx.fill();
    ctx.restore();

    // Upper Lip (Cupid's bow)
    ctx.beginPath();
    ctx.moveTo(-mouthW - 1, cornerSmileY);
    ctx.quadraticCurveTo(-mouthW * 0.45, -5.2, -2.5, -3.5);
    ctx.quadraticCurveTo(0, -2.3, 2.5, -3.5);
    ctx.quadraticCurveTo(mouthW * 0.45, -5.2, mouthW + 1, cornerSmileY);
    ctx.quadraticCurveTo(0, -0.5, -mouthW - 1, cornerSmileY);
    ctx.closePath();
    ctx.fillStyle = skin.lipUpper;
    ctx.fill();

    // Lower Lip moving downward cleanly with jaw drop
    const lowLipY = cavityH * 0.9 + 1.2;
    ctx.beginPath();
    ctx.moveTo(-mouthW + 0.5, cornerSmileY + 0.5);
    ctx.quadraticCurveTo(0, lowLipY + 5.6, mouthW - 0.5, cornerSmileY + 0.5);
    ctx.quadraticCurveTo(0, lowLipY + 0.4, -mouthW + 0.5, cornerSmileY + 0.5);
    ctx.closePath();
    ctx.fillStyle = skin.lipLower;
    ctx.fill();
  } else {
    // Closed expressive natural lips
    // Upper lip
    ctx.beginPath();
    ctx.moveTo(-mouthW, cornerSmileY);
    ctx.quadraticCurveTo(-mouthW * 0.45, -4.8, -2.5, -3.2);
    ctx.quadraticCurveTo(0, -2.0, 2.5, -3.2);
    ctx.quadraticCurveTo(mouthW * 0.45, -4.8, mouthW, cornerSmileY);
    ctx.quadraticCurveTo(0, 1.5 - cornerSmileY * 0.4, -mouthW, cornerSmileY);
    ctx.closePath();
    ctx.fillStyle = skin.lipUpper;
    ctx.fill();

    // Lower lip
    ctx.beginPath();
    ctx.moveTo(-mouthW * 0.9, cornerSmileY + 0.5);
    ctx.quadraticCurveTo(0, 7.2 - cornerSmileY * 0.25, mouthW * 0.9, cornerSmileY + 0.5);
    ctx.quadraticCurveTo(0, 2.2 - cornerSmileY * 0.35, -mouthW * 0.9, cornerSmileY + 0.5);
    ctx.closePath();
    ctx.fillStyle = skin.lipLower;
    ctx.fill();

    // Crisp lip parting shadow line
    ctx.strokeStyle = skin.lipLine;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-mouthW, cornerSmileY);
    ctx.quadraticCurveTo(0, 2.0 - cornerSmileY * 0.4, mouthW, cornerSmileY);
    ctx.stroke();

    // Soft lower-lip specular sheen
    ctx.beginPath();
    ctx.ellipse(0, 3.6 - cornerSmileY * 0.2, 4.5, 1.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.fill();
  }
  ctx.restore();

  // Front Hair Volume, Natural Hairline Taper & Studio Hair Sheen
  const hairGrad = ctx.createLinearGradient(-36, -94, 42, -30);
  hairGrad.addColorStop(0, hairHighlight);
  hairGrad.addColorStop(0.45, hairColor);
  hairGrad.addColorStop(1, hairShadow);

  ctx.save();
  ctx.fillStyle = hairGrad;
  ctx.beginPath();
  if (gender === 'female') {
    ctx.moveTo(-54, -10);
    ctx.bezierCurveTo(-58, -68, -24, -89, 0, -88);
    ctx.bezierCurveTo(24, -89, 58, -68, 54, -10);
    ctx.quadraticCurveTo(46, -42, 16, -54);
    ctx.quadraticCurveTo(0, -45, -18, -56);
    ctx.quadraticCurveTo(-46, -42, -54, -10);
  } else {
    ctx.moveTo(-52, -14);
    ctx.bezierCurveTo(-56, -70, -24, -92, 12, -88);
    ctx.bezierCurveTo(44, -84, 57, -56, 51, -14);
    ctx.lineTo(47, -28);
    ctx.quadraticCurveTo(38, -50, 8, -52);
    ctx.quadraticCurveTo(-24, -55, -46, -28);
    ctx.closePath();
  }
  ctx.fill();

  // Studio top hair specular rim arc
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-26, -72);
  ctx.quadraticCurveTo(4, -81, 30, -68);
  ctx.stroke();
  ctx.restore();

  ctx.restore(); // end articulated head

  // ==================== RIGGED 2-BONE ARMS & HANDS ====================
  // Helper converts live local head coords (hx, hy) -> torso space so hand locks onto forehead/chin!
  const cosT = Math.cos(headTiltRad);
  const sinT = Math.sin(headTiltRad);
  const headToBody = (hx: number, hy: number) => ({
    x: hx * cosT - hy * sinT,
    y: -56 + headNodY + hx * sinT + hy * cosT,
  });

  const leftShoulder = { x: gender === 'female' ? -62 : -68, y: 40 };
  const rightShoulder = { x: gender === 'female' ? 62 : 68, y: 40 };

  if (pose === 'thinkForehead') {
    // Viewer-right arm lifts cleanly so fingers rest directly on temple/forehead; left supports across chest
    const templeTarget = headToBody(31, -34);
    drawRiggedArm(
      ctx,
      leftShoulder.x,
      leftShoulder.y,
      -24,
      66,
      1,
      suitColor,
      suitShadow,
      skin,
      'relaxed',
      1,
      0.35,
      true,
      handPhase
    );
    drawRiggedArm(
      ctx,
      rightShoulder.x,
      rightShoulder.y,
      templeTarget.x + 8,
      templeTarget.y + 8,
      -1,
      suitColor,
      suitShadow,
      skin,
      'foreheadRest',
      -1,
      -0.25 + headTiltRad,
      false,
      handPhase
    );
  } else if (pose === 'thinkChin') {
    const chinTarget = headToBody(14, 48 + jawDropPx);
    drawRiggedArm(
      ctx,
      leftShoulder.x,
      leftShoulder.y,
      -26,
      66,
      1,
      suitColor,
      suitShadow,
      skin,
      'relaxed',
      1,
      0.38,
      true,
      handPhase
    );
    drawRiggedArm(
      ctx,
      rightShoulder.x,
      rightShoulder.y,
      chinTarget.x + 6,
      chinTarget.y + 8,
      -1,
      suitColor,
      suitShadow,
      skin,
      'chinRest',
      -1,
      -0.35 + headTiltRad,
      false,
      handPhase
    );
  } else if (pose === 'waveSpeak') {
    const waveSway = Math.sin(handPhase * 7.2) * 14;
    const waveBob = Math.cos(handPhase * 7.2) * 6;
    const speakBobR = Math.sin(handPhase * 4.8) * (4 + mouthOpen * 6);
    drawRiggedArm(
      ctx,
      leftShoulder.x,
      leftShoulder.y,
      -94 + waveSway,
      -20 + waveBob,
      1,
      suitColor,
      suitShadow,
      skin,
      'open',
      1,
      Math.sin(handPhase * 7.2) * 0.28,
      true,
      handPhase
    );
    drawRiggedArm(
      ctx,
      rightShoulder.x,
      rightShoulder.y,
      58,
      64 - speakBobR,
      -1,
      suitColor,
      suitShadow,
      skin,
      'open',
      -1,
      -0.22,
      false,
      handPhase
    );
  } else if (pose === 'pointUp') {
    const bob = Math.sin(handPhase * 6.2) * 7;
    drawRiggedArm(
      ctx,
      leftShoulder.x,
      leftShoulder.y,
      -86,
      -28 + bob,
      1,
      suitColor,
      suitShadow,
      skin,
      'point',
      1,
      -0.08,
      true,
      handPhase
    );
    drawRiggedArm(
      ctx,
      rightShoulder.x,
      rightShoulder.y,
      58,
      66 + bob * 0.45,
      -1,
      suitColor,
      suitShadow,
      skin,
      'open',
      -1,
      -0.25,
      false,
      handPhase
    );
  } else if (pose === 'pointSide') {
    const bob = Math.sin(handPhase * 6.4) * 8;
    const pointRightSide = activeOptionIndex !== undefined && activeOptionIndex % 2 === 0;
    if (pointRightSide) {
      drawRiggedArm(
        ctx,
        leftShoulder.x,
        leftShoulder.y,
        -52,
        66 - bob * 0.4,
        1,
        suitColor,
        suitShadow,
        skin,
        'open',
        1,
        0.24,
        true,
        handPhase
      );
      drawRiggedArm(
        ctx,
        rightShoulder.x,
        rightShoulder.y,
        104 + bob,
        32,
        -1,
        suitColor,
        suitShadow,
        skin,
        'point',
        -1,
        Math.PI / 2,
        false,
        handPhase
      );
    } else {
      drawRiggedArm(
        ctx,
        leftShoulder.x,
        leftShoulder.y,
        -104 + bob,
        32,
        1,
        suitColor,
        suitShadow,
        skin,
        'point',
        1,
        -Math.PI / 2,
        true,
        handPhase
      );
      drawRiggedArm(
        ctx,
        rightShoulder.x,
        rightShoulder.y,
        52,
        66 - bob * 0.4,
        -1,
        suitColor,
        suitShadow,
        skin,
        'open',
        -1,
        -0.24,
        false,
        handPhase
      );
    }
  } else if (pose === 'tapWatch') {
    const tapBob = Math.abs(Math.sin(handPhase * 9.2)) * -7;
    drawRiggedArm(
      ctx,
      leftShoulder.x,
      leftShoulder.y,
      -16,
      48,
      1,
      suitColor,
      suitShadow,
      skin,
      'open',
      1,
      0.55,
      true,
      handPhase
    );
    drawRiggedArm(
      ctx,
      rightShoulder.x,
      rightShoulder.y,
      8,
      38 + tapBob,
      -1,
      suitColor,
      suitShadow,
      skin,
      'point',
      -1,
      -0.95,
      false,
      handPhase
    );
  } else if (pose === 'celebrate') {
    const pump = Math.sin(handPhase * 8.2) * 11;
    drawRiggedArm(
      ctx,
      leftShoulder.x,
      leftShoulder.y,
      -88,
      -20 - pump,
      1,
      suitColor,
      suitShadow,
      skin,
      'open',
      1,
      -0.18,
      true,
      handPhase
    );
    drawRiggedArm(
      ctx,
      rightShoulder.x,
      rightShoulder.y,
      88,
      -20 - pump,
      -1,
      suitColor,
      suitShadow,
      skin,
      'open',
      -1,
      0.18,
      false,
      handPhase
    );
  } else if (pose === 'pointSubscribe') {
    const bob = Math.sin(handPhase * 6.0) * 7;
    drawRiggedArm(
      ctx,
      leftShoulder.x,
      leftShoulder.y,
      -58,
      62 + bob,
      1,
      suitColor,
      suitShadow,
      skin,
      'point',
      1,
      Math.PI * 0.72,
      true,
      handPhase
    );
    drawRiggedArm(
      ctx,
      rightShoulder.x,
      rightShoulder.y,
      68,
      22 - bob * 0.7,
      -1,
      suitColor,
      suitShadow,
      skin,
      'open',
      -1,
      0.18,
      false,
      handPhase
    );
  } else if (pose === 'leanSuspense') {
    const sway = Math.sin(handPhase * 5.2) * 4;
    drawRiggedArm(
      ctx,
      leftShoulder.x,
      leftShoulder.y,
      -28,
      54 + sway,
      1,
      suitColor,
      suitShadow,
      skin,
      'open',
      1,
      0.58,
      true,
      handPhase
    );
    drawRiggedArm(
      ctx,
      rightShoulder.x,
      rightShoulder.y,
      28,
      54 + sway,
      -1,
      suitColor,
      suitShadow,
      skin,
      'open',
      -1,
      -0.58,
      false,
      handPhase
    );
  } else {
    // 'explain' (lively upper-chest two-hand speaking & option-presenting gestures inside visible frame)
    const gBobL = Math.sin(handPhase * 5.2) * (5 + mouthOpen * 10);
    const gBobR = Math.cos(handPhase * 5.2) * (5 + mouthOpen * 10);
    const optBias =
      activeOptionIndex !== undefined ? (activeOptionIndex % 2 === 0 ? 1 : -1) : 0;
    const twistL = Math.sin(handPhase * 4.8) * 0.16;
    const twistR = -Math.cos(handPhase * 4.8) * 0.16;
    drawRiggedArm(
      ctx,
      leftShoulder.x,
      leftShoulder.y,
      -78 - mouthOpen * 6,
      58 - gBobL - (optBias < 0 ? 12 : 0),
      1,
      suitColor,
      suitShadow,
      skin,
      'open',
      1,
      0.24 + twistL,
      true,
      handPhase
    );
    drawRiggedArm(
      ctx,
      rightShoulder.x,
      rightShoulder.y,
      78 + mouthOpen * 6,
      58 - gBobR - (optBias > 0 ? 12 : 0),
      -1,
      suitColor,
      suitShadow,
      skin,
      'open',
      -1,
      -0.24 + twistR,
      false,
      handPhase
    );
  }

  ctx.restore();
}

function drawStudioPhotoHost(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  template: TemplateSettings,
  cx: number,
  cy: number,
  boxW: number,
  boxH: number,
  choreo: PresenterChoreography,
  softBottomFade: boolean
): void {
  const natW = img.naturalWidth || 1;
  const natH = img.naturalHeight || 1;
  const imgRatio = natW / natH;
  const talkIntensity = Math.max(0, Math.min(100, template.presenterTalkIntensity ?? 70));
  const mouthNormY = Math.max(0.2, Math.min(0.48, (template.presenterMouthY ?? 31.2) / 100));

  const suspenseLean = choreo.pose === 'leanSuspense' ? 0.055 : 0;
  const speechBounce = choreo.isSpeaking ? choreo.speechEnergy * 0.016 : 0;
  const scaleX = 1 + suspenseLean + speechBounce * 0.45 + choreo.breathe * 0.008;
  const scaleY = 1 + suspenseLean + speechBounce + choreo.breathe * 0.012;
  const tilt = choreo.headTiltRad * 0.48;
  const shiftY = choreo.headNodY * 0.6;

  let drawH = boxH;
  let drawW = drawH * imgRatio;
  if (drawW < boxW) {
    drawW = boxW;
    drawH = drawW / imgRatio;
  }

  const imgX = -drawW / 2;
  const imgY = -boxH / 2 - (drawH - boxH) * 0.1;

  ctx.save();
  ctx.translate(cx, cy + shiftY);
  ctx.rotate(tilt);
  ctx.scale(scaleX, scaleY);

  const isThinkingPose = choreo.pose === 'thinkForehead' || choreo.pose === 'thinkChin';
  if (choreo.isSpeaking || choreo.pose === 'celebrate' || isThinkingPose) {
    const glowAlpha =
      choreo.pose === 'celebrate'
        ? 0.42
        : isThinkingPose
          ? 0.22
          : 0.14 + choreo.speechEnergy * 0.3;
    const rg = ctx.createRadialGradient(
      0,
      -boxH * 0.12,
      boxW * 0.1,
      0,
      -boxH * 0.05,
      boxW * 0.72
    );
    rg.addColorStop(
      0,
      choreo.pose === 'celebrate'
        ? `rgba(0, 176, 80, ${glowAlpha.toFixed(2)})`
        : isThinkingPose
          ? `rgba(56, 189, 248, ${glowAlpha.toFixed(2)})`
          : `rgba(237, 214, 162, ${glowAlpha.toFixed(2)})`
    );
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(-boxW * 0.75, -boxH * 0.75, boxW * 1.5, boxH * 1.5);
  }

  ctx.drawImage(img, imgX, imgY, drawW, drawH);

  if (choreo.mouthOpen > 0.04 && talkIntensity > 0) {
    const lipCenterX = imgX + drawW * 0.5;
    const lipLineY = imgY + drawH * mouthNormY;
    const mouthSpanW = drawW * 0.088;
    const maxJawDrop = drawH * 0.0115 * (talkIntensity / 100);
    const jawDrop = Math.max(0.5, choreo.mouthOpen * maxJawDrop);

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(
      lipCenterX,
      lipLineY + jawDrop * 0.45,
      mouthSpanW * 0.44,
      Math.max(1.2, jawDrop * 0.78),
      0,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = 'rgba(34, 9, 12, 0.86)';
    ctx.fill();

    if (jawDrop > 2.2) {
      ctx.beginPath();
      ctx.ellipse(
        lipCenterX,
        lipLineY + jawDrop * 0.14,
        mouthSpanW * 0.34,
        Math.min(2.4, jawDrop * 0.28),
        0,
        0,
        Math.PI
      );
      ctx.fillStyle = 'rgba(248, 244, 238, 0.82)';
      ctx.fill();
    }
    ctx.restore();

    const scratch = getJawScratchCanvas();
    const sCtx = scratch?.getContext('2d');
    if (scratch && sCtx) {
      const sliceSrcW = natW * 0.24;
      const sliceSrcH = natH * 0.072;
      const sliceSrcX = natW * 0.38;
      const sliceSrcY = natH * mouthNormY;
      const destW = drawW * 0.24;
      const destH = drawH * 0.072;
      const destX = imgX + drawW * 0.38;
      const destY = lipLineY + jawDrop * 0.82;

      sCtx.globalCompositeOperation = 'source-over';
      sCtx.clearRect(0, 0, scratch.width, scratch.height);
      sCtx.drawImage(
        img,
        sliceSrcX,
        sliceSrcY,
        sliceSrcW,
        sliceSrcH,
        0,
        0,
        scratch.width,
        scratch.height
      );

      sCtx.globalCompositeOperation = 'destination-in';
      const feather = sCtx.createRadialGradient(
        scratch.width * 0.5,
        scratch.height * 0.35,
        scratch.width * 0.14,
        scratch.width * 0.5,
        scratch.height * 0.45,
        scratch.width * 0.48
      );
      feather.addColorStop(0, 'rgba(0,0,0,1)');
      feather.addColorStop(0.6, 'rgba(0,0,0,0.88)');
      feather.addColorStop(1, 'rgba(0,0,0,0)');
      sCtx.fillStyle = feather;
      sCtx.fillRect(0, 0, scratch.width, scratch.height);
      sCtx.globalCompositeOperation = 'source-over';

      ctx.drawImage(scratch, destX, destY, destW, destH);
    }
  }

  if (choreo.blinkClosed > 0.2) {
    const eyeLineY = imgY + drawH * 0.254;
    const eyeSpreadX = drawW * 0.056;
    const lidRx = drawW * 0.032;
    const lidRy = Math.max(1.5, drawH * 0.0085 * choreo.blinkClosed);
    const eyelidTone =
      template.presenterStyle === 'photoFemale'
        ? `rgba(218, 174, 146, ${(0.72 * choreo.blinkClosed).toFixed(2)})`
        : `rgba(202, 152, 118, ${(0.72 * choreo.blinkClosed).toFixed(2)})`;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        imgX + drawW * 0.5 + dir * eyeSpreadX,
        eyeLineY,
        lidRx,
        lidRy,
        0,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = eyelidTone;
      ctx.fill();
    }
  }

  if (softBottomFade) {
    const fadeGrad = ctx.createLinearGradient(0, boxH * 0.18, 0, boxH * 0.52);
    fadeGrad.addColorStop(0, 'rgba(0,0,0,0)');
    fadeGrad.addColorStop(1, 'rgba(6, 10, 20, 0.72)');
    ctx.fillStyle = fadeGrad;
    ctx.fillRect(-boxW / 2, boxH * 0.18, boxW, boxH * 0.36);
  }

  ctx.restore();
}

export interface PresenterStageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function resolveSlidePresenterRect(
  template: TemplateSettings,
  W: number,
  H: number
): PresenterStageRect {
  const isWide = template.aspectRatio === '16:9';
  const scale = Math.max(0.5, Math.min(1.8, (template.presenterScale ?? 100) / 100));
  const shape: PresenterFrameShape = template.presenterFrameShape || 'broadcastCard';
  const placement: PresenterPlacement = template.presenterPlacement || 'cornerBottomRight';

  const baseW = isWide
    ? shape === 'circleCam'
      ? 210
      : 230
    : shape === 'circleCam'
      ? 230
      : 256;
  const baseH = shape === 'circleCam' ? baseW : Math.round(baseW * 1.24);

  const w = baseW * scale;
  const h = baseH * scale;

  let centerX = W * 0.84;
  let centerY = H * 0.78;

  if (placement === 'floating') {
    centerX = ((template.presenterX ?? 84) / 100) * W;
    centerY = ((template.presenterY ?? 79) / 100) * H;
  } else if (placement === 'bottomCenter') {
    centerX = W / 2;
    centerY = H - h / 2 - (isWide ? 22 : 34);
  } else if (placement === 'cornerBottomRight') {
    centerX = W - w / 2 - (isWide ? 34 : 26);
    centerY = H - h / 2 - (isWide ? 28 : 42);
  } else if (placement === 'cornerBottomLeft') {
    centerX = w / 2 + (isWide ? 34 : 26);
    centerY = H - h / 2 - (isWide ? 28 : 42);
  } else if (placement === 'topRight') {
    centerX = W - w / 2 - (isWide ? 34 : 26);
    centerY = h / 2 + (isWide ? 36 : 96);
  } else if (placement === 'topLeft') {
    centerX = w / 2 + (isWide ? 34 : 26);
    centerY = h / 2 + (isWide ? 36 : 96);
  } else if (placement === 'sideStage') {
    centerX = isWide ? W - w / 2 - 42 : W - w / 2 - 22;
    centerY = isWide ? H * 0.56 : H * 0.44;
  }

  centerX = Math.max(w / 2 + 10, Math.min(W - w / 2 - 10, centerX));
  centerY = Math.max(h / 2 + 10, Math.min(H - h / 2 - 10, centerY));

  return {
    x: centerX - w / 2,
    y: centerY - h / 2,
    w,
    h,
  };
}

function drawBroadcastEqualizer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  barCount: number,
  energy: number,
  time: number,
  color: string
): void {
  ctx.save();
  for (let i = 0; i < barCount; i++) {
    const wave = 0.25 + 0.75 * Math.abs(Math.sin(time * 12 + i * 1.15));
    const h = 4 + energy * 16 * wave;
    ctx.fillStyle = color;
    drawRoundedPath(ctx, x + i * 7, y - h / 2, 4.5, h, 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawPresenterHostFrame(
  ctx: CanvasRenderingContext2D,
  template: TemplateSettings,
  choreo: PresenterChoreography,
  rect: PresenterStageRect,
  fontStack: string,
  options?: {
    isFullscreenHero?: boolean;
    targetPointX?: number;
    targetPointY?: number;
  }
): void {
  const { x, y, w, h } = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const isHero = Boolean(options?.isFullscreenHero);
  const shape: PresenterFrameShape = isHero
    ? 'broadcastCard'
    : template.presenterFrameShape || 'broadcastCard';
  const style: PresenterStyle = template.presenterStyle || 'stylized3d';
  const talkIntensity = Math.max(0, Math.min(100, template.presenterTalkIntensity ?? 70));
  const portraitUrl = getPresenterPortraitUrl(template);
  const portraitImg = portraitUrl ? getCachedPortrait(portraitUrl) : null;
  const isThinkingPose = choreo.pose === 'thinkForehead' || choreo.pose === 'thinkChin';

  ctx.save();

  if (isHero) {
    const heroGlow = ctx.createRadialGradient(
      cx,
      cy - h * 0.08,
      w * 0.1,
      cx,
      cy,
      Math.max(w, h) * 0.75
    );
    heroGlow.addColorStop(0, 'rgba(237, 214, 162, 0.26)');
    heroGlow.addColorStop(0.6, 'rgba(0, 176, 80, 0.10)');
    heroGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = heroGlow;
    ctx.fillRect(cx - w, cy - h, w * 2, h * 2);
  }

  const accentRingColor =
    choreo.pose === 'celebrate'
      ? '#00B050'
      : choreo.pose === 'pointSubscribe'
        ? '#ef4444'
        : isThinkingPose
          ? '#38bdf8'
          : choreo.isSpeaking
            ? '#EDD6A2'
            : template.questionBorderColor || '#D4A73A';

  if (shape === 'circleCam') {
    const rad = Math.min(w, h) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = '#0b1120';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 22;
    ctx.fill();
    ctx.clip();

    if (style !== 'stylized3d' && portraitImg) {
      drawStudioPhotoHost(ctx, portraitImg, template, cx, cy, rad * 2, rad * 2, choreo, false);
    } else {
      const camBg = ctx.createRadialGradient(cx, cy - rad * 0.25, rad * 0.1, cx, cy, rad);
      camBg.addColorStop(0, '#1e325c');
      camBg.addColorStop(1, '#091124');
      ctx.fillStyle = camBg;
      ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      drawRealisticStudioHost(ctx, template, cx, cy, rad * 2, rad * 2, choreo, talkIntensity);
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = accentRingColor;
    ctx.lineWidth = choreo.isSpeaking ? 5 + choreo.speechEnergy * 4 : 4;
    ctx.stroke();
    ctx.restore();
  } else if (shape === 'cutout') {
    ctx.save();
    drawRoundedPath(ctx, x, y, w, h, 34);
    ctx.clip();
    if (style !== 'stylized3d' && portraitImg) {
      drawStudioPhotoHost(ctx, portraitImg, template, cx, cy, w, h, choreo, true);
    } else {
      drawRealisticStudioHost(ctx, template, cx, cy, w, h, choreo, talkIntensity);
    }
    ctx.restore();
  } else {
    const radius = isHero ? 38 : 26;
    ctx.save();
    drawRoundedPath(ctx, x, y, w, h, radius);
    ctx.fillStyle = '#091124';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = isHero ? 36 : 20;
    ctx.shadowOffsetY = 8;
    ctx.fill();
    ctx.clip();

    if (style !== 'stylized3d' && portraitImg) {
      drawStudioPhotoHost(ctx, portraitImg, template, cx, cy, w, h, choreo, false);
    } else {
      const studioBg = ctx.createRadialGradient(cx, cy - h * 0.15, w * 0.08, cx, cy, h * 0.8);
      studioBg.addColorStop(0, '#1d3566');
      studioBg.addColorStop(0.55, '#0f1f42');
      studioBg.addColorStop(1, '#070d1f');
      ctx.fillStyle = studioBg;
      ctx.fillRect(x, y, w, h);

      // Subtle vertical broadcast studio bokeh strips
      ctx.fillStyle = 'rgba(237, 214, 162, 0.04)';
      ctx.fillRect(x + w * 0.12, y, w * 0.06, h);
      ctx.fillRect(x + w * 0.82, y, w * 0.06, h);

      drawRealisticStudioHost(ctx, template, cx, cy, w, h, choreo, talkIntensity);
    }

    const barH = isHero ? 74 : 44;
    const barGrad = ctx.createLinearGradient(x, y + h - barH - 18, x, y + h);
    barGrad.addColorStop(0, 'rgba(6, 10, 22, 0)');
    barGrad.addColorStop(1, 'rgba(6, 10, 22, 0.92)');
    ctx.fillStyle = barGrad;
    ctx.fillRect(x, y + h - barH - 18, w, barH + 18);

    const pName = (template.presenterName || '').trim();
    if (pName) {
      ctx.font = `800 ${isHero ? 26 : 16}px ${fontStack}`;
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(pName, x + w - (isHero ? 26 : 14), y + h - (isHero ? 30 : 19));
    }

    drawBroadcastEqualizer(
      ctx,
      x + (isHero ? 28 : 14),
      y + h - (isHero ? 30 : 19),
      isHero ? 6 : 4,
      choreo.isSpeaking ? Math.max(0.2, choreo.speechEnergy) : 0.08,
      choreo.handPhase,
      choreo.isSpeaking ? '#00B050' : '#EDD6A2'
    );

    ctx.restore();

    ctx.save();
    drawRoundedPath(ctx, x, y, w, h, radius);
    ctx.strokeStyle = accentRingColor;
    ctx.lineWidth = isHero ? 4.5 : choreo.isSpeaking ? 4 : 3;
    ctx.stroke();
    ctx.restore();
  }

  if (template.presenterStudioMic !== false && shape !== 'circleCam') {
    const micScale = isHero ? 1.15 : Math.max(0.55, Math.min(1.0, w / 260));
    drawStudioCondenserMic(
      ctx,
      x + w * 0.22,
      y + h - (shape === 'cutout' ? 4 : isHero ? 56 : 32),
      micScale,
      choreo.speechEnergy,
      choreo.isSpeaking
    );
  }

  drawGestureOverlayProps(
    ctx,
    choreo,
    cx,
    cy,
    w / 2,
    h / 2,
    fontStack,
    options?.targetPointX,
    options?.targetPointY
  );

  ctx.restore();
}

export function resolveAiPresenterRect(
  ai: AiPresenterOverlay,
  W: number,
  H: number,
  aspectRatio?: '9:16' | '16:9'
): PresenterStageRect {
  const isWide = aspectRatio === '16:9';
  const scale = Math.max(0.4, Math.min(2.2, (ai.scale ?? 100) / 100));
  const shape: PresenterFrameShape = ai.frameShape || 'cutout';
  const placement: PresenterPlacement = ai.placement || 'cornerBottomRight';

  const media = getCachedAiPresenterMedia(ai.mediaKey);
  const vidAspect =
    media && media.width > 0 && media.height > 0 ? media.width / media.height : 9 / 16;

  let baseW = isWide ? (shape === 'circleCam' ? 230 : 270) : shape === 'circleCam' ? 250 : 300;
  let baseH = shape === 'circleCam' ? baseW : Math.round(baseW / Math.max(0.55, Math.min(1.6, vidAspect)));
  if (shape === 'broadcastCard') {
    baseH = Math.round(baseW * 1.24);
  }

  const w = baseW * scale;
  const h = baseH * scale;

  let centerX = W * 0.82;
  let centerY = H * 0.78;

  if (placement === 'floating') {
    centerX = ((ai.x ?? 82) / 100) * W;
    centerY = ((ai.y ?? 78) / 100) * H;
  } else if (placement === 'bottomCenter') {
    centerX = W / 2;
    centerY = H - h / 2 - (isWide ? 20 : 32);
  } else if (placement === 'cornerBottomRight') {
    centerX = W - w / 2 - (isWide ? 32 : 24);
    centerY = H - h / 2 - (isWide ? 26 : 38);
  } else if (placement === 'cornerBottomLeft') {
    centerX = w / 2 + (isWide ? 32 : 24);
    centerY = H - h / 2 - (isWide ? 26 : 38);
  } else if (placement === 'topRight') {
    centerX = W - w / 2 - (isWide ? 32 : 24);
    centerY = h / 2 + (isWide ? 34 : 92);
  } else if (placement === 'topLeft') {
    centerX = w / 2 + (isWide ? 32 : 24);
    centerY = h / 2 + (isWide ? 34 : 92);
  } else if (placement === 'sideStage') {
    centerX = isWide ? W - w / 2 - 40 : W - w / 2 - 20;
    centerY = isWide ? H * 0.56 : H * 0.45;
  }

  centerX = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, centerX));
  centerY = Math.max(h / 2 + 6, Math.min(H - h / 2 - 6, centerY));

  return {
    x: centerX - w / 2,
    y: centerY - h / 2,
    w,
    h,
  };
}

function drawCoverImageOrVideo(
  ctx: CanvasRenderingContext2D,
  source: HTMLVideoElement | HTMLImageElement,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  contain = false
): void {
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  const srcRatio = sw / sh;
  const dstRatio = dw / dh;
  let drawW = dw;
  let drawH = dh;
  let drawX = dx;
  let drawY = dy;
  if (contain) {
    if (srcRatio > dstRatio) {
      drawW = dw;
      drawH = dw / srcRatio;
      drawY = dy + (dh - drawH) / 2;
    } else {
      drawH = dh;
      drawW = dh * srcRatio;
      drawX = dx + (dw - drawW) / 2;
    }
  } else {
    if (srcRatio > dstRatio) {
      drawH = dh;
      drawW = dh * srcRatio;
      drawX = dx - (drawW - dw) / 2;
    } else {
      drawW = dw;
      drawH = dw / srcRatio;
      drawY = dy - (drawH - dh) / 2;
    }
  }
  ctx.drawImage(source, drawX, drawY, drawW, drawH);
}

export function drawAiPresenterVideoFrame(
  ctx: CanvasRenderingContext2D,
  template: TemplateSettings,
  ai: AiPresenterOverlay,
  rect: PresenterStageRect,
  fontStack: string,
  options?: {
    isFullscreenHero?: boolean;
    videoTimeSec?: number;
    globalTime?: number;
    isIdleAfterSpeech?: boolean;
  }
): void {
  const { x, y, w, h } = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const isHero = Boolean(options?.isFullscreenHero);
  const isIdle = Boolean(options?.isIdleAfterSpeech);
  const shape: PresenterFrameShape = isHero ? 'broadcastCard' : ai.frameShape || 'cutout';
  const media = getCachedAiPresenterMedia(ai.mediaKey);
  if (!media) {
    void preloadAiPresenterMedia(ai);
  }
  const speechAmp = isIdle
    ? 0
    : getAiPresenterSpeechEnvelope(
        ai.mediaKey,
        options?.videoTimeSec ?? media?.videoEl.currentTime ?? 0
      );
  const isActivelySpeaking = !isIdle && speechAmp > 0.08 && (ai.volume ?? 1) > 0.02;
  const waveClock = options?.globalTime ?? options?.videoTimeSec ?? media?.videoEl.currentTime ?? 0;
  const customBgImg =
    ai.bgMode === 'customImage' && ai.customBgDataUrl
      ? getCachedPortrait(ai.customBgDataUrl)
      : null;

  const paintBackground = () => {
    if (ai.bgMode === 'transparent') return;
    if (ai.bgMode === 'white') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x, y, w, h);
    } else if (ai.bgMode === 'color') {
      ctx.fillStyle = ai.bgColor || '#0f172a';
      ctx.fillRect(x, y, w, h);
    } else if (ai.bgMode === 'customImage' && customBgImg) {
      drawCoverImageOrVideo(
        ctx,
        customBgImg,
        customBgImg.naturalWidth,
        customBgImg.naturalHeight,
        x,
        y,
        w,
        h,
        false
      );
    } else if (shape !== 'cutout') {
      ctx.fillStyle = '#091124';
      ctx.fillRect(x, y, w, h);
    }
  };

  const paintVideoContent = (containMode: boolean) => {
    if (media && media.ready && media.videoEl.readyState >= 2) {
      if (isIdle) {
        const breatheScale = 1 + 0.008 * Math.sin(waveClock * 2.1);
        const swayY = Math.sin(waveClock * 1.4) * Math.max(1, h * 0.004);
        ctx.save();
        ctx.translate(cx, y + h);
        ctx.scale(breatheScale, breatheScale);
        ctx.translate(-cx, -(y + h) + swayY);
        drawCoverImageOrVideo(
          ctx,
          media.videoEl,
          media.videoEl.videoWidth || media.width,
          media.videoEl.videoHeight || media.height,
          x,
          y,
          w,
          h,
          containMode
        );
        ctx.restore();
      } else {
        drawCoverImageOrVideo(
          ctx,
          media.videoEl,
          media.videoEl.videoWidth || media.width,
          media.videoEl.videoHeight || media.height,
          x,
          y,
          w,
          h,
          containMode
        );
      }
    } else {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.fillRect(x, y, w, h);
      ctx.font = `700 ${Math.max(16, Math.round(w * 0.08))}px ${fontStack}`;
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#EDD6A2';
      ctx.fillText('جارٍ تحميل الراوي...', cx, cy);
    }
  };

  ctx.save();

  const speakingStroke = isActivelySpeaking
    ? '#00E676'
    : template.questionBorderColor || '#D4A73A';

  if (shape === 'circleCam') {
    const rad = Math.min(w, h) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.shadowColor = isActivelySpeaking ? 'rgba(0, 230, 118, 0.55)' : 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = isActivelySpeaking ? 26 + speechAmp * 14 : 22;
    ctx.fillStyle = ai.bgMode === 'transparent' ? 'rgba(0,0,0,0.01)' : '#0b1120';
    ctx.fill();
    ctx.clip();
    paintBackground();
    paintVideoContent(false);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = speakingStroke;
    ctx.lineWidth = isActivelySpeaking ? 4.5 + speechAmp * 3.5 : 4.5;
    ctx.stroke();
    ctx.restore();

    if ((ai.volume ?? 1) > 0.02) {
      drawBroadcastEqualizer(
        ctx,
        cx - 12,
        y + h - 18,
        4,
        isActivelySpeaking ? Math.max(0.28, speechAmp) : 0.06,
        waveClock,
        isActivelySpeaking ? '#00E676' : '#EDD6A2'
      );
    }
  } else if (shape === 'cutout') {
    ctx.save();
    drawRoundedPath(ctx, x, y, w, h, 26);
    ctx.clip();
    paintBackground();
    paintVideoContent(ai.bgMode === 'transparent');
    ctx.restore();

    if (isActivelySpeaking) {
      drawBroadcastEqualizer(
        ctx,
        cx - 12,
        y + h - 16,
        4,
        Math.max(0.26, speechAmp),
        waveClock,
        '#00E676'
      );
    }
  } else {
    const radius = isHero ? 38 : 26;
    ctx.save();
    drawRoundedPath(ctx, x, y, w, h, radius);
    ctx.shadowColor = isActivelySpeaking ? 'rgba(0, 230, 118, 0.45)' : 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = isActivelySpeaking ? (isHero ? 40 : 26) : isHero ? 36 : 20;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = ai.bgMode === 'transparent' ? 'rgba(9,17,36,0.22)' : '#091124';
    ctx.fill();
    ctx.clip();
    paintBackground();
    paintVideoContent(false);

    const barH = isHero ? 70 : 42;
    const barGrad = ctx.createLinearGradient(x, y + h - barH - 12, x, y + h);
    barGrad.addColorStop(0, 'rgba(6, 10, 22, 0)');
    barGrad.addColorStop(1, 'rgba(6, 10, 22, 0.88)');
    ctx.fillStyle = barGrad;
    ctx.fillRect(x, y + h - barH - 12, w, barH + 12);

    if (ai.showNameBadge) {
      const pName = (ai.displayName || ai.replicaName || '').trim();
      if (pName) {
        ctx.font = `800 ${isHero ? 26 : 16}px ${fontStack}`;
        ctx.direction = 'rtl';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(pName, x + w - (isHero ? 24 : 14), y + h - (isHero ? 28 : 18));
      }
    }

    if ((ai.volume ?? 1) > 0.02) {
      drawBroadcastEqualizer(
        ctx,
        x + (isHero ? 26 : 14),
        y + h - (isHero ? 28 : 18),
        isHero ? 6 : 4,
        isActivelySpeaking ? Math.max(0.28, speechAmp) : 0.06,
        waveClock,
        isActivelySpeaking ? '#00E676' : '#EDD6A2'
      );
    }
    ctx.restore();

    ctx.save();
    drawRoundedPath(ctx, x, y, w, h, radius);
    ctx.strokeStyle = speakingStroke;
    ctx.lineWidth = isHero ? (isActivelySpeaking ? 5.5 : 4.5) : isActivelySpeaking ? 4 : 3;
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}
