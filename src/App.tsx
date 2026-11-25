import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Brain,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Lock,
  Music,
  Palette,
  Redo2,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Video,
  Youtube,
} from 'lucide-react';
import { soundEngine } from './audio/soundEngine';
import { AiGeneratorPanel } from './components/AiGeneratorPanel';
import { AiPresenterStudioModal } from './components/AiPresenterStudioModal';
import { AppLockScreen, ManageLockModal } from './components/AppLockGate';
import { AudioTimingPanel } from './components/AudioTimingPanel';
import { BulkImportPanel } from './components/BulkImportPanel';
import { ExportVideoModal } from './components/ExportVideoModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ProjectsModal } from './components/ProjectsModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { QuestionBankVaultModal } from './components/QuestionBankVaultModal';
import { ShortsPreviewStage } from './components/ShortsPreviewStage';
import { SlidesEditorPanel } from './components/SlidesEditorPanel';
import { TemplateDesignPanel } from './components/TemplateDesignPanel';
import { ThumbnailStudioModal } from './components/ThumbnailStudioModal';
import { GoogleSignInButton, YouTubePublishPanel } from './components/YouTubePublishPanel';
import { YoutubePublishKit } from './services/aiClient';
import {
  YouTubeChannelInfo,
  YouTubePlaylistItem,
  YouTubePrivacyStatus,
  completeApkWebLoginFromBrowser,
  connectYouTubeWithPopup,
  disconnectYouTubeSession,
  fetchMyYouTubePlaylists,
  initYouTubeAuthListener,
} from './services/youtubeClient';
import {
  loadProjectFromStore,
  normalizeLoadedProject,
  saveProjectToStore,
} from './storage/projectStore';
import {
  getBankStats,
  seedAllStarterBanksIfNeeded,
} from './storage/questionBankVault';
import {
  QuestionSlide,
  QuizProject,
  STUDIO_THEME_ORDER,
  applyChannelThemePreset,
  applyStudioThemePreset,
  applyThemeBackgroundOnly,
  createDefaultProject,
  getCanvasDimensions,
  getTotalDuration,
} from './types/quiz';
import { isAppLockEnabled } from './utils/appLock';
import { setRootBackHandler } from './utils/androidBack';
import { isAndroidNativeApp } from './utils/nativeDownload';

type StudioTab = 'slides' | 'ai' | 'template' | 'audio' | 'import' | 'youtube';
type MobileStageMode = 'compact' | 'expanded' | 'collapsed';
type StudioUiTheme = 'darkGold' | 'midnightPro' | 'emeraldStudio' | 'lightSand';

const STUDIO_UI_THEMES: { id: StudioUiTheme; label: string; dot: string }[] = [
  { id: 'darkGold', label: 'داكن ذهبي', dot: '#d4a73a' },
  { id: 'midnightPro', label: 'نيلي احترافي', dot: '#38bdf8' },
  { id: 'emeraldStudio', label: 'زمردي غامق', dot: '#10b981' },
  { id: 'lightSand', label: 'رملي فاتح', dot: '#edd6a2' },
];

const UI_THEME_STORAGE_KEY = 'shorts_studio_ui_theme_v1';

