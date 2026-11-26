import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Film,
  Info,
  Loader2,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Upload,
  UserCheck,
  Video,
  X,
} from 'lucide-react';
import { registerAiPresenterBlob } from '../canvas/aiPresenterMedia';
import {
  AiPresenterBackgroundSettingsPayload,
  AiPresenterStatusResponse,
  AiPresenterVideoStatus,
  GenerateAiPresenterRequest,
  TavusReplicaItem,
  downloadAiPresenterMediaBlob,
  fetchAiPresenterStatus,
  fetchAiPresenterVideoStatus,
  fetchAiPresenterVideosList,
  fetchTavusReplicas,
  resolvePresenterApiUrl,
  submitAiPresenterGeneration,
} from '../services/aiPresenterClient';
import { deleteAiMediaBlob, readFileAsDataUrl } from '../storage/projectStore';
import {
  AiPresenterBgMode,
  AiPresenterOverlay,
  AiPresenterScope,
  PRESET_BACKDROPS,
  QuestionSlide,
  TemplateSettings,
} from '../types/quiz';
import { AiPresenterEditorControls } from './AiPresenterEditorControls';

function getEditorSceneBackdropSummary(template: TemplateSettings): {
  bgColor: string;
  bgImageDataUrl?: string;
  sceneLabel: string;
  swatches: string[];
} {
  const preset = PRESET_BACKDROPS.find((p) => p.id === template.presetId);
  const sceneBgColor =
    template.backgroundType === 'color'
      ? template.solidBgColor || '#0b1220'
      : preset?.swatchColor || preset?.gradientOuter || template.solidBgColor || '#0b1220';

  const bgImageDataUrl =
    template.backgroundType === 'custom' && template.customBgDataUrl
      ? template.customBgDataUrl
      : undefined;

  const sceneLabel =
    template.backgroundType === 'custom'
      ? template.customBgName || 'صورة خلفية المشروع'
      : template.backgroundType === 'color'
        ? `لون مشهد المشروع (${sceneBgColor})`
        : preset?.label || 'مشهد المحرر الحالي';

  const rawSwatches = [
    sceneBgColor,
    template.questionBoxColor,
    template.badgeBgColor,
    '#FFFFFF',
    '#0B1220',
    '#00B050',
  ];
  const uniqueSwatches: string[] = [];
  for (const c of rawSwatches) {
    const clean = (c || '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(clean) && !uniqueSwatches.some((u) => u.toLowerCase() === clean.toLowerCase())) {
      uniqueSwatches.push(clean);
    }
  }

  return {
    bgColor: sceneBgColor,
    bgImageDataUrl,
    sceneLabel,
    swatches: uniqueSwatches.slice(0, 6),
  };
}

function buildSolidColorPngDataUrl(hexColor: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = /^#[0-9a-f]{3,8}$/i.test(hexColor.trim()) ? hexColor.trim() : '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function buildBackgroundApiPayload(opts: {
  bgMode: AiPresenterBgMode;
  bgColor: string;
  customBgDataUrl?: string;
  customBgUrlInput: string;
  bakeIntoVideo: boolean;
  matchedEditorScene: boolean;
}): Pick<
  GenerateAiPresenterRequest,
  | 'transparent_background'
  | 'background_mode'
  | 'background_color'
  | 'background_url'
  | 'background_data_url'
  | 'background_settings'
> {
  const cleanUrl = opts.customBgUrlInput.trim();
  const hasHttpsUrl = opts.bgMode === 'customImage' && /^https:\/\//i.test(cleanUrl);
  const resolvedColor =
    opts.bgMode === 'white' ? '#FFFFFF' : opts.bgMode === 'color' ? opts.bgColor : undefined;

  // Transparent mode always uses alpha WebM; external HTTPS custom URL without local upload bakes directly via background_url;
  // white/color/uploaded-image use alpha WebM by default unless user explicitly asks to bake into API video.
  const shouldBakeIntoApi =
    opts.bgMode !== 'transparent' &&
    opts.bgMode !== 'original' &&
    (opts.bakeIntoVideo || (hasHttpsUrl && !opts.customBgDataUrl));

  const useTransparentAlpha =
    opts.bgMode === 'transparent' ||
    ((opts.bgMode === 'white' || opts.bgMode === 'color' || opts.bgMode === 'customImage') &&
      !shouldBakeIntoApi);

  const settings: AiPresenterBackgroundSettingsPayload = {
    mode: opts.bgMode,
    transparent_background: useTransparentAlpha,
    bake_into_video: shouldBakeIntoApi,
    ...(resolvedColor ? { color: resolvedColor } : {}),
    ...(hasHttpsUrl ? { background_url: cleanUrl } : {}),
    ...(opts.bgMode === 'customImage' && opts.customBgDataUrl ? { has_custom_image: true } : {}),
    ...(opts.matchedEditorScene ? { matched_editor_scene: true } : {}),
  };

  const payload: Pick<
    GenerateAiPresenterRequest,
    | 'transparent_background'
    | 'background_mode'
    | 'background_color'
    | 'background_url'
    | 'background_data_url'
    | 'background_settings'
  > = {
    transparent_background: useTransparentAlpha,
    background_mode: opts.bgMode,
    background_settings: settings,
  };

  if (resolvedColor) {
    payload.background_color = resolvedColor;
  }

  if (shouldBakeIntoApi) {
    if (hasHttpsUrl) {
      payload.background_url = cleanUrl;
    } else if (opts.bgMode === 'customImage' && opts.customBgDataUrl) {
      payload.background_data_url = opts.customBgDataUrl;
    } else if (resolvedColor) {
      const solidPng = buildSolidColorPngDataUrl(resolvedColor);
      if (solidPng) {
        payload.background_data_url = solidPng;
      }
    }
  }

  return payload;
}

interface AiPresenterStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  template: TemplateSettings;
  slides: QuestionSlide[];
  activeSlideIndex: number;
  onUpdateTemplate: (next: TemplateSettings, immediate?: boolean) => void;
  onConnectionChecked?: (configured: boolean) => void;
}

type StudioInnerTab = 'create' | 'manage';
type VoiceMode = 'script' | 'audioUrl' | 'localAudio';

