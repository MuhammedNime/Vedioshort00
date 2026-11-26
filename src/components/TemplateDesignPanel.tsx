import React, { useEffect, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Box,
  Check,
  ChevronDown,
  Crown,
  Download,
  ImagePlus,
  LayoutGrid,
  LayoutTemplate,
  Loader2,
  Mic,
  Monitor,
  Palette,
  Pencil,
  Play,
  Redo2,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Sparkles,
  Star,
  Timer,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Upload,
  UserCheck,
  Video,
  Wand2,
  X,
} from 'lucide-react';
import { BUILTIN_SFX_OPTIONS, soundEngine } from '../audio/soundEngine';
import { AiVoiceName, generateSingleTtsClip } from '../services/aiClient';
import {
  CustomTemplatePreset,
  deleteCustomPresetAsync,
  getDefaultCustomStyleId,
  importCustomStyleFromJson,
  loadCustomPresets,
  loadCustomPresetsAsync,
  renameCustomPresetAsync,
  saveCustomPresetAsync,
  serializeStylePreset,
  setDefaultCustomStyleId,
  updateCustomPresetAsync,
} from '../storage/customPresets';
import {
  ChannelBrandKit,
  applyBrandKitToTemplate,
  deleteBrandKitAsync,
  loadBrandKits,
  loadBrandKitsAsync,
  saveBrandKitAsync,
} from '../storage/brandKits';
import { deleteAiMediaBlob, readFileAsDataUrl } from '../storage/projectStore';
import { saveOrDownloadBlob } from '../utils/nativeDownload';
import {
  AnimationStyle,
  BackgroundMotion,
  BoxBorderStyle,
  BoxShapeStyle,
  BrandCornerPosition,
  BrandLogoAnimation,
  BuiltInSfxId,
  DEFAULT_PRIZE_LADDER,
  DEFAULT_TEMPLATE,
  OptionLabelStyle,
  OptionLayoutMode,
  OptionTextAlign,
  OptionsAppearMode,
  PRESENTER_GESTURE_OPTIONS,
  PRESENTER_PORTRAIT_URLS,
  PRESET_BACKDROPS,
  PresenterBeardStyle,
  PresenterFrameShape,
  PresenterGender,
  PresenterGestureCommand,
  PresenterLipSyncMode,
  PresenterPhaseCommands,
  PresenterPlacement,
  PresenterPoseId,
  PresenterSkinTone,
  PresenterStyle,
  PresetId,
  PrizeLadderStyle,
  QuestionSlide,
  QuestionTextAlign,
  RevealStyle,
  SlideTransitionStyle,
  TemplateSettings,
  ThemeApplyMode,
  TimerPlacement,
  TimerStyle,
  TimerUnitSuffix,
  TimerVisibilityMode,
  TimingSettings,
  applyStudioThemePreset,
  applyThemeBackgroundOnly,
} from '../types/quiz';
import { AiPresenterEditorControls } from './AiPresenterEditorControls';
import { MicRecordButton } from './MicRecordButton';

interface TemplateDesignPanelProps {
  template: TemplateSettings;
  timing?: TimingSettings;
  slides?: QuestionSlide[];
  aiVoiceName?: AiVoiceName;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onChange: (next: TemplateSettings, immediate?: boolean) => void;
  onTimingChange?: (next: TimingSettings) => void;
  onOpenAiPresenterStudio?: () => void;
}

const ANIM_OPTIONS: { id: AnimationStyle; label: string }[] = [
  { id: 'pop', label: 'نبض ارتدادي (Pop)' },
  { id: 'scale', label: 'تكبير ناعم' },
  { id: 'slideRight', label: 'انزلاق من اليمين' },
  { id: 'slideLeft', label: 'انزلاق من اليسار' },
  { id: 'slideUp', label: 'انزلاق للأعلى' },
  { id: 'fade', label: 'تلاشي ناعم' },
];

const ONE_CLICK_STYLES: { id: PresetId; label: string; emoji: string; accent: string }[] = [
  { id: 'channelSand', label: 'أسلوب القناة', emoji: '📺', accent: '#EDD6A2' },
  { id: 'islamicAndalusian', label: 'أندلسي فاخر', emoji: '🕌', accent: '#eab308' },
  { id: 'cosmicSpace', label: 'مجرة الفضاء', emoji: '🌌', accent: '#38bdf8' },
  { id: 'stadiumArena', label: 'ملعب الأبطال', emoji: '⚽', accent: '#22c55e' },
  { id: 'ancientHistory', label: 'كنوز التاريخ', emoji: '🏺', accent: '#c9a24a' },
  { id: 'millionaire', label: 'المليونير', emoji: '💎', accent: '#1a3b8e' },
  { id: 'neonCyber', label: 'النيون', emoji: '⚡', accent: '#22d3ee' },
  { id: 'tvShowGold', label: 'البث الذهبي', emoji: '🏆', accent: '#facc15' },
  { id: 'crimsonArena', label: 'حلبة التحدي', emoji: '🔥', accent: '#f43f5e' },
];

const VIRAL_HOOK_PRESETS = [
  '90% يخطئون في السؤال الأخير! 🤯',
  'اختبر ثقافتك الإسلامية في 30 ثانية 🕌',
  'أذكى العقول فقط تحل هذا التحدي 🧠',
  'تحدي سرعة: كم إجابة صح ستجمع؟ 🔥',
  'هل تستطيع الإجابة قبل انتهاء العداد؟ ⏳',
];

