import {
  AudioSettings,
  AudioSlotConfig,
  AudioSlotId,
  BuiltInSfxId,
  QuestionSlide,
  SlideAudioClip,
  TemplateSettings,
  TimingSettings,
  computeProjectTimeline,
  getEndCardDuration,
  getIntroHookDuration,
  getSlidesContentDuration,
  getTotalDuration,
} from '../types/quiz';
import {
  decodeAiPresenterAudioBuffer,
  getAiPresenterPlaybackWindows,
} from '../canvas/aiPresenterMedia';

export const BUILTIN_SFX_OPTIONS: { id: BuiltInSfxId; label: string }[] = [
  { id: 'none', label: 'بدون صوت' },
  { id: 'softPop', label: 'فقاعة القناة (Pop)' },
  { id: 'whoosh', label: 'سحب هوائي (Whoosh)' },
  { id: 'click', label: 'نقرة احترافية (Click)' },
  { id: 'channelTick', label: 'تكتكة العداد الكلاسيكي (القناة)' },
  { id: 'tick', label: 'تكتكة ساعة خفيفة (Tick)' },
  { id: 'suspenseRiser', label: 'تشويق قبل الجواب (نبض + تصاعد)' },
  { id: 'chime', label: 'رنة تنبيه لطيفة (Chime)' },
  { id: 'successFanfare', label: 'نغمة الإجابة الصحيحة (Success)' },
  { id: 'calmPulse', label: 'نبضة موسيقية هادئة' },
];

export interface RenderedExportAudio {
  buffer: AudioBuffer;
  speechIntervals: Array<{ start: number; end: number }>;
}

interface ScheduledVoiceItem {
  start: number;
  buffer: AudioBuffer;
  volume: number;
  maxEnd: number;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private ctxCaches = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
  private bgNodes = new WeakMap<BaseAudioContext, { gain: GainNode; baseVolume: number }>();
  private decodedDurations = new Map<string, number>();
  private activeSfxSources = new Set<AudioBufferSourceNode>();
  private activeVoiceSource: AudioBufferSourceNode | null = null;
  private activeVoiceGain: GainNode | null = null;
  private activeBgSource: AudioBufferSourceNode | null = null;
  private activeBgGain: GainNode | null = null;

  private getCacheForContext(ctx: BaseAudioContext): Map<string, AudioBuffer> {
    let map = this.ctxCaches.get(ctx);
    if (!map) {
      map = new Map<string, AudioBuffer>();
      this.ctxCaches.set(ctx, map);
    }
    return map;
  }

  private trackSourceIfPreview(
    ctx: BaseAudioContext,
    src: AudioBufferSourceNode,
    channel: 'sfx' | 'voice' = 'sfx',
    gainNode?: GainNode
  ): void {
    if (ctx !== this.ctx) return;

    if (channel === 'voice') {
      this.stopActiveVoice();
      this.activeVoiceSource = src;
      this.activeVoiceGain = gainNode ?? null;
      src.onended = () => {
        if (this.activeVoiceSource === src) {
          this.activeVoiceSource = null;
          this.activeVoiceGain = null;
        }
      };
      return;
    }

    this.activeSfxSources.add(src);
    src.onended = () => {
      this.activeSfxSources.delete(src);
    };
  }

  public stopActiveVoice(): void {
    if (this.activeVoiceSource) {
      try {
        this.activeVoiceSource.stop();
        this.activeVoiceSource.disconnect();
      } catch {
        // already stopped
      }
      this.activeVoiceSource = null;
    }
    if (this.activeVoiceGain) {
      try {
        this.activeVoiceGain.disconnect();
      } catch {
        // already disconnected
      }
      this.activeVoiceGain = null;
    }
  }

  private activeSfxGains = new Set<GainNode>();

