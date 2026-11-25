import React, { useRef } from 'react';
import { Music, Play, RotateCcw, Trash2, Upload } from 'lucide-react';
import { BUILTIN_SFX_OPTIONS, soundEngine } from '../audio/soundEngine';
import { readFileAsDataUrl } from '../storage/projectStore';
import {
  AudioSettings,
  AudioSlotConfig,
  AudioSlotId,
  BuiltInSfxId,
  DEFAULT_TIMING,
  TimingSettings,
} from '../types/quiz';

interface AudioTimingPanelProps {
  audio: AudioSettings;
  timing: TimingSettings;
  onAudioChange: (next: AudioSettings) => void;
  onTimingChange: (next: TimingSettings) => void;
}

const AUDIO_CHANNELS: { id: AudioSlotId; title: string; subtitle: string; isBg?: boolean }[] = [
  {
    id: 'questionEnter',
    title: 'صوت دخول السؤال',
    subtitle: 'يبدأ تلقائياً مع ظهور السؤال (ما لم تحدد صوتاً خاصاً للسؤال)',
  },
  {
    id: 'optionEnter',
    title: 'صوت ظهور كل خيار',
    subtitle: 'يبدأ مع كل خيار (ما لم تحدد صوتاً خاصاً للخيار)',
  },
  {
    id: 'countdownTick',
    title: 'صوت العداد (كل ثانية)',
    subtitle: 'يتكرر كل ثانية أثناء عمل المؤقت',
  },
  {
    id: 'suspense',
    title: 'صوت التشويق قبل الجواب',
    subtitle: 'يعمل فور انتهاء العد التنازلي مع نبض الخيارات قبل التلوين بالأخضر',
  },
  {
    id: 'correctReveal',
    title: 'صوت الجواب الصحيح',
    subtitle: 'يبدأ عند اختفاء المؤقت وتلوين الإجابة الصحيحة بالأخضر',
  },
  {
    id: 'bgMusic',
    title: 'موسيقى أو خلفية صوتية',
    subtitle: 'تعمل بشكل متواصل طوال الفيديو (اختياري)',
    isBg: true,
  },
];

