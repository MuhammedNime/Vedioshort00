import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarClock,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  LogOut,
  RefreshCw,
  Send,
  Sparkles,
  UploadCloud,
  X,
  Youtube,
} from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { exportThumbnailJpg } from '../canvas/quizRenderer';
import {
  ExportFormatPreference,
  ExportProgress,
  ExportResolutionPreference,
  ExportResult,
  exportQuizVideo,
} from '../canvas/videoExporter';
import { YoutubePublishKit, generateYoutubePublishKit } from '../services/aiClient';
import {
  YouTubeChannelInfo,
  YouTubePlaylistItem,
  YouTubePrivacyStatus,
  YouTubeUploadResult,
  getWebLoginBaseUrl,
  getYouTubeNativeMode,
  launchWebLinkLoginForApk,
  uploadVideoToYouTube,
} from '../services/youtubeClient';
import {
  QuizProject,
  computeProjectTimeline,
  getCanvasDimensions,
} from '../types/quiz';
import {
  canShareNatively,
  isAndroidNativeApp,
  saveOrDownloadBlob,
  shareBlobNatively,
} from '../utils/nativeDownload';
import { GoogleSignInButton } from './YouTubePublishPanel';

export interface SharedYouTubeProps {
  publishKit: YoutubePublishKit;
  tagsInput: string;
  onUpdatePublishKit: (updater: (prev: YoutubePublishKit) => YoutubePublishKit) => void;
  onUpdateTagsInput: (val: string) => void;
  ytConnected: boolean;
  ytChannel: YouTubeChannelInfo | null;
  ytEmail: string | null;
  ytPlaylists: YouTubePlaylistItem[];
  selectedPlaylistId: string;
  onSelectPlaylistId: (id: string) => void;
  ytPrivacy: YouTubePrivacyStatus;
  onChangePrivacy: (privacy: YouTubePrivacyStatus) => void;
  ytUseSchedule: boolean;
  onChangeUseSchedule: (useSchedule: boolean) => void;
  ytScheduleLocal: string;
  onChangeScheduleLocal: (val: string) => void;
  ytAutoPostComment: boolean;
  onChangeAutoPostComment: (autoPost: boolean) => void;
  isConnectingYt: boolean;
  ytAuthError: string;
  onConnectYouTube: () => Promise<void>;
  onDisconnectYouTube: () => Promise<void>;
}

interface ExportVideoModalProps extends SharedYouTubeProps {
  isOpen: boolean;
  project: QuizProject;
  onClose: () => void;
  customThumbnailBlob?: Blob | null;
  customThumbnailPreviewUrl?: string | null;
  onOpenThumbnailStudio?: () => void;
}

type ExportScopeMode = 'full' | 'single' | 'splitBatch';

