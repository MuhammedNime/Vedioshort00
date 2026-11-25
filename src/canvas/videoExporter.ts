import {
  ArrayBufferTarget as Mp4ArrayBufferTarget,
  Muxer as Mp4Muxer,
} from 'mp4-muxer';
import {
  ArrayBufferTarget as WebmArrayBufferTarget,
  Muxer as WebmMuxer,
} from 'webm-muxer';
import { soundEngine } from '../audio/soundEngine';
import {
  AudioSettings,
  QuestionSlide,
  TemplateSettings,
  TimingSettings,
  computeProjectTimeline,
  getCanvasDimensions,
  getEndCardDuration,
  getIntroHookDuration,
  getSlidesContentDuration,
  getTotalDuration,
} from '../types/quiz';
import {
  TimelineSoundEvent,
  clearRendererCaches,
  ensureQuizFontsLoaded,
  preloadTemplateBackground,
  preloadTimerVideo,
  renderQuizFrame,
} from './quizRenderer';
import {
  pauseAllCachedAiPresenterVideos,
  preloadAiPresenterMedia,
  seekAiPresenterVideoForExportFrame,
  syncAiPresenterPreviewVideo,
} from './aiPresenterMedia';

export type ExportFormatPreference = 'auto' | 'webm' | 'mp4';
export type ExportResolutionPreference = 'auto' | '720p' | '1080p';

export interface ExportVideoOptions {
  formatPreference?: ExportFormatPreference;
  resolutionPreference?: ExportResolutionPreference;
  includeAudio?: boolean;
  getPreviewCanvas?: () => HTMLCanvasElement | null;
}

export interface ExportProgress {
  progress: number;
  currentTime: number;
  totalDuration: number;
  statusText: string;
}

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
}

interface ScheduledTimelineAudio {
  time: number;
  maxDuration?: number;
  event: TimelineSoundEvent;
}

interface MimeCandidate {
  mimeType: string;
  extension: 'mp4' | 'webm';
}

interface DimensionsPlan {
  width: number;
  height: number;
  label: '1080p' | '720p';
  videoBitrate: number;
}

const EXPORT_FPS = 30;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isAppleBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|Android|Edg|CriOS|FxiOS/i.test(ua);
  return isIos || isSafari;
}

function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
}