export const AudioTimingPanel: React.FC<AudioTimingPanelProps> = ({
  audio,
  timing,
  onAudioChange,
  onTimingChange,
}) => {
  const fileInputsRef = useRef<Partial<Record<AudioSlotId, HTMLInputElement | null>>>({});

  const updateSlot = (slotId: AudioSlotId, partial: Partial<AudioSlotConfig>) => {
    onAudioChange({
      ...audio,
      [slotId]: { ...audio[slotId], ...partial },
    });
  };

  const handleUploadAudio = async (
    slotId: AudioSlotId,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const duration = await soundEngine.getAudioDuration(dataUrl);
    updateSlot(slotId, {
      sourceType: 'custom',
      customFileName: file.name,
      customDataUrl: dataUrl,
      duration,
    });
    e.target.value = '';
  };

  const handleTestPlay = async (slotId: AudioSlotId) => {
    soundEngine.getContext();
    const cfg = audio[slotId];
    await soundEngine.playSlot(cfg);
  };

  const patchTiming = (partial: Partial<TimingSettings>) => {
    onTimingChange({ ...timing, ...partial });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Auto-Sync Audio Timing Toggle */}
      <section className="flex flex-col gap-3 p-3.5 rounded-xl bg-[#00B050]/12 border border-[#00B050]/40">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={timing.autoSyncWithAudio}
            onChange={(e) => patchTiming({ autoSyncWithAudio: e.target.checked })}
            className="mt-1 w-4 h-4 accent-[#00B050] rounded cursor-pointer shrink-0"
          />
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold text-[#00B050] dark:text-[#6ee7b7]">
              انتقال تلقائي عند انتهاء الصوت (تزامن مع التعليق الصوتي)
            </span>
            <span className="text-[11px] text-[var(--pmuted)] leading-relaxed">
              يبدأ الصوت تلقائياً مع السؤال أو الخيار، وعند انتهاء الملف الصوتي ينتقل
              للمرحلة التي تليه دون تداخل.
            </span>
          </div>
        </label>

        {timing.autoSyncWithAudio && (
          <label className="flex flex-col gap-1 pt-1 border-t border-[#00B050]/25">
            <div className="flex items-center justify-between text-xs text-[var(--ptxt)]">
              <span>مهلة قصيرة بعد انتهاء كل صوت</span>
              <span className="font-mono-nums text-[#00B050] dark:text-[#6ee7b7]">
                {(timing.audioEndGap ?? 0.15).toFixed(2)} ث
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1.0}
              step={0.05}
              value={timing.audioEndGap ?? 0.15}
              onChange={(e) => patchTiming({ audioEndGap: parseFloat(e.target.value) })}
              className="w-full"
            />
          </label>
        )}

        <div className="pt-2 border-t border-[#00B050]/25 flex flex-col gap-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={timing.autoDuckMusic !== false}
              onChange={(e) => patchTiming({ autoDuckMusic: e.target.checked })}
              className="mt-0.5 w-4 h-4 accent-[#00B050] rounded cursor-pointer shrink-0"
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold text-[var(--ptxt)]">
                خفض موسيقى الخلفية تلقائياً أثناء كلام المذيع (Auto-Ducking)
              </span>
              <span className="text-[11px] text-[var(--pmuted)]">
                تخف الموسيقى تلقائياً عند نطق السؤال والخيارات ثم تعود طبيعياً.
              </span>
            </div>
          </label>

          {timing.autoDuckMusic !== false && (
            <label className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs text-[var(--ptxt)]">
                <span>مستوى الموسيقى أثناء الكلام</span>
                <span className="font-mono-nums text-[#00B050] dark:text-[#6ee7b7]">
                  {Math.round((timing.bgMusicDuckRatio ?? 0.22) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={0.65}
                step={0.05}
                value={timing.bgMusicDuckRatio ?? 0.22}
                onChange={(e) =>
                  patchTiming({ bgMusicDuckRatio: parseFloat(e.target.value) })
                }
                className="w-full"
              />
            </label>
          )}
        </div>
      </section>

      {/* 1. Audio Channels (Matches attached HTML 5 channels + BG Music) */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[var(--ptxt)]">
            1. الأصوات (ارفع ملفاتك أو اختر الافتراضي)
          </h2>
          <span className="text-[11px] text-[var(--pmuted)]">MP3 · WAV · OGG</span>
        </div>

        <div className="flex flex-col gap-3">
          {AUDIO_CHANNELS.map((ch) => {
            const cfg = audio[ch.id];
            const isCustom = cfg?.sourceType === 'custom' && !!cfg.customDataUrl;

            return (
              <div
                key={ch.id}
                className="flex flex-col gap-2.5 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-[var(--ptxt)]">{ch.title}</div>
                    <div className="text-[11px] text-[var(--pmuted)] mt-0.5">{ch.subtitle}</div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleTestPlay(ch.id)}
                    title="تجربة الصوت"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--panel)] hover:border-[var(--gold)] border border-[var(--pline)] text-[#00B050] dark:text-[#6ee7b7] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                    <span>اختبار</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {!ch.isBg && !isCustom ? (
                    <select
                      value={cfg.builtinId}
                      onChange={(e) =>
                        updateSlot(ch.id, {
                          sourceType: 'builtin',
                          builtinId: e.target.value as BuiltInSfxId,
                        })
                      }
                      className="flex-1 px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                    >
                      {BUILTIN_SFX_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] truncate">
                      <Music className="w-3.5 h-3.5 text-[#00B050] shrink-0" />
                      <span className="truncate">
                        {isCustom
                          ? `✓ مرفوع: ${cfg.customFileName || 'ملف صوتي'}${
                              cfg.duration ? ` (${cfg.duration.toFixed(1)} ث)` : ''
                            }`
                          : 'بدون موسيقى خلفية'}
                      </span>
                    </div>
                  )}

                  <input
                    ref={(el) => {
                      fileInputsRef.current[ch.id] = el;
                    }}
                    type="file"
                    accept="audio/*"
                    onChange={(e) => void handleUploadAudio(ch.id, e)}
                    className="hidden"
                  />

                  <button
                    type="button"
                    onClick={() => fileInputsRef.current[ch.id]?.click()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#00B050]/15 hover:bg-[#00B050]/25 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/35 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{isCustom ? 'تغيير' : 'رفع صوت'}</span>
                  </button>

                  {isCustom && (
                    <button
                      type="button"
                      onClick={() =>
                        updateSlot(ch.id, {
                          sourceType: 'builtin',
                          customDataUrl: undefined,
                          customFileName: undefined,
                          duration: undefined,
                        })
                      }
                      title="إزالة الملف المخصص"
                      className="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/25 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <label className="flex items-center gap-3">
                  <span className="text-[11px] text-[var(--pmuted)] whitespace-nowrap">مستوى الصوت</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={cfg.volume}
                    onChange={(e) =>
                      updateSlot(ch.id, { volume: parseFloat(e.target.value) })
                    }
                    className="flex-1 h-1"
                  />
                  <span className="font-mono-nums text-[11px] text-[var(--ptxt)] w-9 text-left">
                    {Math.round(cfg.volume * 100)}%
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      </section>

      {/* 2. Animation Timing Controls */}
      <section className="flex flex-col gap-3 border-t border-[var(--pline)] pt-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[var(--ptxt)]">
            2. التوقيت والعداد (ثانية)
          </h2>
          <button
            type="button"
            onClick={() => onTimingChange({ ...DEFAULT_TIMING })}
            title="استعادة أوقات التوقيت الافتراضية"
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] text-[11px] font-bold text-[var(--ptxt)] cursor-pointer"
          >
            <RotateCcw className="w-3 h-3 text-[#00B050]" />
            <span>استعادة الافتراضي</span>
          </button>
        </div>

        {/* 1-Click Retention & Speed Presets */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-[var(--pmuted)]">
            أوضاع التوقيت الجاهزة (ضغطة واحدة):
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              {
                id: 'fastShorts',
                label: 'شورتس سريع ⚡',
                sub: '3.5ث عداد · مشاهدات عالية',
                values: {
                  introHold: 0,
                  questionReadDelay: 0.7,
                  optionStaggerDelay: 0.25,
                  thinkingDuration: 3.5,
                  suspenseDuration: 0.8,
                  revealHoldDuration: 2.0,
                  transitionGap: 0.2,
                },
              },
              {
                id: 'balanced',
                label: 'متوازن ⚖️',
                sub: '5ث عداد · قياسي',
                values: {
                  introHold: DEFAULT_TIMING.introHold,
                  questionReadDelay: DEFAULT_TIMING.questionReadDelay,
                  optionStaggerDelay: DEFAULT_TIMING.optionStaggerDelay,
                  thinkingDuration: DEFAULT_TIMING.thinkingDuration,
                  suspenseDuration: DEFAULT_TIMING.suspenseDuration,
                  revealHoldDuration: DEFAULT_TIMING.revealHoldDuration,
                  transitionGap: DEFAULT_TIMING.transitionGap,
                },
              },
              {
                id: 'deepChallenge',
                label: 'تحدي عميق 🧮',
                sub: '8ث عداد · رياضيات/ألغاز',
                values: {
                  introHold: 0.2,
                  questionReadDelay: 1.4,
                  optionStaggerDelay: 0.45,
                  thinkingDuration: 8.0,
                  suspenseDuration: 1.2,
                  revealHoldDuration: 3.25,
                  transitionGap: 0.4,
                },
              },
            ].map((preset) => {
              const isSelected =
                Math.abs((timing.thinkingDuration ?? 0) - preset.values.thinkingDuration) < 0.05 &&
                Math.abs((timing.suspenseDuration ?? 0) - preset.values.suspenseDuration) < 0.05 &&
                Math.abs((timing.revealHoldDuration ?? 0) - preset.values.revealHoldDuration) < 0.05;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => patchTiming(preset.values)}
                  className={`flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg border text-center transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#00B050]/15 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                      : 'bg-[var(--surface)] border-[var(--pline)] hover:border-[var(--gold)] text-[var(--ptxt)]'
                  }`}
                >
                  <span className="text-[11px] font-bold whitespace-nowrap">{preset.label}</span>
                  <span className="text-[9.5px] text-[var(--pmuted)] leading-tight">
                    {preset.sub}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {[
            {
              key: 'introHold' as const,
              label: 'مهلة قبل ظهور السؤال (0 = فوري مع الصوت)',
              min: 0,
              max: 4.0,
              step: 0.05,
            },
            {
              key: 'questionReadDelay' as const,
              label: 'مهلة السؤال قبل الخيار الأول',
              min: 0.1,
              max: 8.0,
              step: 0.1,
            },
            {
              key: 'optionStaggerDelay' as const,
              label: 'الفاصل بين كل خيار وآخر',
              min: 0.1,
              max: 4.0,
              step: 0.05,
            },
            {
              key: 'thinkingDuration' as const,
              label: 'مدة العداد في المنتصف (5 ث لعداد الفيديو)',
              min: 1.0,
              max: 20.0,
              step: 0.5,
            },
            {
              key: 'suspenseDuration' as const,
              label: 'مدة التشويق والنبض قبل كشف الجواب',
              min: 0,
              max: 5.0,
              step: 0.2,
            },
            {
              key: 'revealHoldDuration' as const,
              label: 'مدة بقاء الناتج الصحيح بالأخضر',
              min: 0.5,
              max: 12.0,
              step: 0.25,
            },
            {
              key: 'transitionGap' as const,
              label: 'فاصل بين الشرائح',
              min: 0,
              max: 4.0,
              step: 0.1,
            },
          ].map((item) => (
            <label key={item.key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs text-[var(--ptxt)]">
                <span>{item.label}</span>
                <span className="font-mono-nums text-[#00B050] dark:text-[#6ee7b7] font-bold">
                  {(timing[item.key] ?? 0).toFixed(2)} ث
                </span>
              </div>
              <input
                type="range"
                min={item.min}
                max={item.max}
                step={item.step}
                value={timing[item.key] ?? 0}
                onChange={(e) =>
                  patchTiming({ [item.key]: parseFloat(e.target.value) })
                }
                className="w-full"
              />
            </label>
          ))}
        </div>

        {/* Escalating Speed / Progressive Difficulty */}
        <div className="flex flex-col gap-2.5 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <div>
              <div className="text-xs font-bold text-[var(--ptxt)]">
                تسريع العداد تصاعدياً في الأسئلة الأخيرة ⚡
              </div>
              <div className="text-[11px] text-[var(--pmuted)] mt-0.5">
                يقصر وقت التفكير تدريجياً مع كل سؤال لرفع الحماس ومنع الملل
              </div>
            </div>
            <input
              type="checkbox"
              checked={Boolean(timing.escalatingSpeed)}
              onChange={(e) => patchTiming({ escalatingSpeed: e.target.checked })}
              className="w-4 h-4 accent-[#00B050] rounded cursor-pointer shrink-0"
            />
          </label>

          {timing.escalatingSpeed && (
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--pline)]">
              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                  <span>نقص لكل سؤال</span>
                  <span className="font-mono-nums font-bold text-[#00B050]">
                    -{(timing.escalatingStepSeconds ?? 0.5).toFixed(2)} ث
                  </span>
                </div>
                <input
                  type="range"
                  min={0.25}
                  max={2.0}
                  step={0.25}
                  value={timing.escalatingStepSeconds ?? 0.5}
                  onChange={(e) =>
                    patchTiming({ escalatingStepSeconds: parseFloat(e.target.value) })
                  }
                />
              </label>

              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                  <span>أقل وقت مسموح</span>
                  <span className="font-mono-nums font-bold text-[var(--gold)]">
                    {(timing.escalatingMinSeconds ?? 2.0).toFixed(1)} ث
                  </span>
                </div>
                <input
                  type="range"
                  min={1.0}
                  max={5.0}
                  step={0.5}
                  value={timing.escalatingMinSeconds ?? 2.0}
                  onChange={(e) =>
                    patchTiming({ escalatingMinSeconds: parseFloat(e.target.value) })
                  }
                />
              </label>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