const ApkWebLoginBridge: React.FC<{ onStayInWeb: () => void }> = ({ onStayInWeb }) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [returnDeepLink, setReturnDeepLink] = useState('');
  const [signedEmail, setSignedEmail] = useState<string | null>(null);
  const [signedChannel, setSignedChannel] = useState<string | null>(null);

  const handleBrowserLogin = async () => {
    if (loading) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await completeApkWebLoginFromBrowser();
      setReturnDeepLink(res.deepLinkUrl);
      setSignedEmail(res.email);
      setSignedChannel(res.channel?.title ?? null);
      window.location.href = res.deepLinkUrl;
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'تعذر إتمام تسجيل الدخول بحساب Google.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[var(--page)] text-[var(--ptxt)] p-4">
      <div className="w-full max-w-md rounded-2xl bg-[var(--panel)] border border-[var(--pline)] p-6 shadow-2xl flex flex-col gap-4 text-center">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-[#00B050]/15 border border-[#00B050]/35 flex items-center justify-center">
          <Youtube className="w-6 h-6 text-rose-500" />
        </div>
        <h1 className="text-lg font-extrabold">ربط حساب Google والعودة للتطبيق</h1>
        <p className="text-xs text-[var(--pmuted)] leading-relaxed">
          سجّل دخولك عبر المتصفح بحساب Google / YouTube المطلوب، وسيتم إعادتك تلقائياً إلى تطبيق{' '}
          <strong>استوديو شورتس الأسئلة</strong> مسجلاً الدخول وجاهزاً للرفع.
        </p>

        {!returnDeepLink ? (
          <GoogleSignInButton
            loading={loading}
            label="تسجيل الدخول بحساب Google والعودة للتطبيق"
            onClick={() => void handleBrowserLogin()}
          />
        ) : (
          <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-[#00B050]/12 border border-[#00B050]/40">
            <p className="text-xs font-bold text-[#00B050] dark:text-[#6ee7b7]">
              تم تسجيل الدخول بنجاح {signedChannel ? `(${signedChannel})` : signedEmail ? `(${signedEmail})` : ''}
            </p>
            <a
              href={returnDeepLink}
              className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-extrabold transition-colors"
            >
              <span>العودة إلى تطبيق استوديو شورتس الآن</span>
            </a>
          </div>
        )}

        {errorMsg && (
          <div className="px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/35 text-xs text-rose-400">
            {errorMsg}
          </div>
        )}

        <button
          type="button"
          onClick={onStayInWeb}
          className="text-xs font-semibold text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
        >
          متابعة العمل على نسخة الموقع بدلاً من ذلك
        </button>
      </div>
    </div>
  );
};

function buildDefaultPublishKit(proj: QuizProject): YoutubePublishKit {
  const targetSlides = proj.slides;
  const firstQ = (targetSlides[0]?.question || 'تحدي المعلومات').trim();
  const shortQ = firstQ.length > 48 ? `${firstQ.slice(0, 48)}...` : firstQ;
  const isShorts = proj.template.aspectRatio !== '16:9';
  const hashtags = isShorts
    ? ['#Shorts', '#أسئلة', '#تحدي_المعلومات', '#اختبر_ذكاءك', '#ثقافة_عامة']
    : ['#أسئلة', '#تحدي_المعلومات', '#اختبر_ذكاءك', '#ثقافة_عامة'];
  const title = isShorts ? `${shortQ} #Shorts` : `تحدي الأسئلة: ${shortQ}`;
  const description = `هل تستطيع الإجابة على ${
    targetSlides.length > 1 ? `جميع الأسئلة (${targetSlides.length} أسئلة)` : 'هذا السؤال'
  } قبل انتهاء الوقت؟ ⏱️🔥\nاكتب نتيجتك في التعليقات ولا تنسَ الاشتراك في القناة!\n\n${hashtags.join(' ')}`;
  const tags = ['أسئلة', 'تحدي المعلومات', 'اختبر ذكاءك', 'شورتس', 'ثقافة عامة', 'مسابقات'];
  const pinnedComment =
    targetSlides.length > 1
      ? `كم إجابة صحيحة جبت من أصل ${targetSlides.length}؟ اكتب نتيجتك في التعليقات 👇🔥`
      : 'هل عرفت الإجابة الصحيحة قبل انتهاء المؤقت؟ اكتب نعم أو لا في التعليقات 👇🔥';

  return { title, description, hashtags, tags, pinnedComment };
}

export default function App() {
  const [project, setProject] = useState<QuizProject>(() => createDefaultProject());
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<StudioTab>('slides');
  const [tabHistory, setTabHistory] = useState<StudioTab[]>([]);
  const [mobileStageMode, setMobileStageMode] = useState<MobileStageMode>('compact');
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [studioUiTheme, setStudioUiTheme] = useState<StudioUiTheme>(() => {
    try {
      const saved = localStorage.getItem(UI_THEME_STORAGE_KEY) as StudioUiTheme | null;
      if (saved && STUDIO_UI_THEMES.some((t) => t.id === saved)) return saved;
    } catch {
      // ignore storage errors
    }
    return 'darkGold';
  });
  const [isThumbStudioOpen, setIsThumbStudioOpen] = useState(false);
  const [isAiPresenterOpen, setIsAiPresenterOpen] = useState(false);
  const [customThumbnailBlob, setCustomThumbnailBlob] = useState<Blob | null>(null);
  const [customThumbnailPreviewUrl, setCustomThumbnailPreviewUrl] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(() => isAppLockEnabled());
  const [isLockModalOpen, setIsLockModalOpen] = useState(false);
  const [isProjectsOpen, setIsProjectsOpen] = useState(false);
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [vaultRefreshTrigger, setVaultRefreshTrigger] = useState(0);
  const [vaultTotalCount, setVaultTotalCount] = useState<number>(0);
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [showApkWebBridge, setShowApkWebBridge] = useState(() => {
    if (typeof window === 'undefined' || isAndroidNativeApp()) return false;
    return new URLSearchParams(window.location.search).get('apk_login') === '1';
  });

  // Shared YouTube Auth + AI Publishing Kit State
  const [publishKit, setPublishKit] = useState<YoutubePublishKit>(() =>
    buildDefaultPublishKit(createDefaultProject())
  );
  const [tagsInput, setTagsInput] = useState(() =>
    buildDefaultPublishKit(createDefaultProject()).tags.join('، ')
  );
  const kitEditedRef = useRef(false);
  const [ytConnected, setYtConnected] = useState(false);
  const [ytChannel, setYtChannel] = useState<YouTubeChannelInfo | null>(null);
  const [ytEmail, setYtEmail] = useState<string | null>(null);
  const [ytPlaylists, setYtPlaylists] = useState<YouTubePlaylistItem[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
  const [ytPrivacy, setYtPrivacy] = useState<YouTubePrivacyStatus>('private');
  const [ytUseSchedule, setYtUseSchedule] = useState(false);
  const [ytScheduleLocal, setYtScheduleLocal] = useState('');
  const [ytAutoPostComment, setYtAutoPostComment] = useState(true);
  const [isConnectingYt, setIsConnectingYt] = useState(false);
  const [ytAuthError, setYtAuthError] = useState('');

  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const hasLocalMutationRef = useRef(false);
  const projectRef = useRef(project);
  projectRef.current = project;
  const pastRef = useRef<QuizProject[]>([]);
  const futureRef = useRef<QuizProject[]>([]);
  const lastHistoryPushTimeRef = useRef(0);

  useEffect(() => {
    let active = true;
    void seedAllStarterBanksIfNeeded(false)
      .then(() => getBankStats())
      .then((stats) => {
        if (!active) return;
        setVaultTotalCount(stats.total);
        setVaultRefreshTrigger((n) => n + 1);
      })
      .catch(() => {
        void getBankStats()
          .then((stats) => {
            if (active) setVaultTotalCount(stats.total);
          })
          .catch(() => {});
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (vaultRefreshTrigger === 0) return;
    let active = true;
    void getBankStats()
      .then((stats) => {
        if (active) setVaultTotalCount(stats.total);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [vaultRefreshTrigger]);

  useEffect(() => {
    if (!isToolsMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setIsToolsMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [isToolsMenuOpen]);

  const navigateToTab = useCallback((nextTab: StudioTab) => {
    setActiveTab((prev) => {
      if (prev !== nextTab) {
        setTabHistory((hist) => [...hist.slice(-10), prev]);
      }
      return nextTab;
    });
  }, []);

  useEffect(() => {
    return setRootBackHandler(() => {
      if (isThumbStudioOpen) {
        setIsThumbStudioOpen(false);
        return true;
      }
      if (isExportOpen) {
        setIsExportOpen(false);
        return true;
      }
      if (isVaultOpen) {
        setIsVaultOpen(false);
        setVaultRefreshTrigger((n) => n + 1);
        return true;
      }
      if (isProjectsOpen) {
        setIsProjectsOpen(false);
        return true;
      }
      if (isLockModalOpen) {
        setIsLockModalOpen(false);
        return true;
      }
      if (mobileStageMode !== 'compact') {
        setMobileStageMode('compact');
        return true;
      }
      if (tabHistory.length > 0) {
        const prevTab = tabHistory[tabHistory.length - 1];
        setTabHistory((hist) => hist.slice(0, -1));
        setActiveTab(prevTab);
        return true;
      }
      if (activeTab !== 'slides') {
        setActiveTab('slides');
        return true;
      }
      return false;
    });
  }, [isThumbStudioOpen, isExportOpen, isVaultOpen, isProjectsOpen, isLockModalOpen, mobileStageMode, tabHistory, activeTab]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'theme-midnight', 'theme-emerald');
    if (studioUiTheme === 'darkGold') {
      root.classList.add('dark');
    } else if (studioUiTheme === 'midnightPro') {
      root.classList.add('dark', 'theme-midnight');
    } else if (studioUiTheme === 'emeraldStudio') {
      root.classList.add('dark', 'theme-emerald');
    }
    try {
      localStorage.setItem(UI_THEME_STORAGE_KEY, studioUiTheme);
    } catch {
      // ignore
    }
  }, [studioUiTheme]);

  const updateProject = useCallback(
    (updater: (prev: QuizProject) => QuizProject, immediateHistory = false) => {
      hasLocalMutationRef.current = true;
      setProject((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        const now = Date.now();
        if (immediateHistory || now - lastHistoryPushTimeRef.current > 450 || pastRef.current.length === 0) {
          pastRef.current = [...pastRef.current.slice(-39), prev];
          lastHistoryPushTimeRef.current = now;
        }
        futureRef.current = [];
        setCanUndo(pastRef.current.length > 0);
        setCanRedo(false);
        return next;
      });
    },
    []
  );

  const handleUndo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const prevSnapshot = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [projectRef.current, ...futureRef.current].slice(0, 40);
    setProject(prevSnapshot);
    setActiveSlideIndex((idx) => Math.min(idx, Math.max(0, prevSnapshot.slides.length - 1)));
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  const handleRedo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const nextSnapshot = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current.slice(-39), projectRef.current];
    setProject(nextSnapshot);
    setActiveSlideIndex((idx) => Math.min(idx, Math.max(0, nextSnapshot.slides.length - 1)));
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) &&
        (target as HTMLInputElement).type !== 'range' &&
        (target as HTMLInputElement).type !== 'checkbox' &&
        (target as HTMLInputElement).type !== 'color';
      if (isTextInput) return;

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    void loadProjectFromStore().then((loaded) => {
      if (!hasLocalMutationRef.current) {
        setProject(loaded);
      }
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      void saveProjectToStore(project);
    }, 380);
    return () => clearTimeout(timer);
  }, [project, isLoaded]);

  useEffect(() => {
    const flushSave = () => {
      if (isLoaded) {
        void saveProjectToStore(projectRef.current);
      }
    };
    window.addEventListener('pagehide', flushSave);
    window.addEventListener('beforeunload', flushSave);
    return () => {
      window.removeEventListener('pagehide', flushSave);
      window.removeEventListener('beforeunload', flushSave);
    };
  }, [isLoaded]);

  useEffect(() => {
    return initYouTubeAuthListener((session) => {
      setYtConnected(session.connected);
      setYtChannel(session.channel);
      setYtEmail(session.email);
      if (session.connected && session.token) {
        void fetchMyYouTubePlaylists(session.token).then(setYtPlaylists);
      } else {
        setYtPlaylists([]);
        setSelectedPlaylistId('');
      }
    });
  }, []);

  useEffect(() => {
    if (kitEditedRef.current) return;
    const fallback = buildDefaultPublishKit(project);
    setPublishKit(fallback);
    setTagsInput(fallback.tags.join('، '));
  }, [project.slides, project.template.aspectRatio]);

  const handleUpdatePublishKit = useCallback(
    (updater: (prev: YoutubePublishKit) => YoutubePublishKit) => {
      kitEditedRef.current = true;
      setPublishKit(updater);
    },
    []
  );

  const handleUpdateTagsInput = useCallback((val: string) => {
    kitEditedRef.current = true;
    setTagsInput(val);
  }, []);

  const handleResetDefaultKit = useCallback(() => {
    kitEditedRef.current = false;
    const fallback = buildDefaultPublishKit(projectRef.current);
    setPublishKit(fallback);
    setTagsInput(fallback.tags.join('، '));
  }, []);

  const handleConnectYouTube = useCallback(async () => {
    if (isConnectingYt) return;
    setIsConnectingYt(true);
    setYtAuthError('');
    try {
      const res = await connectYouTubeWithPopup();
      setYtConnected(true);
      setYtChannel(res.channel);
      setYtEmail(res.email);
      const pls = await fetchMyYouTubePlaylists(res.accessToken);
      setYtPlaylists(pls);
    } catch (err) {
      setYtAuthError(err instanceof Error ? err.message : 'تعذر ربط حساب Google / YouTube.');
    } finally {
      setIsConnectingYt(false);
    }
  }, [isConnectingYt]);

  const handleDisconnectYouTube = useCallback(async () => {
    setYtAuthError('');
    await disconnectYouTubeSession();
    setYtConnected(false);
    setYtChannel(null);
    setYtEmail(null);
    setYtPlaylists([]);
    setSelectedPlaylistId('');
  }, []);

  const audioSyncSigRef = useRef('');
  useEffect(() => {
    if (!isLoaded) return;
    const urls: string[] = [];
    if (project.template.introHookAudio?.dataUrl) {
      urls.push(
        `h:${project.template.introHookAudio.dataUrl.slice(0, 32)}:${project.template.introHookAudio.dataUrl.length}`
      );
    }
    if (project.template.endCardAudio?.dataUrl) {
      urls.push(
        `e:${project.template.endCardAudio.dataUrl.slice(0, 32)}:${project.template.endCardAudio.dataUrl.length}`
      );
    }
    (['questionEnter', 'optionEnter', 'countdownTick', 'suspense', 'correctReveal', 'bgMusic'] as const).forEach(
      (slot) => {
        const cfg = project.audio[slot];
        if (cfg?.sourceType === 'custom' && cfg.customDataUrl) {
          urls.push(`a:${slot}:${cfg.customDataUrl.slice(0, 32)}:${cfg.customDataUrl.length}`);
        }
      }
    );
    project.slides.forEach((s, si) => {
      if (s.voiceover?.question?.dataUrl) {
        urls.push(`q${si}:${s.voiceover.question.dataUrl.slice(0, 32)}:${s.voiceover.question.dataUrl.length}`);
      }
      if (s.voiceover?.answer?.dataUrl) {
        urls.push(`an${si}:${s.voiceover.answer.dataUrl.slice(0, 32)}:${s.voiceover.answer.dataUrl.length}`);
      }
      s.voiceover?.options?.forEach((o, oi) => {
        if (o?.dataUrl) {
          urls.push(`o${si}_${oi}:${o.dataUrl.slice(0, 32)}:${o.dataUrl.length}`);
        }
      });
    });

    if (urls.length === 0) {
      audioSyncSigRef.current = '';
      return;
    }

    const sig = urls.join('|');
    if (audioSyncSigRef.current === sig) return;
    audioSyncSigRef.current = sig;

    let cancelled = false;
    const decodeCtx =
      typeof OfflineAudioContext !== 'undefined'
        ? new OfflineAudioContext(1, 1, 48000)
        : undefined;

    void soundEngine
      .syncProjectAudioDurations(project.slides, project.audio, project.template, decodeCtx)
      .then((synced) => {
        if (cancelled) return;
        setProject((prev) => {
          let changed = false;
          const nextSlides = prev.slides.map((s, idx) => {
            const ss = synced.slides[idx];
            if (!s.voiceover || !ss?.voiceover) return s;
            const qChanged =
              s.voiceover.question?.dataUrl &&
              ss.voiceover.question &&
              Math.abs((s.voiceover.question.duration || 0) - ss.voiceover.question.duration) > 0.02;
            const ansChanged =
              s.voiceover.answer?.dataUrl &&
              ss.voiceover.answer &&
              Math.abs((s.voiceover.answer.duration || 0) - ss.voiceover.answer.duration) > 0.02;
            const optsChanged = Boolean(
              s.voiceover.options?.some(
                (o, oi) =>
                  o?.dataUrl &&
                  ss.voiceover?.options?.[oi] &&
                  Math.abs((o.duration || 0) - ss.voiceover.options[oi]!.duration) > 0.02
              )
            );
            if (!qChanged && !ansChanged && !optsChanged) return s;
            changed = true;
            return { ...s, voiceover: ss.voiceover };
          });

          const nextAudio = { ...prev.audio };
          (['questionEnter', 'optionEnter', 'countdownTick', 'suspense', 'correctReveal', 'bgMusic'] as const).forEach(
            (slot) => {
              const pCfg = prev.audio[slot];
              const sCfg = synced.audio[slot];
              if (
                pCfg?.sourceType === 'custom' &&
                pCfg.customDataUrl &&
                sCfg?.duration &&
                Math.abs((pCfg.duration ?? 0) - sCfg.duration) > 0.02
              ) {
                changed = true;
                nextAudio[slot] = { ...pCfg, duration: sCfg.duration };
              }
            }
          );

          let nextTemplate = prev.template;
          if (
            prev.template.introHookAudio?.dataUrl &&
            synced.template.introHookAudio &&
            Math.abs((prev.template.introHookAudio.duration || 0) - synced.template.introHookAudio.duration) >
              0.02
          ) {
            changed = true;
            nextTemplate = { ...nextTemplate, introHookAudio: synced.template.introHookAudio };
          }
          if (
            prev.template.endCardAudio?.dataUrl &&
            synced.template.endCardAudio &&
            Math.abs((prev.template.endCardAudio.duration || 0) - synced.template.endCardAudio.duration) >
              0.02
          ) {
            changed = true;
            nextTemplate = { ...nextTemplate, endCardAudio: synced.template.endCardAudio };
          }

          return changed
            ? { ...prev, slides: nextSlides, audio: nextAudio, template: nextTemplate }
            : prev;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, project.slides, project.audio, project.template]);

  const totalDuration = getTotalDuration(
    project.slides,
    project.timing,
    project.audio,
    project.template
  );
  const canvasDims = getCanvasDimensions(project.template);

  const handleUpdateSlide = useCallback(
    (idx: number, updated: QuestionSlide) => {
      updateProject((prev) => {
        const nextSlides = [...prev.slides];
        nextSlides[idx] = updated;
        return { ...prev, slides: nextSlides };
      });
    },
    [updateProject]
  );

  const handleAddSlide = useCallback(() => {
    updateProject((prev) => {
      const nextNum = prev.slides.length + 1;
      const newSlide: QuestionSlide = {
        id: `slide-${Date.now()}`,
        badgeText: `السؤال ${nextNum}`,
        question: 'اكتب نص السؤال الجديد هنا',
        options: ['الجواب الصحيح', 'خيار خاطئ 1', 'خيار خاطئ 2', 'خيار خاطئ 3'],
        correctIndex: 0,
        explanationText: '',
      };
      const nextSlides = [...prev.slides, newSlide];
      setActiveSlideIndex(nextSlides.length - 1);
      return { ...prev, slides: nextSlides };
    }, true);
  }, [updateProject]);

  const handleDuplicateSlide = useCallback(
    (idx: number) => {
      updateProject((prev) => {
        const source = prev.slides[idx];
        if (!source) return prev;
        const copy: QuestionSlide = {
          ...source,
          id: `slide-${Date.now()}`,
          options: [...source.options] as [string, string, string, string],
        };
        const nextSlides = [
          ...prev.slides.slice(0, idx + 1),
          copy,
          ...prev.slides.slice(idx + 1),
        ];
        setActiveSlideIndex(idx + 1);
        return { ...prev, slides: nextSlides };
      }, true);
    },
    [updateProject]
  );

  const handleDeleteSlide = useCallback(
    (idx: number) => {
      updateProject((prev) => {
        if (prev.slides.length <= 1) return prev;
        const nextSlides = prev.slides.filter((_, i) => i !== idx);
        setActiveSlideIndex((curr) => Math.min(curr, nextSlides.length - 1));
        return { ...prev, slides: nextSlides };
      }, true);
    },
    [updateProject]
  );

  const handleReorderSlide = useCallback(
    (fromIdx: number, toIdx: number) => {
      updateProject((prev) => {
        if (
          fromIdx === toIdx ||
          fromIdx < 0 ||
          toIdx < 0 ||
          fromIdx >= prev.slides.length ||
          toIdx >= prev.slides.length
        ) {
          return prev;
        }
        const nextSlides = [...prev.slides];
        const [moved] = nextSlides.splice(fromIdx, 1);
        nextSlides.splice(toIdx, 0, moved);
        setActiveSlideIndex(toIdx);
        return { ...prev, slides: nextSlides };
      }, true);
    },
    [updateProject]
  );

  const handleUpdateAllSlides = useCallback(
    (updater: (slides: QuestionSlide[]) => QuestionSlide[]) => {
      updateProject((prev) => ({ ...prev, slides: updater(prev.slides) }), true);
    },
    [updateProject]
  );

  const handleCycleChannelTheme = useCallback(() => {
    updateProject((prev) => {
      const currentIdx = STUDIO_THEME_ORDER.indexOf(prev.template.presetId);
      const nextId =
        STUDIO_THEME_ORDER[(currentIdx + 1) % STUDIO_THEME_ORDER.length];
      const mode = prev.template.themeApplyMode || 'bgOnly';
      return {
        ...prev,
        template:
          mode === 'full'
            ? applyStudioThemePreset(prev.template, nextId)
            : applyThemeBackgroundOnly(prev.template, nextId),
      };
    }, true);
  }, [updateProject]);

  const handleToggleAspectRatio = useCallback(() => {
    updateProject(
      (prev) => ({
        ...prev,
        template: {
          ...prev.template,
          aspectRatio: prev.template.aspectRatio === '16:9' ? '9:16' : '16:9',
        },
      }),
      true
    );
  }, [updateProject]);

  const navTabs: { id: StudioTab; label: string }[] = [
    { id: 'slides', label: 'الأسئلة' },
    { id: 'ai', label: 'توليد ذكي' },
    { id: 'template', label: 'القالب والتصميم' },
    { id: 'audio', label: 'الأصوات والتوقيت' },
    { id: 'import', label: 'استيراد سريع' },
    { id: 'youtube', label: 'نشر يوتيوب' },
  ];

  if (showApkWebBridge) {
    return (
      <ApkWebLoginBridge
        onStayInWeb={() => {
          setShowApkWebBridge(false);
          if (typeof window !== 'undefined') {
            const url = new URL(window.location.href);
            url.searchParams.delete('apk_login');
            window.history.replaceState({}, '', url.toString());
          }
        }}
      />
    );
  }

  if (isLocked) {
    return <AppLockScreen onUnlock={() => setIsLocked(false)} />;
  }

  return (
    <div className="h-[100dvh] lg:h-screen flex flex-col bg-[var(--page)] text-[var(--ptxt)] overflow-hidden">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-3 lg:gap-8 px-3.5 lg:px-6 h-13 lg:h-16 border-b border-[var(--pline)] bg-[var(--panel)] shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => e.preventDefault()}
          className="font-display text-sm sm:text-base lg:text-lg font-extrabold tracking-tight text-[var(--ptxt)] whitespace-nowrap shrink-0"
        >
          استوديو شورتس الأسئلة
        </a>

        {/* Zone 2: 6 single-line navigation links (Desktop / Tablet) */}
        <nav className="hidden md:flex items-center gap-4 lg:gap-6 text-xs lg:text-sm font-semibold text-[var(--pmuted)]">
          {navTabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => navigateToTab(tab.id)}
                className={`relative py-5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active ? 'text-[var(--ptxt)] font-bold' : 'hover:text-[var(--ptxt)]'
                }`}
              >
                {tab.label}
                {active && (
                  <span className="absolute bottom-0 inset-x-0 h-0.5 bg-[#00B050] rounded-full" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary CTA */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              try {
                soundEngine.getContext();
              } catch {
                // ignore
              }
              setIsExportOpen(true);
            }}
            className="flex items-center gap-1.5 lg:gap-2 px-3 lg:px-4 py-1.5 lg:py-2 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs lg:text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Film className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
            <span>تصدير الفيديو</span>
          </button>
        </div>
      </header>

      {/* Main Studio Workspace: Single Unified Phone Layout on < lg, Split Studio on lg+ */}
      <main className="flex-1 flex flex-col lg:grid lg:grid-cols-[440px_1fr] min-h-0 overflow-hidden">
        {/* Active Editor Panel (Bottom scrollable half on Mobile, Right column on RTL Desktop) */}
        <aside
          className={`order-2 lg:order-1 ${
            mobileStageMode === 'expanded' ? 'hidden lg:flex' : 'flex flex-1 min-h-0'
          } flex-col bg-[var(--panel)] lg:border-l border-t lg:border-t-0 border-[var(--pline)] min-h-0`}
        >
          {/* Unboxed workspace metadata strip + Undo/Redo + Projects + Consolidated Tools Menu */}
          <div className="flex items-center justify-between gap-1.5 sm:gap-2 px-2.5 py-1.5 sm:px-3.5 sm:py-2 lg:px-5 lg:py-2.5 border-b border-[var(--pline)] text-[11px] lg:text-xs text-[var(--pmuted)] shrink-0">
            <div className="flex items-center gap-1 sm:gap-1.5 truncate min-w-0">
              <span className="truncate">{project.slides.length} أسئلة</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-nums hidden sm:inline">
                {canvasDims.width}×{canvasDims.height}
              </span>
              <span aria-hidden="true" className="hidden sm:inline">·</span>
              <span className="font-mono-nums shrink-0">{totalDuration.toFixed(1)} ث</span>
            </div>

            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <div className="flex items-center border border-[var(--pline)] rounded-lg bg-[var(--surface)] overflow-hidden">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  title="تراجع (Ctrl+Z)"
                  className="h-7 px-1.5 text-[var(--ptxt)] disabled:opacity-30 hover:text-[#00B050] cursor-pointer disabled:cursor-default"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  title="إعادة (Ctrl+Y)"
                  className="h-7 px-1.5 text-[var(--ptxt)] disabled:opacity-30 hover:text-[#00B050] border-r border-[var(--pline)] cursor-pointer disabled:cursor-default"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsVaultOpen(true)}
                title="مكتبة الذاكرة الكبرى للأسئلة والمجلدات"
                className="flex items-center gap-1 h-7 px-1.5 sm:px-2 rounded-lg bg-[#00B050]/12 border border-[#00B050]/45 hover:border-[#00B050] text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7] cursor-pointer whitespace-nowrap"
              >
                <Brain className="w-3.5 h-3.5 shrink-0" />
                <span>الذاكرة</span>
                {vaultTotalCount > 0 && (
                  <span className="px-1 sm:px-1.5 py-0.2 rounded-full bg-[#00B050] text-white text-[10px] font-extrabold leading-tight font-mono-nums">
                    {vaultTotalCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsProjectsOpen(true)}
                title="مكتبة المشاريع المحفوظة"
                className="flex items-center gap-1 h-7 px-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7] cursor-pointer whitespace-nowrap"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>المشاريع</span>
              </button>

              <div className="relative" ref={toolsMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsToolsMenuOpen((v) => !v)}
                  title="الأدوات والمظهر والقفل"
                  className={`flex items-center gap-1 h-7 px-2 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    isToolsMenuOpen
                      ? 'bg-[#00B050]/15 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                      : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>الأدوات</span>
                </button>

                {isToolsMenuOpen && (
                  <div className="absolute left-0 top-9 z-40 w-56 p-1.5 rounded-xl bg-[var(--panel)] border border-[var(--pline)] shadow-xl flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsToolsMenuOpen(false);
                        setIsAiPresenterOpen(true);
                      }}
                      className="flex items-center justify-between gap-2 w-full px-3 py-2 rounded-lg text-xs font-bold text-[var(--ptxt)] hover:bg-[var(--surface)] transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span className="flex items-center gap-2">
                        <Video className="w-3.5 h-3.5 text-[#00B050] shrink-0" />
                        <span>الراوي الذكي – AI Presenter</span>
                      </span>
                      {project.template.aiPresenter?.enabled && (
                        <span className="w-2 h-2 rounded-full bg-[#00B050]" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsToolsMenuOpen(false);
                        setIsThumbStudioOpen(true);
                      }}
                      className="flex items-center justify-between gap-2 w-full px-3 py-2 rounded-lg text-xs font-bold text-[var(--ptxt)] hover:bg-[var(--surface)] transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span className="flex items-center gap-2">
                        <ImageIcon className="w-3.5 h-3.5 text-[var(--gold)] shrink-0" />
                        <span>استوديو الغلاف (Thumbnail)</span>
                      </span>
                      {customThumbnailPreviewUrl && (
                        <span className="w-2 h-2 rounded-full bg-[#00B050]" />
                      )}
                    </button>
                    <PWAInstallButton
                      variant="menuItem"
                      onAction={() => setIsToolsMenuOpen(false)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setIsToolsMenuOpen(false);
                        setIsLockModalOpen(true);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-semibold text-[var(--ptxt)] hover:bg-[var(--surface)] transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Lock className="w-3.5 h-3.5 text-[#00B050] shrink-0" />
                      <span>قفل الخصوصية</span>
                    </button>

                    <div className="mt-1 pt-1.5 border-t border-[var(--pline)] px-2 pb-1">
                      <span className="block text-[10px] font-bold text-[var(--pmuted)] mb-1.5">
                        ثيم واجهة الاستوديو:
                      </span>
                      <div className="grid grid-cols-2 gap-1">
                        {STUDIO_UI_THEMES.map((t) => {
                          const active = studioUiTheme === t.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => {
                                setStudioUiTheme(t.id);
                                setIsToolsMenuOpen(false);
                              }}
                              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[10px] font-bold cursor-pointer transition-colors ${
                                active
                                  ? 'bg-[#00B050]/16 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                                  : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
                              }`}
                            >
                              <span
                                className="w-2.5 h-2.5 rounded-full border border-white/40 shrink-0"
                                style={{ backgroundColor: t.dot }}
                              />
                              <span className="truncate">{t.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 lg:p-5 overscroll-contain">
            {aiNotice && (
              <div className="mb-4 flex items-start justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/35 text-xs text-amber-300 leading-relaxed">
                <span>{aiNotice}</span>
                <button
                  type="button"
                  onClick={() => setAiNotice(null)}
                  className="text-amber-300 hover:text-white font-bold px-1 cursor-pointer shrink-0"
                  aria-label="إغلاق التنبيه"
                >
                  ×
                </button>
              </div>
            )}

            {activeTab === 'slides' && (
              <SlidesEditorPanel
                slides={project.slides}
                activeIndex={activeSlideIndex}
                aiVoiceName={project.preferredAiVoice ?? 'Kore'}
                onAiVoiceChange={(voice) =>
                  updateProject((prev) => ({ ...prev, preferredAiVoice: voice }), true)
                }
                onSelectSlide={setActiveSlideIndex}
                onUpdateSlide={handleUpdateSlide}
                onAddSlide={handleAddSlide}
                onDuplicateSlide={handleDuplicateSlide}
                onDeleteSlide={handleDeleteSlide}
                onReorderSlide={handleReorderSlide}
                onUpdateAllSlides={handleUpdateAllSlides}
                hasAiPresenter={Boolean(project.template.aiPresenter?.enabled)}
                onOpenAiPresenterStudio={() => setIsAiPresenterOpen(true)}
              />
            )}

            {activeTab === 'ai' && (
              <AiGeneratorPanel
                voiceName={project.preferredAiVoice ?? 'Kore'}
                existingQuestions={project.slides.map((s) => s.question)}
                vaultRefreshTrigger={vaultRefreshTrigger}
                onOpenLargeVault={() => setIsVaultOpen(true)}
                onVoiceChange={(voice) =>
                  updateProject((prev) => ({ ...prev, preferredAiVoice: voice }), true)
                }
                onInsertSlides={(newSlides, mode, enableAutoSync, warningMessage, themePreset) => {
                  const targetIdx = mode === 'replace' ? 0 : project.slides.length;
                  updateProject((prev) => {
                    const updatedSlides =
                      mode === 'replace' ? newSlides : [...prev.slides, ...newSlides];
                    const nextTemplate =
                      themePreset === true || themePreset === 'math'
                        ? applyChannelThemePreset(prev.template, 'channelMath')
                        : themePreset === 'islamic'
                          ? applyStudioThemePreset(prev.template, 'islamicAndalusian')
                          : prev.template;
                    return {
                      ...prev,
                      slides: updatedSlides,
                      template: nextTemplate,
                      timing: enableAutoSync
                        ? { ...prev.timing, autoSyncWithAudio: true }
                        : prev.timing,
                    };
                  }, true);
                  setAiNotice(warningMessage ?? null);
                  setActiveSlideIndex(targetIdx);
                  setActiveTab('slides');
                }}
              />
            )}

            {activeTab === 'template' && (
              <TemplateDesignPanel
                template={project.template}
                timing={project.timing}
                slides={project.slides}
                aiVoiceName={project.preferredAiVoice ?? 'Kore'}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onChange={(nextTemplate, immediate = true) =>
                  updateProject((prev) => ({ ...prev, template: nextTemplate }), immediate)
                }
                onTimingChange={(nextTiming) =>
                  updateProject((prev) => ({ ...prev, timing: nextTiming }), true)
                }
                onOpenAiPresenterStudio={() => setIsAiPresenterOpen(true)}
              />
            )}

            {activeTab === 'audio' && (
              <AudioTimingPanel
                audio={project.audio}
                timing={project.timing}
                onAudioChange={(nextAudio) =>
                  updateProject((prev) => ({ ...prev, audio: nextAudio }), true)
                }
                onTimingChange={(nextTiming) =>
                  updateProject((prev) => ({ ...prev, timing: nextTiming }))
                }
              />
            )}

            {activeTab === 'import' && (
              <BulkImportPanel
                project={project}
                onReplaceSlides={(newSlides) => {
                  updateProject((prev) => ({ ...prev, slides: newSlides }), true);
                  setActiveSlideIndex(0);
                }}
                onAppendSlides={(moreSlides) => {
                  updateProject(
                    (prev) => ({
                      ...prev,
                      slides: [...prev.slides, ...moreSlides],
                    }),
                    true
                  );
                }}
                onImportFullProject={(loaded) => {
                  updateProject(() => normalizeLoadedProject(loaded), true);
                  setActiveSlideIndex(0);
                }}
              />
            )}

            {activeTab === 'youtube' && (
              <YouTubePublishPanel
                project={project}
                publishKit={publishKit}
                tagsInput={tagsInput}
                onUpdatePublishKit={handleUpdatePublishKit}
                onUpdateTagsInput={handleUpdateTagsInput}
                onResetDefaultKit={handleResetDefaultKit}
                ytConnected={ytConnected}
                ytChannel={ytChannel}
                ytEmail={ytEmail}
                ytPlaylists={ytPlaylists}
                selectedPlaylistId={selectedPlaylistId}
                onSelectPlaylistId={setSelectedPlaylistId}
                ytPrivacy={ytPrivacy}
                onChangePrivacy={setYtPrivacy}
                ytUseSchedule={ytUseSchedule}
                onChangeUseSchedule={setYtUseSchedule}
                ytScheduleLocal={ytScheduleLocal}
                onChangeScheduleLocal={setYtScheduleLocal}
                ytAutoPostComment={ytAutoPostComment}
                onChangeAutoPostComment={setYtAutoPostComment}
                isConnectingYt={isConnectingYt}
                ytAuthError={ytAuthError}
                onConnectYouTube={() => void handleConnectYouTube()}
                onDisconnectYouTube={() => void handleDisconnectYouTube()}
                onOpenExport={() => {
                  try {
                    soundEngine.getContext();
                  } catch {
                    // ignore
                  }
                  setIsExportOpen(true);
                }}
                customThumbnailPreviewUrl={customThumbnailPreviewUrl}
                onOpenThumbnailStudio={() => setIsThumbStudioOpen(true)}
              />
            )}
          </div>
        </aside>

        {/* Live Stage (Docked Top on Mobile, Left Column on RTL Desktop) */}
        <section
          className={`order-1 lg:order-2 flex flex-col items-center justify-center bg-[var(--page)] overflow-hidden ${
            mobileStageMode === 'expanded'
              ? 'flex-1 min-h-0'
              : mobileStageMode === 'collapsed'
              ? 'shrink-0 lg:flex-1 lg:min-h-0'
              : 'h-[215px] sm:h-[260px] shrink-0 lg:h-auto lg:flex-1 lg:min-h-0'
          }`}
        >
          <ShortsPreviewStage
            slides={project.slides}
            activeSlideIndex={activeSlideIndex}
            template={project.template}
            timing={project.timing}
            audio={project.audio}
            isExporting={isExportOpen}
            mobileStageMode={mobileStageMode}
            onChangeMobileStageMode={setMobileStageMode}
            onToggleSafeGuides={() =>
              updateProject(
                (prev) => ({
                  ...prev,
                  template: {
                    ...prev.template,
                    showSafeGuides: !prev.template.showSafeGuides,
                  },
                }),
                true
              )
            }
            onToggleAspectRatio={handleToggleAspectRatio}
            onCycleChannelTheme={handleCycleChannelTheme}
            onActiveSlideChange={setActiveSlideIndex}
            onUpdateTemplate={(nextTemplate) =>
              updateProject((prev) => ({ ...prev, template: nextTemplate }))
            }
          />
        </section>
      </main>

      {/* Native Phone Bottom Navigation Bar (< md / mobile) */}
      <nav
        aria-label="أقسام الاستوديو"
        className="md:hidden grid grid-cols-6 border-t border-[var(--pline)] bg-[var(--panel)] shrink-0 pb-[env(safe-area-inset-bottom)]"
      >
        {[
          { id: 'slides', label: 'الأسئلة', icon: Layers },
          { id: 'ai', label: 'ذكاء', icon: Sparkles },
          { id: 'template', label: 'القالب', icon: Palette },
          { id: 'audio', label: 'الأصوات', icon: Music },
          { id: 'import', label: 'استيراد', icon: Film },
          { id: 'youtube', label: 'يوتيوب', icon: Youtube },
        ].map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id && mobileStageMode !== 'expanded';
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                navigateToTab(t.id as StudioTab);
                if (mobileStageMode === 'expanded') {
                  setMobileStageMode('compact');
                }
              }}
              className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-bold transition-colors cursor-pointer ${
                active
                  ? 'text-[#00B050] dark:text-[#6ee7b7]'
                  : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
              }`}
            >
              {active && (
                <span className="absolute top-0 inset-x-2 h-0.5 rounded-b-full bg-[#00B050]" />
              )}
              <Icon className="w-4 h-4" />
              <span className="whitespace-nowrap">{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Video Export Modal */}
      <ExportVideoModal
        isOpen={isExportOpen}
        project={project}
        onClose={() => setIsExportOpen(false)}
        publishKit={publishKit}
        tagsInput={tagsInput}
        onUpdatePublishKit={handleUpdatePublishKit}
        onUpdateTagsInput={handleUpdateTagsInput}
        ytConnected={ytConnected}
        ytChannel={ytChannel}
        ytEmail={ytEmail}
        ytPlaylists={ytPlaylists}
        selectedPlaylistId={selectedPlaylistId}
        onSelectPlaylistId={setSelectedPlaylistId}
        ytPrivacy={ytPrivacy}
        onChangePrivacy={setYtPrivacy}
        ytUseSchedule={ytUseSchedule}
        onChangeUseSchedule={setYtUseSchedule}
        ytScheduleLocal={ytScheduleLocal}
        onChangeScheduleLocal={setYtScheduleLocal}
        ytAutoPostComment={ytAutoPostComment}
        onChangeAutoPostComment={setYtAutoPostComment}
        isConnectingYt={isConnectingYt}
        ytAuthError={ytAuthError}
        onConnectYouTube={handleConnectYouTube}
        onDisconnectYouTube={handleDisconnectYouTube}
        customThumbnailBlob={customThumbnailBlob}
        customThumbnailPreviewUrl={customThumbnailPreviewUrl}
        onOpenThumbnailStudio={() => setIsThumbStudioOpen(true)}
      />

      {/* YouTube Custom Thumbnail Studio Modal */}
      <ThumbnailStudioModal
        isOpen={isThumbStudioOpen}
        project={project}
        activeSlideIndex={activeSlideIndex}
        hasAttachedThumbnail={Boolean(customThumbnailBlob)}
        onClose={() => setIsThumbStudioOpen(false)}
        onAttachForYouTube={(blob, previewUrl) => {
          setCustomThumbnailBlob(blob);
          setCustomThumbnailPreviewUrl(previewUrl);
        }}
        onClearAttachedThumbnail={() => {
          setCustomThumbnailBlob(null);
          setCustomThumbnailPreviewUrl(null);
        }}
      />

      {/* Large Collapsible Question Bank & Nested Folders Vault */}
      <QuestionBankVaultModal
        isOpen={isVaultOpen}
        onClose={() => {
          setIsVaultOpen(false);
          setVaultRefreshTrigger((n) => n + 1);
        }}
        voiceName={project.preferredAiVoice ?? 'Kore'}
        onVoiceChange={(voice) =>
          updateProject((prev) => ({ ...prev, preferredAiVoice: voice }), true)
        }
        onInsertSlides={(
          newSlides,
          mode,
          enableAutoSync,
          warningMessage,
          themePreset,
          aspectRatioOverride
        ) => {
          const targetIdx = mode === 'replace' ? 0 : project.slides.length;
          updateProject((prev) => {
            const updatedSlides =
              mode === 'replace' ? newSlides : [...prev.slides, ...newSlides];
            let nextTemplate =
              themePreset === true || themePreset === 'math'
                ? applyChannelThemePreset(prev.template, 'channelMath')
                : themePreset === 'islamic'
                  ? applyStudioThemePreset(prev.template, 'islamicAndalusian')
                  : prev.template;
            if (aspectRatioOverride && nextTemplate.aspectRatio !== aspectRatioOverride) {
              nextTemplate = {
                ...nextTemplate,
                aspectRatio: aspectRatioOverride,
              };
            }
            return {
              ...prev,
              slides: updatedSlides,
              template: nextTemplate,
              timing: enableAutoSync
                ? { ...prev.timing, autoSyncWithAudio: true }
                : prev.timing,
            };
          }, true);
          setAiNotice(warningMessage ?? null);
          setActiveSlideIndex(targetIdx);
          setActiveTab('slides');
        }}
      />

      {/* Multi-Project Library Modal */}
      <ProjectsModal
        isOpen={isProjectsOpen}
        currentProject={project}
        onClose={() => setIsProjectsOpen(false)}
        onSelectProject={(loaded) => {
          updateProject(() => normalizeLoadedProject(loaded), true);
          setActiveSlideIndex(0);
          setAiNotice(null);
        }}
        onRenameCurrent={(name) =>
          updateProject((prev) => ({ ...prev, name }), true)
        }
      />

      {/* Personal Passcode Lock Management Modal */}
      <ManageLockModal
        isOpen={isLockModalOpen}
        onClose={() => setIsLockModalOpen(false)}
        onLockNow={() => setIsLocked(true)}
      />

      {/* Realistic Human AI Presenter Studio Modal */}
      <AiPresenterStudioModal
        isOpen={isAiPresenterOpen}
        onClose={() => setIsAiPresenterOpen(false)}
        template={project.template}
        slides={project.slides}
        activeSlideIndex={activeSlideIndex}
        onUpdateTemplate={(next, immediate = true) =>
          updateProject((prev) => ({ ...prev, template: next }), immediate)
        }
      />

      <OfflineIndicator />
    </div>
  );
}
