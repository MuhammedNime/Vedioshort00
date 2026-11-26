import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Maximize2,
  Minimize2,
  Monitor,
  Move,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Scan,
  Smartphone,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { saveOrDownloadBlob } from '../utils/nativeDownload';
import {
  DragTargetId,
  StageElementHitbox,
  clearRendererCaches,
  collectSoundEventsInInterval,
  ensureQuizFontsLoaded,
  exportThumbnailJpg,
  getSlideTimeInfo,
  preloadTemplateBackground,
  preloadTimerVideo,
  renderQuizFrame,
} from '../canvas/quizRenderer';
import {
  decodeAiPresenterAudioBuffer,
  getAiPresenterPlaybackWindows,
  isTimeCoveredByAiPresenterAudio,
  pauseAllCachedAiPresenterVideos,
  preloadAiPresenterMedia,
  prepareAiPresenterPlaybackAt,
  subscribeAiPresenterFrameReady,
  syncAiPresenterPreviewVideo,
} from '../canvas/aiPresenterMedia';
import {
  AudioSettings,
  PresenterPoseId,
  QuestionSlide,
  TemplateSettings,
  TimingSettings,
  computeProjectTimeline,
  getCanvasDimensions,
  getIntroHookDuration,
  getSlidesContentDuration,
  getTotalDuration,
} from '../types/quiz';

interface ShortsPreviewStageProps {
  slides: QuestionSlide[];
  activeSlideIndex: number;
  template: TemplateSettings;
  timing: TimingSettings;
  audio: AudioSettings;
  isExporting?: boolean;
  mobileStageMode?: 'compact' | 'expanded' | 'collapsed';
  onChangeMobileStageMode?: (mode: 'compact' | 'expanded' | 'collapsed') => void;
  onToggleSafeGuides: () => void;
  onToggleAspectRatio?: () => void;
  onCycleChannelTheme: () => void;
  onActiveSlideChange?: (idx: number) => void;
  onUpdateTemplate?: (next: TemplateSettings) => void;
}

type StagePhaseId = 'intro' | 'question' | 'opt1' | 'opt4' | 'timer' | 'suspense' | 'reveal' | 'end';

function computeActivePhaseId(
  t: number,
  slides: QuestionSlide[],
  template: TemplateSettings,
  timing: TimingSettings,
  audio: AudioSettings
): StagePhaseId | null {
  const introDur = getIntroHookDuration(template, timing);
  if (introDur > 0 && t < introDur) return 'intro';
  const contentEnd = getSlidesContentDuration(slides, timing, audio, template);
  if (template.showEndCard && t >= contentEnd) return 'end';
  const info = getSlideTimeInfo(t, slides, timing, audio, template);
  if (!info) return null;
  const { localTime, schedule } = info;
  if (localTime < schedule.tOptionStarts[0]) return 'question';
  if (localTime < (schedule.tOptionStarts[1] ?? schedule.tThinkingStart)) return 'opt1';
  if (localTime < schedule.tThinkingStart) return 'opt4';
  if (localTime < schedule.tTimerExitStart) return 'timer';
  if (localTime < schedule.tRevealStart) return 'suspense';
  return 'reveal';
}

function applyExactClipDurations(
  slides: QuestionSlide[],
  audio: AudioSettings,
  template: TemplateSettings
): { slides: QuestionSlide[]; audio: AudioSettings; template: TemplateSettings } {
  const syncClip = <T extends { dataUrl?: string; duration: number } | undefined>(clip: T): T => {
    if (!clip?.dataUrl) return clip;
    const exact = soundEngine.getExactDuration(clip.dataUrl, clip.duration);
    return Math.abs(exact - clip.duration) > 0.01 ? ({ ...clip, duration: exact } as T) : clip;
  };

  let slidesChanged = false;
  const nextSlides = slides.map((s) => {
    if (!s.voiceover) return s;
    const q = syncClip(s.voiceover.question);
    const ans = syncClip(s.voiceover.answer);
    const opts = s.voiceover.options
      ? ([
          syncClip(s.voiceover.options[0]),
          syncClip(s.voiceover.options[1]),
          syncClip(s.voiceover.options[2]),
          syncClip(s.voiceover.options[3]),
        ] as [
          typeof s.voiceover.question,
          typeof s.voiceover.question,
          typeof s.voiceover.question,
          typeof s.voiceover.question
        ])
      : undefined;
    const optsChanged =
      opts &&
      s.voiceover.options &&
      (opts[0] !== s.voiceover.options[0] ||
        opts[1] !== s.voiceover.options[1] ||
        opts[2] !== s.voiceover.options[2] ||
        opts[3] !== s.voiceover.options[3]);
    if (q !== s.voiceover.question || ans !== s.voiceover.answer || optsChanged) {
      slidesChanged = true;
      return {
        ...s,
        voiceover: {
          ...s.voiceover,
          question: q,
          answer: ans,
          options: opts,
        },
      };
    }
    return s;
  });

  const syncSlot = <T extends AudioSettings[keyof AudioSettings]>(cfg: T): T => {
    if (cfg.sourceType !== 'custom' || !cfg.customDataUrl) return cfg;
    const exact = soundEngine.getExactDuration(cfg.customDataUrl, cfg.duration ?? 0);
    return exact > 0 && Math.abs(exact - (cfg.duration ?? 0)) > 0.01
      ? ({ ...cfg, duration: exact } as T)
      : cfg;
  };

  const nextAudio: AudioSettings = {
    questionEnter: syncSlot(audio.questionEnter),
    optionEnter: syncSlot(audio.optionEnter),
    countdownTick: syncSlot(audio.countdownTick),
    suspense: syncSlot(audio.suspense),
    correctReveal: syncSlot(audio.correctReveal),
    bgMusic: syncSlot(audio.bgMusic),
  };

  const nextIntroHookAudio = syncClip(template.introHookAudio);
  const nextEndCardAudio = syncClip(template.endCardAudio);
  const nextTemplate =
    nextIntroHookAudio !== template.introHookAudio || nextEndCardAudio !== template.endCardAudio
      ? {
          ...template,
          introHookAudio: nextIntroHookAudio,
          endCardAudio: nextEndCardAudio,
        }
      : template;

  return {
    slides: slidesChanged ? nextSlides : slides,
    audio: nextAudio,
    template: nextTemplate,
  };
}

