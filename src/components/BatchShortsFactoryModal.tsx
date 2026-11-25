import React, { useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { Check, Factory, Film, FolderPlus, Loader2, Sparkles, UserCheck, X } from 'lucide-react';
import { exportQuizVideo } from '../canvas/videoExporter';
import { AiVoiceName } from '../services/aiClient';
import { updateCloudBankQuestionsUsedBatch } from '../services/firebaseClient';
import { saveProjectsToLibraryBatch } from '../storage/projectStore';
import {
  BankQuestionItem,
  bankItemToQuestionSlide,
  markBankQuestionsUsed,
} from '../storage/questionBankVault';
import {
  PRESENTER_PORTRAIT_URLS,
  PresenterStyle,
  PresetId,
  QuizProject,
  applyChannelThemePreset,
  applyStudioThemePreset,
  createDefaultProject,
} from '../types/quiz';
import { saveOrDownloadBlob } from '../utils/nativeDownload';

interface BatchShortsFactoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  poolItems: BankQuestionItem[];
  seriesLabel: string;
  voiceName: AiVoiceName;
  cloudUser: User | null;
  onCreated: (noticeMessage: string) => void;
}

const ROTATE_THEMES: PresetId[] = [
  'channelSand',
  'islamicAndalusian',
  'cosmicSpace',
  'stadiumArena',
  'millionaire',
  'neonCyber',
];

