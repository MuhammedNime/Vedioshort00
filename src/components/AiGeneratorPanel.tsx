import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Brain,
  Calculator,
  CheckCircle2,
  Circle,
  Cloud,
  Download,
  ExternalLink,
  FolderTree,
  Loader2,
  LogOut,
  Maximize2,
  MessageSquareText,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Shuffle,
  Sparkles,
  Square,
  Trash2,
  Video,
  Volume2,
} from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import {
  AI_VOICE_OPTIONS,
  AiVoiceMode,
  AiVoiceName,
  adviseQuestionBankPlan,
  generateAiQuizSlides,
  generateSlideVoiceoverSafe,
} from '../services/aiClient';
import {
  CloudSyncMeta,
  deleteCloudBankQuestion,
  getCloudSyncMeta,
  pushBankQuestionsToCloud,
  signInWithGoogleForSync,
  signOutFirebaseUser,
  subscribeFirebaseUser,
  syncQuestionBankWithCloud,
  updateCloudBankQuestionUsed,
} from '../services/firebaseClient';
import {
  getWebLoginBaseUrl,
  launchWebLinkLoginForApk,
} from '../services/youtubeClient';
import {
  BankFolder,
  BankQuestionItem,
  BankStatsSummary,
  addQuestionsToBank,
  bankItemToQuestionSlide,
  buildFolderBreadcrumb,
  clearBankQuestions,
  deleteBankQuestion,
  getAllBankFolders,
  getAllBankQuestions,
  getBankQuestions,
  getBankStats,
  markBankQuestionsUsed,
  seedAllStarterBanksIfNeeded,
} from '../storage/questionBankVault';
import { QUIZ_CATEGORIES, QuestionSlide, QuizCategory } from '../types/quiz';
import { isAndroidNativeApp, saveOrDownloadBlob } from '../utils/nativeDownload';
import { TtsQuotaBanner } from './TtsQuotaBanner';

interface AiGeneratorPanelProps {
  voiceName: AiVoiceName;
  existingQuestions?: string[];
  vaultRefreshTrigger?: number;
  aiPresenterConfigured?: boolean;
  hasAiPresenter?: boolean;
  onOpenAiPresenterStudio?: () => void;
  onOpenLargeVault?: () => void;
  onVoiceChange: (voice: AiVoiceName) => void;
  onInsertSlides: (
    slides: QuestionSlide[],
    mode: 'append' | 'replace',
    enableAutoSync: boolean,
    warningMessage?: string,
    themePreset?: boolean | 'math' | 'islamic'
  ) => void;
}

type AiPanelSubTab = 'direct' | 'bank';
type ConsultMsg = { id: string; role: 'user' | 'assistant'; text: string };

const CATEGORY_SUGGESTIONS: Record<QuizCategory, string[]> = {
  general: [
    'معلومات عامة وحقائق مذهلة غير متوقعة',
    'تحدي سرعة البديهة والألغاز الذكية',
    'أوائل واختراعات غيّرت حياة البشر',
    'مقارنات غريبة في الطبيعة والعالم',
  ],
  discussion: [
    'أسئلة للنقاش ومواقف حياتية للتعليقات',
    'لو خُيّرت: اختيارات محيّرة بين قيمتين',
    'موقف في الصداقة والعمل: ماذا تختار ولماذا؟',
    'نقاش حول التقنية والهواتف وتأثيرها اليومي',
  ],
  sports: [
    'أرقام قياسية في كأس العالم ودوري الأبطال',
    'نجوم وأساطير كرة القدم عبر التاريخ',
    'معلومات خفية عن المنتخبات والأندية العربية',
    'قوانين ومواقف تحكيمية مثيرة للجدل',
  ],
  geography: [
    'عواصم ودول عربية وعالمية صعبة',
    'أطول الأنهار وأعمق البحار والمضائق',
    'معالم عالمية ودول غريبة على الخريطة',
    'أعلام وعملات ومواقع جغرافية مدهشة',
  ],
  science: [
    'الفضاء والكواكب والثقوب السوداء',
    'أسرار جسم الإنسان والدماغ المدهشة',
    'حقائق فيزيائية وكيميائية تصعب تصديقها',
    'غرائب عالم الحيوان والكائنات البحرية',
  ],
  history: [
    'أسرار الحضارات القديمة (الفراعنة وبابل)',
    'شخصيات وقادة غيروا مجرى التاريخ',
    'معلومات نادرة من التاريخ الإسلامي والعربي',
    'اكتشافات وأحداث تاريخية شهيرة',
  ],
  islamic: [
    'أسئلة في السيرة النبوية والغزوات',
    'قصص الأنبياء وسور القرآن الكريم',
    'مواقف الصحابة والتابعين المضيئة',
    'معلومات دينية وثقافة إسلامية ميسّرة',
  ],
  technology: [
    'أسرار الذكاء الاصطناعي وتطور التكنولوجيا',
    'قصص تأسيس أشهر الشركات والتطبيقات',
    'حقائق مدهشة عن الإنترنت والأمن السيبراني',
    'مخترعو التقنية الحديثة وأجهزتنا اليومية',
  ],
  literature: [
    'أمثال وحكم عربية أصيلة ومعانيها',
    'معاني مفردات عربية نادرة وفصيحة',
    'أشهر شعراء العرب وقصائدهم الخالدة',
    'أسئلة ذكية في البلاغة والنحو السهل',
  ],
  math: [
    'كسور وجذور تربيعية سهلة وممتعة',
    'معادلات جبرية سريعة (قيمة س)',
    'قوى وأسس وحساب ذهني سريع',
    'مساحة ومحيط الأشكال الهندسية',
  ],
};

const MATH_SUGGESTIONS = CATEGORY_SUGGESTIONS.math;

const TRUE_FALSE_SUGGESTIONS = [
  'حقائق علمية مدهشة (صح أم خطأ)',
  'معلومات تاريخية وإسلامية',
  'معلومات غريبة عن جسم الإنسان',
  'عجائب الفضاء والطبيعة',
];

const CLUES_SUGGESTIONS = [
  'دول وعواصم عربية وعالمية',
  'شخصيات وعلماء عبر التاريخ',
  'حيوانات ومخلوقات مدهشة',
  'اختراعات وأشياء يومية شهيرة',
];