function makeEven(n: number): number {
  const rounded = Math.max(2, Math.round(n));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function resolveDimensionPlans(
  baseWidth: number,
  baseHeight: number,
  resPref: ExportResolutionPreference
): DimensionsPlan[] {
  const fullW = makeEven(baseWidth);
  const fullH = makeEven(baseHeight);
  const fullPlan: DimensionsPlan = {
    width: fullW,
    height: fullH,
    label: '1080p',
    videoBitrate: 5_200_000,
  };

  const shortSide = Math.min(fullW, fullH);
  const scale720 = shortSide > 720 ? 720 / shortSide : 1;
  const hdW = makeEven(fullW * scale720);
  const hdH = makeEven(fullH * scale720);
  const hdPlan: DimensionsPlan = {
    width: hdW,
    height: hdH,
    label: '720p',
    videoBitrate: 3_000_000,
  };

  const hasDistinctHd = hdW < fullW || hdH < fullH;
  if (!hasDistinctHd) {
    return [fullPlan];
  }

  if (resPref === '720p') {
    return [hdPlan];
  }
  if (resPref === '1080p') {
    return [fullPlan, hdPlan];
  }

  // 'auto': mobile/Android phones encode faster, cleaner, and without hardware codec OOM at 720p
  return isMobileBrowser() ? [hdPlan] : [fullPlan, hdPlan];
}

function drawScaledPreview(
  sourceCanvas: HTMLCanvasElement,
  previewCanvas?: HTMLCanvasElement | null
): void {
  if (!previewCanvas || !previewCanvas.isConnected) return;
  const pCtx = previewCanvas.getContext('2d');
  if (!pCtx) return;
  try {
    pCtx.drawImage(sourceCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
  } catch {
    // ignore preview blit errors
  }
}

function getPreferredMimeTypes(formatPref: ExportFormatPreference = 'auto'): MimeCandidate[] {
  const mp4Candidates: MimeCandidate[] = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
  ];

  const webmCandidates: MimeCandidate[] = [
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];

  const preferMp4 = formatPref === 'mp4' || (formatPref === 'auto' && isAppleBrowser());

  const ordered = preferMp4
    ? [...mp4Candidates, ...webmCandidates]
    : [...webmCandidates, ...mp4Candidates];

  const supported =
    typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
      ? ordered.filter((c) => {
          try {
            return MediaRecorder.isTypeSupported(c.mimeType);
          } catch {
            return false;
          }
        })
      : [];

  const fallbackExt: 'mp4' | 'webm' = preferMp4 ? 'mp4' : 'webm';
  const result = [...supported, { mimeType: '', extension: fallbackExt }];

  const seen = new Set<string>();
  return result.filter((item) => {
    const key = `${item.mimeType}|${item.extension}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildScheduledAudioPlan(
  slides: QuestionSlide[],
  timing: TimingSettings,
  audio: AudioSettings,
  template: TemplateSettings,
  totalDuration: number
): {
  events: ScheduledTimelineAudio[];
  speechIntervals: Array<{ start: number; end: number }>;
} {
  const events: ScheduledTimelineAudio[] = [];
  const speechIntervals: Array<{ start: number; end: number }> = [];

  const schedules = computeProjectTimeline(slides, timing, audio, template);
  const introDur = getIntroHookDuration(template, timing);
  if (introDur > 0 && slides.length > 0) {
    const firstSlideStart = schedules[0]?.startTime ?? introDur;
    const introBound = Math.max(0.15, firstSlideStart - 0.02);
    events.push({
      time: 0,
      maxDuration: introBound,
      event: { type: 'introHook', slideIndex: 0 },
    });
    if (template.introHookAudio?.dataUrl && (template.introHookAudio.duration ?? 0) > 0.2) {
      speechIntervals.push({
        start: 0,
        end: Math.min(introBound, template.introHookAudio.duration),
      });
    }
  }

  const urgentThreshold = Math.max(1, Math.min(10, template?.timerUrgentThreshold ?? 3));

  for (let idx = 0; idx < schedules.length; idx++) {
    const sched = schedules[idx];
    const sIdx = sched.slideIndex;
    const slide = slides[sIdx];
    const base = sched.startTime;
    const nextSlideStart =
      idx < schedules.length - 1 ? schedules[idx + 1].startTime : totalDuration;

    const tQ = base + sched.tQuestionStart;
    const opt0Time = base + sched.tOptionStarts[0];
    const tThink = base + sched.tThinkingStart;
    const tSus = base + sched.tSuspenseStart;
    const tReveal = base + sched.tRevealStart;
    const optCount =
      slide?.slideType === 'trueFalse' || slide?.slideType === 'versus'
        ? 2
        : slide?.slideType === 'clues' || slide?.slideType === 'multiple3'
          ? 3
          : 4;
    const hasAnyOptVoice = Array.from({ length: optCount }).some((_, oi) =>
      Boolean(slide?.voiceover?.options?.[oi]?.dataUrl)
    );

    const qBound = hasAnyOptVoice
      ? Math.max(0.15, opt0Time - tQ - 0.02)
      : Math.max(0.15, tThink - tQ - 0.03);
    events.push({
      time: tQ,
      maxDuration: slide?.voiceover?.question?.dataUrl
        ? Math.min(nextSlideStart - tQ - 0.02, qBound)
        : Math.max(0.15, opt0Time - tQ - 0.02),
      event: { type: 'questionEnter', slideIndex: sIdx },
    });
    if (slide?.voiceover?.question?.dataUrl && slide.voiceover.question.duration > 0.2) {
      speechIntervals.push({
        start: tQ,
        end: tQ + Math.min(slide.voiceover.question.duration, qBound),
      });
    }

    let optVoiceCursor = opt0Time;
    for (let oIdx = 0; oIdx < optCount; oIdx++) {
      const tOpt = base + sched.tOptionStarts[oIdx];
      let groupEndBoundary = tThink;
      for (let k = oIdx + 1; k < optCount; k++) {
        const cand = base + sched.tOptionStarts[k];
        if (cand > tOpt + 0.01) {
          groupEndBoundary = cand;
          break;
        }
      }
      const sameAsPrev =
        oIdx > 0 && Math.abs(sched.tOptionStarts[oIdx] - sched.tOptionStarts[oIdx - 1]) < 0.01;
      const isGroupedSameStart =
        oIdx < optCount - 1 && Math.abs(sched.tOptionStarts[oIdx + 1] - tOpt) < 0.01;
      const oClip = slide?.voiceover?.options?.[oIdx];

      if (oClip?.dataUrl) {
        const scheduledStart =
          isGroupedSameStart || sameAsPrev ? Math.max(tOpt, optVoiceCursor) : tOpt;
        const maxBound = Math.max(scheduledStart + 0.15, groupEndBoundary - 0.02);
        if (scheduledStart < maxBound - 0.04) {
          const maxDur = Math.max(0.15, maxBound - scheduledStart);
          events.push({
            time: scheduledStart,
            maxDuration: maxDur,
            event: { type: 'optionEnter', slideIndex: sIdx, optionIndex: oIdx },
          });
          const clipDur = oClip.duration > 0.05 ? oClip.duration : 1.0;
          if (clipDur > 0.2) {
            speechIntervals.push({
              start: scheduledStart,
              end: scheduledStart + Math.min(clipDur, maxDur),
            });
          }
          optVoiceCursor = Math.min(maxBound, scheduledStart + clipDur + 0.04);
        }
      } else if (!sameAsPrev) {
        events.push({
          time: tOpt,
          maxDuration: Math.max(0.15, groupEndBoundary - tOpt - 0.02),
          event: { type: 'optionEnter', slideIndex: sIdx, optionIndex: oIdx },
        });
      }
    }

    const totalTicks = Math.floor(sched.thinkingDuration);
    for (let sec = 0; sec < totalTicks; sec++) {
      const tickSecond = totalTicks - sec;
      const tTick = tThink + sec;
      events.push({
        time: tTick,
        maxDuration: Math.max(0.08, Math.min(0.88, tSus - tTick - 0.02)),
        event: {
          type: 'countdownTick',
          slideIndex: sIdx,
          tickSecond,
          urgent: tickSecond <= urgentThreshold,
        },
      });
    }

    const susDur = Math.max(0, timing.suspenseDuration ?? 0);
    if (susDur > 0) {
      events.push({
        time: tSus,
        maxDuration: Math.max(0.15, tReveal - tSus - 0.02),
        event: { type: 'suspense', slideIndex: sIdx },
      });
    }

    events.push({
      time: tReveal,
      maxDuration: Math.max(0.25, nextSlideStart - tReveal - 0.03),
      event: { type: 'correctReveal', slideIndex: sIdx },
    });
    if (slide?.voiceover?.answer?.dataUrl && slide.voiceover.answer.duration > 0.2) {
      speechIntervals.push({
        start: tReveal,
        end: Math.min(nextSlideStart - 0.02, tReveal + slide.voiceover.answer.duration),
      });
    }
  }

  const endDur = getEndCardDuration(template);
  if (endDur > 0 && template.endCardAudio?.dataUrl) {
    const contentEnd = getSlidesContentDuration(slides, timing, audio, template);
    const maxDur = Math.max(0.2, totalDuration - contentEnd - 0.03);
    events.push({
      time: contentEnd,
      maxDuration: maxDur,
      event: { type: 'endCardEnter', slideIndex: Math.max(0, slides.length - 1) },
    });
    if ((template.endCardAudio.duration ?? 0) > 0.2) {
      speechIntervals.push({
        start: contentEnd,
        end: contentEnd + Math.min(maxDur, template.endCardAudio.duration),
      });
    }
  }

  events.sort((a, b) => a.time - b.time);
  return { events, speechIntervals };
}

interface WebCodecsPlan {
  container: 'mp4' | 'webm';
  videoConfig: VideoEncoderConfig;
  webmVideoCodec?: 'V_VP8' | 'V_VP9';
  audioConfig: AudioEncoderConfig | null;
  webmAudioCodec?: 'A_OPUS';
  mimeType: string;
}

async function probeWebCodecsPlans(
  containerOrder: Array<'mp4' | 'webm'>,
  dims: DimensionsPlan,
  audioBuffer: AudioBuffer | null,
  requireAudio: boolean
): Promise<WebCodecsPlan[]> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return [];
  }
  if (requireAudio && (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined')) {
    return [];
  }

  const plans: WebCodecsPlan[] = [];
  const sampleRate = audioBuffer ? audioBuffer.sampleRate : 48000;
  const numChannels = audioBuffer ? Math.min(2, Math.max(1, audioBuffer.numberOfChannels)) : 2;

  let cachedAacConfig: AudioEncoderConfig | null | undefined;
  const resolveAacConfig = async (): Promise<AudioEncoderConfig | null> => {
    if (!requireAudio || !audioBuffer) return null;
    if (cachedAacConfig !== undefined) return cachedAacConfig;
    const candidates: AudioEncoderConfig[] = [
      {
        codec: 'mp4a.40.2',
        sampleRate,
        numberOfChannels: numChannels,
        bitrate: 128_000,
      },
      {
        codec: 'mp4a.40.2',
        sampleRate,
        numberOfChannels: numChannels,
      },
    ];
    for (const cfg of candidates) {
      try {
        const res = await AudioEncoder.isConfigSupported(cfg);
        if (res.supported) {
          cachedAacConfig = res.config ?? cfg;
          return cachedAacConfig;
        }
      } catch {
        // try next
      }
    }
    cachedAacConfig = null;
    return null;
  };

  let cachedOpusConfig: AudioEncoderConfig | null | undefined;
  const resolveOpusConfig = async (): Promise<AudioEncoderConfig | null> => {
    if (!requireAudio || !audioBuffer) return null;
    if (cachedOpusConfig !== undefined) return cachedOpusConfig;
    // Opus strictly accepts standard rates (48000, 24000, 16000, 12000, 8000)
    const validOpusRates = [48000, 24000, 16000, 12000, 8000];
    if (!validOpusRates.includes(sampleRate)) {
      cachedOpusConfig = null;
      return null;
    }
    const candidates: AudioEncoderConfig[] = [
      {
        codec: 'opus',
        sampleRate,
        numberOfChannels: numChannels,
        bitrate: 128_000,
      },
      {
        codec: 'opus',
        sampleRate,
        numberOfChannels: numChannels,
      },
    ];
    for (const cfg of candidates) {
      try {
        const res = await AudioEncoder.isConfigSupported(cfg);
        if (res.supported) {
          cachedOpusConfig = res.config ?? cfg;
          return cachedOpusConfig;
        }
      } catch {
        // try next
      }
    }
    cachedOpusConfig = null;
    return null;
  };

  for (const container of containerOrder) {
    if (container === 'mp4') {
      const audioConfig = await resolveAacConfig();
      if (requireAudio && !audioConfig) {
        continue;
      }
      const avcCodecs = [
        'avc1.640028', // High L4.0 (handles 1080p)
        'avc1.4d002a', // Main L4.2 (handles 1080p)
        'avc1.420028', // Baseline L4.0 (handles 1080p)
        'avc1.42E01F', // Constrained Baseline L3.1 (720p safe)
        'avc1.42001f',
      ];
      for (const codec of avcCodecs) {
        const cfg: VideoEncoderConfig = {
          codec,
          width: dims.width,
          height: dims.height,
          bitrate: dims.videoBitrate,
          framerate: EXPORT_FPS,
          avc: { format: 'avc' },
        };
        try {
          const sup = await VideoEncoder.isConfigSupported(cfg);
          if (sup.supported) {
            plans.push({
              container: 'mp4',
              videoConfig: sup.config ?? cfg,
              audioConfig,
              mimeType: 'video/mp4',
            });
            break;
          }
        } catch {
          // try next codec
        }
      }
    } else {
      const audioConfig = await resolveOpusConfig();
      if (requireAudio && !audioConfig) {
        continue;
      }
      const webmCodecs: Array<{
        codec: string;
        muxerCodec: 'V_VP8' | 'V_VP9';
        hardwareAcceleration?: HardwareAcceleration;
      }> = [
        { codec: 'vp8', muxerCodec: 'V_VP8' },
        { codec: 'vp09.00.10.08', muxerCodec: 'V_VP9' },
        { codec: 'vp8', muxerCodec: 'V_VP8', hardwareAcceleration: 'prefer-software' },
      ];
      for (const wc of webmCodecs) {
        const cfg: VideoEncoderConfig = {
          codec: wc.codec,
          width: dims.width,
          height: dims.height,
          bitrate: dims.videoBitrate,
          framerate: EXPORT_FPS,
          ...(wc.hardwareAcceleration ? { hardwareAcceleration: wc.hardwareAcceleration } : {}),
        };
        try {
          const sup = await VideoEncoder.isConfigSupported(cfg);
          if (sup.supported) {
            plans.push({
              container: 'webm',
              videoConfig: sup.config ?? cfg,
              webmVideoCodec: wc.muxerCodec,
              audioConfig,
              webmAudioCodec: audioConfig ? 'A_OPUS' : undefined,
              mimeType: 'video/webm',
            });
          }
        } catch {
          // try next
        }
      }
    }
  }

  return plans;
}

async function encodeWithWebCodecsPlan(
  plan: WebCodecsPlan,
  baseWidth: number,
  baseHeight: number,
  dims: DimensionsPlan,
  totalDuration: number,
  sSlides: QuestionSlide[],
  sTemplate: TemplateSettings,
  timing: TimingSettings,
  sAudio: AudioSettings,
  masterAudioBuffer: AudioBuffer | null,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
  getPreviewCanvas?: () => HTMLCanvasElement | null
): Promise<ExportResult> {
  if (signal.aborted) {
    throw new Error('تم إلغاء التصدير.');
  }

  const renderCanvas = document.createElement('canvas');
  renderCanvas.width = baseWidth;
  renderCanvas.height = baseHeight;
  const renderCtx = renderCanvas.getContext('2d', { alpha: false });
  if (!renderCtx) {
    throw new Error('تعذر تهيئة محرك الرسم.');
  }
  renderCtx.imageSmoothingEnabled = true;
  renderCtx.imageSmoothingQuality = 'high';

  const needsDownscale = dims.width !== baseWidth || dims.height !== baseHeight;
  const outputCanvas = needsDownscale ? document.createElement('canvas') : renderCanvas;
  if (needsDownscale) {
    outputCanvas.width = dims.width;
    outputCanvas.height = dims.height;
  }
  const outputCtx = needsDownscale ? outputCanvas.getContext('2d', { alpha: false }) : renderCtx;
  if (!outputCtx) {
    throw new Error('تعذر تهيئة طبقة التحجيم.');
  }
  outputCtx.imageSmoothingEnabled = true;
  outputCtx.imageSmoothingQuality = 'high';

  const hasAudio = Boolean(plan.audioConfig && masterAudioBuffer);
  const mp4Target = plan.container === 'mp4' ? new Mp4ArrayBufferTarget() : null;
  const webmTarget = plan.container === 'webm' ? new WebmArrayBufferTarget() : null;

  const mp4Muxer =
    plan.container === 'mp4' && mp4Target
      ? new Mp4Muxer({
          target: mp4Target,
          video: {
            codec: 'avc',
            width: dims.width,
            height: dims.height,
            frameRate: EXPORT_FPS,
          },
          ...(hasAudio && masterAudioBuffer
            ? {
                audio: {
                  codec: 'aac',
                  numberOfChannels: Math.min(2, Math.max(1, masterAudioBuffer.numberOfChannels)),
                  sampleRate: masterAudioBuffer.sampleRate,
                },
              }
            : {}),
          fastStart: 'in-memory',
          firstTimestampBehavior: 'offset',
        })
      : null;

  const webmMuxer =
    plan.container === 'webm' && webmTarget
      ? new WebmMuxer({
          target: webmTarget,
          video: {
            codec: plan.webmVideoCodec ?? 'V_VP8',
            width: dims.width,
            height: dims.height,
            frameRate: EXPORT_FPS,
          },
          ...(hasAudio && masterAudioBuffer
            ? {
                audio: {
                  codec: plan.webmAudioCodec ?? 'A_OPUS',
                  numberOfChannels: Math.min(2, Math.max(1, masterAudioBuffer.numberOfChannels)),
                  sampleRate: masterAudioBuffer.sampleRate,
                },
              }
            : {}),
          firstTimestampBehavior: 'offset',
        })
      : null;

  let fatalError: Error | null = null;
  let videoChunksEmitted = 0;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      videoChunksEmitted += 1;
      try {
        if (mp4Muxer) {
          mp4Muxer.addVideoChunk(chunk, meta);
        } else if (webmMuxer) {
          webmMuxer.addVideoChunk(chunk, meta);
        }
      } catch (err) {
        if (!fatalError) {
          fatalError = err instanceof Error ? err : new Error('فشل دمج إطارات الفيديو.');
        }
      }
    },
    error: (err) => {
      if (!fatalError) {
        fatalError = err instanceof Error ? err : new Error('حدث خطأ في مشفر الفيديو.');
      }
    },
  });

  let audioEncoder: AudioEncoder | null = null;
  if (hasAudio && plan.audioConfig) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        try {
          if (mp4Muxer) {
            mp4Muxer.addAudioChunk(chunk, meta);
          } else if (webmMuxer) {
            webmMuxer.addAudioChunk(chunk, meta);
          }
        } catch (err) {
          if (!fatalError) {
            fatalError = err instanceof Error ? err : new Error('فشل دمج مقاطع الصوت.');
          }
        }
      },
      error: (err) => {
        if (!fatalError) {
          fatalError = err instanceof Error ? err : new Error('حدث خطأ في مشفر الصوت.');
        }
      },
    });
  }

  try {
    videoEncoder.configure(plan.videoConfig);
    if (audioEncoder && plan.audioConfig) {
      audioEncoder.configure(plan.audioConfig);
    }

    // 1. Encode offline mixed PCM audio track deterministically
    if (audioEncoder && masterAudioBuffer) {
      const sr = masterAudioBuffer.sampleRate;
      const numChannels = Math.min(2, Math.max(1, masterAudioBuffer.numberOfChannels));
      const maxAudioFrames = Math.min(
        masterAudioBuffer.length,
        Math.max(1, Math.round(totalDuration * sr))
      );
      const chunkFrames = 4096;

      for (let offset = 0; offset < maxAudioFrames; offset += chunkFrames) {
        if (signal.aborted) throw new Error('تم إلغاء التصدير.');
        if (fatalError) throw fatalError;

        const waitStart = performance.now();
        while (audioEncoder.encodeQueueSize > 10) {
          if (signal.aborted) throw new Error('تم إلغاء التصدير.');
          if (fatalError) throw fatalError;
          if (performance.now() - waitStart > 8000) {
            throw new Error('توقف مشفر الصوت عن الاستجابة.');
          }
          await sleepMs(6);
        }

        const count = Math.min(chunkFrames, maxAudioFrames - offset);
        const planar = new Float32Array(count * numChannels);
        for (let ch = 0; ch < numChannels; ch++) {
          const chData = masterAudioBuffer.getChannelData(ch);
          planar.set(chData.subarray(offset, offset + count), ch * count);
        }

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: sr,
          numberOfChannels: numChannels,
          numberOfFrames: count,
          timestamp: Math.round((offset / sr) * 1_000_000),
          data: planar,
        });
        try {
          audioEncoder.encode(audioData);
        } finally {
          audioData.close();
        }
      }
    }

    // 2. Encode deterministic 30fps video frames faster than real-time
    const totalFrames = Math.max(1, Math.ceil(totalDuration * EXPORT_FPS));
    const frameDurationUs = Math.round(1_000_000 / EXPORT_FPS);
    let lastProgressPerf = 0;
    let lastYieldPerf = performance.now();

    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      if (signal.aborted) throw new Error('تم إلغاء التصدير.');
      if (fatalError) throw fatalError;

      const waitStart = performance.now();
      while (videoEncoder.encodeQueueSize > 5) {
        if (signal.aborted) throw new Error('تم إلغاء التصدير.');
        if (fatalError) throw fatalError;
        if (performance.now() - waitStart > 8000) {
          throw new Error('توقف مشفر الفيديو عن الاستجابة.');
        }
        await sleepMs(10);
      }

      const frameTime = Math.min(totalDuration, frameIdx / EXPORT_FPS);
      if (sTemplate.aiPresenter?.enabled && sTemplate.aiPresenter?.mediaKey) {
        await seekAiPresenterVideoForExportFrame(frameTime, sSlides, sTemplate, timing, sAudio);
      }
      renderQuizFrame(renderCtx, frameTime, sSlides, sTemplate, timing, sAudio, false);

      if (needsDownscale) {
        outputCtx.drawImage(renderCanvas, 0, 0, dims.width, dims.height);
      }
      if (frameIdx % 2 === 0 || frameIdx === totalFrames - 1) {
        drawScaledPreview(outputCanvas, getPreviewCanvas?.());
      }

      const timestampUs = Math.round((frameIdx / EXPORT_FPS) * 1_000_000);
      const videoFrame = new VideoFrame(outputCanvas, {
        timestamp: timestampUs,
        duration: frameDurationUs,
      });
      try {
        videoEncoder.encode(videoFrame, { keyFrame: frameIdx % 60 === 0 });
      } finally {
        videoFrame.close();
      }

      const nowPerf = performance.now();
      if (frameIdx === totalFrames - 1 || nowPerf - lastProgressPerf >= 110) {
        lastProgressPerf = nowPerf;
        const pctRatio = (frameIdx + 1) / totalFrames;
        onProgress({
          progress: 0.05 + 0.87 * pctRatio,
          currentTime: frameTime,
          totalDuration,
          statusText: `جارٍ تصدير الفيديو فائق السرعة (${Math.round(pctRatio * 100)}%)`,
        });
      }

      if (nowPerf - lastYieldPerf >= 16) {
        lastYieldPerf = performance.now();
        await sleepMs(0);
      }
    }

    onProgress({
      progress: 0.94,
      currentTime: totalDuration,
      totalDuration,
      statusText: 'جارٍ حفظ وتجميع ملف الفيديو النهائي...',
    });

    const flushAll = Promise.all([
      videoEncoder.flush(),
      audioEncoder ? audioEncoder.flush() : Promise.resolve(),
    ]);
    await Promise.race([
      flushAll,
      new Promise<never>((_, reject) => {
        window.setTimeout(
          () => reject(new Error('انتهت مهلة إتمام ترميز الفيديو.')),
          15_000
        );
      }),
    ]);

    if (fatalError) throw fatalError;
    if (videoChunksEmitted === 0) {
      throw new Error('لم يصدر مشفر الفيديو أي إطارات.');
    }

    if (mp4Muxer && mp4Target) {
      mp4Muxer.finalize();
      const blob = new Blob([mp4Target.buffer], { type: 'video/mp4' });
      if (blob.size < 512) {
        throw new Error('نتج عن التصدير ملف فيديو فارغ.');
      }
      return {
        blob,
        mimeType: 'video/mp4',
        extension: 'mp4',
      };
    }

    if (webmMuxer && webmTarget) {
      webmMuxer.finalize();
      const blob = new Blob([webmTarget.buffer], { type: 'video/webm' });
      if (blob.size < 512) {
        throw new Error('نتج عن التصدير ملف فيديو فارغ.');
      }
      return {
        blob,
        mimeType: 'video/webm',
        extension: 'webm',
      };
    }

    throw new Error('تعذر تهيئة حاوية الفيديو.');
  } finally {
    try {
      if (videoEncoder.state !== 'closed') {
        videoEncoder.close();
      }
    } catch {
      // ignore
    }
    if (audioEncoder) {
      try {
        if (audioEncoder.state !== 'closed') {
          audioEncoder.close();
        }
      } catch {
        // ignore
      }
    }
  }
}

export async function exportQuizVideo(
  slides: QuestionSlide[],
  template: TemplateSettings,
  timing: TimingSettings,
  audio: AudioSettings,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
  options?: ExportVideoOptions
): Promise<ExportResult> {
  if (slides.length === 0) {
    throw new Error('لا توجد أسئلة صالحة للتصدير.');
  }

  const checkAborted = () => {
    if (signal.aborted) {
      throw new Error('تم إلغاء التصدير.');
    }
  };

  checkAborted();
  const { width: baseWidth, height: baseHeight } = getCanvasDimensions(template);
  const formatPref: ExportFormatPreference = options?.formatPreference ?? 'auto';
  const resPref: ExportResolutionPreference = options?.resolutionPreference ?? 'auto';
  const includeAudio = options?.includeAudio !== false;
  const getPreviewCanvas = options?.getPreviewCanvas;

  onProgress({
    progress: 0.01,
    currentTime: 0,
    totalDuration: getTotalDuration(slides, timing, audio, template) || 1,
    statusText: 'جارٍ تجهيز الخطوط والقالب وفحص أطوال الأصوات...',
  });

  await Promise.all([
    ensureQuizFontsLoaded(template.fontFamily),
    preloadTemplateBackground(template, slides),
    preloadTimerVideo(),
    preloadAiPresenterMedia(template.aiPresenter),
  ]);
  clearRendererCaches();
  checkAborted();

  // Reuse the app's single shared AudioContext (never close it on cleanup!)
  let sharedAudioCtx: AudioContext | null = null;
  try {
    sharedAudioCtx = soundEngine.getContext();
  } catch {
    sharedAudioCtx = null;
  }

  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    await Promise.race([
      sharedAudioCtx.resume().catch(() => undefined),
      sleepMs(400),
    ]);
  }
  checkAborted();

  const syncTask = soundEngine.syncProjectAudioDurations(
    slides,
    audio,
    template,
    sharedAudioCtx ?? undefined
  );
  const synced = await Promise.race([
    syncTask,
    new Promise<{ slides: QuestionSlide[]; audio: AudioSettings; template: TemplateSettings }>(
      (resolve) => {
        window.setTimeout(() => resolve({ slides, audio, template }), 8000);
      }
    ),
  ]);
  checkAborted();

  const sSlides = synced.slides;
  const sAudio = synced.audio;
  const sTemplate = synced.template;

  const totalDuration = getTotalDuration(sSlides, timing, sAudio, sTemplate);
  if (totalDuration <= 0) {
    throw new Error('لا توجد أسئلة صالحة للتصدير.');
  }

  let masterAudioBuffer: AudioBuffer | null = null;
  if (includeAudio) {
    onProgress({
      progress: 0.03,
      currentTime: 0,
      totalDuration,
      statusText: 'جارٍ معالجة ودمج المسار الصوتي بدقة...',
    });

    try {
      const rendered = await soundEngine.renderOfflineExportMix(
        sSlides,
        sTemplate,
        timing,
        sAudio,
        48000
      );
      masterAudioBuffer = rendered?.buffer ?? null;
    } catch {
      masterAudioBuffer = null;
    }
    checkAborted();
  }

  const dimensionPlans = resolveDimensionPlans(baseWidth, baseHeight, resPref);
  let lastErr: unknown = null;

  // ============================================================================
  // TIER 1: Offline WebCodecs Engine (MP4 / WebM) — immune to suspended AudioContext,
  // compositor throttling, and captureStream drops, and exports 3x-10x faster.
  // ============================================================================
  const canTryWebCodecs =
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    (!includeAudio || (masterAudioBuffer !== null && typeof AudioEncoder !== 'undefined'));

  if (canTryWebCodecs) {
    const containerOrder: Array<'mp4' | 'webm'> =
      formatPref === 'webm'
        ? ['webm', 'mp4']
        : formatPref === 'mp4'
          ? ['mp4', 'webm']
          : ['mp4', 'webm'];

    for (const dims of dimensionPlans) {
      checkAborted();
      const plans = await probeWebCodecsPlans(
        containerOrder,
        dims,
        masterAudioBuffer,
        includeAudio
      );

      for (let i = 0; i < plans.length; i++) {
        checkAborted();
        const plan = plans[i];
        try {
          if (i > 0 || dims.label !== dimensionPlans[0].label) {
            onProgress({
              progress: 0.04,
              currentTime: 0,
              totalDuration,
              statusText: `جارٍ المحاولة بدقة ${dims.label} (${plan.container.toUpperCase()})...`,
            });
          }
          return await encodeWithWebCodecsPlan(
            plan,
            baseWidth,
            baseHeight,
            dims,
            totalDuration,
            sSlides,
            sTemplate,
            timing,
            sAudio,
            masterAudioBuffer,
            onProgress,
            signal,
            getPreviewCanvas
          );
        } catch (err) {
          if (signal.aborted) throw err;
          lastErr = err;
        }
      }
    }
  }

  // ============================================================================
  // TIER 2: Hardened MediaRecorder Fallback (for browsers without WebCodecs)
  // ============================================================================
  if (typeof MediaRecorder === 'undefined') {
    throw lastErr instanceof Error
      ? lastErr
      : new Error('متصفحك الحالي لا يدعم تصدير الفيديو (WebCodecs أو MediaRecorder).');
  }

  const fallbackPlan =
    includeAudio && !masterAudioBuffer
      ? buildScheduledAudioPlan(sSlides, timing, sAudio, sTemplate, totalDuration)
      : { events: [], speechIntervals: [] };

  const mimeCandidates = getPreferredMimeTypes(formatPref);

  const checkAudioClockRunning = async (ctx: AudioContext | null): Promise<boolean> => {
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await Promise.race([ctx.resume().catch(() => undefined), sleepMs(350)]);
    }
    if (ctx.state !== 'running') return false;
    const t0 = ctx.currentTime;
    await sleepMs(80);
    return ctx.state === 'running' && ctx.currentTime > t0 + 0.005;
  };

  const runRecorderAttempt = async (
    candidate: MimeCandidate,
    dims: DimensionsPlan,
    withAudioTrack: boolean
  ): Promise<ExportResult> => {
    checkAborted();

    const audioIsLive = withAudioTrack ? await checkAudioClockRunning(sharedAudioCtx) : false;
    // Never attach a dead suspended AudioContext stream to MediaRecorder — it freezes muxing at ~1%!
    const attachAudio = Boolean(withAudioTrack && sharedAudioCtx && audioIsLive);

    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = baseWidth;
    renderCanvas.height = baseHeight;
    const renderCtx = renderCanvas.getContext('2d', { alpha: false });
    if (!renderCtx) {
      throw new Error('تعذر تهيئة محرك الرسم على هذا المتصفح.');
    }
    renderCtx.imageSmoothingEnabled = true;
    renderCtx.imageSmoothingQuality = 'high';

    const needsDownscale = dims.width !== baseWidth || dims.height !== baseHeight;
    const captureCanvas = needsDownscale ? document.createElement('canvas') : renderCanvas;
    if (needsDownscale) {
      captureCanvas.width = dims.width;
      captureCanvas.height = dims.height;
    }
    captureCanvas.style.position = 'fixed';
    captureCanvas.style.right = '4px';
    captureCanvas.style.bottom = '4px';
    captureCanvas.style.width = `${Math.max(120, Math.round(dims.width / 8))}px`;
    captureCanvas.style.height = `${Math.max(120, Math.round(dims.height / 8))}px`;
    captureCanvas.style.opacity = '0.03';
    captureCanvas.style.zIndex = '60';
    captureCanvas.style.pointerEvents = 'none';
    captureCanvas.style.visibility = 'visible';
    document.body.appendChild(captureCanvas);

    const captureCtx = needsDownscale
      ? captureCanvas.getContext('2d', { alpha: false })
      : renderCtx;
    if (!captureCtx) {
      captureCanvas.remove();
      throw new Error('تعذر تهيئة محرك الالتقاط.');
    }
    captureCtx.imageSmoothingEnabled = true;
    captureCtx.imageSmoothingQuality = 'high';

    let audioDest: MediaStreamAudioDestinationNode | null = null;
    let keepAliveOsc: OscillatorNode | null = null;
    let keepAliveGain: GainNode | null = null;

    if (attachAudio && sharedAudioCtx) {
      try {
        audioDest = sharedAudioCtx.createMediaStreamDestination();
        keepAliveOsc = sharedAudioCtx.createOscillator();
        keepAliveGain = sharedAudioCtx.createGain();
        keepAliveGain.gain.setValueAtTime(0.00001, sharedAudioCtx.currentTime);
        keepAliveOsc.connect(keepAliveGain);
        keepAliveGain.connect(audioDest);
        keepAliveOsc.start();
      } catch {
        audioDest = null;
      }
    }

    const canvasStream = captureCanvas.captureStream(EXPORT_FPS);
    const audioTracks = audioDest ? audioDest.stream.getAudioTracks() : [];
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
    if (attachAudio && audioTracks.length > 0) {
      tracks.push(...audioTracks);
    }
    const combinedStream = new MediaStream(tracks);

    let activeRecorder: MediaRecorder;
    try {
      const opts: MediaRecorderOptions = {
        videoBitsPerSecond: dims.videoBitrate,
        ...(attachAudio && audioTracks.length > 0 ? { audioBitsPerSecond: 160_000 } : {}),
      };
      if (candidate.mimeType) {
        opts.mimeType = candidate.mimeType;
      }
      activeRecorder = new MediaRecorder(combinedStream, opts);
    } catch (err) {
      combinedStream.getTracks().forEach((t) => t.stop());
      canvasStream.getTracks().forEach((t) => t.stop());
      try {
        keepAliveOsc?.stop();
        keepAliveOsc?.disconnect();
        keepAliveGain?.disconnect();
      } catch {
        // ignore
      }
      captureCanvas.remove();
      throw err instanceof Error ? err : new Error('تعذر بدء مسجل الفيديو.');
    }

    const chunks: BlobPart[] = [];
    let lastChunkPerf = performance.now();
    activeRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        chunks.push(ev.data);
        lastChunkPerf = performance.now();
      }
    };

    let bgSource: AudioBufferSourceNode | null = null;
    let masterSource: AudioBufferSourceNode | null = null;

    let wakeLock: { release: () => Promise<void> } | null = null;
    try {
      const wl = (navigator as unknown as {
        wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
      }).wakeLock;
      if (wl) wakeLock = await wl.request('screen');
    } catch {
      // ignore
    }

    return await new Promise<ExportResult>((resolve, reject) => {
      let timerId = 0;
      let stopWatchdogId = 0;
      let stallCheckIntervalId = 0;
      let rafId = 0;
      let cleanedUp = false;
      let settled = false;

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        window.clearTimeout(timerId);
        window.clearTimeout(stopWatchdogId);
        window.clearInterval(stallCheckIntervalId);
        cancelAnimationFrame(rafId);
        try {
          keepAliveOsc?.stop();
          keepAliveOsc?.disconnect();
          keepAliveGain?.disconnect();
        } catch {
          // ignore
        }
        if (masterSource) {
          try {
            masterSource.stop();
            masterSource.disconnect();
          } catch {
            // ignore
          }
          masterSource = null;
        }
        if (bgSource) {
          try {
            bgSource.stop();
            bgSource.disconnect();
          } catch {
            // ignore
          }
          bgSource = null;
        }
        combinedStream.getTracks().forEach((t) => t.stop());
        canvasStream.getTracks().forEach((t) => t.stop());
        if (wakeLock) {
          void wakeLock.release().catch(() => undefined);
          wakeLock = null;
        }
        pauseAllCachedAiPresenterVideos();
        captureCanvas.remove();
      };

      const finishSuccess = () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        cleanup();
        if (signal.aborted) return;
        const finalType =
          activeRecorder.mimeType || candidate.mimeType || `video/${candidate.extension}`;
        const blob = new Blob(chunks, { type: finalType });
        if (blob.size < 512) {
          reject(new Error('نتج عن التسجيل ملف فيديو فارغ.'));
          return;
        }
        resolve({
          blob,
          mimeType: finalType,
          extension: finalType.includes('mp4') ? 'mp4' : 'webm',
        });
      };

      const finishError = (msg: string) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        try {
          if (activeRecorder.state !== 'inactive') {
            activeRecorder.stop();
          }
        } catch {
          // ignore
        }
        cleanup();
        reject(new Error(msg));
      };

      const onAbort = () => {
        finishError('تم إلغاء التصدير.');
      };

      signal.addEventListener('abort', onAbort, { once: true });

      activeRecorder.onerror = () => {
        finishError('حدث خطأ أثناء تسجيل الفيديو بهذه الصيغة.');
      };

      activeRecorder.onstop = () => {
        finishSuccess();
      };

      const renderToCapture = (t: number) => {
        if (sTemplate.aiPresenter?.enabled && sTemplate.aiPresenter?.mediaKey) {
          syncAiPresenterPreviewVideo(t, t > 0, sSlides, sTemplate, timing, sAudio, true, true);
        }
        renderQuizFrame(renderCtx, t, sSlides, sTemplate, timing, sAudio, false);
        if (needsDownscale) {
          captureCtx.drawImage(renderCanvas, 0, 0, dims.width, dims.height);
        }
        drawScaledPreview(captureCanvas, getPreviewCanvas?.());
      };

      try {
        renderToCapture(0);
      } catch (err) {
        finishError(err instanceof Error ? err.message : 'فشل رسم الإطار الأول.');
        return;
      }

      let nextAudioIdx = 0;
      let audioStartTime = sharedAudioCtx ? sharedAudioCtx.currentTime : 0;

      const scheduleFallbackAudioLookahead = (horizonTime: number) => {
        if (!attachAudio || !sharedAudioCtx || !audioDest || masterAudioBuffer) return;
        while (
          nextAudioIdx < fallbackPlan.events.length &&
          fallbackPlan.events[nextAudioIdx].time <= horizonTime
        ) {
          const item = fallbackPlan.events[nextAudioIdx];
          nextAudioIdx += 1;
          const when = Math.max(sharedAudioCtx.currentTime, audioStartTime + item.time);
          const ev = item.event;
          const slide = sSlides[ev.slideIndex];
          const maxDur = item.maxDuration;

          if (ev.type === 'introHook') {
            const hookSfx = sTemplate.introHookSfx ?? 'whoosh';
            const hasHookVoice = Boolean(sTemplate.introHookAudio?.dataUrl);
            if (hookSfx && hookSfx !== 'none') {
              soundEngine.playBuiltInSfx(
                hookSfx,
                hasHookVoice ? 0.42 : 0.72,
                sharedAudioCtx,
                audioDest,
                when,
                false,
                1.6,
                hasHookVoice ? Math.min(0.28, maxDur ?? 0.28) : maxDur
              );
            }
            if (sTemplate.introHookAudio?.dataUrl) {
              void soundEngine.playClip(
                sTemplate.introHookAudio,
                1,
                audioDest,
                sharedAudioCtx,
                when,
                'voice',
                maxDur
              );
            }
          } else if (ev.type === 'questionEnter') {
            if (slide?.voiceover?.question?.dataUrl) {
              void soundEngine.playClip(
                slide.voiceover.question,
                1,
                audioDest,
                sharedAudioCtx,
                when,
                'voice',
                maxDur
              );
            } else {
              void soundEngine.playSlot(
                sAudio.questionEnter,
                audioDest,
                sharedAudioCtx,
                when,
                false,
                maxDur
              );
            }
          } else if (ev.type === 'optionEnter') {
            const optIdx = ev.optionIndex ?? 0;
            const optClip = slide?.voiceover?.options?.[optIdx];
            if (optClip?.dataUrl) {
              void soundEngine.playClip(
                optClip,
                1,
                audioDest,
                sharedAudioCtx,
                when,
                'voice',
                maxDur
              );
            } else {
              void soundEngine.playSlot(
                sAudio.optionEnter,
                audioDest,
                sharedAudioCtx,
                when,
                false,
                maxDur
              );
            }
          } else if (ev.type === 'countdownTick') {
            void soundEngine.playSlot(
              sAudio.countdownTick,
              audioDest,
              sharedAudioCtx,
              when,
              !!ev.urgent,
              maxDur
            );
          } else if (ev.type === 'suspense') {
            void soundEngine.playSlot(
              sAudio.suspense,
              audioDest,
              sharedAudioCtx,
              when,
              false,
              maxDur,
              timing.suspenseDuration
            );
          } else if (ev.type === 'correctReveal') {
            if (slide?.voiceover?.answer?.dataUrl) {
              void soundEngine.playClip(
                slide.voiceover.answer,
                1,
                audioDest,
                sharedAudioCtx,
                when,
                'voice',
                maxDur
              );
            } else {
              void soundEngine.playSlot(
                sAudio.correctReveal,
                audioDest,
                sharedAudioCtx,
                when,
                false,
                maxDur
              );
            }
          } else if (ev.type === 'endCardEnter') {
            if (sTemplate.endCardAudio?.dataUrl) {
              void soundEngine.playClip(
                sTemplate.endCardAudio,
                1,
                audioDest,
                sharedAudioCtx,
                when,
                'voice',
                maxDur
              );
            }
          }
        }
      };

      let loopStarted = false;
      let lastProgressEmitPerf = 0;

      const beginSyncLoop = () => {
        if (loopStarted || signal.aborted || cleanedUp || settled) return;
        loopStarted = true;

        const wallStartPerf = performance.now();
        lastChunkPerf = wallStartPerf;
        let lastRenderTickPerf = wallStartPerf;
        audioStartTime = sharedAudioCtx ? sharedAudioCtx.currentTime + 0.025 : 0;

        if (attachAudio && sharedAudioCtx && audioDest) {
          if (masterAudioBuffer) {
            try {
              const src = sharedAudioCtx.createBufferSource();
              src.buffer = masterAudioBuffer;
              src.connect(audioDest);
              src.start(audioStartTime);
              masterSource = src;
            } catch {
              // ignore
            }
          } else {
            void soundEngine
              .startBgMusic(sAudio.bgMusic, audioDest, sharedAudioCtx)
              .then((src) => {
                if ((cleanedUp || settled) && src) {
                  try {
                    src.stop();
                  } catch {
                    // ignore
                  }
                  return;
                }
                bgSource = src;
                if (timing.autoDuckMusic !== false && fallbackPlan.speechIntervals.length > 0) {
                  soundEngine.scheduleBgDuckIntervals(
                    sharedAudioCtx,
                    fallbackPlan.speechIntervals,
                    audioStartTime,
                    timing.bgMusicDuckRatio ?? 0.22
                  );
                }
              });
            scheduleFallbackAudioLookahead(0.8);
          }
        }

        try {
          renderToCapture(0);
        } catch (err) {
          finishError(err instanceof Error ? err.message : 'فشل رسم الفيديو.');
          return;
        }

        let nextSlotTime = 1 / EXPORT_FPS;
        let finishing = false;
        let forceWallClock = !attachAudio || !sharedAudioCtx || sharedAudioCtx.state !== 'running';
        let lastAudioSeen = sharedAudioCtx ? sharedAudioCtx.currentTime : 0;
        let lastAudioProgressPerf = wallStartPerf;
        let maxElapsedReached = 0;

        stallCheckIntervalId = window.setInterval(() => {
          if (settled || finishing || cleanedUp) return;
          const nowP = performance.now();
          if (nowP - lastRenderTickPerf > 4500) {
            finishError('توقف تحديث الإطارات أثناء التسجيل.');
            return;
          }
          if (totalDuration > 4 && nowP - lastChunkPerf > 5000 && chunks.length === 0) {
            finishError('لم يخرج مسجل المتصفح أي بيانات فيديو (MediaRecorder).');
          }
        }, 700);

        const stepFrame = () => {
          if (signal.aborted || cleanedUp || settled || finishing) return;
          window.clearTimeout(timerId);
          cancelAnimationFrame(rafId);

          const nowPerf = performance.now();
          lastRenderTickPerf = nowPerf;
          const wallElapsed = Math.max(0, (nowPerf - wallStartPerf) / 1000);

          if (!forceWallClock && sharedAudioCtx) {
            const curAudio = sharedAudioCtx.currentTime;
            if (curAudio > lastAudioSeen + 0.001) {
              lastAudioSeen = curAudio;
              lastAudioProgressPerf = nowPerf;
            } else if (
              sharedAudioCtx.state !== 'running' ||
              nowPerf - lastAudioProgressPerf > 260
            ) {
              forceWallClock = true;
            }
          }

          const rawAudioElapsed =
            !forceWallClock && sharedAudioCtx
              ? Math.max(0, sharedAudioCtx.currentTime - audioStartTime)
              : wallElapsed;

          const elapsed = Math.min(
            totalDuration,
            Math.max(maxElapsedReached, forceWallClock ? wallElapsed : rawAudioElapsed)
          );
          maxElapsedReached = elapsed;

          if (attachAudio && !masterAudioBuffer) {
            scheduleFallbackAudioLookahead(elapsed + 0.8);
          }

          if (elapsed >= nextSlotTime - 0.004 || elapsed >= totalDuration) {
            try {
              renderToCapture(elapsed);
            } catch (err) {
              finishError(
                err instanceof Error ? err.message : 'حدث خطأ أثناء رسم مشهد الفيديو.'
              );
              return;
            }

            if (elapsed >= totalDuration || nowPerf - lastProgressEmitPerf >= 140) {
              lastProgressEmitPerf = nowPerf;
              onProgress({
                progress: 0.04 + 0.96 * (elapsed / totalDuration),
                currentTime: elapsed,
                totalDuration,
                statusText: `جارٍ تسجيل الفيديو (${Math.round((elapsed / totalDuration) * 100)}%)`,
              });
            }

            while (nextSlotTime <= elapsed + 0.004) {
              nextSlotTime += 1 / EXPORT_FPS;
            }
          }

          if (elapsed >= totalDuration) {
            finishing = true;
            timerId = window.setTimeout(() => {
              if (settled) return;
              try {
                if (activeRecorder.state === 'recording') {
                  try {
                    activeRecorder.requestData?.();
                  } catch {
                    // ignore
                  }
                  activeRecorder.stop();
                } else if (activeRecorder.state === 'inactive') {
                  finishSuccess();
                }
              } catch {
                finishSuccess();
              }

              stopWatchdogId = window.setTimeout(() => {
                finishSuccess();
              }, 2500);
            }, 180);
            return;
          }

          const msToNext = Math.max(8, Math.min(36, (nextSlotTime - elapsed) * 1000));
          rafId = requestAnimationFrame(stepFrame);
          timerId = window.setTimeout(stepFrame, msToNext);
        };

        rafId = requestAnimationFrame(stepFrame);
        timerId = window.setTimeout(stepFrame, 33);
      };

      activeRecorder.onstart = () => {
        window.clearTimeout(timerId);
        cancelAnimationFrame(rafId);
        beginSyncLoop();
      };

      try {
        activeRecorder.start(1000);
      } catch {
        finishError('تعذر تشغيل مسجل الفيديو على هذا الجهاز.');
        return;
      }

      timerId = window.setTimeout(() => {
        beginSyncLoop();
      }, 90);
    });
  };

  // Prefer 720p fallback in MediaRecorder if 1080p fails
  for (const dims of dimensionPlans) {
    for (let i = 0; i < mimeCandidates.length; i++) {
      checkAborted();
      const cand = mimeCandidates[i];
      try {
        if (i > 0 || dims.label !== dimensionPlans[0].label) {
          onProgress({
            progress: 0.04,
            currentTime: 0,
            totalDuration,
            statusText: `جارٍ المحاولة بالمسجل البديل (${cand.extension.toUpperCase()} · ${dims.label})...`,
          });
        }
        return await runRecorderAttempt(cand, dims, includeAudio);
      } catch (err) {
        if (signal.aborted) throw err;
        lastErr = err;
      }
    }
  }

  if (includeAudio) {
    const safeDims = dimensionPlans[dimensionPlans.length - 1];
    for (const cand of mimeCandidates.slice(0, 2)) {
      checkAborted();
      try {
        onProgress({
          progress: 0.04,
          currentTime: 0,
          totalDuration,
          statusText: 'تعذر دمج مسار الصوت على هذا المتصفح، جارٍ المحاولة بدون مسار صوتي...',
        });
        return await runRecorderAttempt(cand, safeDims, false);
      } catch (err) {
        if (signal.aborted) throw err;
        lastErr = err;
      }
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error('تعذر تصدير الفيديو على هذا المتصفح. جرّب دقة 720p أو صيغة WebM.');
}