export const BatchShortsFactoryModal: React.FC<BatchShortsFactoryModalProps> = ({
  isOpen,
  onClose,
  poolItems,
  seriesLabel,
  voiceName,
  cloudUser,
  onCreated,
}) => {
  const [episodeCount, setEpisodeCount] = useState(5);
  const [perEpisode, setPerEpisode] = useState(3);
  const [autoRotateThemes, setAutoRotateThemes] = useState(true);
  const [enablePresenter, setEnablePresenter] = useState(true);
  const [presenterStyle, setPresenterStyle] = useState<PresenterStyle>('stylized3d');
  const [escalatingSpeed, setEscalatingSpeed] = useState(true);
  const [enableFlashTeaser, setEnableFlashTeaser] = useState(true);
  const [enableScoreboard, setEnableScoreboard] = useState(true);

  const [isRunning, setIsRunning] = useState(false);
  const [statusLabel, setStatusLabel] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  if (!isOpen) return null;

  const unusedPool = poolItems.filter((it) => !it.usedInVideo);
  const effectivePool = unusedPool.length > 0 ? unusedPool : poolItems;
  const maxPossibleEpisodes = Math.max(1, effectivePool.length);

  const buildEpisodes = (): {
    episodes: QuizProject[];
    usedIds: string[];
    usedItems: BankQuestionItem[];
  } => {
    const safeCount = Math.min(episodeCount, effectivePool.length);
    const chunkSize = Math.max(
      1,
      Math.min(perEpisode, Math.floor(effectivePool.length / Math.max(1, safeCount)))
    );
    const episodes: QuizProject[] = [];
    const usedIds: string[] = [];
    const usedItems: BankQuestionItem[] = [];
    const baseTime = Date.now();

    for (let ep = 0; ep < safeCount; ep++) {
      const start = ep * chunkSize;
      const chunk = effectivePool.slice(start, start + chunkSize);
      if (chunk.length === 0) break;

      const baseProj = createDefaultProject();
      const slides = chunk.map((it) => bankItemToQuestionSlide(it));

      const hasMath = chunk.some((it) => it.category === 'math');
      const hasIslamic = chunk.some((it) => it.category === 'islamic');

      let epTemplate = baseProj.template;
      if (autoRotateThemes) {
        const themeId = ROTATE_THEMES[ep % ROTATE_THEMES.length];
        epTemplate = applyStudioThemePreset(epTemplate, themeId);
      } else if (hasMath) {
        epTemplate = applyChannelThemePreset(epTemplate, 'channelMath');
      } else if (hasIslamic) {
        epTemplate = applyStudioThemePreset(epTemplate, 'islamicAndalusian');
      }

      epTemplate = {
        ...epTemplate,
        showIntroHook: true,
        introFlashTeaser: enableFlashTeaser,
        showEndCard: true,
        showEndSubscribeCta: true,
        showProgressCounter: true,
        showLiveScoreboard: enableScoreboard,
        presenterEnabled: enablePresenter,
        presenterStyle,
        presenterIntroFullscreen: true,
        presenterOutroFullscreen: true,
      };

      const epTiming = {
        ...baseProj.timing,
        escalatingSpeed,
      };

      episodes.push({
        ...baseProj,
        id: `factory-${baseTime}-${ep + 1}`,
        name: `${seriesLabel} — حلقة ${ep + 1}`,
        preferredAiVoice: voiceName,
        slides,
        template: epTemplate,
        timing: epTiming,
        updatedAt: baseTime + ep,
      });

      for (const it of chunk) {
        usedIds.push(it.id);
        usedItems.push(it);
      }
    }

    return { episodes, usedIds, usedItems };
  };

  const handleSaveBatchProjects = async () => {
    if (isRunning) return;
    if (effectivePool.length === 0) {
      setErrorMsg('لا توجد أسئلة متاحة في المجلد أو الفلتر الحالي.');
      return;
    }
    setErrorMsg('');
    setIsRunning(true);
    setStatusLabel('جارٍ بناء وحفظ الحلقات في مكتبة المشاريع...');
    try {
      const { episodes, usedIds, usedItems } = buildEpisodes();
      await saveProjectsToLibraryBatch(episodes);
      if (usedIds.length > 0) {
        await markBankQuestionsUsed(usedIds, true);
        if (cloudUser) {
          void updateCloudBankQuestionsUsedBatch(usedIds, true, usedItems).catch(() => {});
        }
      }
      onCreated(
        `تم إنتاج وحفظ ${episodes.length} شورتس جاهزة (${usedIds.length} سؤالاً) بالمذيع والمزايا الفيروسية!`
      );
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حفظ سلسلة الحلقات.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleBatchExportVideos = async () => {
    if (isRunning) return;
    if (effectivePool.length === 0) {
      setErrorMsg('لا توجد أسئلة متاحة في المجلد أو الفلتر الحالي.');
      return;
    }
    setErrorMsg('');
    setIsRunning(true);
    setProgressPct(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { episodes, usedIds, usedItems } = buildEpisodes();
      await saveProjectsToLibraryBatch(episodes);
      if (usedIds.length > 0) {
        await markBankQuestionsUsed(usedIds, true);
        if (cloudUser) {
          void updateCloudBankQuestionsUsedBatch(usedIds, true, usedItems).catch(() => {});
        }
      }

      let exportedCount = 0;
      for (let i = 0; i < episodes.length; i++) {
        if (controller.signal.aborted) break;
        const ep = episodes[i];
        setStatusLabel(`تصدير الحلقة ${i + 1} من ${episodes.length}: ${ep.name}`);

        const result = await exportQuizVideo(
          ep.slides,
          ep.template,
          ep.timing,
          ep.audio,
          (p) => {
            const overall = ((i + p.progress) / episodes.length) * 100;
            setProgressPct(Math.round(overall));
          },
          controller.signal,
          { formatPreference: 'auto', resolutionPreference: '720p', includeAudio: true }
        );

        const safeFile = `${ep.name.replace(/[^\w\u0600-\u06FF-]+/g, '-')}.${result.extension}`;
        await saveOrDownloadBlob(result.blob, safeFile, result.mimeType);
        exportedCount += 1;
      }

      onCreated(
        `تم إنتاج وحفظ ${episodes.length} حلقات وتصدير ${exportedCount} ملفات فيديو متتالية بنجاح!`
      );
      onClose();
    } catch (err) {
      if (!controller.signal.aborted) {
        setErrorMsg(err instanceof Error ? err.message : 'توقف التصدير المتتالي.');
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3"
      dir="rtl"
    >
      <div className="w-full max-w-lg rounded-2xl bg-[var(--panel)] border border-[var(--pline)] shadow-2xl overflow-hidden text-[var(--ptxt)] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--pline)] bg-[var(--surface)]">
          <div className="flex items-center gap-2">
            <Factory className="w-5 h-5 text-[#00B050]" />
            <div>
              <h3 className="text-sm font-extrabold">مصنع الشورتس التلقائي</h3>
              <p className="text-[11px] text-[var(--pmuted)]">
                متوفر {unusedPool.length} سؤال جديد (إجمالي {poolItems.length} بالفلتر الحالي)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
            className="p-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[var(--pmuted)] hover:text-rose-400 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 max-h-[75dvh] overflow-y-auto">
          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-rose-500/12 border border-rose-500/40 text-xs text-rose-300">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <div className="flex justify-between text-xs font-bold">
                <span>عدد الحلقات</span>
                <span className="font-mono-nums text-[#00B050]">
                  {Math.min(episodeCount, maxPossibleEpisodes)} حلقة
                </span>
              </div>
              <input
                type="range"
                min={2}
                max={Math.max(2, Math.min(20, maxPossibleEpisodes))}
                step={1}
                disabled={isRunning}
                value={Math.min(episodeCount, Math.max(2, maxPossibleEpisodes))}
                onChange={(e) => setEpisodeCount(parseInt(e.target.value, 10))}
              />
            </label>

            <label className="flex flex-col gap-1 p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <div className="flex justify-between text-xs font-bold">
                <span>أسئلة كل حلقة</span>
                <span className="font-mono-nums text-[var(--gold)]">{perEpisode} أسئلة</span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                disabled={isRunning}
                value={perEpisode}
                onChange={(e) => setPerEpisode(parseInt(e.target.value, 10))}
              />
            </label>
          </div>

          {/* Presenter Option */}
          <div className="flex flex-col gap-2 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="flex items-center gap-1.5 text-xs font-bold">
                <UserCheck className="w-4 h-4 text-[#00B050]" />
                <span>تفعيل المذيع التفاعلي في كل الحلقات</span>
              </span>
              <input
                type="checkbox"
                checked={enablePresenter}
                disabled={isRunning}
                onChange={(e) => setEnablePresenter(e.target.checked)}
                className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
              />
            </label>

            {enablePresenter && (
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                {[
                  { id: 'stylized3d' as PresenterStyle, label: 'مذيع ذكي متحرك', thumb: '' },
                  { id: 'photoMale' as PresenterStyle, label: 'صورة مذيع', thumb: PRESENTER_PORTRAIT_URLS.photoMale },
                  { id: 'photoFemale' as PresenterStyle, label: 'صورة مذيعة', thumb: PRESENTER_PORTRAIT_URLS.photoFemale },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isRunning}
                    onClick={() => setPresenterStyle(opt.id)}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer ${
                      presenterStyle === opt.id
                        ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                        : 'bg-[var(--panel)] border-[var(--pline)] text-[var(--ptxt)]'
                    }`}
                  >
                    {opt.thumb ? (
                      <img src={opt.thumb} alt={opt.label} className="w-6 h-6 rounded object-cover shrink-0" />
                    ) : (
                      <Sparkles className="w-4 h-4 shrink-0 text-[#00B050]" />
                    )}
                    <span className="truncate">{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Viral Booster Switches */}
          <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
            {[
              { label: 'تنويع الثيمات تلقائياً 🎨', val: autoRotateThemes, set: setAutoRotateThemes },
              { label: 'تسريع العداد تصاعدياً ⚡', val: escalatingSpeed, set: setEscalatingSpeed },
              { label: 'ومضة أول ثانية (Hook) 👀', val: enableFlashTeaser, set: setEnableFlashTeaser },
              { label: 'لوحة النقاط المباشرة 🏆', val: enableScoreboard, set: setEnableScoreboard },
            ].map((sw) => (
              <label
                key={sw.label}
                className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)] cursor-pointer"
              >
                <span className="truncate">{sw.label}</span>
                <input
                  type="checkbox"
                  checked={sw.val}
                  disabled={isRunning}
                  onChange={(e) => sw.set(e.target.checked)}
                  className="w-4 h-4 accent-[#00B050] rounded cursor-pointer shrink-0"
                />
              </label>
            ))}
          </div>

          {isRunning && (
            <div className="p-3 rounded-xl bg-[#00B050]/10 border border-[#00B050]/40 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="flex items-center gap-1.5 text-[#00B050]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{statusLabel}</span>
                </span>
                <span className="font-mono-nums">{progressPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--surface)] overflow-hidden">
                <div
                  className="h-full bg-[#00B050] transition-all duration-200"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="p-3.5 border-t border-[var(--pline)] bg-[var(--surface)] flex flex-wrap items-center justify-end gap-2">
          {isRunning ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold cursor-pointer"
            >
              إيقاف العملية
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleSaveBatchProjects()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--panel)] border border-[#00B050]/55 hover:border-[#00B050] text-[#00B050] dark:text-[#6ee7b7] text-xs font-bold cursor-pointer"
              >
                <FolderPlus className="w-4 h-4" />
                <span>إنشاء وحفظ بالمشاريع</span>
              </button>
              <button
                type="button"
                onClick={() => void handleBatchExportVideos()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-extrabold cursor-pointer"
              >
                <Film className="w-4 h-4" />
                <Check className="w-3.5 h-3.5" />
                <span>توليد وتصدير الفيديوهات متتالية</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