function formatTimecode(sec: number): string {
  const clamped = Math.max(0, sec);
  const mins = Math.floor(clamped / 60);
  const rem = clamped % 60;
  const whole = Math.floor(rem);
  const tenths = Math.floor((rem - whole) * 10);
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${tenths}`;
}

export const ShortsPreviewStage: React.FC<ShortsPreviewStageProps> = ({
  slides,
  activeSlideIndex,
  template,
  timing,
  audio,
  isExporting = false,
  mobileStageMode = 'compact',
  onChangeMobileStageMode,
  onToggleSafeGuides,
  onToggleAspectRatio,
  onCycleChannelTheme,
  onActiveSlideChange,
  onUpdateTemplate,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rangeInputRef = useRef<HTMLInputElement | null>(null);
  const timeLabelRef = useRef<HTMLSpanElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCapturingThumb, setIsCapturingThumb] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [dragMode, setDragMode] = useState(false);
  const [activeDragTarget, setActiveDragTarget] = useState<DragTargetId | null>(null);

  const { width: canvasW, height: canvasH } = getCanvasDimensions(template);
  const isWide = template.aspectRatio === '16:9';
  const totalDuration = getTotalDuration(slides, timing, audio, template);

  const timeRef = useRef(0);
  const totalDurationRef = useRef(totalDuration);
  const hasUserScrubbedRef = useRef(false);
  const hasInitializedTimeRef = useRef(false);
  const isExternallySelectedSlideRef = useRef(false);
  const isScrubSlideSyncRef = useRef(false);
  const forceFirstTickRef = useRef(false);
  const isPlayingRef = useRef(false);
  const isMutedRef = useRef(false);
  const playSessionRef = useRef(0);
  const slidesRef = useRef(slides);
  const templateRef = useRef(template);
  const timingRef = useRef(timing);
  const audioRef = useRef(audio);
  const dragModeRef = useRef(dragMode);
  const activeDragTargetRef = useRef<DragTargetId | null>(activeDragTarget);
  const hitboxesRef = useRef<StageElementHitbox[]>([]);
  const dragSessionRef = useRef<{
    target: DragTargetId;
    startCanvasX: number;
    startCanvasY: number;
    startTemplate: TemplateSettings;
  } | null>(null);

  slidesRef.current = slides;
  templateRef.current = template;
  timingRef.current = timing;
  audioRef.current = audio;
  totalDurationRef.current = totalDuration;
  isMutedRef.current = isMuted;
  dragModeRef.current = dragMode;
  activeDragTargetRef.current = activeDragTarget;

  const demoPoseRef = useRef<PresenterPoseId | null>(null);
  const demoAnimClockRef = useRef<number>(0);

  const drawPreviewFrame = (
    ctx: CanvasRenderingContext2D,
    t: number,
    s = slidesRef.current,
    tpl = templateRef.current,
    tm = timingRef.current,
    au = audioRef.current
  ) => {
    if (!isPlayingRef.current && tpl.aiPresenter?.enabled && tpl.aiPresenter?.mediaKey) {
      syncAiPresenterPreviewVideo(t, false, s, tpl, tm, au, isMutedRef.current, true);
    }
    const nextHitboxes: StageElementHitbox[] = [];
    const hasInteractiveOverride = Boolean(dragModeRef.current || demoPoseRef.current);
    renderQuizFrame(
      ctx,
      t,
      s,
      tpl,
      tm,
      au,
      true,
      hasInteractiveOverride
        ? {
            dragMode: dragModeRef.current,
            activeTarget: dragModeRef.current ? activeDragTargetRef.current : null,
            demoPresenterPose: demoPoseRef.current,
            demoPresenterAnimClock: demoAnimClockRef.current,
          }
        : undefined,
      nextHitboxes
    );
    hitboxesRef.current = nextHitboxes;
  };

  const syncTimeUi = (sec: number, dur = totalDurationRef.current, syncReact = true) => {
    timeRef.current = sec;
    if (rangeInputRef.current) {
      rangeInputRef.current.value = String(sec);
    }
    if (timeLabelRef.current) {
      timeLabelRef.current.textContent = `${formatTimecode(sec)} / ${formatTimecode(dur)}`;
    }
    if (syncReact) {
      setCurrentTime(sec);
    }
  };

  useEffect(() => {
    if (isExporting) {
      setIsPlaying(false);
      setDragMode(false);
      soundEngine.stopBgMusic();
      soundEngine.stopAllSfxAndVoice();
    }
  }, [isExporting]);

  useEffect(() => {
    let alive = true;
    const redrawWithFreshFontCache = () => {
      if (!alive) return;
      clearRendererCaches();
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { alpha: false });
      if (ctx) {
        drawPreviewFrame(ctx, timeRef.current);
      }
    };

    void ensureQuizFontsLoaded(template.fontFamily).then(redrawWithFreshFontCache);
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.addEventListener('loadingdone', redrawWithFreshFontCache);
    }
    return () => {
      alive = false;
      if (typeof document !== 'undefined' && document.fonts) {
        document.fonts.removeEventListener('loadingdone', redrawWithFreshFontCache);
      }
    };
  }, [template.fontFamily]);

  useEffect(() => {
    void Promise.all([
      preloadTemplateBackground(template, slides),
      preloadTimerVideo(),
      preloadAiPresenterMedia(template.aiPresenter),
    ]).then(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { alpha: false });
      if (ctx) {
        drawPreviewFrame(ctx, timeRef.current, slides, template, timing, audio);
      }
    });
  }, [template, slides, timing, audio, canvasW, canvasH, dragMode, activeDragTarget]);

  useEffect(() => {
    if (!hasInitializedTimeRef.current && !hasUserScrubbedRef.current && !isPlayingRef.current) {
      hasInitializedTimeRef.current = true;
      const schedules = computeProjectTimeline(slides, timing, audio, template);
      const sched = schedules[activeSlideIndex] ?? schedules[0];
      if (sched) {
        const showcaseTime = Math.min(
          totalDuration,
          sched.startTime + sched.tThinkingStart + Math.min(1.1, sched.thinkingDuration * 0.25)
        );
        syncTimeUi(showcaseTime, totalDuration, true);
      }
    }
  }, [slides, timing, audio, template, activeSlideIndex, totalDuration]);

  useEffect(() => {
    const unsubscribe = subscribeAiPresenterFrameReady(() => {
      if (isPlayingRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { alpha: false });
      if (ctx) {
        drawPreviewFrame(ctx, timeRef.current);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let rafId = 0;
    const handlePresenterDemo = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pose?: PresenterPoseId }>).detail;
      if (!detail?.pose) return;
      cancelAnimationFrame(rafId);
      demoPoseRef.current = detail.pose;
      const startPerf = performance.now();
      const durationMs = 2600;

      const step = (now: number) => {
        const elapsedSec = (now - startPerf) / 1000;
        demoAnimClockRef.current = elapsedSec;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { alpha: false });
        if (ctx && !isPlayingRef.current) {
          drawPreviewFrame(ctx, timeRef.current);
        }
        if (now - startPerf < durationMs && demoPoseRef.current === detail.pose) {
          rafId = requestAnimationFrame(step);
        } else {
          demoPoseRef.current = null;
          if (ctx && !isPlayingRef.current) {
            drawPreviewFrame(ctx, timeRef.current);
          }
        }
      };

      rafId = requestAnimationFrame(step);
    };

    window.addEventListener('shortvedio:presenter-demo', handlePresenterDemo);
    return () => {
      cancelAnimationFrame(rafId);
      demoPoseRef.current = null;
      window.removeEventListener('shortvedio:presenter-demo', handlePresenterDemo);
    };
  }, []);

  const prevAiPresenterSigRef = useRef<string>('');
  useEffect(() => {
    const ai = template.aiPresenter;
    const sig = ai?.enabled ? `${ai.mediaKey}:${ai.scope}:${ai.targetSlideIndex ?? 0}` : '';
    const changed = prevAiPresenterSigRef.current !== sig;
    prevAiPresenterSigRef.current = sig;

    if (changed && ai?.enabled && !isPlayingRef.current) {
      const windows = getAiPresenterPlaybackWindows(slides, template, timing, audio);
      if (windows.length > 0) {
        const cur = timeRef.current;
        const alreadyVisible = windows.some(
          (w) => cur >= w.timelineStart && cur <= w.timelineEnd
        );
        if (!alreadyVisible) {
          const target = Math.min(
            totalDuration,
            windows[0].timelineStart + Math.min(0.2, Math.max(0.05, (windows[0].timelineEnd - windows[0].timelineStart) * 0.2))
          );
          syncTimeUi(target, totalDuration, true);
        }
      }
    }
  }, [template, slides, timing, audio, totalDuration]);

  useEffect(() => {
    if (totalDuration > 0 && timeRef.current > totalDuration) {
      syncTimeUi(totalDuration, totalDuration, true);
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (ctx && mobileStageMode !== 'collapsed') {
      drawPreviewFrame(ctx, timeRef.current, slides, template, timing, audio);
    }
  }, [slides, template, timing, audio, totalDuration, canvasW, canvasH, dragMode, activeDragTarget, mobileStageMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (isPlayingRef.current) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (ctx) {
        drawPreviewFrame(ctx, timeRef.current);
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  const prevSlideIdxRef = useRef(activeSlideIndex);
  useEffect(() => {
    if (prevSlideIdxRef.current !== activeSlideIndex && !isPlayingRef.current) {
      if (isScrubSlideSyncRef.current) {
        isScrubSlideSyncRef.current = false;
      } else {
        isExternallySelectedSlideRef.current = true;
        const schedules = computeProjectTimeline(slides, timing, audio, template);
        const sched = schedules[activeSlideIndex];
        const target = sched
          ? sched.startTime + sched.tThinkingStart + Math.min(1.1, sched.thinkingDuration * 0.25)
          : 0;
        const clamped = Math.min(totalDuration, target);
        syncTimeUi(clamped, totalDuration, true);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { alpha: false });
        if (ctx) {
          drawPreviewFrame(ctx, clamped, slides, template, timing, audio);
        }
      }
    }
    prevSlideIdxRef.current = activeSlideIndex;
  }, [activeSlideIndex, timing, audio, totalDuration, slides, template]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    const sessionId = ++playSessionRef.current;

    if (!isPlaying) {
      soundEngine.stopBgMusic();
      soundEngine.stopAllSfxAndVoice();
      return;
    }

    let canceled = false;
    const isStale = () => canceled || !isPlayingRef.current || playSessionRef.current !== sessionId;

    const startPlayback = async () => {
      const audioCtx = await soundEngine.unlock();
      if (isStale()) return;

      await soundEngine.syncProjectAudioDurations(
        slidesRef.current,
        audioRef.current,
        templateRef.current,
        audioCtx
      );
      if (isStale()) return;

      const initialSynced = applyExactClipDurations(
        slidesRef.current,
        audioRef.current,
        templateRef.current
      );

      if (!isMutedRef.current) {
        void soundEngine.startBgMusic(initialSynced.audio.bgMusic).then((src) => {
          if (isStale() && src) {
            soundEngine.stopBgMusic();
          }
        });
      }

      // Hydrate & pre-decode AI Presenter video audio for accurate synced live preview
      let aiPresenterAudioBuf: AudioBuffer | null = null;
      const aiPres = initialSynced.template.aiPresenter;
      const triggeredAiWinIndices = new Set<number>();
      if (aiPres?.enabled && aiPres.mediaKey) {
        await preloadAiPresenterMedia(aiPres);
        if (!isStale()) {
          aiPresenterAudioBuf = await decodeAiPresenterAudioBuffer(aiPres.mediaKey, audioCtx);
        }
        if (!isStale()) {
          await prepareAiPresenterPlaybackAt(
            timeRef.current,
            initialSynced.slides,
            initialSynced.template,
            timingRef.current,
            initialSynced.audio
          );
        }
      }

      if (isStale()) return;

      let rafId = 0;
      const startMediaTime = timeRef.current;
      const startPerfMs = performance.now();
      let audioBaseCtxSec: number | null =
        audioCtx.state === 'running' ? audioCtx.currentTime : null;
      let lastUiSyncPerf = startPerfMs;
      let lastSyncedPhase: StagePhaseId | null = computeActivePhaseId(
        startMediaTime,
        initialSynced.slides,
        initialSynced.template,
        timingRef.current,
        initialSynced.audio
      );
      let isFirstTick = true;

      if (initialSynced.template.aiPresenter?.enabled && initialSynced.template.aiPresenter.mediaKey) {
        syncAiPresenterPreviewVideo(
          startMediaTime,
          true,
          initialSynced.slides,
          initialSynced.template,
          timingRef.current,
          initialSynced.audio,
          isMutedRef.current,
          Boolean(aiPresenterAudioBuf)
        );
      }

      const tick = (now: number) => {
        if (isStale()) return;

        // Read live editor props with exact decoded clip durations so screen stays responsive mid-playback
        const liveSynced = applyExactClipDurations(
          slidesRef.current,
          audioRef.current,
          templateRef.current
        );
        const curSlides = liveSynced.slides;
        const curAudio = liveSynced.audio;
        const curTemplate = liveSynced.template;

        const rawPrevT = timeRef.current;
        const useFirstMargin = isFirstTick || forceFirstTickRef.current;
        // Ensure events sitting right at play/step start time fire synchronously with first frame
        const prevT = useFirstMargin ? rawPrevT - 0.001 : rawPrevT;
        isFirstTick = false;
        forceFirstTickRef.current = false;

        if (audioBaseCtxSec === null && audioCtx.state === 'running') {
          audioBaseCtxSec = audioCtx.currentTime - Math.max(0, (now - startPerfMs) / 1000);
        }
        const elapsedSec =
          audioBaseCtxSec !== null && audioCtx.state === 'running'
            ? Math.max(0, audioCtx.currentTime - audioBaseCtxSec)
            : Math.max(0, (now - startPerfMs) / 1000);

        let nextT = startMediaTime + elapsedSec;
        const maxDur = getTotalDuration(curSlides, timingRef.current, curAudio, curTemplate);

        if (nextT >= maxDur) {
          nextT = maxDur;
          syncTimeUi(nextT, maxDur, true);
          pauseAllCachedAiPresenterVideos();
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d', { alpha: false });
          if (ctx) {
            drawPreviewFrame(ctx, nextT, curSlides, curTemplate, timingRef.current, curAudio);
          }
          setIsPlaying(false);
          soundEngine.stopBgMusic();
          soundEngine.stopAllSfxAndVoice();
          return;
        }

        if (curTemplate.aiPresenter?.enabled && curTemplate.aiPresenter.mediaKey) {
          syncAiPresenterPreviewVideo(
            nextT,
            true,
            curSlides,
            curTemplate,
            timingRef.current,
            curAudio,
            isMutedRef.current,
            Boolean(aiPresenterAudioBuf)
          );

          if (!isMutedRef.current && aiPresenterAudioBuf && (curTemplate.aiPresenter.volume ?? 1) > 0.01) {
            const aiWins = getAiPresenterPlaybackWindows(
              curSlides,
              curTemplate,
              timingRef.current,
              curAudio
            );
            aiWins.forEach((w, wIdx) => {
              if (triggeredAiWinIndices.has(wIdx)) return;
              const crossedStart = prevT < w.timelineStart && nextT >= w.timelineStart;
              const startedInside = useFirstMargin && nextT >= w.timelineStart && nextT < w.timelineEnd - 0.08;
              if (crossedStart || startedInside) {
                triggeredAiWinIndices.add(wIdx);
                const elapsedInWin = Math.max(0, nextT - w.timelineStart);
                const offsetInBuf = w.trimStart + elapsedInWin;
                const playDur = Math.max(0, w.timelineEnd - nextT);
                if (playDur > 0.06) {
                  if (timingRef.current.autoDuckMusic !== false && playDur > 0.25) {
                    soundEngine.duckBgMusic(undefined, playDur, timingRef.current.bgMusicDuckRatio ?? 0.22);
                  }
                  soundEngine.playBufferSlice(
                    aiPresenterAudioBuf!,
                    w.volume,
                    offsetInBuf,
                    playDur,
                    undefined,
                    undefined,
                    undefined,
                    'aiPresenter'
                  );
                }
              }
            });
          }
        }

        if (!isMutedRef.current) {
          const events = collectSoundEventsInInterval(
            prevT,
            nextT,
            curSlides,
            timingRef.current,
            curAudio,
            curTemplate
          );
          const aiVoiceOwnsAudioHere = isTimeCoveredByAiPresenterAudio(
            nextT,
            curSlides,
            curTemplate,
            timingRef.current,
            curAudio
          );
          const duckIfNeeded = (durSec: number) => {
            if (timingRef.current.autoDuckMusic !== false && durSec > 0.25) {
              soundEngine.duckBgMusic(undefined, durSec, timingRef.current.bgMusicDuckRatio ?? 0.22);
            }
          };

          for (const ev of events) {
            const s = curSlides[ev.slideIndex];
            const maxDurEv = ev.maxDuration;
            if (ev.type === 'introHook') {
              const hookSfx = curTemplate.introHookSfx ?? 'whoosh';
              const hasHookVoice = Boolean(curTemplate.introHookAudio?.dataUrl) && !aiVoiceOwnsAudioHere;
              if (hookSfx && hookSfx !== 'none') {
                const ctx = soundEngine.getContext();
                soundEngine.playBuiltInSfx(
                  hookSfx,
                  aiVoiceOwnsAudioHere ? 0.28 : hasHookVoice ? 0.42 : 0.72,
                  ctx,
                  ctx.destination,
                  ctx.currentTime,
                  false,
                  1.6,
                  aiVoiceOwnsAudioHere || hasHookVoice ? Math.min(0.24, maxDurEv ?? 0.24) : maxDurEv
                );
              }
              if (curTemplate.introHookAudio?.dataUrl && !aiVoiceOwnsAudioHere) {
                const dur = Math.min(maxDurEv ?? 99, curTemplate.introHookAudio.duration || 1.2);
                duckIfNeeded(dur);
                void soundEngine.playClip(
                  curTemplate.introHookAudio,
                  1,
                  undefined,
                  undefined,
                  undefined,
                  'voice',
                  maxDurEv
                );
              }
            } else if (ev.type === 'questionEnter') {
              if (s?.voiceover?.question?.dataUrl && !aiVoiceOwnsAudioHere) {
                const dur = Math.min(maxDurEv ?? 99, s.voiceover.question.duration || 1.2);
                duckIfNeeded(dur);
                void soundEngine.playClip(
                  s.voiceover.question,
                  1,
                  undefined,
                  undefined,
                  undefined,
                  'voice',
                  maxDurEv
                );
              } else {
                soundEngine.stopActiveVoice();
                void soundEngine.playSlot(curAudio.questionEnter, undefined, undefined, undefined, false, maxDurEv);
              }
            } else if (ev.type === 'optionEnter') {
              const oIdx = ev.optionIndex ?? 0;
              const oClip = s?.voiceover?.options?.[oIdx];
              if (oClip?.dataUrl && !aiVoiceOwnsAudioHere) {
                const dur = Math.min(maxDurEv ?? 99, oClip.duration || 1.0);
                duckIfNeeded(dur);
                void soundEngine.playClip(oClip, 1, undefined, undefined, undefined, 'voice', maxDurEv);
              } else {
                soundEngine.stopActiveVoice();
                void soundEngine.playSlot(curAudio.optionEnter, undefined, undefined, undefined, false, maxDurEv);
              }
            } else if (ev.type === 'countdownTick') {
              void soundEngine.playSlot(
                curAudio.countdownTick,
                undefined,
                undefined,
                undefined,
                !!ev.urgent,
                maxDurEv ?? 0.88
              );
            } else if (ev.type === 'suspense') {
              void soundEngine.playSlot(
                curAudio.suspense,
                undefined,
                undefined,
                undefined,
                false,
                maxDurEv ?? Math.max(0.25, timingRef.current.suspenseDuration ?? 1.6),
                timingRef.current.suspenseDuration
              );
            } else if (ev.type === 'correctReveal') {
              if (s?.voiceover?.answer?.dataUrl && !aiVoiceOwnsAudioHere) {
                const dur = Math.min(maxDurEv ?? 99, s.voiceover.answer.duration || 1.2);
                duckIfNeeded(dur);
                void soundEngine.playClip(
                  s.voiceover.answer,
                  1,
                  undefined,
                  undefined,
                  undefined,
                  'voice',
                  maxDurEv
                );
              } else {
                soundEngine.stopActiveVoice();
                void soundEngine.playSlot(curAudio.correctReveal, undefined, undefined, undefined, false, maxDurEv);
              }
            } else if (ev.type === 'endCardEnter') {
              if (curTemplate.endCardAudio?.dataUrl && !aiVoiceOwnsAudioHere) {
                const dur = Math.min(maxDurEv ?? 99, curTemplate.endCardAudio.duration || 2.0);
                duckIfNeeded(dur);
                void soundEngine.playClip(
                  curTemplate.endCardAudio,
                  1,
                  undefined,
                  undefined,
                  undefined,
                  'voice',
                  maxDurEv
                );
              }
            }
          }
        }

        const nextPhase = computeActivePhaseId(
          nextT,
          curSlides,
          curTemplate,
          timingRef.current,
          curAudio
        );
        const phaseChanged = nextPhase !== lastSyncedPhase;
        const shouldSyncReact = phaseChanged || now - lastUiSyncPerf >= 85;
        if (shouldSyncReact) {
          lastUiSyncPerf = now;
          lastSyncedPhase = nextPhase;
        }
        syncTimeUi(nextT, maxDur, shouldSyncReact);

        const info = getSlideTimeInfo(
          nextT,
          curSlides,
          timingRef.current,
          curAudio,
          curTemplate
        );
        if (info && onActiveSlideChange && info.slideIndex !== prevSlideIdxRef.current) {
          prevSlideIdxRef.current = info.slideIndex;
          onActiveSlideChange(info.slideIndex);
        }

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { alpha: false });
        if (ctx) {
          drawPreviewFrame(ctx, nextT, curSlides, curTemplate, timingRef.current, curAudio);
        }

        rafId = requestAnimationFrame(tick);
      };

      rafId = requestAnimationFrame(tick);

      return () => {
        cancelAnimationFrame(rafId);
      };
    };

    let stopRaf: (() => void) | undefined;
    void startPlayback().then((cleanup) => {
      if (isStale()) {
        cleanup?.();
        return;
      }
      stopRaf = cleanup;
    });

    return () => {
      canceled = true;
      playSessionRef.current += 1;
      stopRaf?.();
      setCurrentTime(timeRef.current);
      pauseAllCachedAiPresenterVideos();
      soundEngine.stopBgMusic();
      soundEngine.stopAllSfxAndVoice();
    };
  }, [isPlaying, onActiveSlideChange]);

  const handleTogglePlay = () => {
    void soundEngine.unlock();
    if (
      !isPlaying &&
      (!hasUserScrubbedRef.current ||
        isExternallySelectedSlideRef.current ||
        timeRef.current >= totalDuration - 0.05)
    ) {
      hasUserScrubbedRef.current = true;
      isExternallySelectedSlideRef.current = false;
      const schedules = computeProjectTimeline(slides, timing, audio, template);
      const sched = schedules[activeSlideIndex];
      const startAt =
        timeRef.current >= totalDuration - 0.05
          ? 0
          : activeSlideIndex === 0 && template.showIntroHook
            ? 0
            : sched
              ? sched.startTime
              : 0;
      timeRef.current = startAt;
      setCurrentTime(startAt);
      forceFirstTickRef.current = true;
    }
    setIsPlaying((p) => !p);
  };

  const handleRestart = () => {
    void soundEngine.unlock();
    soundEngine.stopAllSfxAndVoice();
    hasUserScrubbedRef.current = true;
    isExternallySelectedSlideRef.current = false;
    forceFirstTickRef.current = true;
    timeRef.current = 0;
    setCurrentTime(0);
    if (onActiveSlideChange && activeSlideIndex !== 0) {
      isScrubSlideSyncRef.current = true;
      onActiveSlideChange(0);
    }
    setIsPlaying(true);
  };

  const handlePlayCurrentSlide = () => {
    void soundEngine.unlock();
    soundEngine.stopAllSfxAndVoice();
    const schedules = computeProjectTimeline(slides, timing, audio, template);
    const sched = schedules[activeSlideIndex] ?? schedules[0];
    const target = sched ? sched.startTime : 0;
    hasUserScrubbedRef.current = true;
    isExternallySelectedSlideRef.current = false;
    forceFirstTickRef.current = true;
    timeRef.current = target;
    setCurrentTime(target);
    setIsPlaying(true);
  };

  const handleStepSlide = (delta: number) => {
    const nextIdx = Math.max(0, Math.min(slides.length - 1, activeSlideIndex + delta));
    const schedules = computeProjectTimeline(slides, timing, audio, template);
    const sched = schedules[nextIdx];
    if (sched && onActiveSlideChange) {
      void soundEngine.unlock();
      soundEngine.stopAllSfxAndVoice();
      hasUserScrubbedRef.current = true;
      isExternallySelectedSlideRef.current = false;
      isScrubSlideSyncRef.current = true;
      forceFirstTickRef.current = true;
      onActiveSlideChange(nextIdx);
      timeRef.current = sched.startTime;
      setCurrentTime(sched.startTime);
      setIsPlaying(true);
    }
  };

  const handleScrub = (val: number) => {
    hasUserScrubbedRef.current = true;
    isExternallySelectedSlideRef.current = false;
    soundEngine.stopAllSfxAndVoice();
    setIsPlaying(false);
    syncTimeUi(val, totalDuration, true);
    const info = getSlideTimeInfo(val, slides, timing, audio, template);
    if (info && onActiveSlideChange && info.slideIndex !== activeSlideIndex) {
      isScrubSlideSyncRef.current = true;
      onActiveSlideChange(info.slideIndex);
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (ctx) {
      drawPreviewFrame(ctx, val, slides, template, timing, audio);
    }
  };

  const clientToCanvasPoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const scale = Math.min(rect.width / canvasW, rect.height / canvasH);
    const drawnW = canvasW * scale;
    const drawnH = canvasH * scale;
    const offsetX = (rect.width - drawnW) / 2;
    const offsetY = (rect.height - drawnH) / 2;
    return {
      x: ((clientX - rect.left - offsetX) / Math.max(1, drawnW)) * canvasW,
      y: ((clientY - rect.top - offsetY) / Math.max(1, drawnH)) * canvasH,
    };
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragMode || !onUpdateTemplate) return;
    const pt = clientToCanvasPoint(e.clientX, e.clientY);
    if (!pt) return;

    const priority: DragTargetId[] = ['brand', 'presenter', 'timer', 'badge', 'question', 'options'];
    let matched: DragTargetId | null = null;
    for (const id of priority) {
      const hb = hitboxesRef.current.find((h) => h.id === id);
      if (!hb) continue;
      const pad = 16;
      if (
        pt.x >= hb.x - pad &&
        pt.x <= hb.x + hb.w + pad &&
        pt.y >= hb.y - pad &&
        pt.y <= hb.y + hb.h + pad
      ) {
        matched = id;
        break;
      }
    }

    if (!matched) {
      setActiveDragTarget(null);
      return;
    }

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsPlaying(false);
    hasUserScrubbedRef.current = true;
    setActiveDragTarget(matched);
    dragSessionRef.current = {
      target: matched,
      startCanvasX: pt.x,
      startCanvasY: pt.y,
      startTemplate: { ...templateRef.current },
    };
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const session = dragSessionRef.current;
    if (!dragMode || !session || !onUpdateTemplate) return;
    const pt = clientToCanvasPoint(e.clientX, e.clientY);
    if (!pt) return;

    const gScale = Math.max(0.75, Math.min(1.25, session.startTemplate.globalScale ?? 1));
    const scaleFactor = session.target === 'brand' ? 1 : gScale;
    const dxPct = (((pt.x - session.startCanvasX) / scaleFactor) / canvasW) * 100;
    const dyPct = (((pt.y - session.startCanvasY) / scaleFactor) / canvasH) * 100;
    const clampPct = (v: number, min = 3, max = 97) =>
      Math.round(Math.max(min, Math.min(max, v)) * 10) / 10;

    const base = session.startTemplate;
    let next: TemplateSettings | null = null;

    if (session.target === 'badge') {
      next = {
        ...base,
        badgeX: clampPct((base.badgeX ?? 50) + dxPct, 5, 95),
        badgeY: clampPct((base.badgeY ?? 15) + dyPct, 2, 92),
      };
    } else if (session.target === 'question') {
      next = {
        ...base,
        questionX: clampPct((base.questionX ?? 50) + dxPct, 5, 95),
        questionY: clampPct((base.questionY ?? 28) + dyPct, 5, 95),
      };
    } else if (session.target === 'options') {
      next = {
        ...base,
        optionsX: clampPct((base.optionsX ?? 50) + dxPct, 5, 95),
        optionsStartY: clampPct((base.optionsStartY ?? 48) + dyPct, 8, 92),
      };
    } else if (session.target === 'timer') {
      next = {
        ...base,
        timerPlacement: 'free',
        timerX: clampPct((base.timerX ?? 50) + dxPct, 4, 96),
        timerY: clampPct((base.timerY ?? 41) + dyPct, 4, 96),
      };
    } else if (session.target === 'brand') {
      next = {
        ...base,
        brandLogoPosition: 'custom',
        brandLogoX: clampPct((base.brandLogoX ?? 8) + dxPct, 3, 97),
        brandLogoY: clampPct((base.brandLogoY ?? 6) + dyPct, 3, 97),
      };
    } else if (session.target === 'presenter') {
      if (base.aiPresenter?.enabled && base.aiPresenter?.mediaKey) {
        next = {
          ...base,
          aiPresenter: {
            ...base.aiPresenter,
            placement: 'floating',
            x: clampPct((base.aiPresenter.x ?? 82) + dxPct, 4, 96),
            y: clampPct((base.aiPresenter.y ?? 78) + dyPct, 6, 96),
          },
        };
      } else {
        next = {
          ...base,
          presenterPlacement: 'floating',
          presenterX: clampPct((base.presenterX ?? 16) + dxPct, 4, 96),
          presenterY: clampPct((base.presenterY ?? 80) + dyPct, 6, 96),
        };
      }
    }

    if (next) {
      onUpdateTemplate(next);
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragSessionRef.current) {
      dragSessionRef.current = null;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
    }
  };

  const handleToggleMute = () => {
    void soundEngine.unlock();
    setIsMuted((prev) => {
      const next = !prev;
      if (next) {
        soundEngine.stopBgMusic();
        soundEngine.stopAllSfxAndVoice();
      } else if (isPlayingRef.current) {
        void soundEngine.startBgMusic(audioRef.current.bgMusic);
      }
      return next;
    });
  };

  const jumpToPhase = (
    phase: 'intro' | 'question' | 'opt1' | 'opt4' | 'timer' | 'suspense' | 'reveal' | 'end'
  ) => {
    hasUserScrubbedRef.current = true;
    isExternallySelectedSlideRef.current = false;
    soundEngine.stopAllSfxAndVoice();
    setIsPlaying(false);
    const schedules = computeProjectTimeline(slides, timing, audio, template);
    const sched = schedules[activeSlideIndex] ?? schedules[0];
    if (!sched) return;
    const activeType = slides[activeSlideIndex]?.slideType;
    const lastOptIdx =
      activeType === 'trueFalse' || activeType === 'versus'
        ? 1
        : activeType === 'clues' || activeType === 'multiple3'
          ? 2
          : 3;

    let target = sched.startTime + sched.tQuestionStart + 0.36;
    if (phase === 'intro') {
      target = Math.min(0.45, totalDuration);
    } else if (phase === 'opt1') {
      target = sched.startTime + sched.tOptionStarts[0] + 0.36;
    } else if (phase === 'opt4') {
      target = sched.startTime + sched.tOptionStarts[lastOptIdx] + 0.36;
    } else if (phase === 'timer') {
      target = sched.startTime + sched.tThinkingStart + Math.min(1.1, sched.thinkingDuration * 0.25);
    } else if (phase === 'suspense') {
      target = sched.startTime + sched.tSuspenseStart + Math.min(0.4, (timing.suspenseDuration ?? 1.6) * 0.3);
    } else if (phase === 'reveal') {
      target = sched.startTime + sched.tRevealStart + 0.5;
    } else if (phase === 'end') {
      const contentEnd = getSlidesContentDuration(slides, timing, audio, template);
      target = Math.min(totalDuration, contentEnd + 0.8);
    }

    const clamped = Math.min(totalDuration, target);
    syncTimeUi(clamped, totalDuration, true);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (ctx) {
      drawPreviewFrame(ctx, clamped, slides, template, timing, audio);
    }
  };

  const handleCaptureThumbnail = async () => {
    if (isCapturingThumb) return;
    setIsCapturingThumb(true);
    try {
      const blob = await exportThumbnailJpg(
        slides,
        template,
        timing,
        audio,
        timeRef.current
      );
      if (!blob) return;
      const fileName = `quiz-thumbnail-${Date.now()}.jpg`;
      await saveOrDownloadBlob(blob, fileName, 'image/jpeg');
    } finally {
      setIsCapturingThumb(false);
    }
  };

  const activePhaseId: StagePhaseId | null = computeActivePhaseId(
    currentTime,
    slides,
    template,
    timing,
    audio
  );

  const currentPhaseLabel = (() => {
    if (activePhaseId === 'intro') return 'المقدمة';
    if (activePhaseId === 'end') return 'النهاية';
    if (activePhaseId === 'question') return 'السؤال';
    if (activePhaseId === 'opt1' || activePhaseId === 'opt4') {
      const st = slides[activeSlideIndex]?.slideType;
      return st === 'clues' ? 'ظهور التلميحات' : st === 'versus' ? 'ظهور الطرفين' : 'ظهور الخيارات';
    }
    if (activePhaseId === 'timer') return 'العد التنازلي';
    if (activePhaseId === 'suspense') return 'التشويق';
    if (activePhaseId === 'reveal') return 'كشف الجواب ✓';
    return '';
  })();

  const activeSlideType = slides[activeSlideIndex]?.slideType;
  const phases: {
    id: 'intro' | 'question' | 'opt1' | 'opt4' | 'timer' | 'suspense' | 'reveal' | 'end';
    label: string;
  }[] = [
    ...(template.showIntroHook ? [{ id: 'intro' as const, label: 'المقدمة' }] : []),
    { id: 'question', label: 'السؤال' },
    {
      id: 'opt1',
      label:
        activeSlideType === 'clues'
          ? 'تلميح 1'
          : activeSlideType === 'versus'
            ? 'طرف 1'
            : 'خيار 1',
    },
    {
      id: 'opt4',
      label:
        activeSlideType === 'trueFalse'
          ? 'الخياران'
          : activeSlideType === 'versus'
            ? 'الطرفان'
            : activeSlideType === 'clues'
              ? 'تلميح 3'
              : 'كل الخيارات',
    },
    { id: 'timer', label: 'المؤقت' },
    ...(timing.suspenseDuration > 0 ? [{ id: 'suspense' as const, label: 'التشويق' }] : []),
    { id: 'reveal', label: 'الناتج' },
    ...(template.showEndCard ? [{ id: 'end' as const, label: 'النهاية' }] : []),
  ];

  const isCollapsedMobile = mobileStageMode === 'collapsed';
  const isCompactMobile = mobileStageMode === 'compact';

  return (
    <div
      className={`flex flex-col items-center justify-between w-full ${
        isCollapsedMobile ? 'lg:h-full' : 'h-full'
      } ${isCompactMobile ? 'gap-1.5 py-1.5 px-2.5 lg:gap-2.5 lg:py-3 lg:px-4' : 'gap-2 py-2 px-3 lg:gap-2.5 lg:py-3 lg:px-4'}`}
    >
      {/* Mobile Collapsed Mini Bar */}
      {isCollapsedMobile && onChangeMobileStageMode && (
        <div className="flex lg:hidden items-center justify-between gap-2 w-full px-2.5 py-1.5 rounded-xl bg-[var(--panel)] border border-[var(--pline)]">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={handleTogglePlay}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#00B050] text-white text-[11px] font-bold shrink-0 cursor-pointer"
            >
              {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              <span>{isPlaying ? 'إيقاف' : 'تشغيل'}</span>
            </button>
            <span className="text-[11px] font-bold text-[var(--ptxt)] truncate">
              {currentPhaseLabel || 'معاينة الفيديو'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onChangeMobileStageMode('compact')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7] shrink-0 cursor-pointer"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            <span>إظهار الشاشة</span>
          </button>
        </div>
      )}

      {/* Stage Quick Jump Bar */}
      <div
        className={`${
          isCollapsedMobile ? 'hidden lg:flex' : 'flex'
        } items-center lg:flex-wrap lg:justify-center gap-1 w-full max-w-2xl overflow-x-auto no-scrollbar`}
      >
        <span className="text-[11px] text-[var(--pmuted)] ml-1 whitespace-nowrap shrink-0">
          الانتقال:
        </span>
        {phases.map((p) => {
          const isActivePhase = activePhaseId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => jumpToPhase(p.id)}
              className={`px-2 py-0.5 lg:px-2.5 lg:py-1 text-[11px] font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isActivePhase
                  ? 'bg-[#00B050] text-white border-[#00B050]'
                  : 'bg-[var(--panel)] hover:border-[var(--gold)] text-[var(--ptxt)] border-[var(--pline)]'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Pure Unobstructed Stage Frame: 9:16 Vertical Shorts OR 16:9 Landscape Video */}
      <div
        className={`${
          isCollapsedMobile ? 'hidden lg:flex' : 'flex'
        } relative flex-1 items-center justify-center min-h-0 w-full`}
      >
        <div
          className={`relative rounded-2xl overflow-hidden bg-black border-2 transition-all duration-200 shadow-2xl shadow-black/70 ${
            dragMode ? 'border-[#00B050]' : 'border-[var(--pline)]'
          } ${
            isWide
              ? 'w-full max-w-[780px] max-h-full aspect-video'
              : 'h-full max-h-[650px] aspect-[9/16]'
          }`}
        >
          <canvas
            ref={canvasRef}
            width={canvasW}
            height={canvasH}
            onClick={() => {
              if (!dragMode) handleTogglePlay();
            }}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerCancel={handleCanvasPointerUp}
            className={`w-full h-full object-contain block touch-none ${
              dragMode ? 'cursor-move' : 'cursor-pointer'
            }`}
          />

          {dragMode && (
            <div className="pointer-events-none absolute bottom-2.5 inset-x-2 flex justify-center">
              <span className="px-3 py-1 rounded-lg bg-[#00B050]/95 text-white text-[11px] font-bold shadow-lg">
                اسحب السؤال أو الخيارات أو المذيع أو المؤقت أو الشارة أو الشعار مباشرة
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Clean Single-Truth Bottom Control Dock */}
      <div
        className={`${
          isCollapsedMobile ? 'hidden lg:flex' : 'flex'
        } w-full max-w-2xl bg-[var(--panel)] border border-[var(--pline)] rounded-xl ${
          isCompactMobile ? 'p-2 lg:px-3 lg:py-2.5 gap-1.5 lg:gap-2' : 'px-3 py-2.5 gap-2'
        } flex-col`}
      >
        {/* Row 1: Primary Play CTA + Scrubber + Timecode + Mute + Mobile Mode Controls */}
        <div className="flex items-center gap-2 lg:gap-2.5">
          <button
            type="button"
            onClick={handleTogglePlay}
            className="flex items-center justify-center gap-1.5 h-8 lg:h-9 px-2.5 lg:px-3.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title={isPlaying ? 'إيقاف مؤقت' : 'تشغيل المعاينة'}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isPlaying ? 'إيقاف' : 'تشغيل'}</span>
          </button>

          <input
            ref={rangeInputRef}
            type="range"
            min={0}
            max={Math.max(0.1, totalDuration)}
            step={0.05}
            defaultValue={currentTime}
            onChange={(e) => handleScrub(parseFloat(e.target.value))}
            aria-label="الجدول الزمني للفيديو"
            className="w-full h-1.5 rounded-lg bg-[var(--surface)] cursor-pointer"
          />

          <span
            ref={timeLabelRef}
            className="font-mono-nums text-[11px] lg:text-xs text-[var(--ptxt)] whitespace-nowrap shrink-0"
            dir="ltr"
          >
            {formatTimecode(currentTime)} / {formatTimecode(totalDuration)}
          </span>

          <button
            type="button"
            onClick={handleToggleMute}
            title={isMuted ? 'تشغيل الصوت' : 'كتم الصوت'}
            className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 transition-colors cursor-pointer ${
              isMuted
                ? 'bg-rose-500/15 text-rose-400 border-rose-500/40'
                : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
            }`}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          {/* Mobile compact bar quick controls */}
          {onChangeMobileStageMode && (
            <div className="flex lg:hidden items-center gap-1 shrink-0">
              {onUpdateTemplate && (
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setDragMode((v) => !v);
                    setActiveDragTarget(null);
                  }}
                  title="تحريك حر"
                  className={`w-8 h-8 flex items-center justify-center rounded-lg border cursor-pointer ${
                    dragMode
                      ? 'bg-[#00B050] border-[#00B050] text-white'
                      : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)]'
                  }`}
                >
                  <Move className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  onChangeMobileStageMode(
                    mobileStageMode === 'expanded' ? 'compact' : 'expanded'
                  )
                }
                title={mobileStageMode === 'expanded' ? 'تصغير والعودة للمحرر' : 'تكبير المعاينة'}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-[var(--ptxt)] cursor-pointer"
              >
                {mobileStageMode === 'expanded' ? (
                  <Minimize2 className="w-3.5 h-3.5 text-[#00B050]" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
              {mobileStageMode !== 'expanded' && (
                <button
                  type="button"
                  onClick={() => onChangeMobileStageMode('collapsed')}
                  title="طي الشاشة لتوسيع المحرر"
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-[var(--pmuted)] cursor-pointer"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Row 2: Slide Stepper + Quick Stage Tools */}
        <div
          className={`${
            isCompactMobile ? 'hidden lg:flex' : 'flex'
          } flex-wrap items-center justify-between gap-2 pt-1 border-t border-[var(--pline)]/60`}
        >
          <div className="flex items-center gap-1.5">
            {slides.length > 1 && (
              <div className="flex items-center rounded-lg bg-[var(--surface)] border border-[var(--pline)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleStepSlide(-1)}
                  disabled={activeSlideIndex <= 0}
                  title="السؤال السابق"
                  className="h-8 px-2 text-[var(--ptxt)] hover:bg-[#00B050]/12 disabled:opacity-35 cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <span className="px-1.5 text-[11px] font-mono-nums font-bold text-[var(--pmuted)] whitespace-nowrap">
                  {activeSlideIndex + 1}/{slides.length}
                </span>
                <button
                  type="button"
                  onClick={() => handleStepSlide(1)}
                  disabled={activeSlideIndex >= slides.length - 1}
                  title="السؤال التالي"
                  className="h-8 px-2 text-[var(--ptxt)] hover:bg-[#00B050]/12 disabled:opacity-35 border-r border-[var(--pline)] cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleRestart}
              title="تشغيل الفيديو من البداية"
              className="flex items-center gap-1 h-8 px-2.5 rounded-lg bg-[var(--surface)] hover:border-[var(--gold)] text-[var(--ptxt)] border border-[var(--pline)] text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">من الأول</span>
            </button>

            <button
              type="button"
              onClick={handlePlayCurrentSlide}
              title="تشغيل السؤال الحالي من بدايته"
              className="h-8 px-2.5 rounded-lg bg-[var(--surface)] hover:border-[#00B050] text-[var(--ptxt)] border border-[var(--pline)] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              السؤال الحالي
            </button>

            {currentPhaseLabel && (
              <span className="hidden sm:inline-block text-[11px] font-semibold text-[var(--gold)] whitespace-nowrap pr-1">
                · {currentPhaseLabel}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {onToggleAspectRatio && (
              <button
                type="button"
                onClick={onToggleAspectRatio}
                title="تبديل أبعاد الفيديو بين شورتس 9:16 وفيديو طويل 16:9"
                className={`flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isWide
                    ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                    : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
                }`}
              >
                {isWide ? <Monitor className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
                <span>{isWide ? '16:9' : '9:16'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onCycleChannelTheme}
              title="تبديل سريع لثيم القناة"
              className="flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold bg-[var(--surface)] border border-[var(--pline)] text-[var(--sand)] hover:border-[var(--gold)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Palette className="w-3.5 h-3.5" />
              <span>الثيم</span>
            </button>

            <button
              type="button"
              onClick={() => void handleCaptureThumbnail()}
              disabled={isCapturingThumb}
              title="حفظ اللقطة الحالية كصورة غلاف JPG بدقة عالية"
              className="flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold bg-[var(--surface)] border border-[var(--pline)] text-[var(--ptxt)] hover:border-[#00B050] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5 text-[#00B050]" />
              <span>{isCapturingThumb ? 'جارٍ الحفظ...' : 'غلاف JPG'}</span>
            </button>

            {onUpdateTemplate && (
              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setDragMode((v) => !v);
                  setActiveDragTarget(null);
                }}
                title="سحب وتحريك أي عنصر مباشرة على الشاشة"
                className={`flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  dragMode
                    ? 'bg-[#00B050] border-[#00B050] text-white'
                    : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[#00B050]'
                }`}
              >
                <Move className="w-3.5 h-3.5" />
                <span>تحريك حر</span>
              </button>
            )}

            <button
              type="button"
              onClick={onToggleSafeGuides}
              title="إظهار حدود أزرار يوتيوب"
              className={`flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                template.showSafeGuides
                  ? 'bg-[#d4a73a]/20 border-[#d4a73a] text-[#EDD6A2]'
                  : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--pmuted)] hover:text-[var(--ptxt)]'
              }`}
            >
              <Scan className="w-3.5 h-3.5" />
              <span>حدود الأمان</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