  public stopAllSfxAndVoice(): void {
    this.stopActiveVoice();
    this.activeSfxSources.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // already stopped
      }
    });
    this.activeSfxSources.clear();
    this.activeSfxGains.forEach((g) => {
      try {
        g.gain.cancelScheduledValues(0);
        g.gain.setValueAtTime(0.0001, this.ctx?.currentTime ?? 0);
        g.disconnect();
      } catch {
        // already disconnected
      }
    });
    this.activeSfxGains.clear();
  }

  private mergeDuckIntervals(
    intervals: Array<{ start: number; end: number }>
  ): Array<{ start: number; end: number }> {
    const sorted = [...intervals]
      .filter((iv) => Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end > iv.start + 0.05)
      .sort((a, b) => a.start - b.start);
    if (sorted.length === 0) return [];

    const merged: Array<{ start: number; end: number }> = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = sorted[i];
      if (curr.start <= prev.end + 0.18) {
        prev.end = Math.max(prev.end, curr.end);
      } else {
        merged.push({ ...curr });
      }
    }
    return merged;
  }

  public scheduleBgDuckIntervals(
    ctx: BaseAudioContext,
    intervals: Array<{ start: number; end: number }>,
    audioStartTime: number,
    duckRatio = 0.22,
    maxAbsoluteEnd?: number
  ): void {
    const bgEntry = this.bgNodes.get(ctx);
    if (!bgEntry || bgEntry.baseVolume <= 0.001 || intervals.length === 0) return;

    const merged = this.mergeDuckIntervals(intervals);
    if (merged.length === 0) return;

    const gainParam = bgEntry.gain.gain;
    const base = bgEntry.baseVolume;
    const target = Math.max(0.01, base * Math.max(0.05, Math.min(0.8, duckRatio)));
    const hardLimit = maxAbsoluteEnd ?? Infinity;

    try {
      gainParam.cancelScheduledValues(audioStartTime);
      gainParam.setValueAtTime(base, audioStartTime);
      let lastScheduledTime = audioStartTime;
      for (const iv of merged) {
        const tStart = Math.max(lastScheduledTime + 0.02, ctx.currentTime, audioStartTime + iv.start);
        if (tStart >= hardLimit - 0.14) break;
        const fadeDownStart = Math.max(lastScheduledTime + 0.005, tStart - 0.04);
        const rampDownAt = Math.max(fadeDownStart + 0.02, tStart + 0.04);
        const rawEnd = Math.max(rampDownAt + 0.04, audioStartTime + iv.end);
        const tEnd = Math.min(hardLimit - 0.05, rawEnd);
        const holdUntil = Math.max(rampDownAt + 0.01, tEnd - 0.03);
        const recoverAt = Math.min(hardLimit, holdUntil + 0.18);
        if (recoverAt <= fadeDownStart + 0.04) break;

        gainParam.setValueAtTime(base, fadeDownStart);
        gainParam.linearRampToValueAtTime(target, rampDownAt);
        gainParam.setValueAtTime(target, holdUntil);
        gainParam.linearRampToValueAtTime(base, recoverAt);
        lastScheduledTime = recoverAt;
      }
    } catch {
      // ignore scheduling errors
    }
  }

  public duckBgMusic(
    ctxOverride: BaseAudioContext | undefined,
    speechDurationSec: number,
    duckRatio = 0.22
  ): void {
    const ctx = ctxOverride ?? this.ctx;
    if (!ctx) return;
    const bgEntry = this.bgNodes.get(ctx);
    if (!bgEntry || bgEntry.baseVolume <= 0.001) return;

    const now = ctx.currentTime;
    const dur = Math.max(0.35, speechDurationSec);
    const targetGain = Math.max(0.01, bgEntry.baseVolume * Math.max(0.05, Math.min(0.8, duckRatio)));
    const gainParam = bgEntry.gain.gain;

    try {
      gainParam.cancelScheduledValues(now);
      gainParam.setValueAtTime(gainParam.value, now);
      gainParam.linearRampToValueAtTime(targetGain, now + 0.08);
      gainParam.setValueAtTime(targetGain, now + Math.max(0.1, dur - 0.05));
      gainParam.linearRampToValueAtTime(bgEntry.baseVolume, now + dur + 0.22);
    } catch {
      // ignore scheduling errors
    }
  }

  private getDataUrlKey(dataUrl: string): string {
    return `${dataUrl.slice(0, 64)}:${dataUrl.length}:${dataUrl.slice(-24)}`;
  }

  public getContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public async getAudioDuration(dataUrl: string): Promise<number> {
    try {
      const buf = await this.decodeDataUrl(dataUrl);
      if (buf && Number.isFinite(buf.duration) && buf.duration > 0) {
        return buf.duration;
      }
    } catch {
      // fall through to metadata/header fallback
    }

    const metaDuration = await new Promise<number>((resolve) => {
      let settled = false;
      const done = (val: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(val);
      };
      const timer = setTimeout(() => done(0), 2500);
      const el = document.createElement('audio');
      el.preload = 'metadata';
      el.onloadedmetadata = () => {
        const dur = Number.isFinite(el.duration) ? el.duration : 0;
        done(dur);
      };
      el.onerror = () => done(0);
      el.src = dataUrl;
    });

    if (metaDuration > 0) return metaDuration;

    if (dataUrl.startsWith('data:audio/wav;base64,')) {
      const base64Len = dataUrl.length - 'data:audio/wav;base64,'.length;
      const byteLen = Math.max(0, Math.floor((base64Len * 3) / 4) - 44);
      if (byteLen > 0) {
        return Math.max(0.5, byteLen / 48000);
      }
    }
    return 0;
  }

  public async decodeDataUrl(
    dataUrl: string,
    targetCtx?: BaseAudioContext
  ): Promise<AudioBuffer | null> {
    const ctx = targetCtx ?? this.getContext();
    const cache = this.getCacheForContext(ctx);
    const cacheKey = this.getDataUrlKey(dataUrl);
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) ?? null;
    }
    try {
      const response = await fetch(dataUrl);
      const arrayBuffer = await response.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      cache.set(cacheKey, decoded);
      if (Number.isFinite(decoded.duration) && decoded.duration > 0) {
        this.decodedDurations.set(cacheKey, decoded.duration);
      }
      return decoded;
    } catch {
      return null;
    }
  }

  public getExactDuration(dataUrl: string | undefined, fallback: number): number {
    if (!dataUrl) return fallback;
    const d = this.decodedDurations.get(this.getDataUrlKey(dataUrl));
    return d && Number.isFinite(d) && d > 0 ? d : fallback;
  }

  public async preloadAllAudio(
    audio: AudioSettings,
    slides: QuestionSlide[] = [],
    targetCtx?: BaseAudioContext,
    template?: TemplateSettings
  ): Promise<void> {
    const slots: AudioSlotId[] = [
      'questionEnter',
      'optionEnter',
      'countdownTick',
      'suspense',
      'correctReveal',
      'bgMusic',
    ];
    const tasks: Promise<unknown>[] = slots.map(async (slot) => {
      const cfg = audio[slot];
      if (cfg && cfg.sourceType === 'custom' && cfg.customDataUrl) {
        await this.decodeDataUrl(cfg.customDataUrl, targetCtx);
      }
    });

    if (template?.introHookAudio?.dataUrl) {
      tasks.push(this.decodeDataUrl(template.introHookAudio.dataUrl, targetCtx));
    }
    if (template?.endCardAudio?.dataUrl) {
      tasks.push(this.decodeDataUrl(template.endCardAudio.dataUrl, targetCtx));
    }

    for (const slide of slides) {
      if (slide.voiceover?.question?.dataUrl) {
        tasks.push(this.decodeDataUrl(slide.voiceover.question.dataUrl, targetCtx));
      }
      if (slide.voiceover?.answer?.dataUrl) {
        tasks.push(this.decodeDataUrl(slide.voiceover.answer.dataUrl, targetCtx));
      }
      slide.voiceover?.options?.forEach((clip) => {
        if (clip?.dataUrl) {
          tasks.push(this.decodeDataUrl(clip.dataUrl, targetCtx));
        }
      });
    }

    await Promise.all(tasks);
  }

  public async syncProjectAudioDurations(
    slides: QuestionSlide[],
    audio: AudioSettings,
    template: TemplateSettings,
    targetCtx?: BaseAudioContext
  ): Promise<{ slides: QuestionSlide[]; audio: AudioSettings; template: TemplateSettings }> {
    await this.preloadAllAudio(audio, slides, targetCtx, template);

    const syncClip = (clip?: SlideAudioClip): SlideAudioClip | undefined => {
      if (!clip?.dataUrl) return clip;
      const exact = this.getExactDuration(clip.dataUrl, clip.duration);
      return Math.abs(exact - clip.duration) > 0.01 ? { ...clip, duration: exact } : clip;
    };

    const syncedSlides: QuestionSlide[] = slides.map((s) => {
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
            SlideAudioClip | undefined,
            SlideAudioClip | undefined,
            SlideAudioClip | undefined,
            SlideAudioClip | undefined
          ])
        : undefined;
      return {
        ...s,
        voiceover: {
          ...s.voiceover,
          question: q,
          answer: ans,
          options: opts,
        },
      };
    });

    const syncSlot = (cfg: AudioSlotConfig): AudioSlotConfig => {
      if (cfg.sourceType !== 'custom' || !cfg.customDataUrl) return cfg;
      const exact = this.getExactDuration(cfg.customDataUrl, cfg.duration ?? 0);
      return exact > 0 ? { ...cfg, duration: exact } : cfg;
    };

    const syncedAudio: AudioSettings = {
      questionEnter: syncSlot(audio.questionEnter),
      optionEnter: syncSlot(audio.optionEnter),
      countdownTick: syncSlot(audio.countdownTick),
      suspense: syncSlot(audio.suspense),
      correctReveal: syncSlot(audio.correctReveal),
      bgMusic: syncSlot(audio.bgMusic),
    };

    const syncedTemplate: TemplateSettings =
      template.introHookAudio?.dataUrl || template.endCardAudio?.dataUrl
        ? {
            ...template,
            ...(template.introHookAudio?.dataUrl
              ? { introHookAudio: syncClip(template.introHookAudio) }
              : {}),
            ...(template.endCardAudio?.dataUrl
              ? { endCardAudio: syncClip(template.endCardAudio) }
              : {}),
          }
        : template;

    return {
      slides: syncedSlides,
      audio: syncedAudio,
      template: syncedTemplate,
    };
  }

  private scheduleBufferWithEnvelope(
    ctx: BaseAudioContext,
    buffer: AudioBuffer,
    volume: number,
    destination: AudioNode,
    startTime: number,
    maxEndTime?: number,
    trackChannel?: 'sfx' | 'voice'
  ): void {
    const start = Math.max(ctx.currentTime, startTime);
    const naturalEnd = start + buffer.duration;
    const clampedEnd =
      maxEndTime !== undefined ? Math.min(naturalEnd, Math.max(start + 0.03, maxEndTime)) : naturalEnd;
    if (clampedEnd <= start + 0.015) return;

    try {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, start);

      // Smooth micro fade-out when truncated before buffer's natural end so clicks/bleed never occur
      if (maxEndTime !== undefined && clampedEnd < naturalEnd - 0.01) {
        const fadeDur = Math.min(0.035, (clampedEnd - start) * 0.4);
        const fadeStart = Math.max(start, clampedEnd - fadeDur);
        gain.gain.setValueAtTime(volume, fadeStart);
        gain.gain.linearRampToValueAtTime(0.0001, clampedEnd);
      }

      src.connect(gain);
      gain.connect(destination);
      if (trackChannel) {
        this.trackSourceIfPreview(ctx, src, trackChannel, gain);
      }
      src.start(start);
      if (clampedEnd < naturalEnd + 0.02) {
        src.stop(clampedEnd + 0.005);
      }
    } catch {
      // ignore invalid scheduling window
    }
  }

  public async playClip(
    clip: SlideAudioClip,
    volume = 1,
    destination?: AudioNode,
    ctxOverride?: BaseAudioContext,
    when?: number,
    channel: 'voice' | 'sfx' = 'voice',
    maxDurationSec?: number
  ): Promise<void> {
    if (volume <= 0.001 || !clip.dataUrl) return;
    const ctx = ctxOverride ?? this.getContext();
    const dest = destination ?? ctx.destination;
    const cache = this.getCacheForContext(ctx);
    const cached = cache.get(this.getDataUrlKey(clip.dataUrl));
    const buffer = cached ?? (await this.decodeDataUrl(clip.dataUrl, ctx));
    if (!buffer) return;

    const startTime = Math.max(ctx.currentTime, when ?? ctx.currentTime);
    const maxEnd = maxDurationSec !== undefined ? startTime + maxDurationSec : undefined;
    this.scheduleBufferWithEnvelope(ctx, buffer, volume, dest, startTime, maxEnd, channel);
  }

  public playBufferSlice(
    buffer: AudioBuffer,
    volume: number,
    offsetSec: number,
    durationSec: number,
    destination?: AudioNode,
    ctxOverride?: BaseAudioContext,
    when?: number,
    channel: 'voice' | 'sfx' = 'voice'
  ): AudioBufferSourceNode | null {
    if (volume <= 0.001 || durationSec <= 0.03) return null;
    const ctx = ctxOverride ?? this.getContext();
    const dest = destination ?? ctx.destination;
    const start = Math.max(ctx.currentTime, when ?? ctx.currentTime);
    const safeOffset = Math.max(0, Math.min(Math.max(0, buffer.duration - 0.04), offsetSec));
    const safeDur = Math.max(0.03, Math.min(durationSec, buffer.duration - safeOffset));
    try {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, start);
      const fadeDur = Math.min(0.035, safeDur * 0.25);
      gain.gain.setValueAtTime(volume, Math.max(start, start + safeDur - fadeDur));
      gain.gain.linearRampToValueAtTime(0.0001, start + safeDur);
      src.connect(gain);
      gain.connect(dest);
      if (channel) {
        this.trackSourceIfPreview(ctx, src, channel, gain);
      }
      src.start(start, safeOffset, safeDur);
      src.stop(start + safeDur + 0.01);
      return src;
    } catch {
      return null;
    }
  }

  public async playSlot(
    config: AudioSlotConfig,
    destination?: AudioNode,
    ctxOverride?: BaseAudioContext,
    when?: number,
    urgent = false,
    maxDurationSec?: number,
    suspenseDurationSec?: number
  ): Promise<void> {
    if (!config || config.volume <= 0.001) return;
    const ctx = ctxOverride ?? this.getContext();
    const dest = destination ?? ctx.destination;

    if (config.sourceType === 'custom' && config.customDataUrl) {
      const cache = this.getCacheForContext(ctx);
      const cached = cache.get(this.getDataUrlKey(config.customDataUrl));
      const buffer = cached ?? (await this.decodeDataUrl(config.customDataUrl, ctx));
      if (buffer) {
        const startTime = Math.max(ctx.currentTime, when ?? ctx.currentTime);
        const maxEnd = maxDurationSec !== undefined ? startTime + maxDurationSec : undefined;
        this.scheduleBufferWithEnvelope(ctx, buffer, config.volume, dest, startTime, maxEnd, 'sfx');
        return;
      }
    }

    const startTime = Math.max(ctx.currentTime, when ?? ctx.currentTime);
    this.playBuiltInSfx(
      config.builtinId,
      config.volume,
      ctx,
      dest,
      startTime,
      urgent,
      suspenseDurationSec,
      maxDurationSec
    );
  }

  public async startBgMusic(
    config: AudioSlotConfig,
    destination?: AudioNode,
    ctxOverride?: BaseAudioContext
  ): Promise<AudioBufferSourceNode | null> {
    this.stopBgMusic();
    if (!config || config.volume <= 0.001) return null;
    if (config.sourceType !== 'custom' || !config.customDataUrl) {
      return null;
    }

    const ctx = ctxOverride ?? this.getContext();
    const dest = destination ?? ctx.destination;
    const buffer = await this.decodeDataUrl(config.customDataUrl, ctx);
    if (!buffer) return null;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(config.volume, ctx.currentTime);
    src.connect(gain);
    gain.connect(dest);
    src.start(ctx.currentTime);

    this.bgNodes.set(ctx, { gain, baseVolume: config.volume });

    if (!ctxOverride) {
      this.activeBgSource = src;
      this.activeBgGain = gain;
    }
    return src;
  }

  public stopBgMusic(): void {
    if (this.ctx) {
      this.bgNodes.delete(this.ctx);
    }
    if (this.activeBgSource) {
      try {
        this.activeBgSource.stop();
        this.activeBgSource.disconnect();
      } catch {
        // already stopped
      }
      this.activeBgSource = null;
    }
    if (this.activeBgGain) {
      this.activeBgGain.disconnect();
      this.activeBgGain = null;
    }
  }

  public playBuiltInSfx(
    id: BuiltInSfxId,
    volume: number,
    ctx: BaseAudioContext,
    dest: AudioNode,
    now: number,
    urgent = false,
    suspenseDurationSec = 1.6,
    maxDurationSec?: number
  ): void {
    if (id === 'none' || volume <= 0.001) return;

    // Route through a dedicated envelope gate when bounded OR in preview so nothing bleeds past phase boundary
    let targetDest: AudioNode = dest;
    if (maxDurationSec !== undefined || ctx === this.ctx) {
      const gate = ctx.createGain();
      gate.gain.setValueAtTime(1, now);
      if (maxDurationSec !== undefined && Number.isFinite(maxDurationSec)) {
        const safeMax = Math.max(0.05, maxDurationSec);
        const fadeStart = Math.max(now, now + safeMax - Math.min(0.035, safeMax * 0.3));
        gate.gain.setValueAtTime(1, fadeStart);
        gate.gain.linearRampToValueAtTime(0.0001, now + safeMax);
      }
      gate.connect(dest);
      targetDest = gate;
      if (ctx === this.ctx) {
        this.activeSfxGains.add(gate);
        window.setTimeout(() => {
          this.activeSfxGains.delete(gate);
          try {
            gate.disconnect();
          } catch {
            // ignore
          }
        }, Math.ceil((maxDurationSec ?? 1.8) * 1000) + 120);
      }
    }

    switch (id) {
      case 'softPop': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.exponentialRampToValueAtTime(860, now + 0.12);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(volume * 0.36, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.connect(gain);
        gain.connect(targetDest);
        osc.start(now);
        osc.stop(now + 0.16);
        break;
      }

      case 'click': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(920, now);
        osc.frequency.exponentialRampToValueAtTime(340, now + 0.045);
        gain.gain.setValueAtTime(volume * 0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.connect(gain);
        gain.connect(targetDest);
        osc.start(now);
        osc.stop(now + 0.07);
        break;
      }

      case 'channelTick': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(urgent ? 1500 : 1000, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(volume * 0.18, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
        osc.connect(gain);
        gain.connect(targetDest);
        osc.start(now);
        osc.stop(now + 0.085);
        break;
      }

      case 'tick': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(urgent ? 1350 : 1150, now);
        osc.frequency.exponentialRampToValueAtTime(750, now + 0.03);
        gain.gain.setValueAtTime(volume * 0.32, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
        osc.connect(gain);
        gain.connect(targetDest);
        osc.start(now);
        osc.stop(now + 0.055);
        break;
      }

      case 'suspenseRiser': {
        const susDur = Math.max(0.35, Math.min(4.0, suspenseDurationSec || 1.6));
        const endT = now + Math.max(0.28, susDur - 0.04);
        const riser = ctx.createOscillator();
        const riserGain = ctx.createGain();
        riser.type = 'sawtooth';
        riser.frequency.setValueAtTime(180, now);
        riser.frequency.exponentialRampToValueAtTime(900, endT);
        riserGain.gain.setValueAtTime(0.0001, now);
        riserGain.gain.exponentialRampToValueAtTime(volume * 0.16, now + 0.04);
        riserGain.gain.setValueAtTime(volume * 0.14, Math.max(now + 0.06, endT - 0.08));
        riserGain.gain.exponentialRampToValueAtTime(0.0001, endT);
        riser.connect(riserGain);
        riserGain.connect(targetDest);
        riser.start(now);
        riser.stop(endT + 0.02);

        const pulseCount = Math.max(2, Math.floor((susDur - 0.08) / 0.25));
        for (let k = 0; k < pulseCount; k++) {
          const t = now + k * 0.25;
          if (t + 0.17 > endT) break;
          const thump = ctx.createOscillator();
          const thumpGain = ctx.createGain();
          thump.type = 'sine';
          thump.frequency.setValueAtTime(90, t);
          thumpGain.gain.setValueAtTime(0.0001, t);
          thumpGain.gain.exponentialRampToValueAtTime(volume * 0.42, t + 0.015);
          thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
          thump.connect(thumpGain);
          thumpGain.connect(targetDest);
          thump.start(t);
          thump.stop(t + 0.17);
        }
        break;
      }

      case 'whoosh': {
        const bufferSize = Math.floor(ctx.sampleRate * 0.28);
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.setValueAtTime(2.2, now);
        filter.frequency.setValueAtTime(260, now);
        filter.frequency.exponentialRampToValueAtTime(2200, now + 0.18);
        filter.frequency.exponentialRampToValueAtTime(480, now + 0.28);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(volume * 0.45, now + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(targetDest);
        noise.start(now);
        noise.stop(now + 0.29);
        break;
      }

      case 'chime': {
        const freqs = [523.25, 659.25];
        freqs.forEach((f, idx) => {
          const t = now + idx * 0.09;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(f, t);
          gain.gain.setValueAtTime(0.001, t);
          gain.gain.linearRampToValueAtTime(volume * 0.35, t + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
          osc.connect(gain);
          gain.connect(targetDest);
          osc.start(t);
          osc.stop(t + 0.4);
        });
        break;
      }

      case 'successFanfare': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, idx) => {
          const t = now + idx * 0.1;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, t);
          gain.gain.setValueAtTime(0.001, t);
          gain.gain.linearRampToValueAtTime(volume * 0.32, t + 0.018);
          gain.gain.exponentialRampToValueAtTime(0.001, t + (idx === 3 ? 0.55 : 0.38));
          osc.connect(gain);
          gain.connect(targetDest);
          osc.start(t);
          osc.stop(t + 0.58);
        });
        break;
      }

      case 'calmPulse': {
        const freqs = [293.66, 440];
        freqs.forEach((f) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(f, now);
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(volume * 0.2, now + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
          osc.connect(gain);
          gain.connect(targetDest);
          osc.start(now);
          osc.stop(now + 0.48);
        });
        break;
      }
    }
  }

  /**
   * Sample-accurate offline mixdown for video export.
   * Eliminates timer drift and prevents voiceovers, countdown ticks, suspense,
   * reveal chimes, and background music from colliding or bleeding across phases.
   */
  public async renderOfflineExportMix(
    slides: QuestionSlide[],
    template: TemplateSettings,
    timing: TimingSettings,
    audio: AudioSettings,
    sampleRate = 48000
  ): Promise<RenderedExportAudio | null> {
    if (typeof OfflineAudioContext === 'undefined') {
      return null;
    }

    const totalDuration = Math.max(0.5, getTotalDuration(slides, timing, audio, template));
    let offline: OfflineAudioContext;
    try {
      const totalSamples = Math.ceil((totalDuration + 0.15) * sampleRate);
      offline = new OfflineAudioContext(2, totalSamples, sampleRate);
    } catch {
      const fallbackRate = 44100;
      const totalSamples = Math.ceil((totalDuration + 0.15) * fallbackRate);
      offline = new OfflineAudioContext(2, totalSamples, fallbackRate);
    }

    // Master Limiter prevents transient summing distortion when SFX + music coincide
    const limiter = offline.createDynamicsCompressor();
    limiter.threshold.setValueAtTime(-3, 0);
    limiter.knee.setValueAtTime(6, 0);
    limiter.ratio.setValueAtTime(8, 0);
    limiter.attack.setValueAtTime(0.003, 0);
    limiter.release.setValueAtTime(0.12, 0);
    limiter.connect(offline.destination);

    // Decode all custom clips directly inside OfflineAudioContext (auto-resamples cleanly)
    await this.preloadAllAudio(audio, slides, offline, template);
    const cache = this.getCacheForContext(offline);
    const lookupBuf = (dataUrl?: string): AudioBuffer | null => {
      if (!dataUrl) return null;
      return cache.get(this.getDataUrlKey(dataUrl)) ?? null;
    };

    const schedules = computeProjectTimeline(slides, timing, audio, template);
    const voiceQueue: ScheduledVoiceItem[] = [];
    const speechIntervals: Array<{ start: number; end: number }> = [];

    const introDur = getIntroHookDuration(template, timing);
    if (introDur > 0 && slides.length > 0) {
      const endBound = Math.min(totalDuration, schedules[0]?.startTime ?? introDur);
      const hookSfx = template.introHookSfx ?? 'whoosh';
      const hookBuf = lookupBuf(template.introHookAudio?.dataUrl);
      if (hookSfx && hookSfx !== 'none' && !hookBuf) {
        this.playBuiltInSfx(
          hookSfx,
          0.72,
          offline,
          limiter,
          0,
          false,
          1.6,
          Math.max(0.15, endBound - 0.02)
        );
      }
      if (hookBuf) {
        if (hookSfx && hookSfx !== 'none') {
          this.playBuiltInSfx(hookSfx, 0.42, offline, limiter, 0, false, 1.6, Math.min(0.28, endBound - 0.02));
        }
        voiceQueue.push({
          start: 0,
          buffer: hookBuf,
          volume: 1,
          maxEnd: endBound - 0.02,
        });
      }
    }

    const urgentThreshold = Math.max(1, Math.min(10, template?.timerUrgentThreshold ?? 3));

    for (let idx = 0; idx < schedules.length; idx++) {
      const sched = schedules[idx];
      const slide = slides[sched.slideIndex];
      const base = sched.startTime;
      const nextSlideStart =
        idx < schedules.length - 1 ? schedules[idx + 1].startTime : totalDuration;

      const tQ = base + sched.tQuestionStart;
      const opt0Time = base + sched.tOptionStarts[0];
      const tThink = base + sched.tThinkingStart;
      const tSus = base + sched.tSuspenseStart;
      const tReveal = base + sched.tRevealStart;

      // 1. Question enter: monophonic voiceover (bounded before countdown ticks!) OR short SFX
      const qBuf = lookupBuf(slide?.voiceover?.question?.dataUrl);
      const optCount =
        slide?.slideType === 'trueFalse' || slide?.slideType === 'versus'
          ? 2
          : slide?.slideType === 'clues' || slide?.slideType === 'multiple3'
            ? 3
            : 4;
      const hasAnyOptVoice = Array.from({ length: optCount }).some((_, oi) =>
        Boolean(lookupBuf(slide?.voiceover?.options?.[oi]?.dataUrl))
      );
      if (qBuf) {
        const qBound = hasAnyOptVoice
          ? Math.max(tQ + 0.15, opt0Time - 0.02)
          : Math.max(tQ + 0.15, tThink - 0.03);
        voiceQueue.push({
          start: tQ,
          buffer: qBuf,
          volume: 1,
          maxEnd: Math.min(nextSlideStart - 0.02, qBound),
        });
      } else {
        this.scheduleSlotInOffline(
          offline,
          limiter,
          audio.questionEnter,
          lookupBuf(audio.questionEnter.customDataUrl),
          tQ,
          Math.max(tQ + 0.15, opt0Time - 0.02),
          false,
          timing.suspenseDuration
        );
      }

      // 2. Options enter: strictly non-overlapping voiceover per option OR short SFX
      let optVoiceCursor = opt0Time;
      for (let oIdx = 0; oIdx < optCount; oIdx++) {
        const tOpt = base + sched.tOptionStarts[oIdx];
        const sameAsPrev =
          oIdx > 0 && Math.abs(sched.tOptionStarts[oIdx] - sched.tOptionStarts[oIdx - 1]) < 0.01;
        // Find the next distinct phase/row start strictly after tOpt (fixes rowByRow where opt 0 & 1 share t0)
        let groupEndBoundary = tThink;
        for (let k = oIdx + 1; k < optCount; k++) {
          const cand = base + sched.tOptionStarts[k];
          if (cand > tOpt + 0.01) {
            groupEndBoundary = cand;
            break;
          }
        }
        const oBuf = lookupBuf(slide?.voiceover?.options?.[oIdx]?.dataUrl);
        if (oBuf) {
          const actualStart = Math.max(tOpt, optVoiceCursor);
          const maxBound = Math.min(
            nextSlideStart - 0.03,
            Math.max(actualStart + 0.15, groupEndBoundary - 0.02)
          );
          if (actualStart < maxBound - 0.04) {
            voiceQueue.push({
              start: actualStart,
              buffer: oBuf,
              volume: 1,
              maxEnd: maxBound,
            });
            optVoiceCursor = Math.min(maxBound, actualStart + oBuf.duration + 0.04);
          }
        } else if (!sameAsPrev) {
          this.scheduleSlotInOffline(
            offline,
            limiter,
            audio.optionEnter,
            lookupBuf(audio.optionEnter.customDataUrl),
            tOpt,
            Math.max(tOpt + 0.15, groupEndBoundary - 0.02),
            false,
            timing.suspenseDuration
          );
        }
      }

      // 3. Countdown ticks: strictly bounded so ticks never overlap each other or bleed into suspense
      const totalTicks = Math.floor(sched.thinkingDuration);
      const tickBuf = lookupBuf(audio.countdownTick.customDataUrl);
      for (let sec = 0; sec < totalTicks; sec++) {
        const tTick = tThink + sec;
        const tickSecond = totalTicks - sec;
        const nextTickOrSus = Math.min(tTick + 0.88, tSus - 0.02);
        this.scheduleSlotInOffline(
          offline,
          limiter,
          audio.countdownTick,
          tickBuf,
          tTick,
          Math.max(tTick + 0.08, nextTickOrSus),
          tickSecond <= urgentThreshold,
          timing.suspenseDuration
        );
      }

      // 4. Suspense: duration-matched synth OR custom clip trimmed cleanly before reveal
      const susDur = Math.max(0, timing.suspenseDuration ?? 0);
      if (susDur > 0) {
        this.scheduleSlotInOffline(
          offline,
          limiter,
          audio.suspense,
          lookupBuf(audio.suspense.customDataUrl),
          tSus,
          Math.max(tSus + 0.15, tReveal - 0.02),
          false,
          susDur
        );
      }

      // 5. Correct Answer Reveal: voiceover OR fanfare, strictly bounded before next slide
      const ansBuf = lookupBuf(slide?.voiceover?.answer?.dataUrl);
      if (ansBuf) {
        voiceQueue.push({
          start: tReveal,
          buffer: ansBuf,
          volume: 1,
          maxEnd: Math.min(totalDuration, nextSlideStart - 0.02),
        });
      } else {
        this.scheduleSlotInOffline(
          offline,
          limiter,
          audio.correctReveal,
          lookupBuf(audio.correctReveal.customDataUrl),
          tReveal,
          Math.min(totalDuration, nextSlideStart - 0.03),
          false,
          susDur
        );
      }
    }

    // 6. End Card Outro Voiceover (Subscribe CTA)
    const endDur = getEndCardDuration(template);
    if (endDur > 0) {
      const contentEnd = getSlidesContentDuration(slides, timing, audio, template);
      const endBuf = lookupBuf(template.endCardAudio?.dataUrl);
      if (endBuf && contentEnd < totalDuration - 0.08) {
        voiceQueue.push({
          start: contentEnd,
          buffer: endBuf,
          volume: 1,
          maxEnd: totalDuration - 0.03,
        });
      }
    }

    // 6.5 Real AI Human Presenter Audio Track (with exact trim & bg music ducking)
    if (template.aiPresenter?.enabled && template.aiPresenter.mediaKey && (template.aiPresenter.volume ?? 1) > 0.01) {
      const aiBuf = await decodeAiPresenterAudioBuffer(template.aiPresenter.mediaKey, offline);
      if (aiBuf) {
        const aiWindows = getAiPresenterPlaybackWindows(slides, template, timing, audio);
        for (const w of aiWindows) {
          const playDur = Math.min(w.timelineEnd - w.timelineStart, Math.max(0, aiBuf.duration - w.trimStart));
          if (playDur > 0.04) {
            this.playBufferSlice(
              aiBuf,
              w.volume,
              w.trimStart,
              playDur,
              limiter,
              offline,
              w.timelineStart,
              'voice'
            );
            if (playDur > 0.2) {
              speechIntervals.push({ start: w.timelineStart, end: w.timelineStart + playDur });
            }
          }
        }
      }
    }

    // Enforce strictly monophonic non-overlapping Voice bus across the whole video
    voiceQueue.sort((a, b) => a.start - b.start);
    for (let i = 0; i < voiceQueue.length; i++) {
      const curr = voiceQueue[i];
      const nextVoice = voiceQueue[i + 1];
      const hardEnd = nextVoice
        ? Math.min(curr.maxEnd, Math.max(curr.start + 0.04, nextVoice.start - 0.02))
        : curr.maxEnd;
      const effectiveEnd = Math.min(curr.start + curr.buffer.duration, hardEnd);
      if (effectiveEnd > curr.start + 0.04) {
        this.scheduleBufferWithEnvelope(
          offline,
          curr.buffer,
          curr.volume,
          limiter,
          curr.start,
          effectiveEnd
        );
        if (effectiveEnd - curr.start > 0.2) {
          speechIntervals.push({ start: curr.start, end: effectiveEnd });
        }
      }
    }

    // Schedule looping Background Music with clean start/end fades + merged Auto-Ducking
    const bgCfg = audio.bgMusic;
    if (bgCfg && bgCfg.volume > 0.001 && bgCfg.sourceType === 'custom' && bgCfg.customDataUrl) {
      const bgBuf = lookupBuf(bgCfg.customDataUrl);
      if (bgBuf) {
        const bgSrc = offline.createBufferSource();
        bgSrc.buffer = bgBuf;
        bgSrc.loop = true;

        const bgGain = offline.createGain();
        const baseVol = bgCfg.volume;
        const fadeInEnd = Math.min(0.18, totalDuration * 0.2);
        const tailStart = Math.max(fadeInEnd + 0.08, totalDuration - 0.45);
        bgGain.gain.setValueAtTime(0.0001, 0);
        bgGain.gain.linearRampToValueAtTime(baseVol, fadeInEnd);

        bgSrc.connect(bgGain);
        bgGain.connect(limiter);
        this.bgNodes.set(offline, { gain: bgGain, baseVolume: baseVol });

        if (timing.autoDuckMusic !== false && speechIntervals.length > 0 && tailStart > fadeInEnd + 0.2) {
          this.scheduleBgDuckIntervals(
            offline,
            speechIntervals,
            fadeInEnd + 0.02,
            timing.bgMusicDuckRatio ?? 0.22,
            tailStart - 0.03
          );
        }

        try {
          bgGain.gain.cancelScheduledValues(tailStart);
          bgGain.gain.setValueAtTime(baseVol, tailStart);
          bgGain.gain.linearRampToValueAtTime(0.0001, totalDuration + 0.05);
        } catch {
          // ignore
        }

        bgSrc.start(0);
        bgSrc.stop(totalDuration + 0.08);
      }
    }

    const renderTimeout = new Promise<AudioBuffer | null>((resolve) => {
      window.setTimeout(() => resolve(null), 12_000);
    });
    const rendered = await Promise.race([
      offline.startRendering().catch(() => null),
      renderTimeout,
    ]);
    if (!rendered) {
      return null;
    }
    return { buffer: rendered, speechIntervals };
  }

  private scheduleSlotInOffline(
    ctx: BaseAudioContext,
    dest: AudioNode,
    config: AudioSlotConfig,
    customBuffer: AudioBuffer | null,
    when: number,
    maxEndTime: number,
    urgent: boolean,
    suspenseDurationSec: number
  ): void {
    if (!config || config.volume <= 0.001) return;
    if (config.sourceType === 'custom' && customBuffer) {
      this.scheduleBufferWithEnvelope(ctx, customBuffer, config.volume, dest, when, maxEndTime);
      return;
    }
    this.playBuiltInSfx(
      config.builtinId,
      config.volume,
      ctx,
      dest,
      when,
      urgent,
      suspenseDurationSec,
      Math.max(0.06, maxEndTime - when)
    );
  }
}

export const soundEngine = new SoundEngine();