export const ExportVideoModal: React.FC<ExportVideoModalProps> = ({
  isOpen,
  project,
  onClose,
  publishKit,
  tagsInput,
  onUpdatePublishKit,
  onUpdateTagsInput,
  ytConnected,
  ytChannel,
  ytEmail,
  ytPlaylists,
  selectedPlaylistId,
  onSelectPlaylistId,
  ytPrivacy,
  onChangePrivacy,
  ytUseSchedule,
  onChangeUseSchedule,
  ytScheduleLocal,
  onChangeScheduleLocal,
  ytAutoPostComment,
  onChangeAutoPostComment,
  isConnectingYt,
  ytAuthError,
  onConnectYouTube,
  onDisconnectYouTube,
  customThumbnailBlob,
  customThumbnailPreviewUrl,
  onOpenThumbnailStudio,
}) => {
  const [scopeMode, setScopeMode] = useState<ExportScopeMode>('full');
  const [formatPref, setFormatPref] = useState<ExportFormatPreference>('auto');
  const [resPref, setResPref] = useState<ExportResolutionPreference>('auto');
  const [selectedSlideIdx, setSelectedSlideIdx] = useState(0);
  const [status, setStatus] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<ExportProgress>({
    progress: 0,
    currentTime: 0,
    totalDuration: 0,
    statusText: '',
  });
  const [result, setResult] = useState<ExportResult | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [exportedFileName, setExportedFileName] = useState<string>('');
  const [batchDoneCount, setBatchDoneCount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isCapturingThumb, setIsCapturingThumb] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // AI Publishing Kit UI local state
  const [isGeneratingKit, setIsGeneratingKit] = useState(false);
  const [kitError, setKitError] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // YouTube Direct Upload local UI state
  const [ytPanelOpen, setYtPanelOpen] = useState(true);
  const [confirmUploadOpen, setConfirmUploadOpen] = useState(false);
  const [isUploadingYt, setIsUploadingYt] = useState(false);
  const [ytUploadPct, setYtUploadPct] = useState(0);
  const [ytUploadStage, setYtUploadStage] = useState('');
  const [ytError, setYtError] = useState('');
  const [ytResult, setYtResult] = useState<YouTubeUploadResult | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const livePreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const getActiveTargetSlides = (overrideMode?: ExportScopeMode, overrideSlideIdx?: number) => {
    const activeProject = projectRef.current;
    const effMode = overrideMode ?? scopeMode;
    const effIdx = overrideSlideIdx ?? selectedSlideIdx;
    if (effMode === 'single' && activeProject.slides[effIdx]) {
      return [activeProject.slides[effIdx]];
    }
    return activeProject.slides;
  };

  const startSingleOrFullExport = (
    mode: 'full' | 'single',
    slideIdx = 0,
    overrideFormat?: ExportFormatPreference,
    overrideRes?: ExportResolutionPreference
  ) => {
    try {
      soundEngine.getContext();
    } catch {
      // ignore
    }
    const activeProject = projectRef.current;
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setResult(null);
    setYtResult(null);
    setConfirmUploadOpen(false);
    setBatchDoneCount(0);
    setStatus('rendering');
    setSaveNotice('');
    setErrorMsg('');

    const targetSlides =
      mode === 'single' && activeProject.slides[slideIdx]
        ? [activeProject.slides[slideIdx]]
        : activeProject.slides;

    void exportQuizVideo(
      targetSlides,
      activeProject.template,
      activeProject.timing,
      activeProject.audio,
      (p) => setProgress(p),
      controller.signal,
      {
        formatPreference: overrideFormat ?? formatPref,
        resolutionPreference: overrideRes ?? resPref,
        getPreviewCanvas: () => livePreviewCanvasRef.current,
      }
    )
      .then(async (res) => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(res.blob);
        const prefix =
          mode === 'single' ? `quiz-slide-${slideIdx + 1}` : 'youtube-short-quiz';
        const generatedName = `${prefix}-${Date.now()}.${res.extension || 'webm'}`;
        setResult(res);
        setVideoUrl(url);
        setExportedFileName(generatedName);
        setStatus('done');

        if (isAndroidNativeApp()) {
          setIsSaving(true);
          const saveRes = await saveOrDownloadBlob(res.blob, generatedName, res.mimeType);
          if (!controller.signal.aborted) {
            setIsSaving(false);
            if (saveRes.ok) {
              const loc = saveRes.savedLocation || 'Movies/ShortsQuizStudio';
              setSaveNotice(
                `تم حفظ الفيديو تلقائياً في الاستوديو/الجهاز (${loc}): ${saveRes.fileName || generatedName}`
              );
            } else if (saveRes.error) {
              setSaveNotice(`تعذر الحفظ التلقائي (${saveRes.error})، اضغط «مشاركة / رفع لتطبيق YouTube».`);
            }
          }
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setErrorMsg(err instanceof Error ? err.message : 'فشل تصدير الفيديو');
        setStatus('error');
      });
  };

  const startSplitBatchExport = async (
    overrideFormat?: ExportFormatPreference,
    overrideRes?: ExportResolutionPreference
  ) => {
    try {
      soundEngine.getContext();
    } catch {
      // ignore
    }
    const activeProject = projectRef.current;
    if (activeProject.slides.length === 0) return;

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setResult(null);
    setYtResult(null);
    setConfirmUploadOpen(false);
    setBatchDoneCount(0);
    setStatus('rendering');
    setSaveNotice('');
    setErrorMsg('');

    const totalCount = activeProject.slides.length;
    try {
      let lastRes: ExportResult | null = null;
      let lastFile = '';
      for (let i = 0; i < totalCount; i++) {
        if (controller.signal.aborted) return;
        const slide = activeProject.slides[i];
        const res = await exportQuizVideo(
          [slide],
          activeProject.template,
          activeProject.timing,
          activeProject.audio,
          (p) => {
            const overall = (i + p.progress) / totalCount;
            setProgress({
              progress: overall,
              currentTime: p.currentTime,
              totalDuration: p.totalDuration,
              statusText: `سؤال ${i + 1} من ${totalCount}: ${p.statusText || 'جارٍ التصدير...'}`,
            });
          },
          controller.signal,
          {
            formatPreference: overrideFormat ?? formatPref,
            resolutionPreference: overrideRes ?? resPref,
            getPreviewCanvas: () => livePreviewCanvasRef.current,
          }
        );
        if (controller.signal.aborted) return;
        const fileName = `quiz-slide-${i + 1}-${Date.now()}.${res.extension || 'webm'}`;
        const batchSave = await saveOrDownloadBlob(res.blob, fileName, res.mimeType);
        if (!batchSave.ok) {
          throw new Error(batchSave.error || `تعذر حفظ الفيديو رقم ${i + 1} على الجهاز`);
        }
        lastRes = res;
        lastFile = fileName;
        setBatchDoneCount(i + 1);
      }

      if (lastRes && !controller.signal.aborted) {
        const url = URL.createObjectURL(lastRes.blob);
        setResult(lastRes);
        setVideoUrl(url);
        setExportedFileName(lastFile);
        setStatus('done');
        setSaveNotice(`تم تصدير وحفظ ${totalCount} فيديوهات مستقلة بنجاح.`);
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      setErrorMsg(err instanceof Error ? err.message : 'فشل تصدير الدفعة');
      setStatus('error');
    }
  };

  useEffect(() => {
    if (!isOpen) {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setScopeMode('full');
      setSelectedSlideIdx(0);
      setStatus('idle');
      setResult(null);
      setExportedFileName('');
      setBatchDoneCount(0);
      setIsSaving(false);
      setSaveNotice('');
      setErrorMsg('');
      setKitError('');
      setYtPanelOpen(true);
      setConfirmUploadOpen(false);
      setYtError('');
      setYtResult(null);
      return;
    }

    setYtPanelOpen(true);
    setScopeMode('full');
    startSingleOrFullExport('full');

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const fileName =
    exportedFileName || `youtube-short-quiz-${Date.now()}.${result?.extension || 'webm'}`;

  const handleDownload = async () => {
    if (!result || isSaving) return;
    setIsSaving(true);
    setSaveNotice('');
    const res = await saveOrDownloadBlob(result.blob, fileName, result.mimeType);
    setIsSaving(false);
    if (res.ok) {
      const loc = res.savedLocation || 'Movies/ShortsQuizStudio';
      setSaveNotice(
        res.savedNatively
          ? `تم حفظ الفيديو في (${loc}): ${res.fileName || fileName}`
          : 'بدأ تنزيل الفيديو على جهازك.'
      );
    } else if (res.error) {
      setSaveNotice(`تعذر حفظ الفيديو: ${res.error}`);
    }
  };

  const handleCaptureCover = async () => {
    if (isCapturingThumb) return;
    setIsCapturingThumb(true);
    try {
      const targetIdx = scopeMode === 'single' ? selectedSlideIdx : 0;
      const targetSlides =
        scopeMode === 'single' && project.slides[targetIdx]
          ? [project.slides[targetIdx]]
          : project.slides;
      const schedules = computeProjectTimeline(
        targetSlides,
        project.timing,
        project.audio,
        project.template
      );
      const sched = schedules[0];
      const captureTime = sched
        ? sched.startTime +
          sched.tThinkingStart +
          Math.min(1.1, project.timing.thinkingDuration * 0.25)
        : 0.5;
      const blob = await exportThumbnailJpg(
        targetSlides,
        project.template,
        project.timing,
        project.audio,
        captureTime
      );
      if (blob) {
        const thumbName = `quiz-cover-${Date.now()}.jpg`;
        const res = await saveOrDownloadBlob(blob, thumbName, 'image/jpeg');
        if (res.ok) {
          setSaveNotice('تم حفظ صورة الغلاف (JPG) بدقة الفيديو الكاملة.');
        } else if (res.error) {
          setSaveNotice(`تعذر حفظ الغلاف: ${res.error}`);
        }
      }
    } finally {
      setIsCapturingThumb(false);
    }
  };

  const canNativeShare = !!result && canShareNatively(fileName, result.mimeType, result.blob);
  const runningInAndroidApk = isAndroidNativeApp();
  const ytNativeMode = getYouTubeNativeMode();

  const handleShareVideo = async (copyMetadataFirst = false) => {
    if (!result || isSaving) return;
    if (copyMetadataFirst) {
      try {
        await navigator.clipboard.writeText(
          `${publishKit.title}\n\n${publishKit.description}`.trim()
        );
        setSaveNotice('تم نسخ العنوان والوصف، اختر تطبيق YouTube من قائمة المشاركة لإكمال النشر.');
      } catch {
        // ignore clipboard denial
      }
    }
    try {
      setIsSaving(true);
      await shareBlobNatively(
        result.blob,
        fileName,
        result.mimeType,
        publishKit.title || 'فيديو شورتس الأسئلة',
        publishKit.title || ''
      );
    } catch {
      // User cancelled share sheet
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelAndClose = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    onClose();
  };

  const handleSwitchScope = (nextScope: ExportScopeMode) => {
    if (nextScope === scopeMode && status !== 'idle') return;
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setScopeMode(nextScope);
    if (nextScope === 'full') {
      startSingleOrFullExport('full');
    } else {
      setStatus('idle');
      setSaveNotice('');
      setErrorMsg('');
    }
  };

  const handleGeneratePublishKit = async () => {
    if (isGeneratingKit) return;
    setIsGeneratingKit(true);
    setKitError('');
    try {
      const targetSlides = getActiveTargetSlides();
      const generated = await generateYoutubePublishKit(
        targetSlides,
        project.template.aspectRatio,
        project.template.showIntroHook ? project.template.introHookText : undefined
      );
      const hashtagsLine = generated.hashtags.join(' ');
      const fullDescription =
        hashtagsLine && !generated.description.includes(generated.hashtags[0] || '')
          ? `${generated.description}\n\n${hashtagsLine}`.trim()
          : generated.description;

      onUpdatePublishKit(() => ({
        ...generated,
        description: fullDescription,
      }));
      onUpdateTagsInput(generated.tags.join('، '));
    } catch (err) {
      setKitError(err instanceof Error ? err.message : 'تعذر توليد حزمة النشر بالذكاء الاصطناعي.');
    } finally {
      setIsGeneratingKit(false);
    }
  };

  const copyText = async (field: string, text: string) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      window.setTimeout(() => {
        setCopiedField((cur) => (cur === field ? null : cur));
      }, 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const parsedTags = tagsInput
    .split(/[,،\n]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean);

  const handleConfirmYouTubeUpload = async () => {
    if (!result || isUploadingYt) return;
    let publishAtIso: string | undefined;
    if (ytUseSchedule) {
      if (!ytScheduleLocal) {
        setYtError('يرجى تحديد تاريخ ووقت النشر المجدول.');
        return;
      }
      const d = new Date(ytScheduleLocal);
      if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now() + 60_000) {
        setYtError('اختر وقتاً مستقبلياً للجدولة (بعد دقيقة على الأقل من الآن).');
        return;
      }
      publishAtIso = d.toISOString();
    }

    setConfirmUploadOpen(false);
    setIsUploadingYt(true);
    setYtError('');
    setYtResult(null);
    setYtUploadPct(2);
    setYtUploadStage('جارٍ تجهيز الرفع...');

    try {
      const uploadRes = await uploadVideoToYouTube({
        blob: result.blob,
        mimeType: result.mimeType,
        title: publishKit.title,
        description: publishKit.description,
        tags: parsedTags,
        privacyStatus: ytPrivacy,
        publishAtIso,
        playlistId: selectedPlaylistId || undefined,
        pinnedComment: ytAutoPostComment ? publishKit.pinnedComment : undefined,
        thumbnailBlob: customThumbnailBlob,
        onProgress: (pct, txt) => {
          setYtUploadPct(pct);
          setYtUploadStage(txt);
        },
      });
      setYtResult(uploadRes);
    } catch (err) {
      setYtError(err instanceof Error ? err.message : 'فشل رفع الفيديو إلى YouTube.');
    } finally {
      setIsUploadingYt(false);
    }
  };

  const dims = getCanvasDimensions(project.template);
  const isWideRatio = project.template.aspectRatio === '16:9';
  const ratioLabel = isWideRatio ? '16:9' : '9:16';
  const effectiveYtError = ytError || ytAuthError;
  const miniPreviewW = isWideRatio ? 240 : 135;
  const miniPreviewH = isWideRatio ? 135 : 240;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4">
      <div className="w-full max-w-xl rounded-2xl bg-[var(--panel)] border border-[var(--pline)] shadow-2xl overflow-hidden text-[var(--ptxt)] max-h-[94dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--pline)] shrink-0">
          <div className="flex items-center gap-2.5">
            <Film className="w-5 h-5 text-[#00B050]" />
            <h3 className="text-base font-bold">
              تصدير ونشر الفيديو ({dims.width}×{dims.height})
            </h3>
          </div>
          <button
            type="button"
            onClick={handleCancelAndClose}
            className="p-1.5 rounded-lg text-[var(--pmuted)] hover:text-[var(--ptxt)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto">
          {/* Export Format & Resolution Switcher */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
            <div className="flex items-center justify-between sm:justify-start gap-2">
              <span className="text-[11px] font-bold text-[var(--pmuted)] shrink-0">الصيغة:</span>
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                {(
                  [
                    { id: 'auto', label: 'تلقائي' },
                    { id: 'mp4', label: 'MP4' },
                    { id: 'webm', label: 'WebM' },
                  ] as { id: ExportFormatPreference; label: string }[]
                ).map((fmt) => {
                  const active = formatPref === fmt.id;
                  return (
                    <button
                      key={fmt.id}
                      type="button"
                      disabled={status === 'rendering'}
                      onClick={() => {
                        setFormatPref(fmt.id);
                        if (scopeMode === 'full' && (status === 'done' || status === 'error')) {
                          startSingleOrFullExport('full', 0, fmt.id, resPref);
                        }
                      }}
                      className={`px-2 py-1 rounded-md text-[10px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                        active
                          ? 'bg-[#00B050] text-white'
                          : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                      }`}
                    >
                      {fmt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-2">
              <span className="text-[11px] font-bold text-[var(--pmuted)] shrink-0">الدقة:</span>
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                {(
                  [
                    { id: 'auto', label: 'تلقائي' },
                    { id: '720p', label: '720p' },
                    { id: '1080p', label: '1080p' },
                  ] as { id: ExportResolutionPreference; label: string }[]
                ).map((rq) => {
                  const active = resPref === rq.id;
                  return (
                    <button
                      key={rq.id}
                      type="button"
                      disabled={status === 'rendering'}
                      onClick={() => {
                        setResPref(rq.id);
                        if (scopeMode === 'full' && (status === 'done' || status === 'error')) {
                          startSingleOrFullExport('full', 0, formatPref, rq.id);
                        }
                      }}
                      className={`px-2 py-1 rounded-md text-[10px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                        active
                          ? 'bg-[#00B050] text-white'
                          : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                      }`}
                    >
                      {rq.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Export Scope Switcher */}
          {project.slides.length > 1 && (
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <button
                type="button"
                onClick={() => handleSwitchScope('full')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                  scopeMode === 'full'
                    ? 'bg-[#00B050] text-white'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                الفيديو الكامل
              </button>
              <button
                type="button"
                onClick={() => handleSwitchScope('single')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                  scopeMode === 'single'
                    ? 'bg-[#00B050] text-white'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                سؤال محدد
              </button>
              <button
                type="button"
                onClick={() => handleSwitchScope('splitBatch')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                  scopeMode === 'splitBatch'
                    ? 'bg-[#00B050] text-white'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                كل سؤال مستقل
              </button>
            </div>
          )}

          {/* Idle controls for single slide or split batch mode */}
          {status === 'idle' && scopeMode === 'single' && (
            <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-[var(--ptxt)]">
                  اختر السؤال لتصديره كفيديو مستقل:
                </span>
                <select
                  value={selectedSlideIdx}
                  onChange={(e) => setSelectedSlideIdx(parseInt(e.target.value, 10))}
                  className="px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                >
                  {project.slides.map((sl, i) => (
                    <option key={sl.id} value={i}>
                      سؤال {i + 1}: {(sl.question || '').slice(0, 48)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => startSingleOrFullExport('single', selectedSlideIdx)}
                className="w-full py-2.5 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
              >
                بدء تصدير السؤال {selectedSlideIdx + 1}
              </button>
            </div>
          )}

          {status === 'idle' && scopeMode === 'splitBatch' && (
            <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <div className="flex items-start gap-2 text-xs text-[var(--ptxt)] leading-relaxed">
                <Layers className="w-4 h-4 text-[#00B050] shrink-0 mt-0.5" />
                <span>
                  سيتم تجهيز وحفظ <strong>{project.slides.length} فيديوهات شورتس مستقلة</strong>{' '}
                  (سؤال واحد في كل فيديو) بنفس التصميم والأصوات تباعاً.
                </span>
              </div>
              <button
                type="button"
                onClick={() => void startSplitBatchExport()}
                className="w-full py-2.5 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
              >
                تصدير وتنزيل كل الأسئلة ({project.slides.length} فيديو)
              </button>
            </div>
          )}

          {status === 'rendering' && (
            <div className="flex items-center gap-3.5 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <div className="shrink-0 rounded-lg overflow-hidden border border-[var(--pline)] bg-black/80 flex items-center justify-center">
                <canvas
                  ref={livePreviewCanvasRef}
                  width={miniPreviewW}
                  height={miniPreviewH}
                  className={isWideRatio ? 'w-24 h-[54px] object-contain' : 'w-[54px] h-24 object-contain'}
                />
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs gap-2">
                  <span className="truncate font-semibold">{progress.statusText || 'جارٍ التحضير...'}</span>
                  <span className="font-mono-nums text-[#00B050] font-bold shrink-0">
                    {Math.round(progress.progress * 100)}%
                  </span>
                </div>

                <div className="w-full h-2.5 rounded-full bg-[var(--panel)] overflow-hidden border border-[var(--pline)]">
                  <div
                    className="h-full bg-[#00B050] transition-all duration-150"
                    style={{ width: `${Math.round(progress.progress * 100)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-[var(--pmuted)] gap-2">
                  <span>{ratioLabel} · دمج صوت وصورة</span>
                  <span className="font-mono-nums shrink-0">
                    {progress.currentTime.toFixed(1)} / {progress.totalDuration.toFixed(1)} ث
                  </span>
                </div>
              </div>
            </div>
          )}

          {status === 'done' && videoUrl && result && (
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center gap-2 text-sm font-bold text-[#00B050]">
                <CheckCircle2 className="w-5 h-5" />
                <span>
                  {scopeMode === 'splitBatch'
                    ? `تم تجهيز وتنزيل ${batchDoneCount} فيديو بنجاح`
                    : 'تم تجهيز الفيديو بنجاح مع الأصوات'}
                </span>
              </div>

              <div className="w-full max-h-[250px] flex justify-center bg-black rounded-xl overflow-hidden border border-[var(--pline)]">
                <video
                  src={videoUrl}
                  controls
                  playsInline
                  className="h-[240px] w-auto object-contain"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-[var(--pmuted)]">
                <span>الصيغة: {result.extension.toUpperCase()}</span>
                <span className="font-mono-nums">
                  الحجم: {(result.blob.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>

              {saveNotice && (
                <div
                  className={`px-3 py-2 rounded-xl border text-xs leading-relaxed break-words ${
                    saveNotice.startsWith('تعذر')
                      ? 'bg-rose-500/12 border-rose-500/35 text-rose-600 dark:text-rose-300'
                      : 'bg-[#00B050]/12 border-[#00B050]/35 text-[#00B050] dark:text-[#6ee7b7]'
                  }`}
                >
                  {saveNotice}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleDownload()}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-60 text-white text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{isSaving ? 'جارٍ الحفظ...' : runningInAndroidApk ? 'حفظ في المعرض / التنزيلات' : 'تنزيل الفيديو'}</span>
                </button>
                <button
                  type="button"
                  disabled={isCapturingThumb}
                  onClick={() => void handleCaptureCover()}
                  title="حفظ صورة غلاف JPG بدقة كاملة"
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] disabled:opacity-50 text-xs font-bold transition-colors cursor-pointer"
                >
                  <Camera className="w-4 h-4 text-[#00B050]" />
                  <span>{isCapturingThumb ? '...' : 'غلاف JPG'}</span>
                </button>
                {canNativeShare && (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => void handleShareVideo(runningInAndroidApk)}
                    className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-60 ${
                      runningInAndroidApk
                        ? 'w-full justify-center bg-rose-600 hover:bg-rose-500 text-white'
                        : 'bg-[var(--surface)] border border-[#00B050]/40 text-[#00B050] dark:text-[#6ee7b7]'
                    }`}
                  >
                    {runningInAndroidApk && <Youtube className="w-4 h-4" />}
                    <span>
                      {runningInAndroidApk
                        ? 'مشاركة / رفع عبر تطبيق YouTube الآن (مع نسخ العنوان والوصف)'
                        : 'مشاركة / حفظ'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/35">
              <p className="text-xs sm:text-sm text-rose-400 leading-relaxed">{errorMsg}</p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (scopeMode === 'splitBatch') {
                      void startSplitBatchExport();
                    } else if (scopeMode === 'single') {
                      startSingleOrFullExport('single', selectedSlideIdx);
                    } else {
                      startSingleOrFullExport('full');
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>إعادة التصدير الآن</span>
                </button>
                {formatPref !== 'webm' && (
                  <button
                    type="button"
                    onClick={() => {
                      setFormatPref('webm');
                      if (scopeMode === 'splitBatch') {
                        void startSplitBatchExport('webm', resPref);
                      } else if (scopeMode === 'single') {
                        startSingleOrFullExport('single', selectedSlideIdx, 'webm', resPref);
                      } else {
                        startSingleOrFullExport('full', 0, 'webm', resPref);
                      }
                    }}
                    className="px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[#00B050] text-xs font-bold text-[var(--ptxt)] cursor-pointer"
                  >
                    تجربة صيغة WebM الآمنة
                  </button>
                )}
                {resPref !== '720p' && (
                  <button
                    type="button"
                    onClick={() => {
                      setResPref('720p');
                      if (scopeMode === 'splitBatch') {
                        void startSplitBatchExport(formatPref, '720p');
                      } else if (scopeMode === 'single') {
                        startSingleOrFullExport('single', selectedSlideIdx, formatPref, '720p');
                      } else {
                        startSingleOrFullExport('full', 0, formatPref, '720p');
                      }
                    }}
                    className="px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[#00B050] text-xs font-bold text-[var(--ptxt)] cursor-pointer"
                  >
                    تجربة دقة 720p السريعة
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 1. Direct YouTube Upload Section (Always Visible) */}
          <div className="rounded-xl bg-[var(--surface)] border border-rose-500/35 p-3.5 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setYtPanelOpen((v) => !v)}
              className="flex items-center justify-between w-full text-right cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Youtube className="w-4 h-4 text-rose-500 shrink-0" />
                <span className="text-xs font-extrabold text-[var(--ptxt)] truncate">
                  الرفع المباشر إلى قناتك على YouTube
                </span>
                {ytConnected && (
                  <span className="text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7] shrink-0">
                    · {ytChannel?.title || ytEmail || 'متصل'}
                  </span>
                )}
              </div>
              <span className="text-[11px] font-bold text-rose-500 dark:text-rose-400 shrink-0">
                {ytPanelOpen ? 'إخفاء' : 'فتح'}
              </span>
            </button>

            {ytPanelOpen && (
              <div className="flex flex-col gap-3 pt-2 border-t border-[var(--pline)]">
                {!ytConnected ? (
                  ytNativeMode === 'standalone-apk' ? (
                    <div className="flex flex-col gap-2.5 p-2.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] text-[var(--pmuted)] leading-relaxed">
                      <p className="font-bold text-[var(--ptxt)]">
                        النشر أو تسجيل الدخول من تطبيق الأندرويد (APK):
                      </p>
                      <button
                        type="button"
                        onClick={() => launchWebLinkLoginForApk(getWebLoginBaseUrl())}
                        className="flex items-center justify-center gap-2 w-full py-2.5 px-3 rounded-xl bg-white hover:bg-[#f8f9fa] text-[#1f1f1f] border border-[#747775]/45 text-xs font-extrabold shadow-sm transition-colors cursor-pointer"
                      >
                        <ExternalLink className="w-4 h-4 text-[#4285F4]" />
                        <span>تسجيل الدخول عبر رابط الموقع (Chrome) والعودة للتطبيق</span>
                      </button>
                      <p>
                        أو بعد اكتمال التصدير بالأعلى، يُحفظ الفيديو تلقائياً في المعرض ويمكنك ضغط زر{' '}
                        <strong className="text-rose-400">«مشاركة / رفع عبر تطبيق YouTube الآن»</strong>{' '}
                        لإرسال الفيديو مباشرة إلى تطبيق يوتيوب.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <p className="text-[11px] text-[var(--pmuted)] leading-relaxed">
                        اختر أي حساب Google أو قناة يوتيوب تريد الرفع عليها:
                      </p>
                      <GoogleSignInButton
                        loading={isConnectingYt}
                        label="تسجيل الدخول بحساب Google / ربط قناة"
                        onClick={() => void onConnectYouTube()}
                      />
                    </div>
                  )
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                      <div className="flex items-center gap-2 min-w-0">
                        {ytChannel?.thumbnailUrl ? (
                          <img
                            src={ytChannel.thumbnailUrl}
                            alt={ytChannel.title}
                            className="w-7 h-7 rounded-full shrink-0"
                          />
                        ) : (
                          <Youtube className="w-4 h-4 text-rose-500 shrink-0" />
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold truncate">
                            {ytChannel?.title || 'حساب Google متصل'}
                          </span>
                          {ytEmail && (
                            <span className="text-[10px] text-[var(--pmuted)] truncate" dir="ltr">
                              {ytEmail}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={isConnectingYt}
                          onClick={() => void onConnectYouTube()}
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] text-[10px] font-bold cursor-pointer"
                        >
                          <RefreshCw className={`w-3 h-3 text-[#00B050] ${isConnectingYt ? 'animate-spin' : ''}`} />
                          <span>تبديل</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDisconnectYouTube()}
                          className="flex items-center gap-1 text-[11px] text-[var(--pmuted)] hover:text-rose-400 cursor-pointer shrink-0"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>خروج</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'private', label: 'خاص (آمن)' },
                          { id: 'unlisted', label: 'غير مدرج' },
                          { id: 'public', label: 'علني مباشرة' },
                        ] as { id: YouTubePrivacyStatus; label: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={ytUseSchedule}
                          onClick={() => onChangePrivacy(opt.id)}
                          className={`py-1.5 px-2 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer ${
                            !ytUseSchedule && ytPrivacy === opt.id
                              ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                              : 'bg-[var(--panel)] border-[var(--pline)] text-[var(--pmuted)]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={ytUseSchedule}
                          onChange={(e) => onChangeUseSchedule(e.target.checked)}
                          className="accent-[#00B050]"
                        />
                        <CalendarClock className="w-3.5 h-3.5 text-[var(--gold)]" />
                        <span>جدولة موعد النشر</span>
                      </label>
                      {ytUseSchedule && (
                        <input
                          type="datetime-local"
                          value={ytScheduleLocal}
                          onChange={(e) => onChangeScheduleLocal(e.target.value)}
                          className="px-2 py-1 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px]"
                        />
                      )}
                    </div>

                    {ytPlaylists.length > 0 && (
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-[var(--pmuted)]">
                          إضافة إلى قائمة تشغيل (اختياري):
                        </span>
                        <select
                          value={selectedPlaylistId}
                          onChange={(e) => onSelectPlaylistId(e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs"
                        >
                          <option value="">بدون قائمة تشغيل</option>
                          {ytPlaylists.map((pl) => (
                            <option key={pl.id} value={pl.id}>
                              {pl.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    <label className="flex items-center gap-2 text-[11px] font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ytAutoPostComment}
                        onChange={(e) => onChangeAutoPostComment(e.target.checked)}
                        className="accent-[#00B050]"
                      />
                      <span>نشر التعليق التفاعلي تلقائياً تحت الفيديو (عند النشر كغير مدرج أو علني)</span>
                    </label>

                    {onOpenThumbnailStudio && (
                      <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                        <div className="flex items-center gap-2 min-w-0">
                          {customThumbnailPreviewUrl ? (
                            <img
                              src={customThumbnailPreviewUrl}
                              alt="غلاف مخصص"
                              className="w-12 h-8 rounded object-cover border border-[#00B050]/50 shrink-0"
                            />
                          ) : (
                            <ImageIcon className="w-4 h-4 text-[var(--gold)] shrink-0" />
                          )}
                          <span className="text-[11px] font-bold truncate">
                            {customThumbnailPreviewUrl
                              ? 'غلاف مصغّر مخصص جاهز للرفع ✅'
                              : 'إرفاق غلاف مصغّر مخصص (Thumbnail)'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenThumbnailStudio();
                          }}
                          className="px-2.5 py-1 rounded-md bg-[var(--surface)] border border-[var(--gold)]/60 text-[10px] font-extrabold text-[var(--gold)] shrink-0 cursor-pointer"
                        >
                          {customThumbnailPreviewUrl ? 'تعديل' : 'تصميم الغلاف'}
                        </button>
                      </div>
                    )}

                    {!confirmUploadOpen && !isUploadingYt && (
                      <button
                        type="button"
                        disabled={status !== 'done' || !result}
                        onClick={() => {
                          setYtError('');
                          setConfirmUploadOpen(true);
                        }}
                        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer disabled:cursor-not-allowed"
                      >
                        <UploadCloud className="w-4 h-4" />
                        <span>
                          {status === 'done' && result
                            ? 'رفع الفيديو إلى YouTube'
                            : 'بانتظار اكتمال تجهيز الفيديو للرفع...'}
                        </span>
                      </button>
                    )}

                    {confirmUploadOpen && !isUploadingYt && (
                      <div className="p-3 rounded-xl bg-[var(--panel)] border border-amber-500/45 flex flex-col gap-2.5">
                        <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                          تأكيد النشر على قناة YouTube:
                        </p>
                        <ul className="text-[11px] text-[var(--pmuted)] space-y-1">
                          <li>
                            • القناة: {ytChannel?.title || 'القناة المتصلة'}
                            {ytEmail ? ` (${ytEmail})` : ''}
                          </li>
                          <li>• العنوان: {publishKit.title}</li>
                          <li>
                            • الحالة:{' '}
                            {ytUseSchedule
                              ? `مجدول (${ytScheduleLocal})`
                              : ytPrivacy === 'public'
                                ? 'علني (يظهر للجميع فوراً)'
                                : ytPrivacy === 'unlisted'
                                  ? 'غير مدرج'
                                  : 'خاص (يظهر لك فقط)'}
                          </li>
                          <li>
                            • التعليق التلقائي:{' '}
                            {ytAutoPostComment && publishKit.pinnedComment.trim()
                              ? 'مفعّل'
                              : 'غير مفعّل'}
                          </li>
                        </ul>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleConfirmYouTubeUpload()}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>تأكيد الرفع الآن</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmUploadOpen(false)}
                            className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs font-semibold cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}

                    {isUploadingYt && (
                      <div className="flex flex-col gap-2 p-2.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                        <div className="flex items-center justify-between text-[11px]">
                          <span>{ytUploadStage}</span>
                          <span className="font-mono-nums font-bold text-[#00B050]">
                            {ytUploadPct}%
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-[var(--surface)] overflow-hidden">
                          <div
                            className="h-full bg-rose-500 transition-all duration-150"
                            style={{ width: `${ytUploadPct}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {effectiveYtError && (
                  <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/35 text-[11px] text-rose-600 dark:text-rose-300 leading-relaxed">
                    {effectiveYtError}
                  </div>
                )}

                {ytResult && (
                  <div className="p-3 rounded-xl bg-[#00B050]/12 border border-[#00B050]/40 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#00B050] dark:text-[#6ee7b7]">
                        تم رفع الفيديو إلى YouTube بنجاح!
                      </span>
                      <a
                        href={ytResult.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#00B050] text-white text-[11px] font-bold"
                      >
                        <span>فتح الفيديو</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    {ytResult.thumbnailApplied && (
                      <p className="text-[11px] text-[#00B050] dark:text-[#6ee7b7] font-bold">
                        ✓ تم رفع وتعيين صورة الغلاف المصغّر المخصصة بنجاح!
                      </p>
                    )}
                    {ytResult.thumbnailNote && (
                      <p className="text-[11px] text-amber-300 leading-relaxed">
                        {ytResult.thumbnailNote}
                      </p>
                    )}
                    {ytResult.commentNote && (
                      <p className="text-[11px] text-[var(--ptxt)] leading-relaxed">
                        {ytResult.commentNote}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. AI YouTube Publishing Kit Section (Always Visible) */}
          <div className="rounded-xl bg-[var(--surface)] border border-[var(--pline)] p-3.5 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--gold)]" />
                <span className="text-xs font-extrabold text-[var(--ptxt)]">
                  حزمة النشر على YouTube (عنوان · وصف · هاشتاغات · تعليق)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={isGeneratingKit}
                  onClick={() => void handleGeneratePublishKit()}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-60 text-white text-[11px] font-bold cursor-pointer"
                >
                  {isGeneratingKit ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{isGeneratingKit ? 'جارٍ التوليد...' : 'توليد بالذكاء الاصطناعي'}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void copyText(
                      'all',
                      `العنوان:\n${publishKit.title}\n\nالوصف:\n${publishKit.description}\n\nالكلمات المفتاحية:\n${tagsInput}\n\nالتعليق المثبت:\n${publishKit.pinnedComment}`
                    )
                  }
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[var(--gold)] text-[11px] font-bold cursor-pointer"
                >
                  {copiedField === 'all' ? (
                    <Check className="w-3.5 h-3.5 text-[#00B050]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-[var(--gold)]" />
                  )}
                  <span>{copiedField === 'all' ? 'تم النسخ' : 'نسخ الكل'}</span>
                </button>
              </div>
            </div>

            {kitError && (
              <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/35 text-[11px] text-rose-600 dark:text-rose-300">
                {kitError}
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[var(--pmuted)]">عنوان الفيديو</span>
                  <button
                    type="button"
                    onClick={() => void copyText('title', publishKit.title)}
                    className="text-[10px] text-[#00B050] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === 'title' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedField === 'title' ? 'نُسخ' : 'نسخ'}</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={publishKit.title}
                  onChange={(e) =>
                    onUpdatePublishKit((p) => ({ ...p, title: e.target.value }))
                  }
                  maxLength={100}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[var(--pmuted)]">
                    الوصف والهاشتاغات
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyText('desc', publishKit.description)}
                    className="text-[10px] text-[#00B050] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === 'desc' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedField === 'desc' ? 'نُسخ' : 'نسخ'}</span>
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={publishKit.description}
                  onChange={(e) =>
                    onUpdatePublishKit((p) => ({ ...p, description: e.target.value }))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none resize-y"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[var(--pmuted)]">
                    الكلمات المفتاحية (Tags - مفصولة بفاصلة)
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyText('tags', tagsInput)}
                    className="text-[10px] text-[#00B050] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === 'tags' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedField === 'tags' ? 'نُسخ' : 'نسخ'}</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => onUpdateTagsInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[var(--pmuted)]">
                    التعليق التفاعلي الجاهز للتثبيت
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyText('comment', publishKit.pinnedComment)}
                    className="text-[10px] text-[#00B050] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === 'comment' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedField === 'comment' ? 'نُسخ' : 'نسخ'}</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={publishKit.pinnedComment}
                  onChange={(e) =>
                    onUpdatePublishKit((p) => ({ ...p, pinnedComment: e.target.value }))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCancelAndClose}
            className="w-full py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-xs font-semibold transition-colors cursor-pointer"
          >
            {status === 'rendering' ? 'إلغاء التصدير وإغلاق' : 'إغلاق'}
          </button>
        </div>
      </div>
    </div>
  );
};