const VERSUS_SUGGESTIONS = [
  'أيهما تفضل للنقاش (لو خيّروك بين خيارين)',
  'أيهما أكبر أو أسرع أو أقدم في الطبيعة',
  'مقارنات علمية وفيزيائية مذهلة',
  'دول ومدن ومباني تاريخية شهيرة',
];

const RANDOM_DISCUSSION_AND_QUIZ_IDEAS = [
  'سؤال للنقاش عن الصداقة والثقة والمواقف اليومية',
  'سؤال للنقاش: لو خيّروك في قرار مصيري بالعمل أو المال',
  'سؤال للنقاش عن التقنية والهواتف الذكية وتأثيرها علينا',
  'تحدي عواصم وأنهار جغرافية غير معروفة للجميع',
  'حقائق مذهلة عن الفضاء والكواكب والثقوب السوداء',
  'أرقام قياسية ومفاجآت من تاريخ كأس العالم',
  'سيرة نبوية وقصص الصحابة بأسلوب مشوق',
  'أسئلة ذكاء ومعاني كلمات عربية أصيلة',
];

export const AiGeneratorPanel: React.FC<AiGeneratorPanelProps> = ({
  voiceName,
  existingQuestions = [],
  vaultRefreshTrigger = 0,
  aiPresenterConfigured = false,
  hasAiPresenter = false,
  onOpenAiPresenterStudio,
  onOpenLargeVault,
  onVoiceChange,
  onInsertSlides,
}) => {
  const [subTab, setSubTab] = useState<AiPanelSubTab>('direct');
  const [selectedCategory, setSelectedCategory] = useState<QuizCategory>('general');
  const [contentType, setContentType] = useState<
    'general' | 'math' | 'multiple3' | 'trueFalse' | 'clues' | 'versus'
  >('general');
  const [autoApplyMathTheme, setAutoApplyMathTheme] = useState(true);
  const [autoApplyIslamicTheme, setAutoApplyIslamicTheme] = useState(true);
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(2);
  const [difficulty, setDifficulty] = useState('متوسط');
  const [withVoice, setWithVoice] = useState(true);
  const [voiceMode, setVoiceMode] = useState<AiVoiceMode>('full');
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Bank Vault & Consultation State
  const [bankFolders, setBankFolders] = useState<BankFolder[]>([]);
  const [targetFolderId, setTargetFolderId] = useState<string>('');
  const [bankStats, setBankStats] = useState<BankStatsSummary | null>(null);
  const [bankItems, setBankItems] = useState<BankQuestionItem[]>([]);
  const [bankFilterCat, setBankFilterCat] = useState<QuizCategory | 'all'>('all');
  const [bankFilterStatus, setBankFilterStatus] = useState<'all' | 'unused' | 'used'>('all');
  const [bankSearch, setBankSearch] = useState('');
  const [bankDisplayLimit, setBankDisplayLimit] = useState(30);

  // Consultation Chat & Batch Generation State
  const [batchTargetCount, setBatchTargetCount] = useState<number>(100);
  const [consultInput, setConsultInput] = useState('');
  const [consultMessages, setConsultMessages] = useState<ConsultMsg[]>([]);
  const [plannedSubtopics, setPlannedSubtopics] = useState<string[]>([]);
  const [newSubtopicInput, setNewSubtopicInput] = useState('');
  const [isConsulting, setIsConsulting] = useState(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    saved: number;
    target: number;
    skippedDupes: number;
    currentLabel: string;
  } | null>(null);
  const [bankActionId, setBankActionId] = useState<string | null>(null);
  const [bankNotice, setBankNotice] = useState('');
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [cloudSyncMeta, setCloudSyncMeta] = useState<CloudSyncMeta | null>(() => getCloudSyncMeta());
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const lastSyncedUidRef = useRef<string | null>(null);
  const batchAbortRef = useRef(false);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const selectedCategoryMeta = useMemo(
    () => QUIZ_CATEGORIES.find((c) => c.id === selectedCategory) ?? QUIZ_CATEGORIES[0],
    [selectedCategory]
  );

  const refreshBank = useCallback(async () => {
    try {
      await seedAllStarterBanksIfNeeded(false);
    } catch {
      // continue reading existing bank items
    }
    const [stats, items, folders] = await Promise.all([
      getBankStats(),
      getBankQuestions({
        category: bankFilterCat,
        status: bankFilterStatus,
        search: bankSearch,
      }),
      getAllBankFolders(),
    ]);
    setBankStats(stats);
    setBankItems(items);
    setBankFolders(folders);
  }, [bankFilterCat, bankFilterStatus, bankSearch]);

  useEffect(() => {
    void refreshBank();
  }, [refreshBank, vaultRefreshTrigger]);

  useEffect(() => {
    return subscribeFirebaseUser((user) => {
      setCloudUser(user);
      if (user && lastSyncedUidRef.current !== user.uid) {
        lastSyncedUidRef.current = user.uid;
        void syncQuestionBankWithCloud({ includeStarterBank: false })
          .then(() => {
            setCloudSyncMeta(getCloudSyncMeta());
            return refreshBank();
          })
          .catch(() => {});
      } else if (!user) {
        lastSyncedUidRef.current = null;
      }
    });
  }, [refreshBank]);

  const handleCloudSyncNow = async (includeStarterBank = false) => {
    if (isCloudSyncing) return;
    setIsCloudSyncing(true);
    setBankNotice('');
    try {
      const targetUser = cloudUser ?? (await signInWithGoogleForSync());
      if (!targetUser) return;
      const syncRes = await syncQuestionBankWithCloud({ includeStarterBank });
      setCloudSyncMeta(getCloudSyncMeta());
      await refreshBank();
      setBankNotice(
        `تمت المزامنة مع Firebase (${targetUser.email || 'حسابك'}): استُرجع ${syncRes.pulled} سؤالاً ورُفع ${syncRes.pushed} سؤالاً${
          syncRes.skippedStarterCount > 0
            ? ` (تم توفير حصة السحابة بتخطي ${syncRes.skippedStarterCount} سؤالاً مدمجاً غير معدّل)`
            : ''
        }.`
      );
    } catch (err) {
      setBankNotice(
        err instanceof Error ? err.message : 'تعذر إتمام المزامنة مع السحابة.'
      );
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const handleSelectCategory = (catId: QuizCategory) => {
    setSelectedCategory(catId);
    if (catId === 'math') {
      setContentType('math');
    } else if (contentType === 'math') {
      setContentType('general');
    }
    if (subTab === 'bank') {
      setBankFilterCat(catId);
      setBankDisplayLimit(30);
    }
  };

  const suggestions =
    contentType === 'math'
      ? MATH_SUGGESTIONS
      : contentType === 'trueFalse'
        ? TRUE_FALSE_SUGGESTIONS
        : contentType === 'clues'
          ? CLUES_SUGGESTIONS
          : contentType === 'versus'
            ? VERSUS_SUGGESTIONS
            : CATEGORY_SUGGESTIONS[selectedCategory] ?? CATEGORY_SUGGESTIONS.general;

  const handleGenerate = async (insertMode: 'append' | 'replace') => {
    const trimmed = topic.trim() || selectedCategoryMeta.promptHint;

    try {
      soundEngine.getContext();
    } catch {
      // ignore
    }

    setErrorMsg('');
    setIsGenerating(true);
    setStatusText(`جارٍ تأليف ${count} أسئلة (${selectedCategoryMeta.label}) بالذكاء الاصطناعي...`);

    try {
      const slides = await generateAiQuizSlides(
        trimmed,
        count,
        difficulty,
        contentType,
        existingQuestions,
        selectedCategory
      );

      // Persist immediately in Question Bank Vault marked as used (since inserted into video)
      const folderPath = targetFolderId ? buildFolderBreadcrumb(targetFolderId, bankFolders) : undefined;
      const directSaved = await addQuestionsToBank(
        slides,
        selectedCategory,
        trimmed.slice(0, 48),
        true,
        targetFolderId || undefined,
        folderPath
      );
      if (cloudUser && directSaved.addedItems.length > 0) {
        void pushBankQuestionsToCloud(directSaved.addedItems).catch(() => {});
      }
      void refreshBank();

      const shouldApplyMath = (contentType === 'math' || selectedCategory === 'math') && autoApplyMathTheme;
      const shouldApplyIslamic = selectedCategory === 'islamic' && autoApplyIslamicTheme;
      const themePreset: 'math' | 'islamic' | false = shouldApplyMath
        ? 'math'
        : shouldApplyIslamic
          ? 'islamic'
          : false;

      if (withVoice) {
        const resultSlides: QuestionSlide[] = [];
        let quotaWarning: string | undefined;

        for (let i = 0; i < slides.length; i++) {
          if (quotaWarning) {
            resultSlides.push(slides[i]);
            continue;
          }

          const res = await generateSlideVoiceoverSafe(
            slides[i],
            voiceName,
            voiceMode,
            (stepLabel) =>
              setStatusText(`السؤال ${i + 1} من ${slides.length}: ${stepLabel}`)
          );
          resultSlides.push(res.slide);

          if (res.warning) {
            quotaWarning = res.warning;
          }
        }

        onInsertSlides(resultSlides, insertMode, true, quotaWarning, themePreset);
      } else {
        onInsertSlides(slides, insertMode, false, undefined, themePreset);
      }

      setStatusText('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'حدث خطأ أثناء التوليد، حاول مجدداً.'
      );
      setStatusText('');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleConsultAi = async (customMessage?: string) => {
    if (isConsulting || isBatchGenerating) return;
    const msg =
      (customMessage ?? consultInput).trim() ||
      `أريد تجهيز ${batchTargetCount} سؤال متنوع في مجال ${selectedCategoryMeta.label} بدون تكرار.`;

    setConsultInput('');
    setBankNotice('');
    setIsConsulting(true);
    setConsultMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', text: msg },
    ]);

    try {
      const res = await adviseQuestionBankPlan({
        category: selectedCategory,
        targetCount: batchTargetCount,
        userMessage: msg,
        existingSubtopics: plannedSubtopics,
      });
      setPlannedSubtopics(res.subtopics);
      setConsultMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', text: res.reply },
      ]);
    } finally {
      setIsConsulting(false);
    }
  };

  const handleStartBatchGeneration = async () => {
    if (isBatchGenerating) return;

    let activeSubtopics = [...plannedSubtopics];
    if (activeSubtopics.length === 0) {
      const plan = await adviseQuestionBankPlan({
        category: selectedCategory,
        targetCount: batchTargetCount,
        userMessage: consultInput.trim() || `تجهيز ${batchTargetCount} سؤال في ${selectedCategoryMeta.label}`,
      });
      activeSubtopics = plan.subtopics;
      setPlannedSubtopics(plan.subtopics);
      setConsultMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', text: plan.reply },
      ]);
    }

    batchAbortRef.current = false;
    setIsBatchGenerating(true);
    setBankNotice('');

    const target = batchTargetCount;
    let savedTotal = 0;
    let skippedTotal = 0;
    let consecutiveFailures = 0;
    let round = 0;
    const batchSize = 10;

    setBatchProgress({
      saved: 0,
      target,
      skippedDupes: 0,
      currentLabel: 'جارٍ بدء التوليد وتجهيز الذاكرة...',
    });

    try {
      const maxRounds = Math.ceil(target / batchSize) + 8;
      while (!batchAbortRef.current && savedTotal < target && round < maxRounds) {
        const subtopic = activeSubtopics[round % activeSubtopics.length] || selectedCategoryMeta.label;
        const neededNow = Math.min(batchSize, target - savedTotal);
        const promptForBatch = `${selectedCategoryMeta.label} — محور: ${subtopic} (دفعة رقم ${round + 1})`;

        setBatchProgress({
          saved: savedTotal,
          target,
          skippedDupes: skippedTotal,
          currentLabel: `توليد دفعة (${round + 1}): ${subtopic}...`,
        });

        try {
          const generatedSlides = await generateAiQuizSlides(
            promptForBatch,
            neededNow,
            difficulty,
            contentType,
            existingQuestions,
            selectedCategory
          );
          consecutiveFailures = 0;

          const folderPath = targetFolderId ? buildFolderBreadcrumb(targetFolderId, bankFolders) : undefined;
          const storeRes = await addQuestionsToBank(
            generatedSlides,
            selectedCategory,
            subtopic,
            false,
            targetFolderId || undefined,
            folderPath
          );
          if (cloudUser && storeRes.addedItems.length > 0) {
            void pushBankQuestionsToCloud(storeRes.addedItems).catch(() => {});
          }
          savedTotal += storeRes.addedItems.length;
          skippedTotal += storeRes.skippedDuplicates;

          setBatchProgress({
            saved: savedTotal,
            target,
            skippedDupes: skippedTotal,
            currentLabel: `تم حفظ ${savedTotal} / ${target} سؤال جديد في الذاكرة`,
          });
          await refreshBank();
        } catch (err) {
          consecutiveFailures += 1;
          const msg = err instanceof Error ? err.message : 'تعذر توليد الدفعة';
          if (consecutiveFailures >= 3) {
            setBankNotice(`توقف التوليد مؤقتاً بعد حفظ ${savedTotal} سؤالاً: ${msg}`);
            break;
          }
          setBatchProgress({
            saved: savedTotal,
            target,
            skippedDupes: skippedTotal,
            currentLabel: `انتظار قصير لتخفيف الضغط ثم استكمال الدفعات...`,
          });
          await new Promise((r) => setTimeout(r, 2200));
        }

        round += 1;
        if (!batchAbortRef.current && savedTotal < target) {
          await new Promise((r) => setTimeout(r, 350));
        }
      }

      if (batchAbortRef.current) {
        setBankNotice(`تم إيقاف التوليد وحفظ ${savedTotal} سؤالاً جديداً في الذاكرة بنجاح.`);
      } else if (savedTotal > 0) {
        setBankNotice(
          `اكتمل الحفظ! أضيف ${savedTotal} سؤالاً جديداً في «${selectedCategoryMeta.label}» (تجاوز ${skippedTotal} مكرراً).`
        );
      }
    } finally {
      setIsBatchGenerating(false);
      setBatchProgress(null);
      await refreshBank();
    }
  };

  const handleUseBankQuestion = async (item: BankQuestionItem, insertMode: 'append' | 'replace' = 'append') => {
    if (bankActionId) return;
    setBankActionId(item.id);
    setBankNotice('');
    try {
      try {
        soundEngine.getContext();
      } catch {
        // ignore
      }

      let slide = bankItemToQuestionSlide(item);
      let warningMsg: string | undefined;

      if (withVoice) {
        const res = await generateSlideVoiceoverSafe(slide, voiceName, voiceMode);
        slide = res.slide;
        warningMsg = res.warning;
      }

      await markBankQuestionsUsed([item.id], true);
      if (cloudUser) {
        void updateCloudBankQuestionUsed(item.id, true, item).catch(() => {});
      }
      await refreshBank();

      const shouldApplyMath = item.category === 'math' && autoApplyMathTheme;
      const shouldApplyIslamic = item.category === 'islamic' && autoApplyIslamicTheme;
      const themePreset: 'math' | 'islamic' | false = shouldApplyMath
        ? 'math'
        : shouldApplyIslamic
          ? 'islamic'
          : false;
      onInsertSlides([slide], insertMode, withVoice, warningMsg, themePreset);
    } finally {
      setBankActionId(null);
    }
  };

  const handlePickRandomUnused = async () => {
    const pool = bankItems.filter((item) => !item.usedInVideo);
    if (pool.length === 0) {
      setBankNotice('لا توجد أسئلة غير مستخدمة ضمن الفلتر الحالي. ولّد دفعة جديدة أو بدّل الفلتر.');
      return;
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    await handleUseBankQuestion(picked, 'append');
  };

  const handleExportBankJson = async () => {
    const all = await getAllBankQuestions();
    if (all.length === 0) {
      setBankNotice('الذاكرة فارغة حالياً.');
      return;
    }
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    await saveOrDownloadBlob(
      blob,
      `question-bank-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json'
    );
    setBankNotice(`تم تصدير نسخة احتياطية تحتوي ${all.length} سؤالاً.`);
  };

  const fullVoiceCountLabel =
    contentType === 'trueFalse'
      ? '+خيارين (4)'
      : contentType === 'versus'
        ? '+الطرفين (4)'
        : contentType === 'clues'
          ? '+3 تلميحات (5)'
          : contentType === 'multiple3'
            ? '+3 خيارات (5)'
            : '+4 خيارات (6)';

  const visibleBankItems = bankItems.slice(0, bankDisplayLimit);

  return (
    <div className="flex flex-col gap-3.5 pb-6">
      {/* Header + Sub-Tab Switcher */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-bold text-[var(--ptxt)]">
              الذكاء الاصطناعي وبنك الأسئلة
            </h2>
            <p className="text-[11px] text-[var(--pmuted)]">
              ذاكرة تمنع التكرار وتصل إلى +2000 سؤال مصنف مع تتبع ✅
            </p>
          </div>
          {bankStats && (
            <span className="px-2 py-1 rounded-lg bg-[#00B050]/12 border border-[#00B050]/35 text-[10px] font-bold text-[#00B050] dark:text-[#6ee7b7] whitespace-nowrap">
              الذاكرة: {bankStats.total}
            </span>
          )}
        </div>

        {onOpenAiPresenterStudio && (
          <button
            type="button"
            onClick={onOpenAiPresenterStudio}
            className="flex items-center justify-between gap-2 w-full px-3 py-2.5 rounded-xl bg-gradient-to-l from-[#00B050]/18 via-[var(--surface)] to-[#d4a73a]/12 hover:border-[#00B050] border border-[#00B050]/50 text-xs font-extrabold text-[var(--ptxt)] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2 min-w-0">
              <Video className="w-4 h-4 text-[#00B050] shrink-0" />
              <span className="truncate">استوديو الراوي الذكي البشري (Tavus AI Presenter)</span>
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                hasAiPresenter
                  ? 'bg-[#00B050] text-white'
                  : aiPresenterConfigured
                    ? 'bg-[#00B050]/18 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/40'
                    : 'bg-[var(--panel)] text-[var(--pmuted)] border border-[var(--pline)]'
              }`}
            >
              {hasAiPresenter ? 'مُدرج ✓' : aiPresenterConfigured ? 'متصل ✓ · افتح' : 'فتح'}
            </span>
          </button>
        )}

        {onOpenLargeVault && (
          <button
            type="button"
            onClick={onOpenLargeVault}
            className="flex items-center justify-between gap-2 w-full px-3 py-2.5 rounded-xl bg-[#00B050]/12 hover:bg-[#00B050]/20 border border-[#00B050]/45 text-xs font-extrabold text-[#00B050] dark:text-[#6ee7b7] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <FolderTree className="w-4 h-4 shrink-0" />
              <span>فتح مكتبة الذاكرة الكبيرة (مجلدات متداخلة وإضافة يدوية)</span>
            </span>
            <Maximize2 className="w-3.5 h-3.5 shrink-0" />
          </button>
        )}

        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
          <button
            type="button"
            disabled={isGenerating || isBatchGenerating}
            onClick={() => setSubTab('direct')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              subTab === 'direct'
                ? 'bg-[#00B050] text-white'
                : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>توليد مباشر</span>
          </button>
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => setSubTab('bank')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              subTab === 'bank'
                ? 'bg-[#00B050] text-white'
                : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
            }`}
          >
            <Brain className="w-3.5 h-3.5 shrink-0" />
            <span>بنك الذاكرة والمستشار</span>
          </button>
        </div>

        {/* Target Folder Picker for Saving Generated Questions */}
        {bankFolders.length > 0 && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
            <span className="text-[11px] font-bold text-[var(--pmuted)] whitespace-nowrap">
              حفظ في مجلد:
            </span>
            <select
              value={targetFolderId}
              disabled={isGenerating || isBatchGenerating}
              onChange={(e) => setTargetFolderId(e.target.value)}
              className="flex-1 min-w-0 bg-[var(--panel)] border border-[var(--pline)] rounded-lg px-2 py-1 text-[11px] text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            >
              <option value="">بدون مجلد محدد</option>
              {bankFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.emoji || '📁'} {buildFolderBreadcrumb(f.id, bankFolders) || f.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Category Selector (Shared across both Direct & Memory Bank) */}
      <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-bold text-[var(--ptxt)]">المجال / التصنيف المطلوب:</span>
          <span className="text-[#00B050] dark:text-[#6ee7b7] font-bold">
            {selectedCategoryMeta.emoji} {selectedCategoryMeta.label}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1">
          {QUIZ_CATEGORIES.map((cat) => {
            const active = selectedCategory === cat.id;
            const catCount = bankStats?.byCategory?.[cat.id]?.total ?? 0;
            return (
              <button
                key={cat.id}
                type="button"
                disabled={isGenerating || isBatchGenerating}
                onClick={() => handleSelectCategory(cat.id)}
                className={`flex items-center justify-between gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                    : 'bg-[var(--panel)] border-[var(--pline)] text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                <span className="truncate">
                  {cat.emoji} {cat.label}
                </span>
                {catCount > 0 && (
                  <span className="font-mono-nums text-[9px] opacity-80 shrink-0">
                    {catCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content Mode Switch */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-1 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
          {(
            [
              { id: 'general', label: 'ثقافة (4 خيارات)', icon: 'sparkles' },
              { id: 'multiple3', label: '3 خيارات 🎯', icon: 'none' },
              { id: 'trueFalse', label: 'صح أم خطأ ✓✗', icon: 'none' },
              { id: 'clues', label: '3 تلميحات 🔍', icon: 'none' },
              { id: 'versus', label: 'مقارنة VS ⚡', icon: 'none' },
              { id: 'math', label: 'رياضيات 🧮', icon: 'calc' },
            ] as const
          ).map((modeBtn) => {
            const active = contentType === modeBtn.id;
            return (
              <button
                key={modeBtn.id}
                type="button"
                disabled={isGenerating || isBatchGenerating}
                onClick={() => {
                  setContentType(modeBtn.id);
                  if (modeBtn.id === 'math') {
                    setSelectedCategory('math');
                  }
                }}
                className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[#00B050] text-white'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)] hover:bg-[var(--panel)]'
                }`}
              >
                {modeBtn.icon === 'sparkles' && <Sparkles className="w-3.5 h-3.5 shrink-0" />}
                {modeBtn.icon === 'calc' && <Calculator className="w-3.5 h-3.5 shrink-0" />}
                <span>{modeBtn.label}</span>
              </button>
            );
          })}
        </div>

        {(contentType === 'math' || selectedCategory === 'math') && (
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#00B050]/10 border border-[#00B050]/35 cursor-pointer">
            <input
              type="checkbox"
              checked={autoApplyMathTheme}
              onChange={(e) => setAutoApplyMathTheme(e.target.checked)}
              className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
            />
            <span className="text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7]">
              تطبيق خلفية سبورة الرياضيات وكشف (3 حمر + أخضر) تلقائياً
            </span>
          </label>
        )}
        {selectedCategory === 'islamic' && contentType !== 'math' && (
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#00B050]/10 border border-[#00B050]/35 cursor-pointer">
            <input
              type="checkbox"
              checked={autoApplyIslamicTheme}
              onChange={(e) => setAutoApplyIslamicTheme(e.target.checked)}
              className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
            />
            <span className="text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7]">
              تطبيق القالب الإسلامي الذهبي تلقائياً لأسئلة الإسلاميات 🌙
            </span>
          </label>
        )}
      </div>

      {/* ================= SUB-TAB 1: DIRECT GENERATION ================= */}
      {subTab === 'direct' && (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold text-[var(--ptxt)]">
                فكرة الفيديو أو الموضوع ({selectedCategoryMeta.label})
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => {
                    const pool = RANDOM_DISCUSSION_AND_QUIZ_IDEAS.filter((item) => item !== topic);
                    const pick =
                      pool[Math.floor(Math.random() * pool.length)] ||
                      RANDOM_DISCUSSION_AND_QUIZ_IDEAS[0];
                    setTopic(pick);
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] text-[10px] font-bold text-[#00B050] cursor-pointer"
                >
                  <Shuffle className="w-3 h-3" />
                  <span>فكرة جديدة</span>
                </button>
                {topic.trim() && (
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setTopic('')}
                    className="text-[10px] text-[var(--pmuted)] hover:text-rose-400 cursor-pointer"
                  >
                    مسح
                  </button>
                )}
              </div>
            </div>
            <textarea
              rows={3}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={isGenerating}
              placeholder={`مثال في ${selectedCategoryMeta.label}: ${selectedCategoryMeta.promptHint}...`}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] focus:border-[#00B050] focus:outline-none text-sm text-[var(--ptxt)] placeholder:text-[var(--pmuted)] resize-none leading-relaxed"
            />

            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={isGenerating}
                  onClick={() => setTopic(s)}
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--surface)] hover:border-[var(--gold)] border border-[var(--pline)] text-[11px] text-[var(--ptxt)] transition-colors cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-[var(--ptxt)]">
                <span>عدد الأسئلة</span>
                <span className="font-mono-nums text-[#00B050] font-bold">{count}</span>
              </div>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
                {[1, 2, 3, 5, 8].map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setCount(n)}
                    className={`flex-1 py-1.5 rounded-md text-xs font-mono-nums font-bold transition-colors cursor-pointer ${
                      count === n
                        ? 'bg-[#00B050] text-white'
                        : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-[var(--ptxt)]">مستوى الصعوبة</span>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
                {['سهل', 'متوسط', 'صعب'].map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setDifficulty(lvl)}
                    className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                      difficulty === lvl
                        ? 'bg-[var(--panel)] text-[var(--gold)] border border-[var(--pline)]'
                        : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ================= SUB-TAB 2: MEMORY VAULT & AI CONSULTANT ================= */}
      {subTab === 'bank' && (
        <div className="flex flex-col gap-3.5">
          {/* Cloud Firebase Sync Card */}
          <div className="p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Cloud className={`w-4 h-4 shrink-0 ${cloudUser ? 'text-[#00B050]' : 'text-[var(--pmuted)]'}`} />
                <span className="text-[11px] font-bold text-[var(--ptxt)] truncate">
                  {cloudUser
                    ? `سحابة Firebase (${cloudUser.email || 'حسابك'})`
                    : 'مزامنة الذاكرة سحابياً (Firebase)'}
                </span>
              </div>
              {cloudUser ? (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={isCloudSyncing || !isOnline}
                    onClick={() => void handleCloudSyncNow(false)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-[10px] font-bold disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isCloudSyncing ? 'animate-spin' : ''}`} />
                    <span>{isCloudSyncing ? 'مزامنة...' : 'مزامنة الآن'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void signOutFirebaseUser()}
                    title="تسجيل خروج المزامنة"
                    className="p-1 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[var(--pmuted)] hover:text-rose-400 cursor-pointer"
                  >
                    <LogOut className="w-3 h-3" />
                  </button>
                </div>
              ) : isAndroidNativeApp() ? (
                <button
                  type="button"
                  onClick={() => launchWebLinkLoginForApk(getWebLoginBaseUrl())}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-[10px] font-bold cursor-pointer shrink-0"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>دخول عبر الموقع</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isCloudSyncing || !isOnline}
                  onClick={() => void handleCloudSyncNow(false)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-[10px] font-bold disabled:opacity-50 cursor-pointer shrink-0"
                >
                  {isCloudSyncing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Cloud className="w-3 h-3" />
                  )}
                  <span>ربط بحساب Google</span>
                </button>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--pmuted)]">
              <span className="flex items-center gap-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    !isOnline ? 'bg-amber-400' : cloudUser ? 'bg-[#00B050]' : 'bg-[var(--pmuted)]'
                  }`}
                />
                {!isOnline
                  ? 'وضع أوفلاين (الحفظ محلي الآن)'
                  : cloudSyncMeta
                    ? `آخر مزامنة: ${new Date(cloudSyncMeta.lastSyncedAt).toLocaleTimeString('ar-EG', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : 'الأسئلة المخصصة والمنفذة تُزامَن تلقائياً لحفظ الحصة'}
              </span>
              {cloudUser && isOnline && (
                <button
                  type="button"
                  disabled={isCloudSyncing}
                  onClick={() => void handleCloudSyncNow(true)}
                  className="text-[10px] font-bold text-[#00B050] hover:underline cursor-pointer disabled:opacity-50"
                >
                  نسخ كل البنك
                </button>
              )}
            </div>
          </div>

          {/* Stats Bar */}
          {bankStats && (
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col items-center">
                <span className="text-[10px] text-[var(--pmuted)]">إجمالي الذاكرة</span>
                <span className="text-sm font-extrabold font-mono-nums text-[var(--ptxt)]">
                  {bankStats.total}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] flex flex-col items-center">
                <span className="text-[10px] text-[var(--pmuted)]">متاح (جديد)</span>
                <span className="text-sm font-extrabold font-mono-nums text-[var(--gold)]">
                  {bankStats.unused}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-[#00B050]/12 border border-[#00B050]/35 flex flex-col items-center">
                <span className="text-[10px] text-[#00B050] dark:text-[#6ee7b7]">تم تنفيذه ✅</span>
                <span className="text-sm font-extrabold font-mono-nums text-[#00B050] dark:text-[#6ee7b7]">
                  {bankStats.used}
                </span>
              </div>
            </div>
          )}

          {/* AI Consultation & Batch Builder */}
          <div className="p-3 rounded-xl bg-[var(--surface)] border border-[#00B050]/35 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <MessageSquareText className="w-4 h-4 text-[#00B050]" />
                <span className="text-xs font-extrabold text-[var(--ptxt)]">
                  استشارة الذكاء وتجهيز دفعات الذاكرة
                </span>
              </div>
              <span className="text-[10px] font-bold text-[#00B050] dark:text-[#6ee7b7]">
                {selectedCategoryMeta.emoji} {selectedCategoryMeta.label}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-[var(--pmuted)]">حجم الدفعة المطلوبة:</span>
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                {[25, 50, 100, 200].map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={isBatchGenerating}
                    onClick={() => setBatchTargetCount(n)}
                    className={`px-2 py-1 rounded-md text-[11px] font-mono-nums font-bold cursor-pointer ${
                      batchTargetCount === n
                        ? 'bg-[#00B050] text-white'
                        : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Mini Consultation Chat Thread */}
            {consultMessages.length > 0 && (
              <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto p-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                {consultMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`px-2.5 py-2 rounded-lg text-[11px] leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-[#00B050]/15 text-[var(--ptxt)] self-start'
                        : 'bg-[var(--surface)] text-[var(--ptxt)] border border-[var(--pline)]'
                    }`}
                  >
                    <span className="font-bold text-[#00B050] ml-1">
                      {m.role === 'user' ? 'أنت:' : 'المستشار الذكي:'}
                    </span>
                    {m.text}
                  </div>
                ))}
              </div>
            )}

            {/* Planned Subtopics Chips */}
            {plannedSubtopics.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-[var(--pmuted)]">
                  المحاور المعتمدة للتوزيع (لمنع التكرار):
                </span>
                <div className="flex flex-wrap gap-1">
                  {plannedSubtopics.map((sub, i) => (
                    <span
                      key={`${sub}-${i}`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--panel)] border border-[var(--pline)] text-[10px] text-[var(--ptxt)]"
                    >
                      <span>{sub}</span>
                      {!isBatchGenerating && (
                        <button
                          type="button"
                          onClick={() =>
                            setPlannedSubtopics((prev) => prev.filter((_, idx) => idx !== i))
                          }
                          className="text-[var(--pmuted)] hover:text-rose-400 font-bold cursor-pointer"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newSubtopicInput}
                    disabled={isBatchGenerating}
                    onChange={(e) => setNewSubtopicInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newSubtopicInput.trim()) {
                        e.preventDefault();
                        setPlannedSubtopics((prev) => [...prev, newSubtopicInput.trim()]);
                        setNewSubtopicInput('');
                      }
                    }}
                    placeholder="إضافة محور إضافي..."
                    className="flex-1 px-2.5 py-1 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={isBatchGenerating || !newSubtopicInput.trim()}
                    onClick={() => {
                      if (!newSubtopicInput.trim()) return;
                      setPlannedSubtopics((prev) => [...prev, newSubtopicInput.trim()]);
                      setNewSubtopicInput('');
                    }}
                    className="px-2 py-1 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[10px] font-bold text-[#00B050] disabled:opacity-40 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Chat Input + Consult Button */}
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={consultInput}
                disabled={isConsulting || isBatchGenerating}
                onChange={(e) => setConsultInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleConsultAi();
                  }
                }}
                placeholder={`اكتب ملاحظتك للذكاء (مثلاً: ركز على ${selectedCategoryMeta.label}...)`}
                className="flex-1 px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
              />
              <button
                type="button"
                disabled={isConsulting || isBatchGenerating}
                onClick={() => void handleConsultAi()}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-[var(--panel)] border border-[#00B050]/50 hover:border-[#00B050] text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7] disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {isConsulting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>استشارة الذكاء</span>
              </button>
            </div>

            {/* Batch Start / Stop Button */}
            {!isBatchGenerating ? (
              <button
                type="button"
                disabled={isConsulting}
                onClick={() => void handleStartBatchGeneration()}
                className="flex items-center justify-center gap-1.5 w-full py-2.5 px-3 rounded-xl bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {plannedSubtopics.length > 0
                    ? `اعتماد وتوليد ${batchTargetCount} سؤال في «${selectedCategoryMeta.label}» الآن`
                    : `اقتراح وتوليد ${batchTargetCount} سؤال بالذاكرة الآن`}
                </span>
              </button>
            ) : (
              <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-[#00B050]/12 border border-[#00B050]/40">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-[#00B050] dark:text-[#6ee7b7] truncate">
                    {batchProgress?.currentLabel || 'جارٍ التوليد...'}
                  </span>
                  <span className="font-mono-nums font-extrabold text-[var(--ptxt)] shrink-0">
                    {batchProgress?.saved ?? 0} / {batchProgress?.target ?? batchTargetCount}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-[var(--panel)] overflow-hidden">
                  <div
                    className="h-full bg-[#00B050] transition-all duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          ((batchProgress?.saved ?? 0) /
                            Math.max(1, batchProgress?.target ?? batchTargetCount)) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    batchAbortRef.current = true;
                  }}
                  className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>إيقاف مؤقت (مع حفظ ما تم توليده)</span>
                </button>
              </div>
            )}

            {bankNotice && (
              <div className="px-3 py-2 rounded-lg bg-[#00B050]/10 border border-[#00B050]/35 text-[11px] text-[#00B050] dark:text-[#6ee7b7] leading-relaxed">
                {bankNotice}
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI Voiceover Settings (Shared for direct generation AND 1-click bank->video) */}
      <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-[#00B050]" />
            <span className="text-xs font-bold text-[var(--ptxt)]">
              توليد تعليق صوتي بالذكاء الاصطناعي عند الإضافة للفيديو
            </span>
          </div>
          <input
            type="checkbox"
            checked={withVoice}
            disabled={isGenerating}
            onChange={(e) => setWithVoice(e.target.checked)}
            className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
          />
        </label>

        {withVoice && (
          <div className="flex flex-col gap-2.5 pt-2 border-t border-[var(--pline)]">
            <TtsQuotaBanner />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--pmuted)]">نبرة المذيع الصوتي</span>
              <select
                value={voiceName}
                disabled={isGenerating}
                onChange={(e) => onVoiceChange(e.target.value as AiVoiceName)}
                className="px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
              >
                {AI_VOICE_OPTIONS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--pmuted)]">
                نطاق التعليق الصوتي (الباقة المجانية 10 مقاطع يومياً / المدفوعة مفتوحة)
              </span>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => setVoiceMode('questionOnly')}
                  className={`py-1.5 px-1 rounded-md text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                    voiceMode === 'questionOnly'
                      ? 'bg-[#00B050]/18 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/40'
                      : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                  }`}
                >
                  السؤال فقط (1)
                </button>
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => setVoiceMode('questionAndAnswer')}
                  className={`py-1.5 px-1 rounded-md text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                    voiceMode === 'questionAndAnswer'
                      ? 'bg-[#00B050]/18 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/40'
                      : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                  }`}
                >
                  السؤال والحل (2)
                </button>
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => setVoiceMode('full')}
                  className={`py-1.5 px-1 rounded-md text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                    voiceMode === 'full'
                      ? 'bg-[#00B050]/18 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/40'
                      : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                  }`}
                >
                  {fullVoiceCountLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stored Bank List (Visible in Bank Tab) */}
      {subTab === 'bank' && (
        <div className="flex flex-col gap-2.5 p-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-[var(--ptxt)]">
              بنك الأسئلة المحفوظة ({bankItems.length})
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handlePickRandomUnused()}
                disabled={Boolean(bankActionId)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-[10px] font-bold cursor-pointer"
              >
                <Shuffle className="w-3 h-3" />
                <span>سحب سؤال عشوائي للفيديو</span>
              </button>
              <button
                type="button"
                onClick={() => void handleExportBankJson()}
                title="نسخ احتياطي للأسئلة بصيغة JSON"
                className="p-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[#00B050] text-[var(--ptxt)] cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--pmuted)] absolute right-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={bankSearch}
                onChange={(e) => {
                  setBankSearch(e.target.value);
                  setBankDisplayLimit(30);
                }}
                placeholder="ابحث داخل بنك الأسئلة..."
                className="w-full pr-8 pl-3 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <select
                value={bankFilterCat}
                onChange={(e) => {
                  setBankFilterCat(e.target.value as QuizCategory | 'all');
                  setBankDisplayLimit(30);
                }}
                className="px-2 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] text-[var(--ptxt)]"
              >
                <option value="all">كل المجالات</option>
                {QUIZ_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </select>

              <select
                value={bankFilterStatus}
                onChange={(e) => {
                  setBankFilterStatus(e.target.value as 'all' | 'unused' | 'used');
                  setBankDisplayLimit(30);
                }}
                className="px-2 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] text-[var(--ptxt)]"
              >
                <option value="all">كل الحالات</option>
                <option value="unused">غير مستخدم فقط</option>
                <option value="used">تم تنفيذه ✅ فقط</option>
              </select>
            </div>
          </div>

          {bankItems.length === 0 ? (
            <div className="p-4 text-center text-xs text-[var(--pmuted)] leading-relaxed">
              لا توجد أسئلة محفوظة في هذا الفلتر بعد. اضغط «استشارة الذكاء» أو «اقتراح وتوليد 100 سؤال الآن» لبناء ذاكرتك الضخمة!
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-0.5">
              {visibleBankItems.map((item) => {
                const catMeta =
                  QUIZ_CATEGORIES.find((c) => c.id === item.category) ?? QUIZ_CATEGORIES[0];
                const isWorking = bankActionId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`p-2.5 rounded-xl border transition-colors flex flex-col gap-1.5 ${
                      item.usedInVideo
                        ? 'bg-[#00B050]/12 border-[#00B050]/55'
                        : 'bg-[var(--panel)] border-[var(--pline)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--pline)] font-bold">
                          {catMeta.emoji} {catMeta.label}
                        </span>
                        {item.topicTag && (
                          <span className="text-[var(--pmuted)] truncate max-w-[140px]">
                            {item.topicTag}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const nextUsed = !item.usedInVideo;
                          void markBankQuestionsUsed([item.id], nextUsed).then(() => {
                            if (cloudUser) {
                              void updateCloudBankQuestionUsed(item.id, nextUsed, item).catch(() => {});
                            }
                            return refreshBank();
                          });
                        }}
                        title={item.usedInVideo ? 'تم تنفيذه كفيديو (اضغط للإلغاء)' : 'تحديد كمنفّذ'}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold shrink-0 cursor-pointer ${
                          item.usedInVideo
                            ? 'bg-[#00B050] text-white'
                            : 'bg-[var(--surface)] text-[var(--pmuted)] border border-[var(--pline)]'
                        }`}
                      >
                        {item.usedInVideo ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            <span>تم تنفيذه</span>
                          </>
                        ) : (
                          <>
                            <Circle className="w-3 h-3" />
                            <span>جديد</span>
                          </>
                        )}
                      </button>
                    </div>

                    <p className="text-xs font-bold text-[var(--ptxt)] leading-relaxed">
                      {item.question}
                    </p>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[10px] text-[#00B050] dark:text-[#6ee7b7] truncate">
                        الحل:{' '}
                        {item.slideType === 'clues'
                          ? item.options[3]
                          : item.options[item.correctIndex] || ''}
                      </span>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={Boolean(bankActionId)}
                          onClick={() => void handleUseBankQuestion(item, 'append')}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-50 text-white text-[10px] font-bold cursor-pointer"
                        >
                          {isWorking ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3 fill-current" />
                          )}
                          <span>تحويل لفيديو</span>
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(bankActionId)}
                          onClick={() => void handleUseBankQuestion(item, 'replace')}
                          title="استبدال أسئلة الفيديو الحالية بهذا السؤال"
                          className="px-2 py-1 rounded-lg bg-[var(--surface)] border border-[var(--pline)] hover:border-[var(--gold)] text-[10px] font-bold text-[var(--ptxt)] cursor-pointer"
                        >
                          بدء جديد
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void deleteBankQuestion(item.id).then(() => {
                              if (cloudUser) {
                                void deleteCloudBankQuestion(item.id).catch(() => {});
                              }
                              return refreshBank();
                            });
                          }}
                          title="حذف من الذاكرة"
                          className="p-1 rounded-lg text-[var(--pmuted)] hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {bankItems.length > bankDisplayLimit && (
                <button
                  type="button"
                  onClick={() => setBankDisplayLimit((n) => n + 40)}
                  className="py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs font-bold text-[#00B050] cursor-pointer"
                >
                  عرض المزيد ({bankItems.length - bankDisplayLimit} متبقي)
                </button>
              )}

              {bankItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    void clearBankQuestions(bankFilterCat).then(refreshBank);
                  }}
                  className="mt-1 py-1.5 rounded-lg border border-rose-500/30 text-[10px] text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                >
                  {bankFilterCat === 'all'
                    ? 'مسح كل الذاكرة'
                    : `مسح أسئلة تصنيف (${QUIZ_CATEGORIES.find((c) => c.id === bankFilterCat)?.label})`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {statusText && (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#00B050]/12 border border-[#00B050]/35 text-xs text-[#00B050] dark:text-[#6ee7b7]">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>{statusText}</span>
        </div>
      )}

      {errorMsg && (
        <div className="px-3.5 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400">
          {errorMsg}
        </div>
      )}

      {/* Action Buttons for Direct Tab */}
      {subTab === 'direct' && (
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => void handleGenerate('replace')}
            className="flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>توليد واستبدال الأسئلة</span>
          </button>

          <button
            type="button"
            disabled={isGenerating}
            onClick={() => void handleGenerate('append')}
            className="flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl bg-[var(--surface)] hover:border-[var(--gold)] disabled:opacity-50 text-[var(--ptxt)] border border-[var(--pline)] text-xs font-semibold transition-colors cursor-pointer"
          >
            <span>توليد وإضافة للقائمة</span>
          </button>
        </div>
      )}
    </div>
  );
};