export const TemplateDesignPanel: React.FC<TemplateDesignPanelProps> = ({
  template,
  timing,
  slides = [],
  aiVoiceName = 'Kore',
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onChange,
  onTimingChange,
  onOpenAiPresenterStudio,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const hookAudioInputRef = useRef<HTMLInputElement | null>(null);
  const endAudioInputRef = useRef<HTMLInputElement | null>(null);
  const presenterPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const styleJsonInputRef = useRef<HTMLInputElement | null>(null);
  const [customPresets, setCustomPresets] = useState<CustomTemplatePreset[]>(() =>
    loadCustomPresets()
  );
  const [presetNameInput, setPresetNameInput] = useState('');
  const [activeCustomId, setActiveCustomId] = useState<string | null>(null);
  const [defaultStyleId, setDefaultStyleId] = useState<string | null>(() =>
    getDefaultCustomStyleId()
  );
  const [includeMediaInSave, setIncludeMediaInSave] = useState(true);
  const [includeTimingInSave, setIncludeTimingInSave] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState('');
  const [styleError, setStyleError] = useState('');
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);
  const [isHookVoicing, setIsHookVoicing] = useState(false);
  const [hookAudioError, setHookAudioError] = useState('');
  const [isEndVoicing, setIsEndVoicing] = useState(false);
  const [endAudioError, setEndAudioError] = useState('');
  const [brandKits, setBrandKits] = useState<ChannelBrandKit[]>(() => loadBrandKits());
  const [brandKitNameInput, setBrandKitNameInput] = useState('');
  const [activeDemoPose, setActiveDemoPose] = useState<PresenterPoseId | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const demoPoseTimerRef = useRef<number | null>(null);

  const triggerPresenterDemo = (pose: PresenterPoseId) => {
    setActiveDemoPose(pose);
    if (demoPoseTimerRef.current) {
      window.clearTimeout(demoPoseTimerRef.current);
    }
    demoPoseTimerRef.current = window.setTimeout(() => {
      setActiveDemoPose((prev) => (prev === pose ? null : prev));
    }, 2600);
    window.dispatchEvent(
      new CustomEvent('shortvedio:presenter-demo', { detail: { pose } })
    );
  };

  type TemplateSectionId =
    | 'styles'
    | 'format'
    | 'backdrop'
    | 'question'
    | 'shapes'
    | 'options'
    | 'timer'
    | 'introEnd'
    | 'brand'
    | 'presenter';

  const [openSection, setOpenSection] = useState<TemplateSectionId | null>('styles');
  const [expandAllSections, setExpandAllSections] = useState(false);
  const sectionRefs = useRef<Partial<Record<TemplateSectionId, HTMLElement | null>>>({});

  const isSectionOpen = (id: TemplateSectionId) => expandAllSections || openSection === id;

  const toggleSection = (id: TemplateSectionId) => {
    if (expandAllSections) {
      setExpandAllSections(false);
      setOpenSection(id);
      return;
    }
    setOpenSection((prev) => (prev === id ? null : id));
  };

  const jumpToSection = (id: TemplateSectionId) => {
    setExpandAllSections(false);
    setOpenSection(id);
    window.setTimeout(() => {
      sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 40);
  };

  useEffect(() => {
    const reloadPresets = () => {
      void loadCustomPresetsAsync().then((loaded) => {
        setCustomPresets(loaded);
      });
      void loadBrandKitsAsync().then((kits) => {
        setBrandKits(kits);
      });
    };
    reloadPresets();
    window.addEventListener('shorts-studio-presets-updated', reloadPresets);
    return () => {
      window.removeEventListener('shorts-studio-presets-updated', reloadPresets);
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const showToast = (msg: string) => {
    setAppliedNotice(msg);
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setAppliedNotice(null);
    }, 1800);
  };

  const themeApplyMode: ThemeApplyMode = template.themeApplyMode || 'bgOnly';

  const patch = (partial: Partial<TemplateSettings>, immediate = true) => {
    onChange({ ...template, ...partial }, immediate);
  };

  const applyChannelPreset = () => {
    onChange(
      {
        ...DEFAULT_TEMPLATE,
        aspectRatio: template.aspectRatio,
        customBgDataUrl: template.customBgDataUrl,
        customBgName: template.customBgName,
        showSafeGuides: template.showSafeGuides,
        endCardText: template.endCardText || 'شكراً لمشاهدتكم',
        brandLogoDataUrl: template.brandLogoDataUrl,
        brandLogoName: template.brandLogoName,
        brandLogoAnim: template.brandLogoAnim,
        brandLogoSize: template.brandLogoSize,
        brandLogoPosition: template.brandLogoPosition,
        brandLogoX: template.brandLogoX,
        brandLogoY: template.brandLogoY,
        brandHandleText: template.brandHandleText,
        brandOpacity: template.brandOpacity,
        showProgressCounter: template.showProgressCounter,
      },
      true
    );
    showToast('تمت استعادة قالب القناة الافتراضي ✓');
  };

  const handleUploadBrandLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    patch({
      brandLogoDataUrl: dataUrl,
      brandLogoName: file.name,
    });
    e.target.value = '';
  };

  const applyQuickLayoutPreset = (
    mode: 'channel' | 'centerCircle' | 'classicMiddle' | 'transparentOverlay'
  ) => {
    if (mode === 'channel') {
      patch(
        {
          freeLayoutMode: false,
          questionX: 50,
          questionY: 29,
          questionWidth: 78,
          questionHeightPct: 16,
          questionFontSize: 66,
          questionBorderRadius: 48,
          questionBoxOpacity: template.questionBoxOpacity <= 0.05 ? 1 : template.questionBoxOpacity,
          optionsLayout: 'channel2x2',
          optionsX: 50,
          optionsStartY: 51,
          optionsWidth: 94,
          optionHeight: 146,
          optionFontSize: 50,
          optionBorderRadius: 32,
          optionBoxOpacity: template.optionBoxOpacity <= 0.05 ? 1 : template.optionBoxOpacity,
          timerPlacement: 'aboveOptions',
          timerX: 50,
          timerY: 43,
          questionToOptionsGap: 0,
        },
        true
      );
      showToast('تم تطبيق تخطيط 2×2 (مؤقت أعلى) ✓');
    } else if (mode === 'centerCircle') {
      patch(
        {
          freeLayoutMode: false,
          questionX: 50,
          questionY: 27,
          questionWidth: 82,
          questionHeightPct: 15,
          questionFontSize: 62,
          questionBorderRadius: 42,
          questionBoxOpacity: template.questionBoxOpacity <= 0.05 ? 1 : template.questionBoxOpacity,
          optionsLayout: 'channel2x2',
          optionsX: 50,
          optionsStartY: 45,
          optionsWidth: 94,
          optionHeight: 142,
          optionFontSize: 48,
          optionBorderRadius: 30,
          optionBoxOpacity: template.optionBoxOpacity <= 0.05 ? 1 : template.optionBoxOpacity,
          timerStyle: template.timerStyle === 'none' ? 'circle' : template.timerStyle,
          timerPlacement: 'centerOfOptions',
          optionsCenterGap: 32,
          questionToOptionsGap: 18,
        },
        true
      );
      showToast('تم توسيط المؤقت بين الخيارات ✓');
    } else if (mode === 'classicMiddle') {
      patch(
        {
          freeLayoutMode: false,
          questionX: 50,
          questionY: 21,
          questionWidth: 86,
          questionHeightPct: 0,
          questionFontSize: 48,
          questionBorderRadius: 26,
          questionBoxOpacity: template.questionBoxOpacity <= 0.05 ? 0.9 : template.questionBoxOpacity,
          timerPlacement: 'aboveOptions',
          timerX: 50,
          timerY: 34,
          optionsLayout: 'vertical',
          optionsX: 50,
          optionsStartY: 43,
          optionsWidth: 84,
          optionHeight: 108,
          optionsGap: 20,
          optionFontSize: 36,
          optionBorderRadius: 20,
          optionBoxOpacity: template.optionBoxOpacity <= 0.05 ? 0.92 : template.optionBoxOpacity,
        },
        true
      );
      showToast('تم تطبيق القائمة العمودية ✓');
    } else if (mode === 'transparentOverlay') {
      patch(
        {
          questionBoxOpacity: 0,
          optionBoxOpacity: 0,
          questionBorderWidth: 0,
          optionBorderWidth: 0,
        },
        true
      );
      showToast('تم تفعيل النصوص الشفافة ✓');
    }
  };

  const handleSelectPreset = (presetId: PresetId) => {
    if (themeApplyMode === 'bgOnly') {
      onChange(applyThemeBackgroundOnly(template, presetId), true);
      showToast('تم تغيير الخلفية مع حفظ تعديلاتك ✓');
    } else {
      onChange(applyStudioThemePreset(template, presetId), true);
      showToast('تم تطبيق الثيم الكامل ✓');
    }
  };

  const handleApplyOneClickStyle = (presetId: PresetId) => {
    onChange(applyStudioThemePreset(template, presetId), true);
    showToast('تم تطبيق الستايل بالكامل ✓');
  };

  const handleSaveCustomPreset = async () => {
    setStyleError('');
    const { list, created } = await saveCustomPresetAsync(presetNameInput, template, {
      includeBrandAndBg: includeMediaInSave,
      timing: includeTimingInSave ? timing : undefined,
    });
    setCustomPresets(list);
    setActiveCustomId(created.id);
    setPresetNameInput('');
    showToast(`تم حفظ ستايل "${created.name}" ✓`);
  };

  const handleUpdateSavedPreset = async (presetId: string) => {
    setStyleError('');
    const target = customPresets.find((p) => p.id === presetId);
    const updatedList = await updateCustomPresetAsync(presetId, template, {
      includeBrandAndBg: includeMediaInSave,
      timing: includeTimingInSave ? timing : undefined,
    });
    setCustomPresets(updatedList);
    setActiveCustomId(presetId);
    showToast(`تم تحديث "${target?.name || 'الستايل'}" بأحدث تعديلاتك ✓`);
  };

  const handleApplyCustomPreset = (preset: CustomTemplatePreset) => {
    const hasOwnBg = Boolean(preset.template.customBgDataUrl);
    const hasOwnLogo = Boolean(preset.template.brandLogoDataUrl);
    onChange(
      {
        ...DEFAULT_TEMPLATE,
        ...preset.template,
        customBgDataUrl: hasOwnBg ? preset.template.customBgDataUrl : template.customBgDataUrl,
        customBgName: hasOwnBg ? preset.template.customBgName : template.customBgName,
        brandLogoDataUrl: hasOwnLogo ? preset.template.brandLogoDataUrl : template.brandLogoDataUrl,
        brandLogoName: hasOwnLogo ? preset.template.brandLogoName : template.brandLogoName,
        brandHandleText:
          preset.template.brandHandleText !== undefined
            ? preset.template.brandHandleText
            : template.brandHandleText,
      },
      true
    );
    if (preset.timing && onTimingChange) {
      onTimingChange({ ...preset.timing });
    }
    setActiveCustomId(preset.id);
    showToast(`تم تطبيق "${preset.name}" ✓`);
  };

  const handleDeleteCustomPreset = async (id: string) => {
    const next = await deleteCustomPresetAsync(id);
    setCustomPresets(next);
    if (activeCustomId === id) setActiveCustomId(null);
    if (defaultStyleId === id) setDefaultStyleId(null);
    showToast('تم حذف الستايل');
  };

  const handleCommitRenamePreset = async (id: string) => {
    const next = await renameCustomPresetAsync(id, editingPresetName);
    setCustomPresets(next);
    setEditingPresetId(null);
    setEditingPresetName('');
    showToast('تم تعديل اسم الستايل ✓');
  };

  const handleToggleDefaultStyle = (id: string) => {
    const nextId = defaultStyleId === id ? null : id;
    setDefaultCustomStyleId(nextId);
    setDefaultStyleId(nextId);
    showToast(
      nextId
        ? 'تم تعيينه كستايل افتراضي لأي مشروع جديد ⭐'
        : 'تم إلغاء التعيين الافتراضي'
    );
  };

  const handleExportCustomPreset = async (preset: CustomTemplatePreset) => {
    const json = serializeStylePreset(preset);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const safeName = preset.name.replace(/[^\w\u0600-\u06FF-]+/g, '_') || 'custom-style';
    await saveOrDownloadBlob(blob, `${safeName}.json`, 'application/json');
    showToast(`تم تصدير "${preset.name}" ✓`);
  };

  const handleImportStyleJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setStyleError('');
    try {
      const text = await file.text();
      const { list, imported } = await importCustomStyleFromJson(text);
      setCustomPresets(list);
      handleApplyCustomPreset(imported);
    } catch (err) {
      setStyleError(err instanceof Error ? err.message : 'تعذر استيراد ملف الستايل.');
    }
  };

  const handleStartBlankStyle = () => {
    setActiveCustomId(null);
    onChange(
      {
        ...DEFAULT_TEMPLATE,
        aspectRatio: template.aspectRatio,
        freeLayoutMode: false,
        backgroundType: 'color',
        solidBgColor: '#0F172A',
        bgDimOpacity: 0,
        boxStyle: 'bevel3d',
        borderStyle: 'solid',
        questionBoxColor: '#1E293B',
        questionTextColor: '#F8FAFC',
        questionBorderColor: '#38BDF8',
        questionBorderWidth: 3,
        optionBoxColor: '#1E293B',
        optionTextColor: '#F8FAFC',
        optionBorderColor: '#475569',
        optionBorderWidth: 2,
        correctColor: '#00B050',
        timerMatchBackground: false,
        timerBgColor: '#0F172A',
        timerColor: '#38BDF8',
        timerBorderColor: '#38BDF8',
        timerBorderWidth: 3,
        timerStyle: 'circle',
        timerPlacement: 'centerOfOptions',
        brandLogoDataUrl: template.brandLogoDataUrl,
        brandLogoName: template.brandLogoName,
        brandHandleText: template.brandHandleText,
      },
      true
    );
    showToast('تم فتح لوحة ستايل نظيفة بطبقات محمية — عدّل واحفظ باسمك ✓');
  };

  const handleUploadBg = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    patch({
      backgroundType: 'custom',
      customBgDataUrl: dataUrl,
      customBgName: file.name,
    });
    e.target.value = '';
  };

  const handleUploadHookAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setHookAudioError('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const duration = await soundEngine.getAudioDuration(dataUrl);
      patch({
        introHookAudio: {
          fileName: file.name,
          dataUrl,
          duration: duration > 0 ? duration : 1.5,
        },
      });
    } catch {
      setHookAudioError('تعذر قراءة ملف الصوت.');
    }
  };

  const handleGenerateHookAiVoice = async () => {
    const text = (template.introHookText ?? 'اختبر معلوماتك الآن!').trim();
    if (!text) {
      setHookAudioError('اكتب نص شريحة المقدمة أولاً.');
      return;
    }
    try {
      soundEngine.getContext();
    } catch {
      // ignore
    }
    setHookAudioError('');
    setIsHookVoicing(true);
    try {
      const clip = await generateSingleTtsClip(text, aiVoiceName, 'hook-voice.wav');
      patch({ introHookAudio: clip });
    } catch (err) {
      setHookAudioError(err instanceof Error ? err.message : 'تعذر توليد صوت المقدمة.');
    } finally {
      setIsHookVoicing(false);
    }
  };

  const handleUploadEndAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setEndAudioError('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const duration = await soundEngine.getAudioDuration(dataUrl);
      patch({
        endCardAudio: {
          fileName: file.name,
          dataUrl,
          duration: duration > 0 ? duration : 2.0,
        },
      });
    } catch {
      setEndAudioError('تعذر قراءة ملف صوت النهاية.');
    }
  };

  const handleGenerateEndAiVoice = async () => {
    const baseText =
      (template.endCtaText || '').trim() ||
      'كم إجابة صحيحة جبت؟ اكتب نتيجتك في التعليقات واشترك في القناة للمزيد!';
    try {
      soundEngine.getContext();
    } catch {
      // ignore
    }
    setEndAudioError('');
    setIsEndVoicing(true);
    try {
      const clip = await generateSingleTtsClip(baseText, aiVoiceName, 'outro-voice.wav');
      patch({ endCardAudio: clip });
    } catch (err) {
      setEndAudioError(err instanceof Error ? err.message : 'تعذر توليد صوت النهاية.');
    } finally {
      setIsEndVoicing(false);
    }
  };

  const handleUploadPresenterPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    patch({
      presenterEnabled: true,
      presenterStyle: 'customPhoto',
      presenterPhotoDataUrl: dataUrl,
      presenterPhotoName: file.name,
    });
    showToast('تم رفع صورة المذيع المخصصة بنجاح ✓');
  };

  const SECTION_META: { id: TemplateSectionId; label: string }[] = [
    { id: 'styles', label: '1. ستايلاتي الخاصة والستايلات الجاهزة' },
    { id: 'format', label: '2. نوع الفيديو والحرية الكاملة' },
    { id: 'backdrop', label: '3. ثيمات القناة والخلفية' },
    { id: 'question', label: '4. الخط ومربع السؤال والشارة' },
    { id: 'shapes', label: '5. شكل الصناديق والحواف والزوم' },
    { id: 'options', label: '6. تخطيط الخيارات وألوانها' },
    { id: 'timer', label: '7. المؤقت وكشف الجواب والتوضيح' },
    { id: 'introEnd', label: '8. المقدمة (الهوك) وشاشة النهاية' },
    { id: 'brand', label: '9. شعار القناة والعداد العلوي' },
    { id: 'presenter', label: '10. المذيع التفاعلي (شخصية حية)' },
  ];

  const renderAccordionHeader = (
    id: TemplateSectionId,
    title: string,
    summary: string,
    Icon: React.ComponentType<{ className?: string }>
  ) => {
    const open = isSectionOpen(id);
    return (
      <button
        type="button"
        onClick={() => toggleSection(id)}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 px-3.5 py-3 text-right transition-colors cursor-pointer select-none ${
          open
            ? 'bg-[#00B050]/12 text-[var(--ptxt)]'
            : 'bg-[var(--surface)]/75 hover:bg-[var(--surface)] text-[var(--ptxt)]'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`w-4 h-4 shrink-0 ${open ? 'text-[#00B050]' : 'text-[var(--gold)]'}`} />
          <span className="text-xs sm:text-sm font-extrabold truncate">{title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {summary && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[var(--panel)] border border-[var(--pline)] text-[var(--pmuted)] max-w-[125px] truncate">
              {summary}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-[var(--pmuted)] transition-transform duration-200 ${
              open ? 'rotate-180 text-[#00B050]' : ''
            }`}
          />
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3 pb-4">
      {/* Sticky Top Bar: Feedback + Undo/Redo + Quick Dropdown Navigator */}
      <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-[var(--panel)]/95 backdrop-blur-sm border-b border-[var(--pline)] flex flex-col gap-2">
        {(appliedNotice || onUndo || onRedo) && (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
            <div className="flex items-center gap-1.5 text-[11px] font-bold min-w-0">
              {appliedNotice ? (
                <span className="flex items-center gap-1 text-[#00B050] dark:text-[#6ee7b7] truncate">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>{appliedNotice}</span>
                </span>
              ) : (
                <span className="text-[var(--pmuted)] truncate">
                  كل تعديل يُحفظ ويثبت فوراً
                </span>
              )}
            </div>
            {(onUndo || onRedo) && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={onUndo}
                  disabled={!canUndo}
                  title="تراجع خطوة للخلف (Ctrl+Z)"
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--panel)] border border-[var(--pline)] text-[11px] font-bold text-[var(--ptxt)] disabled:opacity-35 hover:border-[#00B050] cursor-pointer disabled:cursor-default"
                >
                  <Undo2 className="w-3 h-3" />
                  <span>تراجع</span>
                </button>
                <button
                  type="button"
                  onClick={onRedo}
                  disabled={!canRedo}
                  title="إعادة الخطوة (Ctrl+Y)"
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--panel)] border border-[var(--pline)] text-[11px] font-bold text-[var(--ptxt)] disabled:opacity-35 hover:border-[#00B050] cursor-pointer disabled:cursor-default"
                >
                  <Redo2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Quick Section Selector Dropdown */}
        <div className="flex items-center gap-1.5">
          <select
            aria-label="الانتقال السريع لأقسام القالب"
            value={openSection || ''}
            onChange={(e) => {
              const val = e.target.value as TemplateSectionId;
              if (val) jumpToSection(val);
            }}
            className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-[var(--surface)] border border-[#00B050]/45 text-xs font-bold text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none cursor-pointer"
          >
            <option value="" disabled>
              اختر قسماً للتعديل السريع...
            </option>
            {SECTION_META.map((sec) => (
              <option key={sec.id} value={sec.id}>
                {sec.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setExpandAllSections((v) => !v)}
            className="px-2.5 py-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)] hover:border-[var(--gold)] text-[11px] font-bold text-[var(--ptxt)] whitespace-nowrap shrink-0 cursor-pointer"
          >
            {expandAllSections ? 'طي الكل' : 'فتح الكل'}
          </button>
        </div>
      </div>

      {/* Section 1: Custom Saved Styles + One-Click Styles + Quick Layouts */}
      <section
        ref={(el) => {
          sectionRefs.current.styles = el;
        }}
        className={`rounded-xl border overflow-hidden transition-colors ${
          isSectionOpen('styles') ? 'border-[#00B050]/55 bg-[var(--panel)]' : 'border-[var(--pline)]'
        }`}
      >
        {renderAccordionHeader(
          'styles',
          '1. ستايلاتي الخاصة والستايلات الجاهزة',
          customPresets.length > 0 ? `${customPresets.length} محفوظ` : 'تصميم وحفظ',
          BookmarkPlus
        )}
        {isSectionOpen('styles') && (
          <div className="p-3.5 border-t border-[var(--pline)] flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ptxt)]">
            <Sparkles className="w-3.5 h-3.5 text-[var(--gold)]" />
            <span>ستايلات متكاملة بكبسة زر</span>
          </div>
          <button
            type="button"
            onClick={applyChannelPreset}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#00B050] hover:bg-[#00c85b] text-white text-[11px] font-bold transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>الافتراضي</span>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {ONE_CLICK_STYLES.map((st) => {
            const active = template.backgroundType === 'preset' && template.presetId === st.id;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => handleApplyOneClickStyle(st.id)}
                className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                    : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/30"
                  style={{ backgroundColor: st.accent }}
                />
                <span className="truncate">{st.emoji} {st.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ptxt)]">
            <LayoutTemplate className="w-3.5 h-3.5 text-[var(--gold)]" />
            <span>تخطيط الترتيب فقط (يحفظ ألوانك وستايلك)</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => applyQuickLayoutPreset('channel')}
            className={`px-2 py-2 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer ${
              template.optionsLayout === 'channel2x2' &&
              (template.timerPlacement || 'aboveOptions') === 'aboveOptions' &&
              template.questionBoxOpacity > 0
                ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
            }`}
          >
            شبكة القناة 2×2 (مؤقت أعلى)
          </button>
          <button
            type="button"
            onClick={() => applyQuickLayoutPreset('centerCircle')}
            className={`px-2 py-2 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer ${
              template.timerPlacement === 'centerOfOptions'
                ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
            }`}
          >
            المؤقت في منتصف الخيارات 🎯
          </button>
          <button
            type="button"
            onClick={() => applyQuickLayoutPreset('classicMiddle')}
            className={`px-2 py-2 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer ${
              template.optionsLayout === 'vertical'
                ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
            }`}
          >
            قائمة عمودية
          </button>
          <button
            type="button"
            onClick={() => applyQuickLayoutPreset('transparentOverlay')}
            className={`px-2 py-2 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
              template.questionBoxOpacity === 0 && template.optionBoxOpacity === 0
                ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                : 'bg-[var(--surface)] hover:border-[var(--gold)] border-[var(--pline)] text-[var(--sand)]'
            }`}
          >
            شفاف فوق صورتك
          </button>
        </div>

        {/* Custom Style Builder & Persistent Vault */}
        <div className="mt-1 p-3.5 rounded-xl bg-[var(--surface)] border border-[#00B050]/45 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <BookmarkPlus className="w-4 h-4 text-[#00B050]" />
              <span className="text-xs font-extrabold text-[var(--ptxt)]">
                ستايلاتي الخاصة (صمّم واحفظ للأبد)
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleStartBlankStyle}
                title="بدء ستايل حر من الصفر بألوان نظيفة ووضع حرية كاملة"
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--panel)] border border-[var(--pline)] hover:border-[var(--gold)] text-[10px] font-bold text-[var(--gold)] cursor-pointer"
              >
                <Wand2 className="w-3 h-3" />
                <span>ستايل من الصفر</span>
              </button>
              <input
                ref={styleJsonInputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => void handleImportStyleJson(e)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => styleJsonInputRef.current?.click()}
                title="استيراد ستايل محفوظ من ملف JSON"
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--panel)] border border-[var(--pline)] hover:border-[#00B050] text-[10px] font-bold text-[var(--ptxt)] cursor-pointer"
              >
                <Upload className="w-3 h-3 text-[#00B050]" />
                <span>استيراد</span>
              </button>
            </div>
          </div>

          {/* Live Current Style Swatch Summary */}
          <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center -space-x-1 rtl:space-x-reverse shrink-0">
                <span
                  className="w-5 h-5 rounded-md border border-white/25 shadow-sm"
                  style={{
                    backgroundColor:
                      template.backgroundType === 'color'
                        ? template.solidBgColor
                        : '#1f2937',
                    backgroundImage:
                      template.backgroundType === 'custom' && template.customBgDataUrl
                        ? `url(${template.customBgDataUrl})`
                        : undefined,
                    backgroundSize: 'cover',
                  }}
                  title="لون/خلفية الستايل الحالي"
                />
                <span
                  className="w-5 h-5 rounded-md border-2 shadow-sm"
                  style={{
                    backgroundColor: template.questionBoxColor,
                    borderColor: template.questionBorderColor,
                  }}
                  title="صندوق السؤال"
                />
                <span
                  className="w-5 h-5 rounded-md border-2 shadow-sm"
                  style={{
                    backgroundColor: template.optionBoxColor,
                    borderColor: template.optionBorderColor,
                  }}
                  title="صناديق الخيارات"
                />
                <span
                  className="w-4 h-4 rounded-full border border-white/40"
                  style={{ backgroundColor: template.correctColor }}
                  title="لون الإجابة الصحيحة"
                />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-bold text-[var(--ptxt)] truncate">
                  {activeCustomId
                    ? `تعديل: ${customPresets.find((c) => c.id === activeCustomId)?.name || 'ستايل مخصص'}`
                    : 'الستايل الحالي جاهز للحفظ'}
                </span>
                <span className="text-[10px] text-[var(--pmuted)] truncate">
                  {template.fontFamily} · {template.boxStyle || 'flat'} · {template.aspectRatio}
                  {template.freeLayoutMode ? ' · حرية كاملة' : ''}
                </span>
              </div>
            </div>
            {activeCustomId && customPresets.some((c) => c.id === activeCustomId) && (
              <button
                type="button"
                onClick={() => void handleUpdateSavedPreset(activeCustomId)}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#00B050]/18 border border-[#00B050] text-[#00B050] dark:text-[#6ee7b7] text-[10px] font-bold shrink-0 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>تحديث</span>
              </button>
            )}
          </div>

          {/* Save Input + Options */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={presetNameInput}
                onChange={(e) => setPresetNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleSaveCustomPreset();
                  }
                }}
                placeholder="سمِّ ستايلك لحفظه (مثال: ستايلي الذهبي)"
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] placeholder:text-[var(--pmuted)] focus:border-[#00B050] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleSaveCustomPreset()}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-[11px] font-bold whitespace-nowrap cursor-pointer shrink-0"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>حفظ ستايلي</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[10px] text-[var(--pmuted)] px-0.5">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeMediaInSave}
                  onChange={(e) => setIncludeMediaInSave(e.target.checked)}
                  className="w-3.5 h-3.5 accent-[#00B050] rounded"
                />
                <span>حفظ صورة الخلفية والشعار</span>
              </label>
              {timing && (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeTimingInSave}
                    onChange={(e) => setIncludeTimingInSave(e.target.checked)}
                    className="w-3.5 h-3.5 accent-[#00B050] rounded"
                  />
                  <span>حفظ أوقات المؤقت والمراحل أيضاً</span>
                </label>
              )}
            </div>
          </div>

          {styleError && (
            <div className="px-2.5 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-300">
              {styleError}
            </div>
          )}

          {/* Saved Custom Styles Cards */}
          {customPresets.length === 0 ? (
            <div className="text-[11px] text-[var(--pmuted)] text-center py-2 border border-dashed border-[var(--pline)] rounded-lg">
              صمّم ألوانك ومواضعك من الأسفل أو اسحب العناصر على الشاشة ثم اضغط «حفظ ستايلي» ليظهر هنا دائماً.
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-0.5">
              {customPresets.map((cp) => {
                const isApplied = activeCustomId === cp.id;
                const isDefault = defaultStyleId === cp.id;
                const isEditing = editingPresetId === cp.id;
                const bgSw =
                  cp.template.backgroundType === 'color'
                    ? cp.template.solidBgColor || '#0f172a'
                    : '#1e293b';

                return (
                  <div
                    key={cp.id}
                    className={`flex items-center justify-between gap-2 p-2 rounded-xl border transition-colors ${
                      isApplied
                        ? 'bg-[#00B050]/12 border-[#00B050]'
                        : 'bg-[var(--panel)] border-[var(--pline)] hover:border-[var(--gold)]'
                    }`}
                  >
                    {isEditing ? (
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <input
                          type="text"
                          value={editingPresetName}
                          onChange={(e) => setEditingPresetName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleCommitRenamePreset(cp.id);
                            if (e.key === 'Escape') setEditingPresetId(null);
                          }}
                          autoFocus
                          className="flex-1 min-w-0 px-2 py-1 rounded bg-[var(--surface)] border border-[#00B050] text-xs text-[var(--ptxt)] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void handleCommitRenamePreset(cp.id)}
                          className="p-1 rounded bg-[#00B050] text-white cursor-pointer"
                          title="حفظ الاسم"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingPresetId(null)}
                          className="p-1 rounded bg-[var(--surface)] text-[var(--pmuted)] cursor-pointer"
                          title="إلغاء"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleApplyCustomPreset(cp)}
                          className="flex items-center gap-2 flex-1 min-w-0 text-right cursor-pointer"
                        >
                          <div className="flex items-center -space-x-1 rtl:space-x-reverse shrink-0">
                            <span
                              className="w-5 h-5 rounded border border-white/25"
                              style={{
                                backgroundColor: bgSw,
                                backgroundImage: cp.template.customBgDataUrl
                                  ? `url(${cp.template.customBgDataUrl})`
                                  : undefined,
                                backgroundSize: 'cover',
                              }}
                            />
                            <span
                              className="w-4 h-4 rounded border"
                              style={{
                                backgroundColor: cp.template.questionBoxColor || '#1e293b',
                                borderColor: cp.template.questionBorderColor || '#EDD6A2',
                              }}
                            />
                            <span
                              className="w-4 h-4 rounded border"
                              style={{
                                backgroundColor: cp.template.optionBoxColor || '#1e293b',
                                borderColor: cp.template.correctColor || '#00B050',
                              }}
                            />
                          </div>

                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-1 min-w-0">
                              <span className="text-xs font-bold text-[var(--ptxt)] truncate">
                                {cp.name}
                              </span>
                              {isDefault && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--gold)]/20 text-[var(--gold)] font-bold shrink-0">
                                  افتراضي
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-[var(--pmuted)] truncate">
                              {cp.template.aspectRatio || '9:16'}
                              {cp.template.boxStyle ? ` · ${cp.template.boxStyle}` : ''}
                              {cp.timing ? ' · مع التوقيت' : ''}
                            </span>
                          </div>
                        </button>

                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleToggleDefaultStyle(cp.id)}
                            title={
                              isDefault
                                ? 'إلغاء التعيين كافتراضي للمشاريع الجديدة'
                                : 'تعيين كستايل افتراضي لأي مشروع جديد'
                            }
                            className={`p-1.5 rounded-md cursor-pointer ${
                              isDefault
                                ? 'text-[var(--gold)] bg-[var(--gold)]/15'
                                : 'text-[var(--pmuted)] hover:text-[var(--gold)]'
                            }`}
                          >
                            <Star className={`w-3.5 h-3.5 ${isDefault ? 'fill-current' : ''}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleUpdateSavedPreset(cp.id)}
                            title="تحديث هذا الستايل بالتعديلات الحالية"
                            className="p-1.5 rounded-md text-[var(--pmuted)] hover:text-[#00B050] cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPresetId(cp.id);
                              setEditingPresetName(cp.name);
                            }}
                            title="إعادة تسمية"
                            className="p-1.5 rounded-md text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleExportCustomPreset(cp)}
                            title="تصدير كملف JSON للنسخ الاحتياطي"
                            className="p-1.5 rounded-md text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteCustomPreset(cp.id)}
                            title="حذف الستايل"
                            className="p-1.5 rounded-md text-[var(--pmuted)] hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </div>
          </div>
        )}
      </section>

      {/* Section 2: Video Format + Free Layout Mode Toggle */}
      <section
        ref={(el) => {
          sectionRefs.current.format = el;
        }}
        className={`rounded-xl border overflow-hidden transition-colors ${
          isSectionOpen('format') ? 'border-[#00B050]/55 bg-[var(--panel)]' : 'border-[var(--pline)]'
        }`}
      >
        {renderAccordionHeader(
          'format',
          '2. نوع الفيديو والحرية الكاملة',
          `${template.aspectRatio === '16:9' ? '16:9 أفقي' : '9:16 شورتس'}${
            template.freeLayoutMode ? ' · حر' : ''
          }`,
          template.aspectRatio === '16:9' ? Monitor : Smartphone
        )}
        {isSectionOpen('format') && (
          <div className="p-3.5 border-t border-[var(--pline)] flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => patch({ aspectRatio: '9:16' })}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                  template.aspectRatio !== '16:9'
                    ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                    : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                <span>شورتس 9:16 عمودي</span>
              </button>
              <button
                type="button"
                onClick={() => patch({ aspectRatio: '16:9' })}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                  template.aspectRatio === '16:9'
                    ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                    : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
                }`}
              >
                <Monitor className="w-4 h-4" />
                <span>فيديو طويل 16:9 أفقي</span>
              </button>
            </div>

            <label
              className={`flex items-start gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${
                template.freeLayoutMode
                  ? 'bg-[#00B050]/14 border-[#00B050]'
                  : 'bg-[var(--surface)] border-[var(--pline)] hover:border-[var(--gold)]'
              }`}
            >
              <input
                type="checkbox"
                checked={Boolean(template.freeLayoutMode)}
                onChange={(e) => {
                  patch({ freeLayoutMode: e.target.checked });
                  showToast(
                    e.target.checked
                      ? 'تم تفعيل وضع الحرية الكاملة ✓'
                      : 'تم تفعيل الترتيب التلقائي ✓'
                  );
                }}
                className="mt-0.5 w-4 h-4 accent-[#00B050] rounded cursor-pointer shrink-0"
              />
              <div className="flex flex-col gap-0.5 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ptxt)]">
                  <Unlock className="w-3.5 h-3.5 text-[#00B050]" />
                  <span>تخطي حماية الطبقات (حرية مطلقة حتى مع التداخل)</span>
                </div>
                <span className="text-[11px] text-[var(--pmuted)] leading-relaxed">
                  في الوضع الافتراضي كل عنصر يعمل في طبقة مستقلة لمنع التداخل تماماً. فعّل هذا الخيار فقط إذا أردت تراكب العناصر فوق بعضها يدوياً.
                </span>
              </div>
            </label>
          </div>
        )}
      </section>

      {/* Section 3: Channel Themes & Background */}
      <section
        ref={(el) => {
          sectionRefs.current.backdrop = el;
        }}
        className={`rounded-xl border overflow-hidden transition-colors ${
          isSectionOpen('backdrop') ? 'border-[#00B050]/55 bg-[var(--panel)]' : 'border-[var(--pline)]'
        }`}
      >
        {renderAccordionHeader(
          'backdrop',
          '3. ثيمات القناة والخلفية',
          template.backgroundType === 'custom'
            ? 'صورة مخصصة'
            : template.backgroundType === 'color'
              ? 'لون ثابت'
              : PRESET_BACKDROPS.find((b) => b.id === template.presetId)?.label || 'ثيم',
          Palette
        )}
        {isSectionOpen('backdrop') && (
          <div className="p-3.5 border-t border-[var(--pline)] flex flex-col gap-3">

        {/* Persistent Mode Switch: Apply Backdrop Only vs Full Theme Override */}
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
          <button
            type="button"
            onClick={() => patch({ themeApplyMode: 'bgOnly' })}
            className={`px-2 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
              themeApplyMode === 'bgOnly'
                ? 'bg-[#00B050] text-white'
                : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
            }`}
          >
            خلفية فقط (حفظ تعديلاتي)
          </button>
          <button
            type="button"
            onClick={() => patch({ themeApplyMode: 'full' })}
            className={`px-2 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
              themeApplyMode === 'full'
                ? 'bg-[var(--gold)] text-[#0c0c0c]'
                : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
            }`}
          >
            تطبيق الثيم كامل (ألوان + شكل)
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {PRESET_BACKDROPS.map((preset) => {
            const active =
              template.backgroundType === 'preset' && template.presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset.id)}
                className={`group relative rounded-lg overflow-hidden border text-right transition-all cursor-pointer ${
                  active
                    ? 'border-[#00B050] ring-2 ring-[#00B050]/35'
                    : 'border-[var(--pline)] hover:border-[var(--gold)]'
                }`}
              >
                {preset.src ? (
                  <img
                    src={preset.src}
                    alt={preset.label}
                    referrerPolicy="no-referrer"
                    className="w-full h-20 object-cover"
                  />
                ) : (
                  <div
                    className="w-full h-20 flex items-center justify-center"
                    style={{
                      background: `radial-gradient(circle at 50% 30%, ${preset.gradientInner}, ${preset.gradientOuter} 75%)`,
                    }}
                  >
                    <span
                      className="w-8 h-5 rounded border-2"
                      style={{
                        backgroundColor: preset.swatchColor,
                        borderColor: '#d4a73a',
                      }}
                    />
                  </div>
                )}
                <div className="px-2 py-1.5 bg-[var(--surface)] text-[10px] font-bold text-[var(--ptxt)] truncate">
                  {preset.label}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUploadBg}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold transition-colors whitespace-nowrap cursor-pointer"
          >
            <ImagePlus className="w-4 h-4" />
            <span>رفع صورة خلفية مخصصة</span>
          </button>

          {template.backgroundType === 'custom' && template.customBgDataUrl && (
            <button
              type="button"
              onClick={() =>
                patch({
                  backgroundType: 'preset',
                  customBgDataUrl: undefined,
                  customBgName: undefined,
                })
              }
              title="حذف الصورة المخصصة"
              className="p-2.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {template.backgroundType === 'custom' && template.customBgName && (
          <p className="text-xs text-[#00B050] dark:text-[#6ee7b7] truncate">
            القالب المرفوع: {template.customBgName}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
            <button
              type="button"
              onClick={() => patch({ backgroundType: 'color' })}
              className={`text-xs font-semibold cursor-pointer ${
                template.backgroundType === 'color' ? 'text-[#00B050]' : 'text-[var(--ptxt)]'
              }`}
            >
              لون ثابت
            </button>
            <input
              type="color"
              value={template.solidBgColor}
              onChange={(e) =>
                patch(
                  {
                    backgroundType: 'color',
                    solidBgColor: e.target.value,
                    ...(template.timerMatchBackground !== false
                      ? { timerBgColor: e.target.value }
                      : {}),
                  },
                  false
                )
              }
              className="w-7 h-7 rounded bg-transparent border-0 cursor-pointer"
            />
          </div>

          <label className="flex flex-col justify-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
            <div className="flex items-center justify-between text-[11px] text-[var(--ptxt)]">
              <span>تعتيم الخلفية</span>
              <span className="font-mono-nums">{Math.round(template.bgDimOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={0.75}
              step={0.05}
              value={template.bgDimOpacity}
              onChange={(e) => patch({ bgDimOpacity: parseFloat(e.target.value) }, false)}
              className="w-full h-1"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--pmuted)]">حركة الخلفية وإضاءة الجو</span>
          <select
            value={template.bgMotion || 'none'}
            onChange={(e) => patch({ bgMotion: e.target.value as BackgroundMotion })}
            className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
          >
            <option value="none">ثابت بدون حركة</option>
            <option value="slowZoom">زوم سينمائي بطيء (Ken Burns)</option>
            <option value="particles">جزيئات ضوئية متحركة (Bokeh / Sparkles)</option>
            <option value="zoomAndParticles">زوم سينمائي + جزيئات ضوئية معاً</option>
          </select>
        </label>
          </div>
        )}
      </section>

      {/* Section 4: Font, Question Box & Top Badge */}
      <section
        ref={(el) => {
          sectionRefs.current.question = el;
        }}
        className={`rounded-xl border overflow-hidden transition-colors ${
          isSectionOpen('question') ? 'border-[#00B050]/55 bg-[var(--panel)]' : 'border-[var(--pline)]'
        }`}
      >
        {renderAccordionHeader(
          'question',
          '4. الخط ومربع السؤال والشارة',
          `${template.fontFamily} · ${template.questionFontSize}px`,
          Type
        )}
        {isSectionOpen('question') && (
          <div className="p-3.5 border-t border-[var(--pline)] flex flex-col gap-3">
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() =>
                  patch({
                    questionX: DEFAULT_TEMPLATE.questionX,
                    questionY: DEFAULT_TEMPLATE.questionY,
                    questionWidth: DEFAULT_TEMPLATE.questionWidth,
                    questionHeightPct: DEFAULT_TEMPLATE.questionHeightPct,
                    questionFontSize: DEFAULT_TEMPLATE.questionFontSize,
                    questionTextAlign: 'center',
                    questionBorderWidth: DEFAULT_TEMPLATE.questionBorderWidth,
                    questionBorderRadius: DEFAULT_TEMPLATE.questionBorderRadius,
                  })
                }
                className="text-[11px] font-bold text-[var(--pmuted)] hover:text-[#00B050] cursor-pointer"
              >
                تصفير أبعاد السؤال
              </button>
            </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">نوع الخط</span>
            <select
              value={template.fontFamily}
              onChange={(e) =>
                patch({ fontFamily: e.target.value as TemplateSettings['fontFamily'] })
              }
              className="px-2.5 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              <option value="Cairo">القاهرة (Cairo)</option>
              <option value="Tajawal">تجوال (Tajawal)</option>
              <option value="Amiri">أميري (Amiri)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">دخول السؤال</span>
            <select
              value={template.questionAnim}
              onChange={(e) => patch({ questionAnim: e.target.value as AnimationStyle })}
              className="px-2.5 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              {ANIM_OPTIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">محاذاة النص</span>
            <select
              value={template.questionTextAlign || 'center'}
              onChange={(e) =>
                patch({ questionTextAlign: e.target.value as QuestionTextAlign })
              }
              className="px-2.5 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              <option value="center">توسيط</option>
              <option value="right">يمين</option>
              <option value="left">يسار</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>موضع السؤال أفقياً (X)</span>
              <span className="font-mono-nums">{Math.round(template.questionX ?? 50)}%</span>
            </div>
            <input
              type="range"
              min={15}
              max={85}
              step={1}
              value={template.questionX ?? 50}
              onChange={(e) => patch({ questionX: parseFloat(e.target.value) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>موضع السؤال عمودياً (Y)</span>
              <span className="font-mono-nums">{Math.round(template.questionY)}%</span>
            </div>
            <input
              type="range"
              min={8}
              max={85}
              step={1}
              value={template.questionY}
              onChange={(e) => patch({ questionY: parseInt(e.target.value, 10) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>عرض مربع السؤال</span>
              <span className="font-mono-nums">{Math.round(template.questionWidth)}%</span>
            </div>
            <input
              type="range"
              min={30}
              max={98}
              step={1}
              value={template.questionWidth}
              onChange={(e) => patch({ questionWidth: parseFloat(e.target.value) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>ارتفاع مربع السؤال</span>
              <span className="font-mono-nums">
                {(template.questionHeightPct ?? 0) === 0 ? 'تلقائي' : `${template.questionHeightPct}%`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={32}
              step={1}
              value={template.questionHeightPct ?? 0}
              onChange={(e) => patch({ questionHeightPct: parseInt(e.target.value, 10) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>حجم خط السؤال</span>
              <span className="font-mono-nums">{template.questionFontSize}px</span>
            </div>
            <input
              type="range"
              min={28}
              max={96}
              step={2}
              value={template.questionFontSize}
              onChange={(e) => patch({ questionFontSize: parseInt(e.target.value, 10) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>سماكة حدود السؤال</span>
              <span className="font-mono-nums">{template.questionBorderWidth}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={14}
              step={1}
              value={template.questionBorderWidth}
              onChange={(e) => patch({ questionBorderWidth: parseInt(e.target.value, 10) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>استدارة زوايا السؤال</span>
              <span className="font-mono-nums">{template.questionBorderRadius}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={70}
              step={2}
              value={template.questionBorderRadius}
              onChange={(e) => patch({ questionBorderRadius: parseInt(e.target.value, 10) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>شفافية صندوق السؤال</span>
              <span className="font-mono-nums">{Math.round(template.questionBoxOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={template.questionBoxOpacity}
              onChange={(e) => patch({ questionBoxOpacity: parseFloat(e.target.value) }, false)}
            />
          </label>

          <div className="col-span-2 flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
            <span className="text-xs text-[var(--ptxt)]">ألوان السؤال (النص / الصندوق / الحد)</span>
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={template.questionTextColor}
                onChange={(e) => patch({ questionTextColor: e.target.value }, false)}
                title="لون نص السؤال"
                className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
              />
              <input
                type="color"
                value={template.questionBoxColor}
                onChange={(e) => patch({ questionBoxColor: e.target.value }, false)}
                title="لون صندوق السؤال"
                className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
              />
              <input
                type="color"
                value={template.questionBorderColor}
                onChange={(e) => patch({ questionBorderColor: e.target.value }, false)}
                title="لون حد السؤال"
                className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={template.enhanceAppearance !== false}
              onChange={(e) => patch({ enhanceAppearance: e.target.checked })}
              className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
            />
            <span className="text-xs font-bold text-[#00B050] dark:text-[#6ee7b7]">
              تحسين ظهور السؤال والخيارات (تباين + إطار مضيء + تدرج احترافي)
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(template.autoFitText)}
              onChange={(e) => patch({ autoFitText: e.target.checked })}
              className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
            />
            <span className="text-xs text-[var(--ptxt)]">
              ضبط تلقائي لحجم النص الطويل لمنع خروجه عن الصندوق (Auto-Fit)
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={template.boxGloss}
                onChange={(e) => patch({ boxGloss: e.target.checked })}
                className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
              />
              <span className="text-xs text-[var(--ptxt)]">لمعان خفيف أعلى الصناديق</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={template.showBadge}
                onChange={(e) => patch({ showBadge: e.target.checked })}
                className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
              />
              <span className="text-xs text-[var(--ptxt)]">إظهار الشارة العلوية</span>
            </label>
          </div>
        </div>

        {template.showBadge && (
          <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--ptxt)]">إعدادات الشارة العلوية</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--pmuted)]">خلفية / نص:</span>
                <input
                  type="color"
                  value={template.badgeBgColor}
                  onChange={(e) => patch({ badgeBgColor: e.target.value }, false)}
                  title="لون خلفية الشارة"
                  className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
                />
                <input
                  type="color"
                  value={template.badgeTextColor}
                  onChange={(e) => patch({ badgeTextColor: e.target.value }, false)}
                  title="لون نص الشارة"
                  className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                  <span>موضع أفقياً (X)</span>
                  <span className="font-mono-nums">{Math.round(template.badgeX ?? 50)}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={1}
                  value={template.badgeX ?? 50}
                  onChange={(e) => patch({ badgeX: parseFloat(e.target.value) }, false)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                  <span>موضع عمودياً (Y)</span>
                  <span className="font-mono-nums">{Math.round(template.badgeY)}%</span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={85}
                  step={1}
                  value={template.badgeY}
                  onChange={(e) => patch({ badgeY: parseFloat(e.target.value) }, false)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                  <span>حجم الشارة</span>
                  <span className="font-mono-nums">
                    {Math.round((template.badgeScale ?? 1) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.6}
                  max={1.8}
                  step={0.05}
                  value={template.badgeScale ?? 1}
                  onChange={(e) => patch({ badgeScale: parseFloat(e.target.value) }, false)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                  <span>استدارة الشارة</span>
                  <span className="font-mono-nums">{template.badgeBorderRadius ?? 33}px</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={40}
                  step={2}
                  value={template.badgeBorderRadius ?? 33}
                  onChange={(e) =>
                    patch({ badgeBorderRadius: parseInt(e.target.value, 10) }, false)
                  }
                />
              </label>
            </div>
          </div>
        )}
          </div>
        )}
      </section>

      {/* Section 5: Box Shapes, Depth, Borders & Zoom/Scale */}
      <section
        ref={(el) => {
          sectionRefs.current.shapes = el;
        }}
        className={`rounded-xl border overflow-hidden transition-colors ${
          isSectionOpen('shapes') ? 'border-[#00B050]/55 bg-[var(--panel)]' : 'border-[var(--pline)]'
        }`}
      >
        {renderAccordionHeader(
          'shapes',
          '5. شكل الصناديق والحواف والزوم',
          `${template.boxStyle || 'flat'} · ${Math.round((template.globalScale ?? 1) * 100)}%`,
          Box
        )}
        {isSectionOpen('shapes') && (
          <div className="p-3.5 border-t border-[var(--pline)] flex flex-col gap-3">
            {Math.abs((template.globalScale ?? 1) - 1) > 0.01 && (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => patch({ globalScale: 1, timerScale: 1, badgeScale: 1 })}
                  className="text-[11px] font-bold text-[#00B050] hover:underline cursor-pointer"
                >
                  إعادة الحجم 100%
                </button>
              </div>
            )}

        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">شكل وعمق الصندوق</span>
            <select
              value={template.boxStyle || 'flat'}
              onChange={(e) => patch({ boxStyle: e.target.value as BoxShapeStyle })}
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              <option value="flat">مسطح كلاسيكي (الأصلي)</option>
              <option value="bevel3d">بارز ثلاثي الأبعاد (3D)</option>
              <option value="inset">مجوف للداخل (Inset)</option>
              <option value="glass">زجاجي شفاف (Glass)</option>
              <option value="neon">نيون متوهج (Neon)</option>
              <option value="millionaireHex">سداسي من سيربح المليون 💎</option>
              <option value="pill3d">كبسولة بارزة ناعمة (Pill 3D)</option>
              <option value="chamfer">زوايا مقصوصة عسكرية (Chamfer)</option>
              <option value="broadcastBar">شريط بث تلفزيوني (TV Bar)</option>
              <option value="ticket">بطاقة تذكرة مقصوصة (Ticket)</option>
              <option value="layeredCard">بطاقة بطبقات متداخلة (Layered)</option>
              <option value="minimalOutline">إطار نظيف شفاف (Minimal)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">تحديد الحواف والإطار</span>
            <select
              value={template.borderStyle || 'solid'}
              onChange={(e) => patch({ borderStyle: e.target.value as BoxBorderStyle })}
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              <option value="solid">حد عادي نظيف</option>
              <option value="double">إطار مزدوج (Double)</option>
              <option value="gradientGold">إطار ذهبي متدرج ✨</option>
              <option value="gradientNeon">إطار نيون متدرج ⚡</option>
              <option value="metallicSilver">إطار فضي معدني (Silver)</option>
              <option value="gradientSunset">إطار شفق متدرج (Sunset)</option>
              <option value="dashedGold">إطار متقطع فاخر (Dashed Gold)</option>
              <option value="cornerBrackets">زوايا إشارة مضيئة (Brackets)</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>تكبير/تصغير المحتوى (Zoom)</span>
              <span className="font-mono-nums">{Math.round((template.globalScale ?? 1) * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.75}
              max={1.25}
              step={0.02}
              value={template.globalScale ?? 1}
              onChange={(e) => patch({ globalScale: parseFloat(e.target.value) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>حجم المؤقت</span>
              <span className="font-mono-nums">{Math.round((template.timerScale ?? 1) * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={1.8}
              step={0.05}
              value={template.timerScale ?? 1}
              onChange={(e) => patch({ timerScale: parseFloat(e.target.value) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>قوة الظل</span>
              <span className="font-mono-nums">
                {Math.round((template.shadowIntensity ?? 1) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.1}
              value={template.shadowIntensity ?? 1}
              onChange={(e) => patch({ shadowIntensity: parseFloat(e.target.value) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>توهج الحواف</span>
              <span className="font-mono-nums">
                {Math.round((template.glowIntensity ?? 0) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={template.glowIntensity ?? 0}
              onChange={(e) => patch({ glowIntensity: parseFloat(e.target.value) }, false)}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--pmuted)]">حركة الانتقال بين الشرائح (Slide Transition)</span>
          <select
            value={template.slideTransition || 'fade'}
            onChange={(e) =>
              patch({ slideTransition: e.target.value as SlideTransitionStyle })
            }
            className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
          >
            <option value="none">قطع مباشر (بدون انتقال)</option>
            <option value="fade">تلاشي ناعم (Fade)</option>
            <option value="slideLeft">انزلاق سريع لليسار</option>
            <option value="slideRight">انزلاق سريع لليمين</option>
            <option value="zoomFade">زوم وتلاشي سينمائي (Zoom)</option>
            <option value="wipeGold">مسحة ضوئية ذهبية (TV Wipe) ✨</option>
          </select>
        </label>

        {/* Millionaire Prize Ladder Config */}
        <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col gap-2.5">
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="flex items-center gap-1.5 text-xs font-bold text-[#EDD6A2]">
              <Crown className="w-4 h-4 text-[#d4a73a]" />
              <span>سلم الجوائز وتقدم الأموال (من سيربح المليون)</span>
            </span>
            <input
              type="checkbox"
              checked={Boolean(template.showPrizeLadder)}
              onChange={(e) => patch({ showPrizeLadder: e.target.checked })}
              className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
            />
          </label>

          {template.showPrizeLadder && (
            <div className="flex flex-col gap-2 pt-1 border-t border-[var(--pline)]">
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[var(--pmuted)]">نمط عرض السلم</span>
                  <select
                    value={template.prizeLadderStyle || 'topStrip'}
                    onChange={(e) =>
                      patch({ prizeLadderStyle: e.target.value as PrizeLadderStyle })
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                  >
                    <option value="topStrip">شريط علوي (مناسب للشورتس)</option>
                    <option value="sideColumn">عمود جانبي (مثالي لـ 16:9)</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[var(--pmuted)]">عنوان السلم</span>
                  <input
                    type="text"
                    value={template.prizeLadderTitle ?? 'الجائزة'}
                    onChange={(e) => patch({ prizeLadderTitle: e.target.value })}
                    placeholder="الجائزة"
                    className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[var(--pmuted)]">
                    مبالغ الجوائز (مفصولة بفاصلة ،)
                  </span>
                  <button
                    type="button"
                    onClick={() => patch({ prizeLadderAmounts: [...DEFAULT_PRIZE_LADDER] })}
                    className="text-[10px] font-bold text-[#00B050] hover:underline cursor-pointer"
                  >
                    استعادة سلم المليون
                  </button>
                </div>
                <input
                  type="text"
                  dir="ltr"
                  value={(template.prizeLadderAmounts || DEFAULT_PRIZE_LADDER).join(', ')}
                  onChange={(e) =>
                    patch({
                      prizeLadderAmounts: e.target.value
                        .split(/[،,]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="100$, 500$, 1000$, 1,000,000$"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs font-mono-nums text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                />
              </label>
            </div>
          )}
        </div>
          </div>
        )}
      </section>

      {/* Section 6: Four Options Layout & Styling */}
      <section
        ref={(el) => {
          sectionRefs.current.options = el;
        }}
        className={`rounded-xl border overflow-hidden transition-colors ${
          isSectionOpen('options') ? 'border-[#00B050]/55 bg-[var(--panel)]' : 'border-[var(--pline)]'
        }`}
      >
        {renderAccordionHeader(
          'options',
          '6. تخطيط الخيارات وألوانها',
          template.optionsLayout === 'vertical' ? 'عمودي' : 'شبكة 2×2',
          LayoutGrid
        )}
        {isSectionOpen('options') && (
          <div className="p-3.5 border-t border-[var(--pline)] flex flex-col gap-3">
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() =>
                  patch({
                    optionsX: DEFAULT_TEMPLATE.optionsX,
                    optionsStartY: DEFAULT_TEMPLATE.optionsStartY,
                    optionsWidth: DEFAULT_TEMPLATE.optionsWidth,
                    optionsGap: DEFAULT_TEMPLATE.optionsGap,
                    optionsColGap: 0,
                    optionHeight: DEFAULT_TEMPLATE.optionHeight,
                    optionFontSize: DEFAULT_TEMPLATE.optionFontSize,
                    optionBorderWidth: DEFAULT_TEMPLATE.optionBorderWidth,
                    optionBorderRadius: DEFAULT_TEMPLATE.optionBorderRadius,
                  })
                }
                className="text-[11px] font-bold text-[var(--pmuted)] hover:text-[#00B050] cursor-pointer"
              >
                تصفير أبعاد الخيارات
              </button>
            </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">شكل الترتيب</span>
            <select
              value={template.optionsLayout}
              onChange={(e) => patch({ optionsLayout: e.target.value as OptionLayoutMode })}
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              <option value="channel2x2">شبكة القناة (حول المؤقت)</option>
              <option value="grid2x2">شبكة 2×2 قياسية</option>
              <option value="vertical">قائمة عمودية</option>
            </select>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">ترقيم الخيارات</span>
            <select
              value={template.optionLabelStyle}
              onChange={(e) =>
                patch({ optionLabelStyle: e.target.value as OptionLabelStyle })
              }
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              <option value="none">بدون ترقيم (ستايل القناة)</option>
              <option value="arabic">أ · ب · ج · د</option>
              <option value="numbers">1 · 2 · 3 · 4</option>
              <option value="english">A · B · C · D</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">طريقة ظهور الخيارات</span>
            <select
              value={template.optionsAppearMode || 'stagger'}
              onChange={(e) =>
                patch({ optionsAppearMode: e.target.value as OptionsAppearMode })
              }
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              <option value="stagger">تتابعي (خياراً بعد خيار)</option>
              <option value="allAtOnce">دفعة واحدة (كلها معاً)</option>
              <option value="rowByRow">صفاً بصف (اثنان معاً)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">محاذاة نص الخيار</span>
            <select
              value={template.optionTextAlign || 'auto'}
              onChange={(e) =>
                patch({ optionTextAlign: e.target.value as OptionTextAlign })
              }
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              <option value="auto">تلقائي حسب القالب</option>
              <option value="center">توسيط داخل الصندوق</option>
              <option value="right">محاذاة لليمين</option>
              <option value="left">محاذاة لليسار</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">حركة دخول الخيارات</span>
            <select
              value={template.optionAnim}
              onChange={(e) => patch({ optionAnim: e.target.value as AnimationStyle })}
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              {ANIM_OPTIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">اتجاه الأعمدة (في 2×2)</span>
            <select
              value={template.optionsRtlColumns !== false ? 'rtl' : 'ltr'}
              onChange={(e) => patch({ optionsRtlColumns: e.target.value === 'rtl' })}
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              <option value="rtl">من اليمين لليسار (أ يمين · ب يسار)</option>
              <option value="ltr">من اليسار لليمين (أ يسار · ب يمين)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>إزاحة الخيارات أفقياً (X)</span>
              <span className="font-mono-nums">{Math.round(template.optionsX ?? 50)}%</span>
            </div>
            <input
              type="range"
              min={15}
              max={85}
              step={1}
              value={template.optionsX ?? 50}
              onChange={(e) => patch({ optionsX: parseFloat(e.target.value) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>بداية الخيارات عمودياً (Y)</span>
              <span className="font-mono-nums">{template.optionsStartY}%</span>
            </div>
            <input
              type="range"
              min={15}
              max={88}
              step={0.5}
              value={template.optionsStartY}
              onChange={(e) => patch({ optionsStartY: parseFloat(e.target.value) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>عرض منطقة الخيارات</span>
              <span className="font-mono-nums">{Math.round(template.optionsWidth)}%</span>
            </div>
            <input
              type="range"
              min={35}
              max={100}
              step={1}
              value={template.optionsWidth}
              onChange={(e) => patch({ optionsWidth: parseInt(e.target.value, 10) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>ارتفاع كل خيار</span>
              <span className="font-mono-nums">{template.optionHeight}px</span>
            </div>
            <input
              type="range"
              min={56}
              max={210}
              step={2}
              value={template.optionHeight}
              onChange={(e) => patch({ optionHeight: parseInt(e.target.value, 10) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>المسافة العمودية بين الصفوف</span>
              <span className="font-mono-nums">{template.optionsGap}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={90}
              step={2}
              value={template.optionsGap}
              onChange={(e) => patch({ optionsGap: parseInt(e.target.value, 10) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>المسافة الأفقية بين الأعمدة</span>
              <span className="font-mono-nums">
                {(template.optionsColGap ?? 0) === 0 ? 'مطابق' : `${template.optionsColGap}px`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={90}
              step={2}
              value={template.optionsColGap ?? 0}
              onChange={(e) => patch({ optionsColGap: parseInt(e.target.value, 10) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>حجم خط الخيار</span>
              <span className="font-mono-nums">{template.optionFontSize}px</span>
            </div>
            <input
              type="range"
              min={22}
              max={68}
              step={2}
              value={template.optionFontSize}
              onChange={(e) => patch({ optionFontSize: parseInt(e.target.value, 10) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>سماكة حدود الخيار</span>
              <span className="font-mono-nums">{template.optionBorderWidth}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={14}
              step={1}
              value={template.optionBorderWidth}
              onChange={(e) => patch({ optionBorderWidth: parseInt(e.target.value, 10) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>استدارة حواف الخيار</span>
              <span className="font-mono-nums">{template.optionBorderRadius}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={64}
              step={2}
              value={template.optionBorderRadius}
              onChange={(e) => patch({ optionBorderRadius: parseInt(e.target.value, 10) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>شفافية الخيار</span>
              <span className="font-mono-nums">{Math.round(template.optionBoxOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={template.optionBoxOpacity}
              onChange={(e) => patch({ optionBoxOpacity: parseFloat(e.target.value) }, false)}
            />
          </label>

          <div className="col-span-2 flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
            <span className="text-xs text-[var(--ptxt)]">ألوان الخيارات (النص / الصندوق / الحد)</span>
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={template.optionTextColor}
                onChange={(e) => patch({ optionTextColor: e.target.value }, false)}
                title="لون نص الخيار"
                className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
              />
              <input
                type="color"
                value={template.optionBoxColor}
                onChange={(e) => patch({ optionBoxColor: e.target.value }, false)}
                title="لون صندوق الخيار"
                className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
              />
              <input
                type="color"
                value={template.optionBorderColor}
                onChange={(e) => patch({ optionBorderColor: e.target.value }, false)}
                title="لون حدود الخيار"
                className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
              />
            </div>
          </div>

          {template.optionLabelStyle !== 'none' && (
            <div className="col-span-2 flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
              <span className="text-xs text-[var(--ptxt)]">ألوان شارة الترقيم (خلفية / نص)</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={template.optionLabelBgColor}
                  onChange={(e) => patch({ optionLabelBgColor: e.target.value }, false)}
                  title="خلفية حرف/رقم الخيار"
                  className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                />
                <input
                  type="color"
                  value={template.optionLabelTextColor}
                  onChange={(e) => patch({ optionLabelTextColor: e.target.value }, false)}
                  title="لون حرف/رقم الخيار"
                  className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                />
              </div>
            </div>
          )}
          </div>
          </div>
        )}
      </section>

      {/* Section 7: Timer, Answer Reveal & Explanation */}
      <section
        ref={(el) => {
          sectionRefs.current.timer = el;
        }}
        className={`rounded-xl border overflow-hidden transition-colors ${
          isSectionOpen('timer') ? 'border-[#00B050]/55 bg-[var(--panel)]' : 'border-[var(--pline)]'
        }`}
      >
        {renderAccordionHeader(
          'timer',
          '7. المؤقت وكشف الجواب والتوضيح',
          `${template.timerStyle} · ${
            template.timerPlacement === 'centerOfOptions'
              ? 'منتصف'
              : template.timerPlacement === 'free'
                ? 'حر'
                : template.timerPlacement === 'belowOptions'
                  ? 'أسفل'
                  : 'أعلى'
          }`,
          Timer
        )}
        {isSectionOpen('timer') && (
          <div className="p-3.5 border-t border-[var(--pline)] flex flex-col gap-3">
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() =>
                  patch({
                    timerStyle: DEFAULT_TEMPLATE.timerStyle,
                    timerPlacement: DEFAULT_TEMPLATE.timerPlacement,
                    timerX: DEFAULT_TEMPLATE.timerX,
                    timerY: DEFAULT_TEMPLATE.timerY,
                    timerScale: 1,
                    timerOpacity: 1,
                    timerUnitSuffix: '',
                    timerUrgentThreshold: 3,
                    timerUrgentColor: '#EF4444',
                    timerBorderColor: '',
                    timerBorderWidth: -1,
                  })
                }
                className="text-[11px] font-bold text-[var(--pmuted)] hover:text-[#00B050] cursor-pointer"
              >
                تصفير المؤقت
              </button>
            </div>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">شكل العد التنازلي</span>
            <select
              value={template.timerStyle}
              onChange={(e) => patch({ timerStyle: e.target.value as TimerStyle })}
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              <option value="channelBox">مربع القناة الأنيق</option>
              <option value="circle">دائرة عد تنازلي</option>
              <option value="neonRing">حلقة نيون مضيئة ⚡</option>
              <option value="hexBadge">شارة سداسية ماسية 💎</option>
              <option value="pillCountdown">كبسولة + شريط تقدم</option>
              <option value="bar">شريط تقدم + ثواني</option>
              <option value="digits">أرقام كبيرة</option>
              <option value="none">بدون مؤقت</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">أسلوب كشف الحل</span>
            <select
              value={template.revealStyle}
              onChange={(e) => patch({ revealStyle: e.target.value as RevealStyle })}
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              <option value="redWrongGreenCorrect">3 حمر للخاطئة + الصحيح أخضر</option>
              <option value="dimOthers">تعتيم الخاطئة + تكبير الصحيح</option>
              <option value="scaleCheck">تكبير + علامة صح</option>
              <option value="highlightGlow">تلوين وتوهج فقط</option>
            </select>
          </label>
        </div>

        {/* Flexible Timer Placement & Visibility Lifecycle */}
        <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col gap-2.5">
          <span className="text-xs font-bold text-[var(--ptxt)]">تموضع المؤقت والمساحات الحرة</span>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                { id: 'aboveOptions', label: 'أعلى الخيارات (منسّق)' },
                { id: 'centerOfOptions', label: 'في منتصف الخيارات 🎯' },
                { id: 'belowOptions', label: 'أسفل الخيارات' },
                { id: 'free', label: 'تحكم حر كامل (X / Y)' },
              ] as { id: TimerPlacement; label: string }[]
            ).map((opt) => {
              const active = (template.timerPlacement || 'aboveOptions') === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => patch({ timerPlacement: opt.id })}
                  className={`px-2.5 py-2 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                      : 'bg-[var(--panel)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--pmuted)]">توقيت ظهور المؤقت</span>
              <select
                value={template.timerVisibilityMode || 'afterOptionsBeforeAnswer'}
                onChange={(e) =>
                  patch({ timerVisibilityMode: e.target.value as TimerVisibilityMode })
                }
                className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
              >
                <option value="afterOptionsBeforeAnswer">بعد الخيارات ويختفي قبل الجواب ✓</option>
                <option value="fromQuestion">من السؤال ويختفي قبل الجواب</option>
                <option value="untilReveal">بعد الخيارات حتى لحظة الجواب</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--pmuted)]">وحدة الرقم</span>
              <select
                value={template.timerUnitSuffix ?? ''}
                onChange={(e) =>
                  patch({ timerUnitSuffix: e.target.value as TimerUnitSuffix })
                }
                className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
              >
                <option value="">رقم فقط (5)</option>
                <option value="ث">ثواني عربي (5ث)</option>
                <option value="s">إنجليزي (5s)</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <label className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                <span>مساحة السؤال عن الخيارات</span>
                <span className="font-mono-nums">{template.questionToOptionsGap ?? 0}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={200}
                step={4}
                value={template.questionToOptionsGap ?? 0}
                onChange={(e) =>
                  patch({ questionToOptionsGap: parseInt(e.target.value, 10) }, false)
                }
              />
            </label>

            {(template.timerPlacement || 'aboveOptions') === 'centerOfOptions' && (
              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                  <span>توسعة منتصف الخيارات للمؤقت</span>
                  <span className="font-mono-nums">{template.optionsCenterGap ?? 24}px</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={180}
                  step={4}
                  value={template.optionsCenterGap ?? 24}
                  onChange={(e) =>
                    patch({ optionsCenterGap: parseInt(e.target.value, 10) }, false)
                  }
                />
              </label>
            )}

            {((template.timerPlacement || 'aboveOptions') === 'aboveOptions' ||
              template.timerPlacement === 'free') && (
              <>
                <label className="flex flex-col gap-1">
                  <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                    <span>موضع المؤقت أفقياً (X)</span>
                    <span className="font-mono-nums">{Math.round(template.timerX ?? 50)}%</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={95}
                    step={1}
                    value={template.timerX ?? 50}
                    onChange={(e) => patch({ timerX: parseFloat(e.target.value) }, false)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                    <span>موضع المؤقت عمودياً (Y)</span>
                    <span className="font-mono-nums">{template.timerY}%</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={95}
                    step={0.5}
                    value={template.timerY}
                    onChange={(e) => patch({ timerY: parseFloat(e.target.value) }, false)}
                  />
                </label>
              </>
            )}

            <label className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                <span>شفافية المؤقت</span>
                <span className="font-mono-nums">
                  {Math.round((template.timerOpacity ?? 1) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={template.timerOpacity ?? 1}
                onChange={(e) => patch({ timerOpacity: parseFloat(e.target.value) }, false)}
              />
            </label>

            <label className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                <span>سماكة حدود المؤقت</span>
                <span className="font-mono-nums">
                  {(template.timerBorderWidth ?? -1) < 0 ? 'تلقائي' : `${template.timerBorderWidth}px`}
                </span>
              </div>
              <input
                type="range"
                min={-1}
                max={10}
                step={1}
                value={template.timerBorderWidth ?? -1}
                onChange={(e) =>
                  patch({ timerBorderWidth: parseInt(e.target.value, 10) }, false)
                }
              />
            </label>

            <label className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                <span>بدء تنبيه الاستعجال</span>
                <span className="font-mono-nums">آخر {template.timerUrgentThreshold ?? 3} ث</span>
              </div>
              <input
                type="range"
                min={1}
                max={8}
                step={1}
                value={template.timerUrgentThreshold ?? 3}
                onChange={(e) =>
                  patch({ timerUrgentThreshold: parseInt(e.target.value, 10) }, false)
                }
              />
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
          <span className="text-xs text-[var(--ptxt)]">ألوان: الصح / الخطأ / العداد / التنبيه / الإطار</span>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={template.correctColor}
              onChange={(e) => patch({ correctColor: e.target.value }, false)}
              title="لون الإجابة الصحيحة"
              className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
            />
            {template.revealStyle === 'redWrongGreenCorrect' && (
              <input
                type="color"
                value={template.wrongColor || '#DC2626'}
                onChange={(e) => patch({ wrongColor: e.target.value }, false)}
                title="لون الخيارات الخاطئة (أحمر)"
                className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
              />
            )}
            {!template.timerMatchBackground && (
              <input
                type="color"
                value={template.timerBgColor || '#F2E3BA'}
                onChange={(e) => patch({ timerBgColor: e.target.value }, false)}
                title="لون خلفية العداد"
                className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
              />
            )}
            <input
              type="color"
              value={template.timerColor}
              onChange={(e) => patch({ timerColor: e.target.value }, false)}
              title="لون أرقام العداد"
              className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
            />
            <input
              type="color"
              value={template.timerUrgentColor || '#EF4444'}
              onChange={(e) => patch({ timerUrgentColor: e.target.value }, false)}
              title="لون عداد الاستعجال في الثواني الأخيرة"
              className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
            />
            <input
              type="color"
              value={template.timerBorderColor || template.questionBorderColor}
              onChange={(e) => patch({ timerBorderColor: e.target.value }, false)}
              title="لون إطار العداد"
              className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={template.timerUrgentPulse !== false}
            onChange={(e) => patch({ timerUrgentPulse: e.target.checked })}
            className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
          />
          <span className="text-xs text-[var(--ptxt)]">
            نبض وتنبيه لوني حماسي في الثواني الأخيرة 🔥
          </span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={template.timerMatchBackground !== false}
            onChange={(e) => patch({ timerMatchBackground: e.target.checked })}
            className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
          />
          <span className="text-xs text-[var(--ptxt)]">
            جعل العداد بنفس لون الخلفية تلقائياً (فك التحديد لحرية الألوان)
          </span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={template.useTimerVideo}
            onChange={(e) => patch({ useTimerVideo: e.target.checked })}
            className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
          />
          <span className="text-xs text-[var(--ptxt)]">
            تفعيل فيديو العداد الأصلي المدمج (عند ضبط المؤقت على 5 ثوانٍ)
          </span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(template.revealConfetti)}
            onChange={(e) => patch({ revealConfetti: e.target.checked })}
            className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
          />
          <span className="text-xs text-[var(--ptxt)]">
            إطلاق قصاصات احتفالية عند كشف الإجابة الصحيحة 🎉
          </span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(template.highlightSpokenOption)}
            onChange={(e) => patch({ highlightSpokenOption: e.target.checked })}
            className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
          />
          <span className="text-xs text-[var(--ptxt)]">
            تمييز وتوهج كل خيار أثناء قراءته صوتياً ✨
          </span>
        </label>

        {/* Explanation Box Setting (Previously missing UI!) */}
        <div className="flex flex-col gap-2 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="text-xs font-bold text-[var(--ptxt)]">
              إظهار صندوق توضيح المعلومة أسفل الخيارات عند كشف الجواب
            </span>
            <input
              type="checkbox"
              checked={Boolean(template.showExplanationOnReveal)}
              onChange={(e) => patch({ showExplanationOnReveal: e.target.checked })}
              className="w-4 h-4 accent-[#00B050] rounded cursor-pointer shrink-0"
            />
          </label>
          {template.showExplanationOnReveal && (
            <div className="flex flex-col gap-2 pt-1.5 border-t border-[var(--pline)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-[var(--pmuted)]">ألوان التوضيح (خلفية / نص)</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={template.explanationBgColor || template.correctColor}
                    onChange={(e) => patch({ explanationBgColor: e.target.value }, false)}
                    title="لون صندوق التوضيح"
                    className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
                  />
                  <input
                    type="color"
                    value={template.explanationTextColor || '#FFFFFF'}
                    onChange={(e) => patch({ explanationTextColor: e.target.value }, false)}
                    title="لون نص التوضيح"
                    className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
                  />
                  {template.explanationBgColor && (
                    <button
                      type="button"
                      onClick={() => patch({ explanationBgColor: '' })}
                      className="text-[10px] text-[var(--pmuted)] hover:text-[#00B050] cursor-pointer"
                    >
                      تلقائي
                    </button>
                  )}
                </div>
              </div>
              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                  <span>إزاحة صندوق التوضيح عمودياً</span>
                  <span className="font-mono-nums">{template.explanationOffsetY ?? 0}px</span>
                </div>
                <input
                  type="range"
                  min={-80}
                  max={140}
                  step={4}
                  value={template.explanationOffsetY ?? 0}
                  onChange={(e) =>
                    patch({ explanationOffsetY: parseInt(e.target.value, 10) }, false)
                  }
                />
              </label>
            </div>
          )}
        </div>
          </div>
        )}
      </section>

      {/* Section 8: Intro Hook & End Card */}
      <section
        ref={(el) => {
          sectionRefs.current.introEnd = el;
        }}
        className={`rounded-xl border overflow-hidden transition-colors ${
          isSectionOpen('introEnd') ? 'border-[#00B050]/55 bg-[var(--panel)]' : 'border-[var(--pline)]'
        }`}
      >
        {renderAccordionHeader(
          'introEnd',
          '8. المقدمة (الهوك) وشاشة النهاية',
          `${template.showIntroHook ? 'مقدمة' : 'بدون مقدمة'} · ${template.showEndCard ? 'نهاية' : 'بدون'}`,
          LayoutTemplate
        )}
        {isSectionOpen('introEnd') && (
          <div className="p-3.5 border-t border-[var(--pline)] flex flex-col gap-3">
        {/* Intro Hook Card Setting */}
        <div className="flex flex-col gap-2.5 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="text-xs font-bold text-[var(--ptxt)]">شريحة مقدمة سريعة (Hook) + الصوت</span>
            <input
              type="checkbox"
              checked={Boolean(template.showIntroHook)}
              onChange={(e) => patch({ showIntroHook: e.target.checked })}
              className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
            />
          </label>
          {template.showIntroHook && (
            <div className="flex flex-col gap-2.5 pt-1 border-t border-[var(--pline)]">
              <input
                type="text"
                value={template.introHookText ?? 'اختبر معلوماتك الآن!'}
                onChange={(e) => patch({ introHookText: e.target.value })}
                placeholder="اختبر معلوماتك الآن!"
                className="w-full px-3 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
              />
              <div className="flex flex-wrap gap-1">
                {VIRAL_HOOK_PRESETS.map((hookPreset) => (
                  <button
                    key={hookPreset}
                    type="button"
                    onClick={() => patch({ introHookText: hookPreset })}
                    className="px-2 py-0.5 rounded-md bg-[var(--panel)] border border-[var(--pline)] hover:border-[#00B050] text-[10px] font-semibold text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                  >
                    {hookPreset}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <div className="flex justify-between text-[11px] text-[var(--pmuted)]">
                    <span>مدة المقدمة</span>
                    <span className="font-mono-nums">{(template.introHookDuration ?? 1.2).toFixed(1)} ث</span>
                  </div>
                  <input
                    type="range"
                    min={0.6}
                    max={6.0}
                    step={0.1}
                    value={template.introHookDuration ?? 1.2}
                    onChange={(e) => patch({ introHookDuration: parseFloat(e.target.value) })}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[var(--pmuted)]">مؤثر دخول الهوك (SFX)</span>
                  <select
                    value={template.introHookSfx ?? 'whoosh'}
                    onChange={(e) => patch({ introHookSfx: e.target.value as BuiltInSfxId })}
                    className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                  >
                    {BUILTIN_SFX_OPTIONS.map((sfx) => (
                      <option key={sfx.id} value={sfx.id}>
                        {sfx.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Hook Voiceover Controls: AI TTS + Mic Record + File Upload */}
              <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-[var(--ptxt)]">
                    صوت المقدمة (الهوك)
                  </span>
                  {template.introHookAudio?.duration ? (
                    <span className="text-[10px] font-mono-nums text-[#00B050] dark:text-[#6ee7b7]">
                      {template.introHookAudio.fileName} ({template.introHookAudio.duration.toFixed(1)}ث)
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--pmuted)]">
                      بدون تعليق صوتي (يُسمع المؤثر فقط)
                    </span>
                  )}
                </div>

                <input
                  ref={hookAudioInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={(e) => void handleUploadHookAudio(e)}
                  className="hidden"
                />

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isHookVoicing}
                    onClick={() => void handleGenerateHookAiVoice()}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-50 text-white text-[11px] font-bold cursor-pointer"
                  >
                    {isHookVoicing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>{isHookVoicing ? 'جارٍ التوليد...' : 'توليد صوت للهوك'}</span>
                  </button>

                  <MicRecordButton
                    compact
                    fileNameBase="hook-voice"
                    onError={(msg) => setHookAudioError(msg)}
                    onRecorded={(clip) => {
                      setHookAudioError('');
                      patch({ introHookAudio: clip });
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => hookAudioInputRef.current?.click()}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--surface)] hover:border-[var(--gold)] border border-[var(--pline)] text-[11px] font-semibold text-[var(--ptxt)] cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>رفع ملف صوت</span>
                  </button>

                  {template.introHookAudio?.dataUrl && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (template.introHookAudio) {
                            void soundEngine.playClip(template.introHookAudio, 1);
                          }
                        }}
                        title="تشغيل صوت المقدمة"
                        className="p-1.5 rounded-lg bg-[var(--surface)] hover:border-[#00B050] border border-[var(--pline)] text-[#00B050] cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => patch({ introHookAudio: undefined })}
                        title="حذف صوت المقدمة"
                        className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {hookAudioError && (
                  <p className="text-[11px] text-rose-400">{hookAudioError}</p>
                )}
              </div>

              {/* Anti-Swipe First-Second Flash Teaser */}
              <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-[var(--panel)] border border-[var(--gold)]/35">
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <div>
                    <div className="text-[11px] font-bold text-[var(--gold)]">
                      ومضة أول ثانية (Anti-Swipe Flash Teaser ⚡)
                    </div>
                    <div className="text-[10px] text-[var(--pmuted)]">
                      تعرض لمحة سريعة من أصعب سؤال في أول نصف ثانية لمنع المشاهد من التمرير
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(template.introFlashTeaser)}
                    onChange={(e) => patch({ introFlashTeaser: e.target.checked })}
                    className="w-4 h-4 accent-[#00B050] rounded cursor-pointer shrink-0"
                  />
                </label>
                {template.introFlashTeaser && (
                  <input
                    type="text"
                    value={template.introFlashHookText ?? 'لن تصدق السؤال الأخير! ⚡'}
                    onChange={(e) => patch({ introFlashHookText: e.target.value })}
                    placeholder="لن تصدق السؤال الأخير! ⚡"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-[11px] text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* End Screen Card Setting */}
        <div className="flex flex-col gap-2 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="text-xs font-bold text-[var(--ptxt)]">شاشة نهاية الفيديو</span>
            <input
              type="checkbox"
              checked={template.showEndCard}
              onChange={(e) => patch({ showEndCard: e.target.checked })}
              className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
            />
          </label>
          {template.showEndCard && (
            <>
              <input
                type="text"
                value={template.endCardText}
                onChange={(e) => patch({ endCardText: e.target.value })}
                placeholder="شكراً لمشاهدتكم"
                className="w-full px-3 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
              />
              <label className="flex items-center gap-2 cursor-pointer pt-0.5">
                <input
                  type="checkbox"
                  checked={Boolean(template.showEndSubscribeCta)}
                  onChange={(e) => patch({ showEndSubscribeCta: e.target.checked })}
                  className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
                />
                <span className="text-[11px] text-[var(--ptxt)]">
                  إظهار زر دعوة الاشتراك والتعليق أسفل شاشة النهاية
                </span>
              </label>
              {template.showEndSubscribeCta && (
                <div className="flex flex-col gap-1.5 pt-1 border-t border-[var(--pline)]/70">
                  <input
                    type="text"
                    value={template.endCtaText ?? ''}
                    onChange={(e) => patch({ endCtaText: e.target.value })}
                    placeholder="اشترك في القناة · اكتب نتيجتك في التعليقات"
                    className="w-full px-3 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] placeholder:text-[var(--pmuted)] focus:border-[#00B050] focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-1">
                    {[
                      'كم سؤالاً جاوبت صح؟ اكتب نتيجتك بالتعليقات 🔥',
                      'اشترك وتحدى أصدقاءك في التعليقات!',
                    ].map((presetText) => (
                      <button
                        key={presetText}
                        type="button"
                        onClick={() => patch({ endCtaText: presetText })}
                        className="px-2 py-0.5 rounded bg-[var(--panel)] border border-[var(--pline)] hover:border-[#00B050] text-[10px] text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                      >
                        {presetText}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* End Card Outro Voiceover (Subscribe CTA Audio) */}
              <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-[var(--ptxt)]">
                    صوت شاشة النهاية والدعوة للاشتراك
                  </span>
                  {template.endCardAudio?.duration ? (
                    <span className="text-[10px] font-mono-nums text-[#00B050] dark:text-[#6ee7b7]">
                      {template.endCardAudio.fileName} ({template.endCardAudio.duration.toFixed(1)}ث)
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--pmuted)]">بدون صوت ختامي</span>
                  )}
                </div>

                <input
                  ref={endAudioInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={(e) => void handleUploadEndAudio(e)}
                  className="hidden"
                />

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isEndVoicing}
                    onClick={() => void handleGenerateEndAiVoice()}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-50 text-white text-[11px] font-bold cursor-pointer"
                  >
                    {isEndVoicing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>{isEndVoicing ? 'جارٍ التوليد...' : 'توليد صوت الاشتراك'}</span>
                  </button>

                  <MicRecordButton
                    compact
                    fileNameBase="outro-voice"
                    onError={(msg) => setEndAudioError(msg)}
                    onRecorded={(clip) => {
                      setEndAudioError('');
                      patch({ endCardAudio: clip });
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => endAudioInputRef.current?.click()}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--surface)] hover:border-[var(--gold)] border border-[var(--pline)] text-[11px] font-semibold text-[var(--ptxt)] cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>رفع صوت</span>
                  </button>

                  {template.endCardAudio?.dataUrl && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (template.endCardAudio) {
                            void soundEngine.playClip(template.endCardAudio, 1);
                          }
                        }}
                        title="تشغيل صوت النهاية"
                        className="p-1.5 rounded-lg bg-[var(--surface)] hover:border-[#00B050] border border-[var(--pline)] text-[#00B050] cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => patch({ endCardAudio: undefined })}
                        title="حذف صوت النهاية"
                        className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {endAudioError && (
                  <p className="text-[11px] text-rose-400">{endAudioError}</p>
                )}
              </div>
            </>
          )}
          </div>
          </div>
        )}
      </section>

      {/* Section 9: Channel Brand Logo & Slide Progress */}
      <section
        ref={(el) => {
          sectionRefs.current.brand = el;
        }}
        className={`rounded-xl border overflow-hidden transition-colors ${
          isSectionOpen('brand') ? 'border-[#00B050]/55 bg-[var(--panel)]' : 'border-[var(--pline)]'
        }`}
      >
        {renderAccordionHeader(
          'brand',
          '9. شعار القناة والعداد العلوي',
          template.brandLogoDataUrl ? 'شعار مرفوع' : template.brandHandleText || 'بدون شعار',
          Crown
        )}
        {isSectionOpen('brand') && (
          <div className="p-3.5 border-t border-[var(--pline)] flex flex-col gap-3">
        {/* Channel Brand Kits Manager (Quick Multi-Channel Profiles) */}
        <div className="flex flex-col gap-2 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-[var(--gold)] flex items-center gap-1.5">
              <Crown className="w-3.5 h-3.5" />
              <span>حزم هوية القناة (Brand Kits)</span>
            </span>
            <span className="text-[10px] text-[var(--pmuted)]">تبديل بضغطة واحدة</span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={brandKitNameInput}
              onChange={(e) => setBrandKitNameInput(e.target.value)}
              placeholder="اسم القناة (مثلاً: قناة الأسئلة الدينية)..."
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                void saveBrandKitAsync(
                  brandKitNameInput || template.brandHandleText || 'هوية قناتي',
                  template,
                  timing
                ).then(({ list, created }) => {
                  setBrandKits(list);
                  setBrandKitNameInput('');
                  showToast(`تم حفظ هوية "${created.name}" ✓`);
                });
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-[11px] font-bold shrink-0 cursor-pointer"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>حفظ الهوية</span>
            </button>
          </div>
          {brandKits.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {brandKits.map((kit) => (
                <div
                  key={kit.id}
                  className="flex items-center gap-1 pl-1 pr-2 py-1 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px]"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onChange(applyBrandKitToTemplate(template, kit), true);
                      if (kit.thinkingDuration && onTimingChange && timing) {
                        onTimingChange({ ...timing, thinkingDuration: kit.thinkingDuration });
                      }
                      showToast(`تم تفعيل هوية "${kit.name}" ✓`);
                    }}
                    className="flex items-center gap-1.5 font-bold text-[var(--ptxt)] hover:text-[#00B050] cursor-pointer"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-white/40 shrink-0"
                      style={{ backgroundColor: kit.questionBoxColor }}
                    />
                    <span>{kit.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void deleteBrandKitAsync(kit.id).then((next) => setBrandKits(next));
                    }}
                    title="حذف الهوية"
                    className="p-0.5 text-[var(--pmuted)] hover:text-rose-400 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => void handleUploadBrandLogo(e)}
            className="hidden"
          />

          {template.brandLogoDataUrl ? (
            <div className="flex items-center justify-between gap-2 w-full px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src={template.brandLogoDataUrl}
                  alt="شعار القناة"
                  className="w-10 h-10 rounded-lg object-contain bg-black/30 p-1 border border-[var(--pline)] shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[var(--ptxt)] truncate">
                    {template.brandLogoName || 'شعار القناة'}
                  </div>
                  <div className="text-[10px] text-[#00B050] dark:text-[#6ee7b7]">
                    يظهر متحركاً في المعاينة والفيديو المصدّر
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] hover:border-[var(--gold)] border border-[var(--pline)] text-[11px] font-semibold cursor-pointer"
                >
                  تغيير
                </button>
                <button
                  type="button"
                  onClick={() =>
                    patch({ brandLogoDataUrl: undefined, brandLogoName: undefined })
                  }
                  title="إزالة الشعار"
                  className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--surface)] hover:border-[var(--gold)] border border-dashed border-[var(--pline)] text-xs font-bold text-[var(--ptxt)] transition-colors cursor-pointer"
            >
              <ImagePlus className="w-4 h-4 text-[var(--gold)]" />
              <span>رفع شعار القناة (PNG شفاف / SVG / JPG)</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">حركة الشعار في الفيديو</span>
            <select
              value={template.brandLogoAnim || 'pulse'}
              onChange={(e) =>
                patch({ brandLogoAnim: e.target.value as BrandLogoAnimation })
              }
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              <option value="pulse">نبض احترافي (Pulse)</option>
              <option value="float">طفو ناعم (Float)</option>
              <option value="glow">توهج ذهبي متموج (Glow)</option>
              <option value="spin">دوران مستمر (Spin)</option>
              <option value="none">ثابت بدون حركة</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--pmuted)]">مكان الشعار</span>
            <select
              value={template.brandLogoPosition || 'topRight'}
              onChange={(e) =>
                patch({ brandLogoPosition: e.target.value as BrandCornerPosition })
              }
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              <option value="topRight">أعلى اليمين</option>
              <option value="topLeft">أعلى اليسار</option>
              <option value="bottomRight">أسفل اليمين</option>
              <option value="bottomLeft">أسفل اليسار</option>
              <option value="custom">موضع حر (X / Y)</option>
            </select>
          </label>

          {template.brandLogoPosition === 'custom' && (
            <>
              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-xs text-[var(--ptxt)]">
                  <span>الشعار أفقياً (X)</span>
                  <span className="font-mono-nums">{Math.round(template.brandLogoX ?? 88)}%</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={95}
                  step={1}
                  value={template.brandLogoX ?? 88}
                  onChange={(e) => patch({ brandLogoX: parseFloat(e.target.value) }, false)}
                />
              </label>

              <label className="flex flex-col gap-1">
                <div className="flex justify-between text-xs text-[var(--ptxt)]">
                  <span>الشعار عمودياً (Y)</span>
                  <span className="font-mono-nums">{Math.round(template.brandLogoY ?? 10)}%</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={95}
                  step={1}
                  value={template.brandLogoY ?? 10}
                  onChange={(e) => patch({ brandLogoY: parseFloat(e.target.value) }, false)}
                />
              </label>
            </>
          )}

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>حجم الشعار</span>
              <span className="font-mono-nums">{template.brandLogoSize ?? 108}px</span>
            </div>
            <input
              type="range"
              min={56}
              max={220}
              step={4}
              value={template.brandLogoSize ?? 108}
              onChange={(e) => patch({ brandLogoSize: parseInt(e.target.value, 10) }, false)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-[var(--ptxt)]">
              <span>شفافية الشعار</span>
              <span className="font-mono-nums">
                {Math.round((template.brandOpacity ?? 0.92) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={template.brandOpacity ?? 0.92}
              onChange={(e) => patch({ brandOpacity: parseFloat(e.target.value) }, false)}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--pmuted)]">معرف أو اسم القناة أسفل الشعار (اختياري)</span>
          <input
            type="text"
            value={template.brandHandleText || ''}
            onChange={(e) => patch({ brandHandleText: e.target.value })}
            placeholder="@اسم_قناتك"
            dir="ltr"
            className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] focus:border-[#00B050] focus:outline-none text-xs text-[var(--ptxt)] text-right placeholder:text-[var(--pmuted)]"
          />
        </label>

        <label className="flex items-center gap-2 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={Boolean(template.showProgressCounter)}
            onChange={(e) => patch({ showProgressCounter: e.target.checked })}
            className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
          />
          <span className="text-xs text-[var(--ptxt)]">
            إظهار عداد رقم السؤال وشريط التقدم أعلى الشاشة (سؤال 2 من 5)
          </span>
        </label>

        {/* Live Scoreboard HUD */}
        <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="text-xs font-bold text-[var(--ptxt)]">
              لوحة التحدي والنقاط المباشرة (Scoreboard 🏆)
            </span>
            <input
              type="checkbox"
              checked={Boolean(template.showLiveScoreboard)}
              onChange={(e) => patch({ showLiveScoreboard: e.target.checked })}
              className="w-4 h-4 accent-[#00B050] rounded cursor-pointer shrink-0"
            />
          </label>
          {template.showLiveScoreboard && (
            <input
              type="text"
              value={template.scoreBoardLabel ?? 'تحدي النقاط'}
              onChange={(e) => patch({ scoreBoardLabel: e.target.value })}
              placeholder="تحدي النقاط"
              className="w-full px-3 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            />
          )}
        </div>
          </div>
        )}
      </section>

      {/* Section 10: Interactive Studio Presenter / Host */}
      <section
        ref={(el) => {
          sectionRefs.current.presenter = el;
        }}
        className={`rounded-xl border overflow-hidden transition-colors ${
          isSectionOpen('presenter') ? 'border-[#00B050]/55 bg-[var(--panel)]' : 'border-[var(--pline)]'
        }`}
      >
        {renderAccordionHeader(
          'presenter',
          '10. المذيع التفاعلي والراوي الذكي AI',
          template.aiPresenter?.enabled
            ? 'راوي بشري حقيقي (AI)'
            : template.presenterEnabled
              ? (template.presenterStyle || 'stylized3d') === 'stylized3d'
                ? template.presenterGender === 'female'
                  ? 'مذيعة ذكية متحركة'
                  : 'مذيع ذكي متحرك'
                : template.presenterStyle === 'photoFemale'
                  ? 'صورة مذيعة'
                  : template.presenterStyle === 'customPhoto'
                    ? 'صورة مخصصة'
                    : 'صورة مذيع'
              : 'معطل',
          UserCheck
        )}
        {isSectionOpen('presenter') && (
          <div className="p-3.5 border-t border-[var(--pline)] flex flex-col gap-3">
            {/* Realistic AI Human Video Presenter Studio Banner */}
            <div className="p-3 rounded-xl bg-gradient-to-l from-[#00B050]/18 via-[var(--surface)] to-[#d4a73a]/12 border border-[#00B050]/45 flex flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-[var(--ptxt)]">
                    <Video className="w-4 h-4 text-[#00B050] shrink-0" />
                    <span>الراوي الذكي – AI Presenter (فيديو بشري حقيقي)</span>
                  </div>
                  <p className="text-[11px] text-[var(--pmuted)] mt-1 leading-relaxed">
                    أنشئ فيديو لراوٍ بشري حقيقي يتحدث بالعربية مع مزامنة شفاه وحركات طبيعية عبر Tavus وأدرجه مباشرة على المسرح.
                  </p>
                </div>
                {onOpenAiPresenterStudio && (
                  <button
                    type="button"
                    onClick={onOpenAiPresenterStudio}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-extrabold cursor-pointer shadow-sm"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{template.aiPresenter ? 'استبدال / توليد جديد' : 'فتح الاستوديو'}</span>
                  </button>
                )}
              </div>

              {template.aiPresenter && (
                <AiPresenterEditorControls
                  aiPresenter={template.aiPresenter}
                  slides={slides}
                  onChange={(nextAi, immediate = true) =>
                    patch({ aiPresenter: nextAi }, immediate)
                  }
                  onOpenStudioForReplace={() => onOpenAiPresenterStudio?.()}
                  onDelete={() => {
                    const prevMediaKey = template.aiPresenter?.mediaKey;
                    patch({ aiPresenter: undefined }, true);
                    if (prevMediaKey) {
                      void deleteAiMediaBlob(prevMediaKey);
                    }
                  }}
                />
              )}
            </div>

            <input
              ref={presenterPhotoInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => void handleUploadPresenterPhoto(e)}
              className="hidden"
            />

            <label className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[var(--surface)] border border-[#00B050]/35 cursor-pointer">
              <div>
                <div className="text-xs font-extrabold text-[var(--ptxt)]">
                  تفعيل المذيع التفاعلي على الشاشة 🎙️
                </div>
                <div className="text-[11px] text-[var(--pmuted)] mt-0.5">
                  يحرك شفتيه تلقائياً كأنه المتحدث، ويتفاعل بـ ١٠ حركات يد وتفكير وخيارات واحتفال
                </div>
              </div>
              <input
                type="checkbox"
                checked={Boolean(template.presenterEnabled)}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  patch({
                    presenterEnabled: enabled,
                    ...(enabled && template.aiPresenter?.enabled
                      ? { aiPresenter: { ...template.aiPresenter, enabled: false } }
                      : {}),
                  });
                }}
                className="w-4 h-4 accent-[#00B050] rounded cursor-pointer shrink-0"
              />
            </label>

            {template.presenterEnabled && template.aiPresenter?.enabled && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/45 text-[11px]">
                <span className="font-bold text-[var(--ptxt)]">
                  فيديو الراوي (Tavus) نشط حالياً ويُخفي المذيع التفاعلي على المسرح.
                </span>
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      presenterEnabled: true,
                      presenterStyle: 'stylized3d',
                      aiPresenter: template.aiPresenter
                        ? { ...template.aiPresenter, enabled: false }
                        : undefined,
                    })
                  }
                  className="shrink-0 px-2.5 py-1 rounded-lg bg-[#00B050] text-white font-extrabold cursor-pointer"
                >
                  إظهار التفاعلي الآن
                </button>
              </div>
            )}

            {/* Presenter Character Selector Cards */}
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  id: 'stylized3d' as PresenterStyle,
                  title: 'مذيع ذكي متحرك (١٠ حركات) 🎭',
                  sub: 'شفاه متزامنة + ذراعان + تفكير + خيارات + احتفال',
                  thumb: '',
                },
                {
                  id: 'photoMale' as PresenterStyle,
                  title: 'صورة مذيع استوديو',
                  sub: 'صورة ثابتة مع نطق خفيف',
                  thumb: PRESENTER_PORTRAIT_URLS.photoMale,
                },
                {
                  id: 'photoFemale' as PresenterStyle,
                  title: 'صورة مذيعة استوديو',
                  sub: 'صورة ثابتة مع نطق خفيف',
                  thumb: PRESENTER_PORTRAIT_URLS.photoFemale,
                },
                {
                  id: 'customPhoto' as PresenterStyle,
                  title: 'صورتك / شعارك الخاص',
                  sub: template.presenterPhotoName || 'ارفع صورة مذيع أو صورتك',
                  thumb: template.presenterPhotoDataUrl || '',
                },
              ].map((ch) => {
                const active = (template.presenterStyle || 'stylized3d') === ch.id;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      if (ch.id === 'customPhoto' && !template.presenterPhotoDataUrl) {
                        presenterPhotoInputRef.current?.click();
                        return;
                      }
                      patch({
                        presenterEnabled: true,
                        presenterStyle: ch.id,
                        ...(template.aiPresenter?.enabled
                          ? { aiPresenter: { ...template.aiPresenter, enabled: false } }
                          : {}),
                      });
                    }}
                    className={`flex items-center gap-2.5 p-2 rounded-xl border text-right transition-colors cursor-pointer ${
                      active && template.presenterEnabled
                        ? 'bg-[#00B050]/16 border-[#00B050] text-[var(--ptxt)]'
                        : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
                    }`}
                  >
                    {ch.thumb ? (
                      <img
                        src={ch.thumb}
                        alt={ch.title}
                        className="w-11 h-11 rounded-lg object-cover border border-[var(--pline)] shrink-0"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-lg bg-[#00B050]/15 border border-[#00B050]/35 flex items-center justify-center shrink-0 text-[#00B050]">
                        {ch.id === 'stylized3d' ? (
                          <Sparkles className="w-5 h-5" />
                        ) : (
                          <ImagePlus className="w-5 h-5" />
                        )}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-[11px] font-extrabold truncate">{ch.title}</div>
                      <div className="text-[10px] text-[var(--pmuted)] truncate">{ch.sub}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {template.presenterStyle === 'customPhoto' && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => presenterPhotoInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] text-xs font-bold cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-[#00B050]" />
                  <span>{template.presenterPhotoDataUrl ? 'تغيير صورة المذيع' : 'رفع صورة شخصية'}</span>
                </button>
              </div>
            )}

            {template.presenterEnabled && (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-[var(--pmuted)]">إطار المذيع</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'broadcastCard' as PresenterFrameShape, label: 'بطاقة تلفزيونية' },
                      { id: 'circleCam' as PresenterFrameShape, label: 'كاميرا دائرية' },
                      { id: 'cutout' as PresenterFrameShape, label: 'طليق بدون إطار' },
                    ].map((sh) => (
                      <button
                        key={sh.id}
                        type="button"
                        onClick={() => patch({ presenterFrameShape: sh.id })}
                        className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer ${
                          (template.presenterFrameShape || 'broadcastCard') === sh.id
                            ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                            : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)]'
                        }`}
                      >
                        {sh.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--pmuted)]">موضع المذيع بالأسئلة</span>
                    <select
                      value={template.presenterPlacement || 'cornerBottomLeft'}
                      onChange={(e) =>
                        patch({ presenterPlacement: e.target.value as PresenterPlacement })
                      }
                      className="px-2.5 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                    >
                      <option value="bottomCenter">أسفل الوسط (ثابت)</option>
                      <option value="cornerBottomLeft">أسفل اليسار (مناسب لليوتيوب)</option>
                      <option value="cornerBottomRight">أسفل اليمين</option>
                      <option value="topLeft">أعلى اليسار</option>
                      <option value="topRight">أعلى اليمين</option>
                      <option value="sideStage">جانبي كبير</option>
                      <option value="floating">موضع حر (اسحبه على الشاشة)</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--pmuted)]">اسم / شارة المذيع</span>
                    <input
                      type="text"
                      value={template.presenterName ?? 'المذيع'}
                      onChange={(e) => patch({ presenterName: e.target.value })}
                      placeholder="المذيع"
                      className="px-2.5 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                    />
                  </label>
                </div>

                <label className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs text-[var(--ptxt)]">
                    <span>حجم المذيع أثناء الأسئلة</span>
                    <span className="font-mono-nums">{template.presenterScale ?? 100}%</span>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={155}
                    step={5}
                    value={template.presenterScale ?? 100}
                    onChange={(e) =>
                      patch({ presenterScale: parseInt(e.target.value, 10) }, false)
                    }
                  />
                </label>

                {template.presenterPlacement === 'floating' && (
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="flex flex-col gap-1">
                      <div className="flex justify-between text-xs text-[var(--ptxt)]">
                        <span>موضع المذيع أفقياً (X)</span>
                        <span className="font-mono-nums">{Math.round(template.presenterX ?? 18)}%</span>
                      </div>
                      <input
                        type="range"
                        min={6}
                        max={94}
                        step={1}
                        value={template.presenterX ?? 18}
                        onChange={(e) => patch({ presenterX: parseFloat(e.target.value) }, false)}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <div className="flex justify-between text-xs text-[var(--ptxt)]">
                        <span>موضع المذيع عمودياً (Y)</span>
                        <span className="font-mono-nums">{Math.round(template.presenterY ?? 81)}%</span>
                      </div>
                      <input
                        type="range"
                        min={8}
                        max={94}
                        step={1}
                        value={template.presenterY ?? 81}
                        onChange={(e) => patch({ presenterY: parseFloat(e.target.value) }, false)}
                      />
                    </label>
                  </div>
                )}

                <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
                  <label className="flex items-center justify-between gap-2 cursor-pointer">
                    <span className="text-[11px] font-bold text-[var(--ptxt)]">
                      ظهور المذيع بملء الشاشة في المقدمة يتحدث (Hook) 🎬
                    </span>
                    <input
                      type="checkbox"
                      checked={template.presenterIntroFullscreen !== false}
                      onChange={(e) =>
                        patch({
                          presenterIntroFullscreen: e.target.checked,
                          ...(e.target.checked && !template.showIntroHook
                            ? { showIntroHook: true }
                            : {}),
                        })
                      }
                      className="w-4 h-4 accent-[#00B050] rounded cursor-pointer shrink-0"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-2 cursor-pointer">
                    <span className="text-[11px] font-bold text-[var(--ptxt)]">
                      ظهور المذيع بملء الشاشة في النهاية يدعو للاشتراك 🔔
                    </span>
                    <input
                      type="checkbox"
                      checked={template.presenterOutroFullscreen !== false}
                      onChange={(e) =>
                        patch({
                          presenterOutroFullscreen: e.target.checked,
                          ...(e.target.checked && !template.showEndCard
                            ? { showEndCard: true, showEndSubscribeCta: true }
                            : {}),
                        })
                      }
                      className="w-4 h-4 accent-[#00B050] rounded cursor-pointer shrink-0"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-2 cursor-pointer">
                    <span className="text-[11px] font-bold text-[var(--ptxt)] flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-[#00B050]" />
                      <span>مايكروفون الاستوديو الاحترافي أمام المذيع</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={template.presenterStudioMic !== false}
                      onChange={(e) => patch({ presenterStudioMic: e.target.checked })}
                      className="w-4 h-4 accent-[#00B050] rounded cursor-pointer shrink-0"
                    />
                  </label>
                </div>

                {/* Rigged Realistic Studio Host Appearance Customizer */}
                {(template.presenterStyle || 'stylized3d') === 'stylized3d' && (
                  <div className="flex flex-col gap-2.5 p-2.5 rounded-xl bg-[var(--surface)] border border-[#00B050]/35">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-extrabold text-[var(--ptxt)]">
                        تخصيص شكل المذيع الواقعي ومظهره (تحكم كامل) 🎨
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          patch({
                            presenterGender: 'male',
                            presenterSkinTone: 'warmWheat',
                            presenterHairColor: '#1c1816',
                            presenterEyeColor: '#4b2f1c',
                            presenterSuitColor: '#14284b',
                            presenterTieColor: '#d4a73a',
                            presenterBeard: 'trimmed',
                            presenterGlasses: false,
                          })
                        }
                        className="text-[10px] font-bold text-[#00B050] hover:underline cursor-pointer"
                      >
                        افتراضي
                      </button>
                    </div>

                    {/* Gender */}
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          { id: 'male', label: 'مذيع رسمي 👔' },
                          { id: 'female', label: 'مذيعة استوديو 👩‍💼' },
                        ] as { id: PresenterGender; label: string }[]
                      ).map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => patch({ presenterGender: g.id })}
                          className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer ${
                            (template.presenterGender || 'male') === g.id
                              ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                              : 'bg-[var(--card)] border-[var(--pline)] text-[var(--ptxt)]'
                          }`}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>

                    {/* Skin Tone & Beard */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-[var(--pmuted)]">لون البشرة</span>
                        <div className="flex items-center gap-1.5">
                          {(
                            [
                              { id: 'fair', hex: '#f6ccb2', title: 'فاتح' },
                              { id: 'warmWheat', hex: '#eab58c', title: 'قمحي' },
                              { id: 'olive', hex: '#dca576', title: 'حنطي' },
                              { id: 'tan', hex: '#c6875a', title: 'أسمر' },
                              { id: 'deep', hex: '#875032', title: 'داكن' },
                            ] as { id: PresenterSkinTone; hex: string; title: string }[]
                          ).map((sk) => (
                            <button
                              key={sk.id}
                              type="button"
                              title={sk.title}
                              onClick={() => patch({ presenterSkinTone: sk.id })}
                              className={`w-6 h-6 rounded-full border-2 cursor-pointer transition-transform ${
                                (template.presenterSkinTone || 'warmWheat') === sk.id
                                  ? 'border-[#00B050] scale-110'
                                  : 'border-[var(--pline)]'
                              }`}
                              style={{ backgroundColor: sk.hex }}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-[var(--pmuted)]">لون الشعر</span>
                        <div className="flex items-center gap-1.5">
                          {[
                            { hex: '#1c1816', title: 'أسود' },
                            { hex: '#3b2416', title: 'بني داكن' },
                            { hex: '#6e4226', title: 'كستنائي' },
                            { hex: '#8f6938', title: 'أشقر داكن' },
                            { hex: '#5b616e', title: 'رمادي وقور' },
                          ].map((hc) => (
                            <button
                              key={hc.hex}
                              type="button"
                              title={hc.title}
                              onClick={() => patch({ presenterHairColor: hc.hex })}
                              className={`w-6 h-6 rounded-full border-2 cursor-pointer transition-transform ${
                                (template.presenterHairColor || '#1c1816') === hc.hex
                                  ? 'border-[#00B050] scale-110'
                                  : 'border-[var(--pline)]'
                              }`}
                              style={{ backgroundColor: hc.hex }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Suit & Tie Colors */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-[var(--pmuted)]">لون البدلة</span>
                        <div className="flex items-center gap-1.5">
                          {[
                            { hex: '#14284b', title: 'كحلي ملكي' },
                            { hex: '#18181b', title: 'أسود رسمي' },
                            { hex: '#334155', title: 'رمادي استوديو' },
                            { hex: '#4c1125', title: 'عنابي' },
                            { hex: '#0d3b2e', title: 'زمردي' },
                          ].map((sc) => (
                            <button
                              key={sc.hex}
                              type="button"
                              title={sc.title}
                              onClick={() => patch({ presenterSuitColor: sc.hex })}
                              className={`w-6 h-6 rounded-full border-2 cursor-pointer transition-transform ${
                                (template.presenterSuitColor || '#14284b') === sc.hex
                                  ? 'border-[#00B050] scale-110'
                                  : 'border-[var(--pline)]'
                              }`}
                              style={{ backgroundColor: sc.hex }}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-[var(--pmuted)]">
                          {template.presenterGender === 'female' ? 'لون العقد واللمسة' : 'لون ربطة العنق'}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {[
                            { hex: '#d4a73a', title: 'ذهبي' },
                            { hex: '#b91c1c', title: 'أحمر' },
                            { hex: '#0284c7', title: 'أزرق سماوي' },
                            { hex: '#059669', title: 'زمردي' },
                            { hex: '#94a3b8', title: 'فضي' },
                          ].map((tc) => (
                            <button
                              key={tc.hex}
                              type="button"
                              title={tc.title}
                              onClick={() => patch({ presenterTieColor: tc.hex })}
                              className={`w-6 h-6 rounded-full border-2 cursor-pointer transition-transform ${
                                (template.presenterTieColor || '#d4a73a') === tc.hex
                                  ? 'border-[#00B050] scale-110'
                                  : 'border-[var(--pline)]'
                              }`}
                              style={{ backgroundColor: tc.hex }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Eye color, Beard & Glasses */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-[var(--pmuted)]">العيون:</span>
                        {[
                          { hex: '#4b2f1c', title: 'بني عسلي' },
                          { hex: '#18181b', title: 'أسود' },
                          { hex: '#2f5e3b', title: 'أخضر' },
                          { hex: '#1d4ed8', title: 'أزرق' },
                        ].map((ec) => (
                          <button
                            key={ec.hex}
                            type="button"
                            title={ec.title}
                            onClick={() => patch({ presenterEyeColor: ec.hex })}
                            className={`w-5 h-5 rounded-full border-2 cursor-pointer ${
                              (template.presenterEyeColor || '#4b2f1c') === ec.hex
                                ? 'border-[#00B050] scale-110'
                                : 'border-[var(--pline)]'
                            }`}
                            style={{ backgroundColor: ec.hex }}
                          />
                        ))}
                      </div>

                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--ptxt)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(template.presenterGlasses)}
                          onChange={(e) => patch({ presenterGlasses: e.target.checked })}
                          className="w-3.5 h-3.5 accent-[#00B050] rounded cursor-pointer"
                        />
                        <span>نظارة طبية 👓</span>
                      </label>
                    </div>

                    {(template.presenterGender || 'male') === 'male' && (
                      <div className="grid grid-cols-3 gap-1.5">
                        {(
                          [
                            { id: 'none', label: 'بدون لحية' },
                            { id: 'stubble', label: 'لحية خفيفة' },
                            { id: 'trimmed', label: 'لحية مهندمة' },
                          ] as { id: PresenterBeardStyle; label: string }[]
                        ).map((bd) => (
                          <button
                            key={bd.id}
                            type="button"
                            onClick={() => patch({ presenterBeard: bd.id })}
                            className={`px-2 py-1 rounded-lg border text-[10px] font-bold cursor-pointer ${
                              (template.presenterBeard || 'trimmed') === bd.id
                                ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                                : 'bg-[var(--card)] border-[var(--pline)] text-[var(--ptxt)]'
                            }`}
                          >
                            {bd.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Natural Mouth Movement, Audio-Only Lip Sync & Expressiveness */}
                <div className="flex flex-col gap-2.5 p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-extrabold text-[var(--ptxt)]">
                      التحكم بالنطق وتزامن الشفاه والحيوية
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          presenterLipSyncMode: 'audioAndReading',
                          presenterContinuousTalk: true,
                          presenterTalkIntensity: 70,
                          presenterExpressiveness: 100,
                          presenterMouthY: 31.2,
                        })
                      }
                      className="text-[10px] font-bold text-[#00B050] hover:underline cursor-pointer"
                    >
                      استعادة الافتراضي
                    </button>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-[var(--pmuted)]">
                      نظام تحريك الشفاه (Lip-Sync):
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          { id: 'audioOnly', label: 'مع الصوت الحقيقي فقط 🎙️' },
                          { id: 'audioAndReading', label: 'مع الصوت + تلقائي عند القراءة' },
                        ] as { id: PresenterLipSyncMode; label: string }[]
                      ).map((lm) => {
                        const activeMode: PresenterLipSyncMode =
                          template.presenterLipSyncMode ??
                          (template.presenterContinuousTalk === false
                            ? 'audioOnly'
                            : 'audioAndReading');
                        return (
                          <button
                            key={lm.id}
                            type="button"
                            onClick={() =>
                              patch({
                                presenterLipSyncMode: lm.id,
                                presenterContinuousTalk: lm.id === 'audioAndReading',
                              })
                            }
                            className={`px-2 py-1.5 rounded-lg border text-[10px] font-bold cursor-pointer ${
                              activeMode === lm.id
                                ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                                : 'bg-[var(--card)] border-[var(--pline)] text-[var(--ptxt)]'
                            }`}
                          >
                            {lm.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="flex flex-col gap-1">
                    <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                      <span>حجم فتحة الفم والشفاه أثناء الكلام</span>
                      <span className="font-mono-nums">
                        {Math.round(template.presenterTalkIntensity ?? 70)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={template.presenterTalkIntensity ?? 70}
                      onChange={(e) =>
                        patch({ presenterTalkIntensity: parseFloat(e.target.value) }, false)
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-1">
                    <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                      <span>حيوية وتفاعل الرأس والحواجب</span>
                      <span className="font-mono-nums">
                        {Math.round(template.presenterExpressiveness ?? 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={150}
                      step={5}
                      value={template.presenterExpressiveness ?? 100}
                      onChange={(e) =>
                        patch({ presenterExpressiveness: parseFloat(e.target.value) }, false)
                      }
                    />
                  </label>

                  {(template.presenterStyle === 'photoMale' ||
                    template.presenterStyle === 'photoFemale' ||
                    template.presenterStyle === 'customPhoto') && (
                    <label className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
                        <span>ضبط ارتفاع الفم أسفل الأنف (للصور المخصصة)</span>
                        <span className="font-mono-nums">
                          {(template.presenterMouthY ?? 31.2).toFixed(1)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={22}
                        max={46}
                        step={0.2}
                        value={template.presenterMouthY ?? 31.2}
                        onChange={(e) =>
                          patch({ presenterMouthY: parseFloat(e.target.value) }, false)
                        }
                      />
                    </label>
                  )}
                </div>

                {/* 10 Interactive Gestures Live Showcase & Stage Director */}
                <div className="flex flex-col gap-2.5 p-2.5 rounded-xl bg-[var(--surface)] border border-[#00B050]/40">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[11px] font-extrabold text-[var(--ptxt)]">
                        الحركات الـ ١٠ التفاعلية للمذيع (اضغط للمعاينة المباشرة) 🎭
                      </span>
                      <div className="text-[10px] text-[var(--pmuted)]">
                        جرّب أي حركة الآن لتظهر مباشرة مع حركة اليدين والشفاه على الشاشة
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        patch({
                          presenterEnabled: true,
                          presenterStyle: 'stylized3d',
                          presenterLipSyncMode: 'audioAndReading',
                          presenterContinuousTalk: true,
                          presenterTalkIntensity: Math.max(75, template.presenterTalkIntensity ?? 75),
                          presenterExpressiveness: Math.max(110, template.presenterExpressiveness ?? 110),
                          presenterCommands: {
                            intro: 'auto',
                            readingQuestion: 'auto',
                            readingOptions: 'auto',
                            thinking: 'auto',
                            suspense: 'auto',
                            reveal: 'auto',
                            outro: 'auto',
                          },
                          ...(template.aiPresenter?.enabled
                            ? { aiPresenter: { ...template.aiPresenter, enabled: false } }
                            : {}),
                        });
                        triggerPresenterDemo('explain');
                      }}
                      className="shrink-0 px-2.5 py-1.5 rounded-lg bg-[#00B050]/18 border border-[#00B050] text-[10px] font-extrabold text-[#00B050] dark:text-[#6ee7b7] cursor-pointer hover:bg-[#00B050]/25"
                    >
                      تفعيل التسلسل التلقائي الذكي ⚡
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    {PRESENTER_GESTURE_OPTIONS.map((g, idx) => {
                      const isDemo = activeDemoPose === g.id;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => {
                            patch({
                              presenterEnabled: true,
                              presenterStyle: 'stylized3d',
                              presenterLipSyncMode: 'audioAndReading',
                              presenterContinuousTalk: true,
                              ...(template.aiPresenter?.enabled
                                ? { aiPresenter: { ...template.aiPresenter, enabled: false } }
                                : {}),
                            });
                            triggerPresenterDemo(g.id);
                          }}
                          className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border text-right text-[10px] font-bold transition-colors cursor-pointer ${
                            isDemo
                              ? 'bg-[#00B050]/22 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                              : 'bg-[var(--card)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[#00B050]/65'
                          }`}
                        >
                          <span className="truncate">
                            {idx + 1}. {g.shortLabel}
                          </span>
                          <Play className="w-3 h-3 shrink-0 opacity-75" />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Stage Director: Per-phase Gesture Commands */}
                <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-extrabold text-[var(--ptxt)]">
                      توزيع الحركات حسب مراحل الفيديو (Action Director)
                    </span>
                    <button
                      type="button"
                      onClick={() => patch({ presenterCommands: undefined })}
                      className="text-[10px] font-bold text-[#00B050] hover:underline cursor-pointer"
                    >
                      تلقائي ذكي للكل
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { key: 'intro', label: 'المقدمة (Hook)' },
                        { key: 'readingQuestion', label: 'قراءة السؤال' },
                        { key: 'readingOptions', label: 'عرض الخيارات' },
                        { key: 'thinking', label: 'أثناء التفكير' },
                        { key: 'suspense', label: 'لحظة الحسم' },
                        { key: 'reveal', label: 'كشف الجواب' },
                        { key: 'outro', label: 'خاتمة الاشتراك' },
                      ] as { key: keyof PresenterPhaseCommands; label: string }[]
                    ).map((phaseItem) => {
                      const val: PresenterGestureCommand =
                        template.presenterCommands?.[phaseItem.key] ?? 'auto';
                      return (
                        <label
                          key={phaseItem.key}
                          className={`flex flex-col gap-1 ${
                            phaseItem.key === 'outro' ? 'col-span-2' : ''
                          }`}
                        >
                          <span className="text-[10px] font-bold text-[var(--pmuted)]">
                            {phaseItem.label}
                          </span>
                          <select
                            value={val}
                            onChange={(e) => {
                              const nextCmd = e.target.value as PresenterGestureCommand;
                              patch({
                                presenterCommands: {
                                  ...(template.presenterCommands ?? {}),
                                  [phaseItem.key]: nextCmd,
                                },
                              });
                              if (nextCmd !== 'auto') {
                                triggerPresenterDemo(nextCmd);
                              }
                            }}
                            className="w-full px-2 py-1.5 rounded-lg bg-[var(--card)] border border-[var(--pline)] text-[11px] text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none cursor-pointer"
                          >
                            <option value="auto">تلقائي ذكي (يتبدل مع الحدث)</option>
                            {PRESENTER_GESTURE_OPTIONS.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