export const AiPresenterStudioModal: React.FC<AiPresenterStudioModalProps> = ({
  isOpen,
  onClose,
  template,
  slides,
  activeSlideIndex,
  onUpdateTemplate,
  onConnectionChecked,
}) => {
  const existingAi = template.aiPresenter;
  const [innerTab, setInnerTab] = useState<StudioInnerTab>(existingAi ? 'create' : 'create');

  const [statusInfo, setStatusInfo] = useState<AiPresenterStatusResponse | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);

  const [replicas, setReplicas] = useState<TavusReplicaItem[]>([]);
  const [isLoadingReplicas, setIsLoadingReplicas] = useState(false);
  const [replicaError, setReplicaError] = useState('');
  const [selectedReplicaId, setSelectedReplicaId] = useState('');
  const [previewReplicaId, setPreviewReplicaId] = useState<string | null>(null);

  const [scriptText, setScriptText] = useState('');
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('script');
  const [audioUrlInput, setAudioUrlInput] = useState('');
  const [localAudioDataUrl, setLocalAudioDataUrl] = useState('');
  const [localAudioName, setLocalAudioName] = useState('');

  const [bgMode, setBgMode] = useState<AiPresenterBgMode>('transparent');
  const [bgColor, setBgColor] = useState('#FFFFFF');
  const [customBgDataUrl, setCustomBgDataUrl] = useState<string | undefined>(undefined);
  const [customBgUrlInput, setCustomBgUrlInput] = useState('');
  const [bakeBackgroundIntoApi, setBakeBackgroundIntoApi] = useState(false);
  const [fastRender, setFastRender] = useState(true);

  const [isGenerating, setIsGenerating] = useState(false);
  const [genStatusText, setGenStatusText] = useState('');
  const [genProgressPct, setGenProgressPct] = useState(0);
  const [genError, setGenError] = useState('');

  const [generatedMedia, setGeneratedMedia] = useState<{
    videoId: string;
    replicaId: string;
    replicaName: string;
    script: string;
    voiceSource: VoiceMode;
    blob: Blob;
    mimeType: 'video/mp4' | 'video/webm';
    previewUrl: string;
    duration: number;
    transparentRequested: boolean;
    fastRequested: boolean;
    bgMode: AiPresenterBgMode;
    bgColor: string;
    customBgDataUrl?: string;
  } | null>(null);

  const [insertScope, setInsertScope] = useState<AiPresenterScope>('fullTimeline');
  const [afterSpeechBehavior, setAfterSpeechBehavior] = useState<'stayIdle' | 'loop' | 'hide'>('stayIdle');
  const [startPhase, setStartPhase] = useState<'timelineStart' | 'firstQuestion'>('timelineStart');
  const [tavusVideos, setTavusVideos] = useState<AiPresenterVideoStatus[]>([]);
  const [isLoadingTavusVideos, setIsLoadingTavusVideos] = useState(false);
  const [importingVideoId, setImportingVideoId] = useState<string | null>(null);

  const cancelPollRef = useRef(false);
  const customBgFileRef = useRef<HTMLInputElement | null>(null);
  const localAudioFileRef = useRef<HTMLInputElement | null>(null);
  const PENDING_JOB_STORAGE_KEY = 'ai_presenter_pending_job_v1';

  const loadReadyVideoIntoPreview = async (
    st: AiPresenterVideoStatus,
    overrideMeta?: {
      replicaId?: string;
      replicaName?: string;
      script?: string;
      voiceSource?: VoiceMode;
      transparentRequested?: boolean;
      fastRequested?: boolean;
      bgMode?: AiPresenterBgMode;
      bgColor?: string;
      customBgDataUrl?: string;
    }
  ) => {
    const fallbackDur = Math.max(2, Math.round(scriptText.trim().split(/\s+/).filter(Boolean).length / 2.2) || 6);
    const primaryEndpoint =
      st.proxiedDownloadUrl ||
      st.proxiedStreamUrl ||
      st.downloadUrl ||
      st.streamUrl;

    if (!primaryEndpoint) {
      throw new Error('اكتمل التوليد لكن لم يصل رابط تنزيل الفيديو.');
    }

    setGenProgressPct(95);
    setGenStatusText('جارٍ تحميل الفيديو وتجهيزه داخل الاستوديو...');

    let downloaded: { blob: Blob; mimeType: 'video/mp4' | 'video/webm' };
    try {
      downloaded = await downloadAiPresenterMediaBlob(primaryEndpoint);
    } catch (primaryErr) {
      const altEndpoint = st.proxiedStreamUrl && st.proxiedStreamUrl !== primaryEndpoint ? st.proxiedStreamUrl : '';
      if (!altEndpoint) throw primaryErr;
      downloaded = await downloadAiPresenterMediaBlob(altEndpoint);
    }
    const { blob, mimeType } = downloaded;
    const previewUrl = URL.createObjectURL(blob);

    const duration = await new Promise<number>((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        resolve(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : fallbackDur);
      };
      v.onerror = () => resolve(fallbackDur);
      v.src = previewUrl;
    });

    if (generatedMedia?.previewUrl) {
      try {
        URL.revokeObjectURL(generatedMedia.previewUrl);
      } catch {
        // ignore
      }
    }

    const wasTransparent =
      overrideMeta?.transparentRequested ??
      (mimeType === 'video/webm' ? true : Boolean(previewBgPayload.transparent_background));

    setGeneratedMedia({
      videoId: st.videoId,
      replicaId: overrideMeta?.replicaId ?? selectedReplicaId,
      replicaName:
        overrideMeta?.replicaName ??
        selectedReplica?.replicaName ??
        st.videoName ??
        'الراوي الذكي',
      script: overrideMeta?.script ?? scriptText.trim(),
      voiceSource: overrideMeta?.voiceSource ?? voiceMode,
      blob,
      mimeType,
      previewUrl,
      duration,
      transparentRequested: wasTransparent,
      fastRequested: overrideMeta?.fastRequested ?? fastRender,
      bgMode: overrideMeta?.bgMode ?? (mimeType === 'video/webm' ? bgMode : 'original'),
      bgColor: overrideMeta?.bgColor ?? (bgMode === 'white' ? '#FFFFFF' : bgColor),
      customBgDataUrl: overrideMeta?.customBgDataUrl ?? customBgDataUrl,
    });

    setGenProgressPct(100);
    setGenStatusText('اكتمل فيديو الراوي البشري الحقيقي! اضغط «إدراج في الفيديو» بالأسفل.');
  };

  const pollVideoUntilReady = async (
    videoId: string,
    overrideMeta?: Parameters<typeof loadReadyVideoIntoPreview>[1]
  ) => {
    setIsGenerating(true);
    setGenError('');
    const maxPolls = 90;
    let completedStatus: AiPresenterVideoStatus | null = null;

    try {
      for (let attempt = 0; attempt < maxPolls; attempt++) {
        if (cancelPollRef.current) return;
        const st = await fetchAiPresenterVideoStatus(videoId);
        const progMatch = (st.generationProgress || '').match(/(\d+)\s*\/\s*100/);
        const pct = progMatch
          ? Math.min(92, Math.max(18, parseInt(progMatch[1], 10)))
          : Math.min(88, 18 + attempt * 3);
        setGenProgressPct(pct);

        if (st.status === 'ready') {
          completedStatus = st;
          break;
        }
        if (st.status === 'error' || st.status === 'deleted') {
          try {
            localStorage.removeItem(PENDING_JOB_STORAGE_KEY);
          } catch {
            // ignore
          }
          throw new Error(st.statusDetails || 'فشل توليد الفيديو في خادم Tavus.');
        }

        setGenStatusText(
          st.generationProgress
            ? `جارٍ التوليد الواقعي ومزامنة الشفاه (${st.generationProgress})...`
            : `الحالة: ${st.status} — جارٍ المعالجة...`
        );

        await new Promise((r) => window.setTimeout(r, 3000));
      }

      if (cancelPollRef.current) return;

      if (!completedStatus) {
        throw new Error('استغرق التوليد وقتاً أطول من المتوقع. سيظهر الفيديو في سجل Tavus فور اكتماله.');
      }

      try {
        localStorage.removeItem(PENDING_JOB_STORAGE_KEY);
      } catch {
        // ignore
      }

      await loadReadyVideoIntoPreview(completedStatus, overrideMeta);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'تعذر متابعة/تحميل فيديو الراوي.');
    } finally {
      setIsGenerating(false);
    }
  };

  const loadTavusVideosList = async () => {
    setIsLoadingTavusVideos(true);
    try {
      const vids = await fetchAiPresenterVideosList();
      setTavusVideos(vids);
    } catch (err) {
      setReplicaError(
        err instanceof Error ? err.message : 'تعذر تحديث قائمة الفيديوهات من Tavus.'
      );
    } finally {
      setIsLoadingTavusVideos(false);
    }
  };

  const loadStatusAndReplicas = async () => {
    setIsLoadingStatus(true);
    setReplicaError('');
    try {
      const st = await fetchAiPresenterStatus();
      setStatusInfo(st);
      onConnectionChecked?.(st.configured);
      if (st.configured) {
        setIsLoadingReplicas(true);
        try {
          const [list, vids] = await Promise.all([
            fetchTavusReplicas(),
            fetchAiPresenterVideosList().catch(() => [] as AiPresenterVideoStatus[]),
          ]);
          setReplicas(list);
          setTavusVideos(vids);
          if (list.length > 0 && !selectedReplicaId) {
            setSelectedReplicaId(list[0].replicaId);
          }

          // Resume tracking if user previously closed the modal mid-generation
          let savedPendingId = '';
          try {
            savedPendingId = localStorage.getItem(PENDING_JOB_STORAGE_KEY) || '';
          } catch {
            savedPendingId = '';
          }
          if (savedPendingId && !isGenerating && !generatedMedia) {
            const matchVid = vids.find((v) => v.videoId === savedPendingId);
            if (matchVid?.status === 'ready') {
              try {
                localStorage.removeItem(PENDING_JOB_STORAGE_KEY);
              } catch {
                // ignore
              }
              await loadReadyVideoIntoPreview(matchVid);
            } else if (
              !matchVid ||
              matchVid.status === 'queued' ||
              matchVid.status === 'generating'
            ) {
              setGenProgressPct(20);
              setGenStatusText(`استكمال متابعة طلبك السابق (${savedPendingId})...`);
              void pollVideoUntilReady(savedPendingId);
            }
          }
        } catch (err) {
          setReplicaError(
            err instanceof Error ? err.message : 'تعذر جلب قائمة الشخصيات الحقيقية من Tavus.'
          );
        } finally {
          setIsLoadingReplicas(false);
        }
      } else {
        setReplicas([]);
        setTavusVideos([]);
      }
    } catch (err) {
      setReplicaError(
        err instanceof Error ? err.message : 'تعذر التحقق من حالة خدمة AI Presenter.'
      );
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      cancelPollRef.current = true;
      return;
    }
    cancelPollRef.current = false;
    void loadStatusAndReplicas();
    if (!scriptText.trim()) {
      const activeQ = slides[activeSlideIndex]?.question?.trim();
      const hookT = template.introHookText?.trim();
      const combined = [hookT, activeQ].filter(Boolean).join(' — ');
      setScriptText(
        combined || 'أهلاً بكم في تحدي المعلومات! هل تستطيع حل هذا السؤال قبل انتهاء الوقت؟'
      );
    }
    return () => {
      cancelPollRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (generatedMedia?.previewUrl) {
        try {
          URL.revokeObjectURL(generatedMedia.previewUrl);
        } catch {
          // ignore
        }
      }
    };
  }, [generatedMedia]);

  if (!isOpen) return null;

  const editorScene = getEditorSceneBackdropSummary(template);
  const selectedReplica = replicas.find((r) => r.replicaId === selectedReplicaId);
  const wordCount = scriptText
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const estSeconds = Math.max(2, Math.round(wordCount / 2.2));

  const isMatchedEditorScene =
    (bgMode === 'color' && bgColor.toLowerCase() === editorScene.bgColor.toLowerCase()) ||
    (bgMode === 'customImage' &&
      Boolean(editorScene.bgImageDataUrl && customBgDataUrl === editorScene.bgImageDataUrl));

  const previewBgPayload = buildBackgroundApiPayload({
    bgMode,
    bgColor,
    customBgDataUrl,
    customBgUrlInput,
    bakeIntoVideo: bakeBackgroundIntoApi,
    matchedEditorScene: isMatchedEditorScene,
  });

  const handleMatchEditorScene = () => {
    if (editorScene.bgImageDataUrl) {
      setCustomBgDataUrl(editorScene.bgImageDataUrl);
      setCustomBgUrlInput('');
      setBgMode('customImage');
      return;
    }
    setBgColor(editorScene.bgColor);
    setBgMode('color');
  };

  const handleUploadBgImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCustomBgDataUrl(dataUrl);
      setCustomBgUrlInput('');
      setBgMode('customImage');
      setGenError('');
    } catch {
      // ignore
    }
  };

  const handleUploadLocalAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8.5 * 1024 * 1024) {
      setGenError('حجم الملف الصوتي يجب أن يكون أقل من 8.5 ميجابايت.');
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setLocalAudioDataUrl(dataUrl);
      setLocalAudioName(file.name);
      setVoiceMode('localAudio');
      setGenError('');
    } catch {
      setGenError('تعذر قراءة الملف الصوتي.');
    }
  };

  const handleGenerate = async () => {
    setGenError('');
    if (!statusInfo?.configured) {
      setGenError('يرجى إضافة TAVUS_API_KEY في Settings > Secrets ثم الضغط على إعادة فحص الاتصال.');
      return;
    }
    if (!selectedReplicaId) {
      setGenError('اختر شخصية بشرية حقيقية من القائمة أولاً.');
      return;
    }
    if (voiceMode === 'script' && !scriptText.trim()) {
      setGenError('يرجى كتابة النص الذي سيتحدثه الراوي.');
      return;
    }
    if (voiceMode === 'audioUrl' && !audioUrlInput.trim().startsWith('https://')) {
      setGenError('أدخل رابط صوت HTTPS عام وصالح (.mp3 أو .wav).');
      return;
    }
    if (voiceMode === 'localAudio' && !localAudioDataUrl) {
      setGenError('اختر ملفاً صوتياً محلياً أولاً.');
      return;
    }
    if (bgMode === 'customImage') {
      const cleanBgUrl = customBgUrlInput.trim();
      if (cleanBgUrl && !/^https:\/\//i.test(cleanBgUrl)) {
        setGenError('رابط الخلفية المخصصة يجب أن يبدأ بـ https:// ويكون متاحاً للوصول العام.');
        return;
      }
      if (!customBgDataUrl && !cleanBgUrl) {
        setGenError('اختر صورة خلفية مخصصة من جهازك، أو التقط خلفية مشهد المحرر، أو أدخل رابط HTTPS.');
        return;
      }
    }

    setIsGenerating(true);
    setGenProgressPct(6);
    setGenStatusText('جارٍ إرسال الطلب مع إعدادات الخلفية إلى Tavus API...');
    cancelPollRef.current = false;

    try {
      const bgPayload = buildBackgroundApiPayload({
        bgMode,
        bgColor,
        customBgDataUrl,
        customBgUrlInput,
        bakeIntoVideo: bakeBackgroundIntoApi,
        matchedEditorScene: isMatchedEditorScene,
      });

      const requestJson: GenerateAiPresenterRequest = {
        replica_id: selectedReplicaId,
        ...(voiceMode === 'script'
          ? { script: scriptText.trim() }
          : voiceMode === 'audioUrl'
            ? { audio_url: audioUrlInput.trim() }
            : { audio_data_url: localAudioDataUrl }),
        video_name: `ShortVedio0_${Date.now()}`,
        fast: bgPayload.transparent_background ? true : fastRender,
        ...bgPayload,
      };

      const job = await submitAiPresenterGeneration(requestJson);
      try {
        localStorage.setItem(PENDING_JOB_STORAGE_KEY, job.videoId);
      } catch {
        // ignore
      }

      setGenProgressPct(15);
      setGenStatusText(`تم قبول الطلب (${job.videoId}) — جارٍ المعالجة في Tavus...`);

      await new Promise((r) => window.setTimeout(r, 2500));
      await pollVideoUntilReady(job.videoId, {
        replicaId: selectedReplicaId,
        replicaName: selectedReplica?.replicaName || 'الراوي الذكي',
        script: scriptText.trim(),
        voiceSource: voiceMode,
        transparentRequested: Boolean(bgPayload.transparent_background),
        fastRequested: Boolean(requestJson.fast),
        bgMode,
        bgColor: bgMode === 'white' ? '#FFFFFF' : bgColor,
        customBgDataUrl,
      });
      void loadTavusVideosList();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'تعذر إنشاء فيديو الراوي.');
      setIsGenerating(false);
    }
  };

  const handleImportExistingTavusVideo = async (vid: AiPresenterVideoStatus) => {
    if (importingVideoId) return;
    setImportingVideoId(vid.videoId);
    setGenError('');
    try {
      const primaryEndpoint =
        vid.proxiedDownloadUrl || vid.proxiedStreamUrl || vid.downloadUrl || vid.streamUrl;
      if (!primaryEndpoint) {
        throw new Error('رابط هذا الفيديو غير متاح حالياً.');
      }
      let downloaded: { blob: Blob; mimeType: 'video/mp4' | 'video/webm' };
      try {
        downloaded = await downloadAiPresenterMediaBlob(primaryEndpoint);
      } catch (primaryErr) {
        const altEndpoint = vid.proxiedStreamUrl && vid.proxiedStreamUrl !== primaryEndpoint ? vid.proxiedStreamUrl : '';
        if (!altEndpoint) throw primaryErr;
        downloaded = await downloadAiPresenterMediaBlob(altEndpoint);
      }
      const { blob, mimeType } = downloaded;
      const previewUrl = URL.createObjectURL(blob);
      const duration = await new Promise<number>((resolve) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => {
          resolve(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 6);
        };
        v.onerror = () => resolve(6);
        v.src = previewUrl;
      });

      const mediaKey = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await registerAiPresenterBlob(mediaKey, blob, mimeType, true);

      const isAlpha = mimeType === 'video/webm';
      const newOverlay: AiPresenterOverlay = {
        enabled: true,
        provider: 'tavus',
        videoId: vid.videoId,
        replicaId: selectedReplicaId || 'tavus',
        replicaName: vid.videoName || 'الراوي الذكي',
        script: '',
        voiceSource: 'script',
        transparentRequested: isAlpha,
        fastRequested: true,
        mimeType,
        naturalDuration: duration,
        mediaKey,
        scope: insertScope,
        targetSlideIndex: activeSlideIndex,
        placement: 'bottomCenter',
        x: 50,
        y: 82,
        scale: 95,
        frameShape: isAlpha ? 'cutout' : 'broadcastCard',
        bgMode: isAlpha ? 'transparent' : 'original',
        bgColor: '#FFFFFF',
        trimStart: 0,
        trimEnd: duration,
        startOffset: 0,
        displayDuration: 0,
        volume: 1,
        muteOtherVoices: true,
        showNameBadge: false,
        fullscreenInIntro: false,
        fullscreenInOutro: false,
        afterSpeechBehavior:
          insertScope === 'fullTimeline' || insertScope === 'allSlides'
            ? afterSpeechBehavior
            : 'hide',
        startPhase,
      };

      const nextTemplate: TemplateSettings = {
        ...template,
        aiPresenter: newOverlay,
        ...(insertScope === 'intro'
          ? {
              showIntroHook: true,
              introHookDuration: Math.max(
                template.introHookDuration ?? 1.2,
                Math.min(30, Math.ceil(duration * 10) / 10)
              ),
            }
          : {}),
        ...(insertScope === 'outro' && !template.showEndCard ? { showEndCard: true } : {}),
      };
      onUpdateTemplate(nextTemplate, true);
      try {
        URL.revokeObjectURL(previewUrl);
      } catch {
        // ignore
      }
      onClose();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'تعذر تحميل وإدراج الفيديو.');
    } finally {
      setImportingVideoId(null);
    }
  };

  const handleInsertIntoProject = async (replaceExisting = false) => {
    if (!generatedMedia) return;
    const mediaKey = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (replaceExisting && existingAi?.mediaKey && existingAi.mediaKey !== mediaKey) {
      void deleteAiMediaBlob(existingAi.mediaKey);
    }

    await registerAiPresenterBlob(mediaKey, generatedMedia.blob, generatedMedia.mimeType, true);

    const effectiveOverlayBgMode: AiPresenterBgMode = generatedMedia.transparentRequested
      ? generatedMedia.bgMode
      : 'original';

    const newOverlay: AiPresenterOverlay = {
      enabled: true,
      provider: 'tavus',
      videoId: generatedMedia.videoId,
      replicaId: generatedMedia.replicaId,
      replicaName: generatedMedia.replicaName,
      script: generatedMedia.script,
      voiceSource: generatedMedia.voiceSource,
      transparentRequested: generatedMedia.transparentRequested,
      fastRequested: generatedMedia.fastRequested,
      mimeType: generatedMedia.mimeType,
      naturalDuration: generatedMedia.duration,
      mediaKey,
      scope: replaceExisting && existingAi ? existingAi.scope : insertScope,
      targetSlideIndex: activeSlideIndex,
      placement: replaceExisting && existingAi ? existingAi.placement : 'bottomCenter',
      x: replaceExisting && existingAi ? existingAi.x : 50,
      y: replaceExisting && existingAi ? existingAi.y : 82,
      scale: replaceExisting && existingAi ? existingAi.scale : 95,
      frameShape:
        replaceExisting && existingAi
          ? existingAi.frameShape
          : generatedMedia.transparentRequested
            ? 'cutout'
            : 'broadcastCard',
      bgMode: effectiveOverlayBgMode,
      bgColor: generatedMedia.bgColor,
      customBgDataUrl: generatedMedia.customBgDataUrl,
      trimStart: 0,
      trimEnd: generatedMedia.duration,
      startOffset: 0,
      displayDuration: 0,
      volume: 1,
      muteOtherVoices: replaceExisting && existingAi ? (existingAi.muteOtherVoices ?? true) : true,
      showNameBadge: false,
      fullscreenInIntro: replaceExisting && existingAi ? Boolean(existingAi.fullscreenInIntro) : false,
      fullscreenInOutro: replaceExisting && existingAi ? Boolean(existingAi.fullscreenInOutro) : false,
      afterSpeechBehavior:
        replaceExisting && existingAi?.afterSpeechBehavior
          ? existingAi.afterSpeechBehavior
          : insertScope === 'fullTimeline' || insertScope === 'allSlides'
            ? afterSpeechBehavior
            : 'hide',
      startPhase:
        replaceExisting && existingAi?.startPhase ? existingAi.startPhase : startPhase,
    };

    const effectiveScope = newOverlay.scope;
    const nextTemplate: TemplateSettings = {
      ...template,
      aiPresenter: newOverlay,
      ...(effectiveScope === 'intro'
        ? {
            showIntroHook: true,
            introHookDuration: Math.max(
              template.introHookDuration ?? 1.2,
              Math.min(30, Math.ceil(generatedMedia.duration * 10) / 10)
            ),
          }
        : {}),
      ...(effectiveScope === 'outro' && !template.showEndCard ? { showEndCard: true } : {}),
    };

    onUpdateTemplate(nextTemplate, true);
    setInnerTab('manage');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="الراوي الذكي – AI Presenter"
    >
      <div className="w-full sm:max-w-2xl max-h-[92dvh] flex flex-col bg-[var(--panel)] border border-[var(--pline)] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden text-right">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--pline)] bg-[var(--surface)] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#00B050]/18 border border-[#00B050]/45 flex items-center justify-center text-[#00B050] shrink-0">
              <Video className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-extrabold text-[var(--ptxt)] truncate">
                  الراوي الذكي – AI Presenter
                </h2>
                <span className="px-1.5 py-0.5 rounded bg-[#00B050]/15 border border-[#00B050]/40 text-[10px] font-bold text-[#00B050] dark:text-[#6ee7b7] shrink-0">
                  بشر حقيقي
                </span>
              </div>
              <p className="text-[11px] text-[var(--pmuted)] truncate">
                Tavus API v2 · باقة مجانية تتجدد شهرياً بدون بطاقة بنكية
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--pmuted)] hover:text-[var(--ptxt)] hover:bg-[var(--panel)] cursor-pointer shrink-0"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Inner Navigation when an AI Presenter is already in project */}
        {existingAi && (
          <div className="grid grid-cols-2 gap-1 p-1.5 bg-[var(--page)] border-b border-[var(--pline)] shrink-0">
            <button
              type="button"
              onClick={() => setInnerTab('create')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                innerTab === 'create'
                  ? 'bg-[#00B050] text-white'
                  : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>توليد راوي جديد</span>
            </button>
            <button
              type="button"
              onClick={() => setInnerTab('manage')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                innerTab === 'manage'
                  ? 'bg-[#00B050] text-white'
                  : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>التحكم بالراوي المثبت</span>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {innerTab === 'manage' && existingAi ? (
            <AiPresenterEditorControls
              aiPresenter={existingAi}
              slides={slides}
              onChange={(next, immediate = true) =>
                onUpdateTemplate({ ...template, aiPresenter: next }, immediate)
              }
              onOpenStudioForReplace={() => setInnerTab('create')}
              onDelete={() => {
                if (existingAi.mediaKey) {
                  void deleteAiMediaBlob(existingAi.mediaKey);
                }
                onUpdateTemplate({ ...template, aiPresenter: undefined }, true);
                setInnerTab('create');
              }}
            />
          ) : (
            <>
              {/* Connection & Recurring Free Tier Status */}
              <div
                className={`p-3 rounded-xl border text-xs ${
                  statusInfo?.configured
                    ? 'bg-[#00B050]/10 border-[#00B050]/40'
                    : 'bg-amber-500/10 border-amber-500/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-[var(--ptxt)]">
                    {isLoadingStatus ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#00B050]" />
                    ) : statusInfo?.configured ? (
                      <CheckCircle2 className="w-4 h-4 text-[#00B050]" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-400" />
                    )}
                    <span>
                      {statusInfo?.configured
                        ? 'متصل بخدمة Tavus (خطة مجانية متجددة شهرياً)'
                        : 'مطلوب ربط مفتاح Tavus المجاني (TAVUS_API_KEY)'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadStatusAndReplicas()}
                    disabled={isLoadingStatus || isLoadingReplicas}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] font-bold text-[var(--ptxt)] hover:border-[#00B050] cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${isLoadingStatus || isLoadingReplicas ? 'animate-spin' : ''}`}
                    />
                    <span>تحديث</span>
                  </button>
                </div>

                {statusInfo?.configured ? (
                  <p className="mt-1.5 text-[11px] text-[var(--ptxt)]/85 leading-relaxed">
                    <strong>تم تفعيل مفتاح Tavus بنجاح!</strong> اختر شخصية بشرية أدناه، اكتب النص العربي، ثم اضغط{' '}
                    <strong>«إنشاء الراوي»</strong> وبعدها <strong>«إدراج في الفيديو»</strong> ليظهر الراوي الحقيقي داخل مشروعك.{' '}
                    <span className="text-[var(--pmuted)]">(الرصيد المجاني: ~5 دقائق شهرياً تتجدد تلقائياً بدون بطاقة).</span>
                  </p>
                ) : (
                  <div className="mt-2 text-[11px] text-amber-200/90 leading-relaxed space-y-1">
                    <p>
                      1. أنشئ حساباً مجانياً بدون بطاقة بنكية على{' '}
                      <span className="font-mono-nums underline">platform.tavus.io</span> (تحصل على
                      رصيد مجاني يتجدد شهرياً).
                    </p>
                    <p>
                      2. انسخ API Key وأضفه في إعدادات البيئة / Secrets باسم{' '}
                      <code className="px-1.5 py-0.5 rounded bg-black/40 font-mono-nums">
                        TAVUS_API_KEY
                      </code>
                      .
                    </p>
                    <p>3. اضغط «تحديث» أعلاه لجلب الشخصيات الحقيقية مباشرة.</p>
                  </div>
                )}
              </div>

              {/* Existing Generated Videos on Tavus Account (Recovery & Instant Insert) */}
              {statusInfo?.configured && tavusVideos.length > 0 && (
                <div className="flex flex-col gap-2 p-3 rounded-xl bg-[var(--surface)] border border-[#00B050]/45">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-[var(--ptxt)]">
                      فيديوهاتك المُرسلة على Tavus ({tavusVideos.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => void loadTavusVideosList()}
                      disabled={isLoadingTavusVideos}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--panel)] border border-[var(--pline)] text-[10px] font-bold text-[var(--ptxt)] cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingTavusVideos ? 'animate-spin' : ''}`} />
                      <span>تحديث السجل</span>
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                    {tavusVideos.slice(0, 6).map((vid) => {
                      const isReady = vid.status === 'ready';
                      const isBusy = importingVideoId === vid.videoId;
                      return (
                        <div
                          key={vid.videoId}
                          className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)]"
                        >
                          <div className="min-w-0">
                            <div className="text-[11px] font-bold text-[var(--ptxt)] truncate">
                              {vid.videoName || vid.videoId}
                            </div>
                            <div className="text-[10px] text-[var(--pmuted)]">
                              {isReady
                                ? 'جاهز للإدراج فوراً ✓'
                                : vid.status === 'error'
                                  ? `فشل: ${vid.statusDetails || 'خطأ'}`
                                  : `قيد المعالجة (${vid.generationProgress || vid.status})`}
                            </div>
                          </div>
                          {isReady ? (
                            <button
                              type="button"
                              disabled={Boolean(importingVideoId)}
                              onClick={() => void handleImportExistingTavusVideo(vid)}
                              className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-50 text-white text-[10px] font-extrabold cursor-pointer"
                            >
                              {isBusy ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Film className="w-3 h-3" />
                              )}
                              <span>{isBusy ? 'جارٍ الإدراج...' : 'إدراج بالاستوديو'}</span>
                            </button>
                          ) : (vid.status === 'queued' || vid.status === 'generating') ? (
                            <button
                              type="button"
                              disabled={isGenerating}
                              onClick={() => {
                                setGenProgressPct(25);
                                setGenStatusText(`متابعة التوليد (${vid.videoId})...`);
                                void pollVideoUntilReady(vid.videoId);
                              }}
                              className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-bold cursor-pointer"
                            >
                              متابعة
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Step 1: Real Human Replicas */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-[var(--ptxt)]">
                    1. اختر شخصية بشرية حقيقية (من Tavus)
                  </span>
                  {replicas.length > 0 && (
                    <span className="text-[11px] text-[var(--pmuted)] font-mono-nums">
                      {replicas.length} شخصية متاحة
                    </span>
                  )}
                </div>

                {replicaError && (
                  <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/35 text-[11px] text-red-400">
                    {replicaError}
                  </div>
                )}

                {isLoadingReplicas ? (
                  <div className="flex items-center justify-center gap-2 py-6 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--pmuted)]">
                    <Loader2 className="w-4 h-4 animate-spin text-[#00B050]" />
                    <span>جارٍ جلب الشخصيات الحقيقية من Tavus...</span>
                  </div>
                ) : replicas.length === 0 ? (
                  <div className="p-4 rounded-xl bg-[var(--surface)] border border-dashed border-[var(--pline)] text-center text-xs text-[var(--pmuted)]">
                    {statusInfo?.configured
                      ? 'لم تُرجع Tavus شخصيات متاحة حالياً. تأكد من صلاحية المفتاح أو اضغط تحديث.'
                      : 'ستظهر الشخصيات البشرية الحقيقية هنا فور إضافة TAVUS_API_KEY في Secrets.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-0.5">
                    {replicas.map((rep) => {
                      const active = selectedReplicaId === rep.replicaId;
                      const isPrev = previewReplicaId === rep.replicaId;
                      const videoSrc = rep.proxiedThumbnailUrl
                        ? resolvePresenterApiUrl(rep.proxiedThumbnailUrl)
                        : rep.thumbnailVideoUrl;
                      return (
                        <div
                          key={rep.replicaId}
                          onClick={() => setSelectedReplicaId(rep.replicaId)}
                          className={`flex flex-col gap-2 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                            active
                              ? 'bg-[#00B050]/15 border-[#00B050]'
                              : 'bg-[var(--surface)] border-[var(--pline)] hover:border-[var(--gold)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-7 h-7 rounded-lg bg-[var(--panel)] border border-[var(--pline)] flex items-center justify-center text-[#00B050] shrink-0">
                                <UserCheck className="w-3.5 h-3.5" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-[var(--ptxt)] truncate">
                                  {rep.replicaName}
                                </div>
                                <div className="text-[10px] text-[var(--pmuted)]">
                                  {rep.replicaType === 'user' ? 'نسختك الخاصة' : 'شخصية Tavus واقعية'}
                                </div>
                              </div>
                            </div>
                            {videoSrc && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewReplicaId(isPrev ? null : rep.replicaId);
                                }}
                                className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--panel)] border border-[var(--pline)] text-[10px] font-bold text-[var(--ptxt)] hover:border-[#00B050] cursor-pointer shrink-0"
                              >
                                <Play className="w-3 h-3 text-[#00B050]" />
                                <span>{isPrev ? 'إخفاء' : 'معاينة'}</span>
                              </button>
                            )}
                          </div>
                          {isPrev && videoSrc && (
                            <video
                              src={videoSrc}
                              controls
                              autoPlay
                              playsInline
                              muted
                              className="w-full h-36 rounded-lg object-cover bg-black"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Step 2: Script & Voice Source */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-[var(--ptxt)]">2. الصوت والنص</span>
                  <div className="flex items-center gap-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        const intro =
                          template.introHookText?.trim() || 'أهلاً بكم في تحدي المعلومات!';
                        const q = slides[activeSlideIndex]?.question?.trim() || '';
                        setScriptText(q ? `${intro} ${q}` : intro);
                      }}
                      className="px-2 py-0.5 rounded bg-[#00B050]/12 border border-[#00B050]/35 text-[10px] font-bold text-[#00B050] dark:text-[#6ee7b7] cursor-pointer"
                    >
                      مقدمة + السؤال
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setScriptText(
                          template.introHookText?.trim() || 'اختبر معلوماتك معنا في هذا التحدي!'
                        )
                      }
                      className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--pline)] text-[10px] font-bold text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                    >
                      من المقدمة
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setScriptText(slides[activeSlideIndex]?.question?.trim() || '')
                      }
                      className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--pline)] text-[10px] font-bold text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                    >
                      السؤال الحالي
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const intro =
                          template.introHookText?.trim() || 'أهلاً بكم في تحدي المعلومات!';
                        const qs = slides
                          .map((s, i) => (s.question?.trim() ? `السؤال ${i + 1}: ${s.question.trim()}` : ''))
                          .filter(Boolean)
                          .join(' ... ');
                        setScriptText(qs ? `${intro} ${qs}` : intro);
                      }}
                      className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--pline)] text-[10px] font-bold text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                    >
                      كل الأسئلة ({slides.length})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setScriptText(
                          template.endCardText?.trim() || 'شكراً لمشاهدتكم! اشتركوا في القناة.'
                        )
                      }
                      className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--pline)] text-[10px] font-bold text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                    >
                      الخاتمة
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setVoiceMode('script')}
                    className={`px-2 py-2 rounded-lg border text-[11px] font-bold cursor-pointer ${
                      voiceMode === 'script'
                        ? 'bg-[#00B050]/16 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                        : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)]'
                    }`}
                  >
                    نطق النص (عربي)
                  </button>
                  <button
                    type="button"
                    onClick={() => setVoiceMode('audioUrl')}
                    className={`px-2 py-2 rounded-lg border text-[11px] font-bold cursor-pointer ${
                      voiceMode === 'audioUrl'
                        ? 'bg-[#00B050]/16 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                        : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)]'
                    }`}
                  >
                    رابط صوت HTTPS
                  </button>
                  <button
                    type="button"
                    disabled={!statusInfo?.canHostTempAudio}
                    onClick={() => {
                      if (!localAudioDataUrl) {
                        localAudioFileRef.current?.click();
                      } else {
                        setVoiceMode('localAudio');
                      }
                    }}
                    title={
                      statusInfo?.canHostTempAudio
                        ? 'رفع ملف صوت محلي'
                        : 'يتطلب استضافة الخادم على HTTPS عام (APP_URL)'
                    }
                    className={`px-2 py-2 rounded-lg border text-[11px] font-bold ${
                      !statusInfo?.canHostTempAudio
                        ? 'opacity-45 cursor-not-allowed bg-[var(--surface)] border-[var(--pline)] text-[var(--pmuted)]'
                        : voiceMode === 'localAudio'
                          ? 'bg-[#00B050]/16 border-[#00B050] text-[#00B050] cursor-pointer'
                          : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] cursor-pointer'
                    }`}
                  >
                    ملف صوتي محلي
                  </button>
                </div>

                {voiceMode === 'script' && (
                  <div className="flex flex-col gap-1">
                    <textarea
                      rows={3}
                      dir="rtl"
                      value={scriptText}
                      onChange={(e) => setScriptText(e.target.value)}
                      placeholder="اكتب النص الذي سيتحدثه الراوي باللغة العربية أو أي لغة أخرى..."
                      className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none leading-relaxed"
                    />
                    <div className="flex items-center justify-between text-[10px] text-[var(--pmuted)] font-mono-nums">
                      <span>
                        {wordCount} كلمة · مدة تقديرية ~{estSeconds} ثانية
                      </span>
                      <span>يدعم العربية + مزامنة شفاه واقعية</span>
                    </div>
                  </div>
                )}

                {voiceMode === 'audioUrl' && (
                  <div className="flex flex-col gap-1.5">
                    <input
                      type="url"
                      dir="ltr"
                      value={audioUrlInput}
                      onChange={(e) => setAudioUrlInput(e.target.value)}
                      placeholder="https://example.com/voice.mp3"
                      className="w-full px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                    />
                    {audioUrlInput.startsWith('https://') && (
                      <audio controls src={audioUrlInput} className="w-full h-8" />
                    )}
                  </div>
                )}

                {voiceMode === 'localAudio' && (
                  <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
                    <span className="text-xs text-[var(--ptxt)] truncate">
                      {localAudioName || 'ملف صوتي مرفق'}
                    </span>
                    <button
                      type="button"
                      onClick={() => localAudioFileRef.current?.click()}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] font-bold cursor-pointer"
                    >
                      <Upload className="w-3 h-3 text-[#00B050]" />
                      <span>تغيير</span>
                    </button>
                  </div>
                )}
                <input
                  ref={localAudioFileRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={handleUploadLocalAudio}
                />
              </div>

              {/* Step 3: Supported Appearance, Background & Editor Scene Compatibility */}
              <div className="flex flex-col gap-2.5 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-extrabold text-[var(--ptxt)]">
                    3. الخلفية والتوافق مع مشهد الفيديو
                  </span>
                  <button
                    type="button"
                    onClick={handleMatchEditorScene}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#00B050]/12 hover:bg-[#00B050]/22 border border-[#00B050]/40 text-[10px] font-bold text-[#00B050] dark:text-[#6ee7b7] cursor-pointer transition-colors"
                    title={editorScene.sceneLabel}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-white/40 shrink-0"
                      style={{ backgroundColor: editorScene.bgColor }}
                    />
                    <span>مطابقة مشهد المحرر</span>
                  </button>
                </div>

                <div className="grid grid-cols-5 gap-1">
                  {[
                    { id: 'transparent' as AiPresenterBgMode, label: 'شفافة' },
                    { id: 'white' as AiPresenterBgMode, label: 'لون أبيض' },
                    { id: 'color' as AiPresenterBgMode, label: 'لون ثابت' },
                    { id: 'customImage' as AiPresenterBgMode, label: 'مخصصة' },
                    { id: 'original' as AiPresenterBgMode, label: 'الأصلية' },
                  ].map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setBgMode(b.id)}
                      className={`px-1.5 py-1.5 rounded-lg border text-[10px] font-bold cursor-pointer transition-colors ${
                        bgMode === b.id
                          ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                          : 'bg-[var(--panel)] border-[var(--pline)] text-[var(--ptxt)]'
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>

                {bgMode === 'color' && (
                  <div className="flex flex-col gap-2 p-2.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-[var(--ptxt)]">
                        لون الخلفية الثابت ({bgColor.toUpperCase()})
                      </span>
                      <input
                        type="color"
                        value={bgColor}
                        onChange={(e) => setBgColor(e.target.value)}
                        className="w-9 h-6 rounded border-0 cursor-pointer bg-transparent"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-[var(--pmuted)]">ألوان المشهد:</span>
                      {editorScene.swatches.map((hex) => {
                        const active = bgColor.toLowerCase() === hex.toLowerCase();
                        return (
                          <button
                            key={hex}
                            type="button"
                            onClick={() => setBgColor(hex)}
                            title={hex}
                            className={`w-5 h-5 rounded-md border cursor-pointer transition-transform ${
                              active
                                ? 'border-[#00B050] scale-110 ring-1 ring-[#00B050]'
                                : 'border-white/25 hover:scale-105'
                            }`}
                            style={{ backgroundColor: hex }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {bgMode === 'customImage' && (
                  <div className="flex flex-col gap-2 p-2.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => customBgFileRef.current?.click()}
                        className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] text-[11px] font-bold text-[var(--ptxt)] cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5 text-[#00B050]" />
                        <span>{customBgDataUrl ? 'تغيير صورة الخلفية' : 'رفع صورة خلفية'}</span>
                      </button>
                      {editorScene.bgImageDataUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setCustomBgDataUrl(editorScene.bgImageDataUrl);
                            setCustomBgUrlInput('');
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-[#00B050]/12 border border-[#00B050]/40 text-[10px] font-bold text-[#00B050] dark:text-[#6ee7b7] cursor-pointer"
                        >
                          من مشهد المحرر
                        </button>
                      )}
                    </div>

                    {customBgDataUrl && (
                      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
                        <div className="flex items-center gap-2 min-w-0">
                          <img
                            src={customBgDataUrl}
                            alt="خلفية مخصصة"
                            className="w-8 h-8 rounded object-cover border border-[var(--pline)] shrink-0"
                          />
                          <span className="text-[10px] text-[var(--pmuted)] truncate">
                            صورة خلفية مخصصة جاهزة
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCustomBgDataUrl(undefined)}
                          className="text-[10px] text-rose-400 hover:text-rose-300 font-bold cursor-pointer shrink-0"
                        >
                          إزالة
                        </button>
                      </div>
                    )}

                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] text-[var(--pmuted)]">
                        أو رابط خلفية HTTPS مباشر (صورة/فيديو يُرسل إلى API):
                      </span>
                      <input
                        type="url"
                        dir="ltr"
                        value={customBgUrlInput}
                        onChange={(e) => {
                          setCustomBgUrlInput(e.target.value);
                          if (e.target.value.trim()) {
                            setCustomBgDataUrl(undefined);
                          }
                        }}
                        placeholder="https://example.com/studio-backdrop.jpg"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-[11px] text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                      />
                    </label>
                  </div>
                )}
                <input
                  ref={customBgFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUploadBgImage}
                />

                {(bgMode === 'white' || bgMode === 'color' || (bgMode === 'customImage' && Boolean(customBgDataUrl))) && (
                  <label className="flex items-start justify-between gap-2 p-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] cursor-pointer text-[11px]">
                    <div className="min-w-0">
                      <span className="font-bold text-[var(--ptxt)] block">
                        تضمين الخلفية مباشرة داخل فيديو API المُولّد
                      </span>
                      <span className="text-[10px] text-[var(--pmuted)] leading-snug block mt-0.5">
                        {bakeBackgroundIntoApi
                          ? 'سيُرسل transparent_background: false مع رابط الخلفية لدمجها داخل الفيديو الناتج.'
                          : 'موصى به: يطلب فيديو شفاف (Alpha WebM) مع دمج الخلفية بسلاسة داخل مشهد المحرر.'}
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={bakeBackgroundIntoApi}
                      disabled={!statusInfo?.canHostTempAudio}
                      onChange={(e) => setBakeBackgroundIntoApi(e.target.checked)}
                      className="w-4 h-4 accent-[#00B050] rounded cursor-pointer shrink-0 mt-0.5"
                    />
                  </label>
                )}

                <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--panel)]/70 border border-[var(--pline)] text-[10px] text-[var(--pmuted)]">
                  <span>
                    {previewBgPayload.transparent_background
                      ? bgMode === 'transparent'
                        ? 'وضع الإرسال إلى API: خلفية شفافة كاملة (Alpha) متوافقة مع كل مشاهد المحرر.'
                        : 'وضع الإرسال إلى API: فيديو شفاف (Alpha) مع حفظ إعدادات الخلفية لدمجها داخل المحرر.'
                      : bgMode === 'original'
                        ? 'وضع الإرسال إلى API: الإبقاء على خلفية الاستوديو الأصلية للشخصية.'
                        : 'وضع الإرسال إلى API: تضمين الخلفية المختارة مباشرة داخل الفيديو المُولّد.'}
                  </span>
                </div>

                <label className="flex items-center justify-between gap-2 cursor-pointer text-xs">
                  <div className="min-w-0">
                    <span className="font-semibold text-[var(--ptxt)] block">
                      تفعيل التوليد السريع (Fast Render)
                    </span>
                    {previewBgPayload.transparent_background && (
                      <span className="text-[10px] text-[var(--pmuted)] block">
                        مفعّل تلقائياً لأن الخلفية الشفافة في Tavus تتطلب المعالجة السريعة.
                      </span>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={previewBgPayload.transparent_background ? true : fastRender}
                    disabled={previewBgPayload.transparent_background}
                    onChange={(e) => setFastRender(e.target.checked)}
                    className="w-4 h-4 accent-[#00B050] rounded cursor-pointer disabled:opacity-70"
                  />
                </label>

                <div className="flex items-start gap-1.5 text-[10px] text-[var(--pmuted)] leading-relaxed">
                  <Info className="w-3.5 h-3.5 text-[#00B050] shrink-0 mt-0.5" />
                  <span>
                    تتولى Tavus تلقائياً مزامنة الشفاه، حركة العينين، وإيماءات الرأس والجسم الطبيعية
                    للشخصية الحقيقية.
                  </span>
                </div>
              </div>

              {genError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/35 text-xs text-red-400 leading-relaxed">
                  {genError}
                </div>
              )}

              {/* Generate Action & Live Progress */}
              {isGenerating && (
                <div className="flex flex-col gap-2 p-3 rounded-xl bg-[#00B050]/10 border border-[#00B050]/40">
                  <div className="flex items-center justify-between text-xs font-bold text-[var(--ptxt)]">
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-[#00B050]" />
                      <span>{genStatusText}</span>
                    </span>
                    <span className="font-mono-nums">{genProgressPct}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-black/30 overflow-hidden">
                    <div
                      className="h-full bg-[#00B050] transition-all duration-300"
                      style={{ width: `${genProgressPct}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={isGenerating || !statusInfo?.configured || !selectedReplicaId}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-45 text-white text-sm font-extrabold transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>جارٍ إنشاء الراوي البشري...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>إنشاء الراوي</span>
                  </>
                )}
              </button>

              {/* Result Preview & Insert into Video Editor */}
              {generatedMedia && (
                <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-[#00B050]/10 border border-[#00B050]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-[#00B050] dark:text-[#6ee7b7]">
                      النتيجة جاهزة ({generatedMedia.duration.toFixed(1)} ثانية)
                    </span>
                    <span className="text-[10px] text-[var(--pmuted)]">
                      {generatedMedia.replicaName}
                    </span>
                  </div>

                  <video
                    src={generatedMedia.previewUrl}
                    controls
                    playsInline
                    className="w-full max-h-64 rounded-xl bg-black"
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold text-[var(--ptxt)]">
                        موضع الإدراج في مشروع الفيديو:
                      </span>
                      <select
                        value={insertScope}
                        onChange={(e) => {
                          const sc = e.target.value as AiPresenterScope;
                          setInsertScope(sc);
                          setAfterSpeechBehavior(
                            sc === 'fullTimeline' || sc === 'allSlides' ? 'stayIdle' : 'hide'
                          );
                        }}
                        className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
                      >
                        <option value="fullTimeline">طوال الفيديو (مستمر)</option>
                        <option value="allSlides">في كل سؤال</option>
                        <option value="slide">في السؤال الحالي فقط</option>
                        <option value="intro">في المقدمة فقط</option>
                        <option value="outro">في الخاتمة فقط</option>
                      </select>
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold text-[var(--ptxt)]">
                        بعد انتهاء كلام المقطع:
                      </span>
                      <select
                        value={afterSpeechBehavior}
                        onChange={(e) =>
                          setAfterSpeechBehavior(
                            e.target.value as 'stayIdle' | 'loop' | 'hide'
                          )
                        }
                        className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
                      >
                        <option value="stayIdle">يبقى ظاهراً على الشاشة</option>
                        <option value="loop">تكرار مستمر طوال الفيديو</option>
                        <option value="hide">يختفي عند الانتهاء</option>
                      </select>
                    </label>
                  </div>

                  {insertScope === 'fullTimeline' && template.showIntroHook && (
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold text-[var(--ptxt)]">
                        توقيت بدء كلام الراوي:
                      </span>
                      <select
                        value={startPhase}
                        onChange={(e) =>
                          setStartPhase(e.target.value as 'timelineStart' | 'firstQuestion')
                        }
                        className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
                      >
                        <option value="timelineStart">من بداية الفيديو (المقدمة)</option>
                        <option value="firstQuestion">عند بدء السؤال الأول</option>
                      </select>
                    </label>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void handleInsertIntoProject(false)}
                      className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-extrabold cursor-pointer"
                    >
                      <Film className="w-4 h-4" />
                      <span>إدراج في الفيديو</span>
                    </button>
                    {existingAi ? (
                      <button
                        type="button"
                        onClick={() => void handleInsertIntoProject(true)}
                        className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-[var(--panel)] border border-[#00B050] text-xs font-bold text-[#00B050] dark:text-[#6ee7b7] cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>استبدال الراوي الحالي</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleGenerate()}
                        disabled={isGenerating}
                        className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-[var(--panel)] border border-[var(--pline)] text-xs font-bold text-[var(--ptxt)] cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>إعادة التوليد</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
