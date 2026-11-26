export type AnimationStyle = 'scale' | 'pop' | 'slideUp' | 'slideRight' | 'slideLeft' | 'fade';

export type VideoAspectRatio = '9:16' | '16:9';

export type RevealStyle =
  | 'highlightGlow'
  | 'scaleCheck'
  | 'dimOthers'
  | 'redWrongGreenCorrect';

export type OptionLayoutMode = 'channel2x2' | 'grid2x2' | 'vertical';

export type OptionLabelStyle = 'arabic' | 'numbers' | 'english' | 'none';

export type TimerStyle =
  | 'channelBox'
  | 'circle'
  | 'neonRing'
  | 'hexBadge'
  | 'pillCountdown'
  | 'bar'
  | 'digits'
  | 'none';

export type TimerPlacement = 'aboveOptions' | 'centerOfOptions' | 'belowOptions' | 'free';

export type TimerVisibilityMode =
  | 'afterOptionsBeforeAnswer'
  | 'fromQuestion'
  | 'untilReveal';

export type BoxShapeStyle =
  | 'flat'
  | 'bevel3d'
  | 'inset'
  | 'glass'
  | 'neon'
  | 'millionaireHex'
  | 'pill3d'
  | 'chamfer'
  | 'broadcastBar'
  | 'ticket'
  | 'layeredCard'
  | 'minimalOutline';

export type BoxBorderStyle =
  | 'solid'
  | 'double'
  | 'gradientGold'
  | 'gradientNeon'
  | 'metallicSilver'
  | 'gradientSunset'
  | 'dashedGold'
  | 'cornerBrackets';

export type BackgroundMotion = 'none' | 'slowZoom' | 'particles' | 'zoomAndParticles';

export type PrizeLadderStyle = 'topStrip' | 'sideColumn';

export type SlideType = 'multiple' | 'multiple3' | 'trueFalse' | 'clues' | 'versus';
export type SlideDifficulty = 'none' | 'easy' | 'medium' | 'hard';

export type QuestionImagePlacement = 'aboveBox' | 'insideBox' | 'belowBox';
export type QuestionImageInsideLayout =
  | 'belowText'
  | 'aboveText'
  | 'sideRight'
  | 'sideLeft'
  | 'backdrop';
export type OptionImagePlacement =
  | 'insideRight'
  | 'insideLeft'
  | 'insideTop'
  | 'coverFill'
  | 'aboveBox'
  | 'belowBox';
export type ImageFitMode = 'cover' | 'contain';

export interface SlideOptionImage {
  dataUrl: string;
  name?: string;
  scale?: number; // 50..160 (%) optional individual multiplier
}

export type QuizCategory =
  | 'general'
  | 'discussion'
  | 'sports'
  | 'geography'
  | 'science'
  | 'history'
  | 'islamic'
  | 'technology'
  | 'literature'
  | 'math';

export interface QuizCategoryMeta {
  id: QuizCategory;
  label: string;
  emoji: string;
  promptHint: string;
}

export const QUIZ_CATEGORIES: QuizCategoryMeta[] = [
  {
    id: 'general',
    label: 'ثقافة عامة',
    emoji: '💡',
    promptHint: 'معلومات عامة وثقافة متنوعة ومفاجآت معرفية',
  },
  {
    id: 'discussion',
    label: 'نقاش وتفاعل',
    emoji: '💬',
    promptHint: 'أسئلة نقاشية وتفاعلية للتعليقات ولو خُيّرت ومواقف حياتية',
  },
  {
    id: 'sports',
    label: 'رياضة',
    emoji: '⚽',
    promptHint: 'كرة القدم، البطولات العالمية، الأرقام القياسية، والرياضات المختلفة',
  },
  {
    id: 'geography',
    label: 'جغرافيا',
    emoji: '🌍',
    promptHint: 'الدول، العواصم، الأنهار، الجبال، المعالم، والخرائط',
  },
  {
    id: 'science',
    label: 'علوم وفضاء',
    emoji: '🔬',
    promptHint: 'الفيزياء، الكيمياء، الأحياء، الفضاء والكواكب، وجسم الإنسان',
  },
  {
    id: 'history',
    label: 'تاريخ',
    emoji: '🏛️',
    promptHint: 'الحضارات القديمة، الشخصيات التاريخية، الأحداث الكبرى، والاكتشافات',
  },
  {
    id: 'islamic',
    label: 'إسلاميات',
    emoji: '🕌',
    promptHint: 'السيرة النبوية، الأنبياء، القرآن الكريم، والتاريخ الإسلامي',
  },
  {
    id: 'technology',
    label: 'تقنية وذكاء',
    emoji: '💻',
    promptHint: 'البرمجة، الذكاء الاصطناعي، الاختراعات الحديثة، والشركات التقنية',
  },
  {
    id: 'literature',
    label: 'لغة وأدب',
    emoji: '📚',
    promptHint: 'اللغة العربية، الأمثال، الشعر، المعاني النادرة، والأدب العالمي',
  },
  {
    id: 'math',
    label: 'رياضيات',
    emoji: '🧮',
    promptHint: 'العمليات الحسابية، الجبر، الكسور، الجذور، والهندسة',
  },
];

export type OptionsAppearMode = 'stagger' | 'allAtOnce' | 'rowByRow';

export type OptionTextAlign = 'auto' | 'center' | 'right' | 'left';
export type QuestionTextAlign = 'center' | 'right' | 'left';
export type ThemeApplyMode = 'bgOnly' | 'full';
export type TimerUnitSuffix = '' | 's' | 'ث';

export type ImageChallengeMode =
  | 'normal'
  | 'blurToClear'
  | 'gradualClear'
  | 'zoomOutReveal'
  | 'tileGridReveal';

export type PresenterStyle = 'stylized3d' | 'photoMale' | 'photoFemale' | 'customPhoto';
export type PresenterGender = 'male' | 'female';
export type PresenterSkinTone = 'fair' | 'warmWheat' | 'olive' | 'tan' | 'deep';
export type PresenterBeardStyle = 'none' | 'stubble' | 'trimmed';
export type PresenterLipSyncMode = 'audioOnly' | 'audioAndReading';

export type PresenterPlacement =
  | 'cornerBottomRight'
  | 'bottomCenter'
  | 'cornerBottomLeft'
  | 'topRight'
  | 'topLeft'
  | 'sideStage'
  | 'floating';
export type PresenterFrameShape = 'cutout' | 'circleCam' | 'broadcastCard';

export type PresenterPoseId =
  | 'waveSpeak'
  | 'explain'
  | 'pointUp'
  | 'pointSide'
  | 'thinkForehead'
  | 'thinkChin'
  | 'tapWatch'
  | 'leanSuspense'
  | 'celebrate'
  | 'pointSubscribe';

export type PresenterGestureCommand = 'auto' | PresenterPoseId;

export const PRESENTER_GESTURE_OPTIONS: {
  id: PresenterPoseId;
  label: string;
  shortLabel: string;
}[] = [
  { id: 'waveSpeak', label: 'ترحيب وتلويح باليد 👋', shortLabel: 'تلويح 👋' },
  { id: 'explain', label: 'تحريك اليدين أثناء الشرح 🤲', shortLabel: 'حركة شرح 🤲' },
  { id: 'pointUp', label: 'إشارة للأعلى نحو السؤال ☝️', shortLabel: 'أشر للسؤال ☝️' },
  { id: 'pointSide', label: 'إشارة نحو الخيارات 👉', shortLabel: 'أشر للخيارات 👉' },
  { id: 'thinkForehead', label: 'يد على الجبين يفكر بعمق 🤔', shortLabel: 'يد على الجبين 🤔' },
  { id: 'thinkChin', label: 'يد على الذقن يفكر 🧐', shortLabel: 'يد على الذقن 🧐' },
  { id: 'tapWatch', label: 'تنبيه للوقت (الساعة ⌚)', shortLabel: 'تنبيه الوقت ⌚' },
  { id: 'leanSuspense', label: 'تشويق وتركيز 😮', shortLabel: 'تشويق 😮' },
  { id: 'celebrate', label: 'احتفال وتشجيع 🙌', shortLabel: 'احتفال 🙌' },
  { id: 'pointSubscribe', label: 'إشارة لزر الاشتراك 🔔', shortLabel: 'زر الاشتراك 🔔' },
];

export interface PresenterPhaseCommands {
  intro?: PresenterGestureCommand;
  readingQuestion?: PresenterGestureCommand;
  readingOptions?: PresenterGestureCommand;
  thinking?: PresenterGestureCommand;
  suspense?: PresenterGestureCommand;
  reveal?: PresenterGestureCommand;
  outro?: PresenterGestureCommand;
}

export interface PresenterActionCue {
  id: string;
  trigger: 'atSecond' | 'readingQuestion' | 'readingOptions' | 'thinking' | 'suspense' | 'reveal';
  atSecond?: number; // seconds from start of slide (when trigger === 'atSecond')
  duration?: number; // cue duration in seconds (default 2.0)
  gesture: PresenterPoseId;
  bubbleText?: string;
}

export type SlideTransitionStyle =
  | 'none'
  | 'fade'
  | 'slideLeft'
  | 'slideRight'
  | 'zoomFade'
  | 'wipeGold';

export type PresetId =
  | 'channelSand'
  | 'channelNavy'
  | 'channelEmerald'
  | 'channelMath'
  | 'millionaire'
  | 'tvShowGold'
  | 'neonCyber'
  | 'parchmentGold'
  | 'playfulKids'
  | 'royalPurple'
  | 'arcticCyan'
  | 'sunsetCinema'
  | 'ramadanLantern'
  | 'crimsonArena'
  | 'mintEditorial'
  | 'islamicAndalusian'
  | 'cosmicSpace'
  | 'stadiumArena'
  | 'ancientHistory'
  | 'emerald'
  | 'navy'
  | 'obsidian';

export type AudioSlotId =
  | 'questionEnter'
  | 'optionEnter'
  | 'countdownTick'
  | 'suspense'
  | 'correctReveal'
  | 'bgMusic';

export type BuiltInSfxId =
  | 'none'
  | 'softPop'
  | 'whoosh'
  | 'click'
  | 'tick'
  | 'channelTick'
  | 'suspenseRiser'
  | 'chime'
  | 'successFanfare'
  | 'calmPulse';

export interface SlideAudioClip {
  fileName: string;
  dataUrl: string;
  duration: number; // exact duration in seconds
}

export interface SlideVoiceover {
  question?: SlideAudioClip;
  options?: [
    SlideAudioClip | undefined,
    SlideAudioClip | undefined,
    SlideAudioClip | undefined,
    SlideAudioClip | undefined
  ];
  answer?: SlideAudioClip;
}

export type BrandLogoAnimation = 'none' | 'pulse' | 'float' | 'glow' | 'spin';

export type BrandCornerPosition =
  | 'topRight'
  | 'topLeft'
  | 'bottomRight'
  | 'bottomLeft'
  | 'custom';

export interface QuestionSlide {
  id: string;
  slideType?: SlideType;
  category?: QuizCategory;
  difficulty?: SlideDifficulty;
  badgeText: string;
  question: string;
  imageDataUrl?: string;
  imageName?: string;
  imageChallengeMode?: ImageChallengeMode;
  imageBlurStrength?: number; // 10..50
  imagePlacement?: QuestionImagePlacement;
  imageInsideLayout?: QuestionImageInsideLayout;
  imageScale?: number; // 40..180 (%)
  imageFit?: ImageFitMode;
  imageBorderRadius?: number; // 0..48
  imageOffsetX?: number; // -200..200
  imageOffsetY?: number; // -200..200
  options: [string, string, string, string];
  optionImages?: [
    SlideOptionImage | undefined,
    SlideOptionImage | undefined,
    SlideOptionImage | undefined,
    SlideOptionImage | undefined
  ];
  optionImagePlacement?: OptionImagePlacement;
  optionImageScale?: number; // 40..180 (%)
  optionImageFit?: ImageFitMode;
  optionImageRadius?: number; // 0..36
  optionImageOffsetX?: number; // -120..120
  optionImageOffsetY?: number; // -120..120
  correctIndex: 0 | 1 | 2 | 3;
  explanationText?: string;
  voiceover?: SlideVoiceover;
  presenterCues?: PresenterActionCue[];
}

export interface AudioSlotConfig {
  sourceType: 'builtin' | 'custom';
  builtinId: BuiltInSfxId;
  customFileName?: string;
  customDataUrl?: string;
  duration?: number;
  volume: number; // 0 to 1
}

export type AudioSettings = Record<AudioSlotId, AudioSlotConfig>;

export interface TemplateSettings {
  aspectRatio: VideoAspectRatio;

  backgroundType: 'preset' | 'custom' | 'color';
  presetId: PresetId;
  customBgDataUrl?: string;
  customBgName?: string;
  solidBgColor: string;
  bgDimOpacity: number; // 0 to 0.75

  fontFamily: 'Cairo' | 'Tajawal' | 'Amiri';

  freeLayoutMode?: boolean;
  themeApplyMode?: ThemeApplyMode;

  showBadge: boolean;
  badgeX?: number; // percentage 10..90
  badgeY: number; // percentage 0..100
  badgeBorderRadius?: number; // px
  badgeBgColor: string;
  badgeTextColor: string;

  questionX?: number; // percentage 15..85
  questionY: number; // percentage 0..100
  questionWidth: number; // percentage 30..98
  questionHeightPct: number; // 0 = auto height, >0 = fixed channel height pct (e.g. 16)
  questionFontSize: number; // px on 1080x1920
  questionTextAlign?: QuestionTextAlign;
  questionTextColor: string;
  questionBoxColor: string;
  questionBoxOpacity: number; // 0..1
  questionBorderColor: string;
  questionBorderWidth: number;
  questionBorderRadius: number;
  questionAnim: AnimationStyle;

  optionsLayout: OptionLayoutMode;
  optionsX?: number; // percentage 15..85
  optionsStartY: number; // percentage 0..100
  optionsWidth: number; // percentage 35..100
  optionsGap: number; // vertical row gap px
  optionsColGap?: number; // 0 = match optionsGap, >0 = independent horizontal column gap px
  optionHeight: number; // px on 1080x1920
  optionFontSize: number; // px on 1080x1920
  optionLabelStyle: OptionLabelStyle;
  optionTextColor: string;
  optionBoxColor: string;
  optionBoxOpacity: number; // 0..1
  optionBorderColor: string;
  optionBorderWidth: number;
  optionBorderRadius: number;
  optionLabelBgColor: string;
  optionLabelTextColor: string;
  optionAnim: AnimationStyle;

  boxGloss: boolean;
  enhanceAppearance: boolean;

  timerStyle: TimerStyle;
  timerPlacement?: TimerPlacement;
  timerX?: number; // percentage 5..95
  timerY: number; // percentage 5..95
  timerVisibilityMode?: TimerVisibilityMode;
  timerUrgentPulse?: boolean;
  timerUrgentThreshold?: number; // seconds 1..6
  timerUrgentColor?: string;
  timerUnitSuffix?: TimerUnitSuffix;
  timerOpacity?: number; // 0.2..1
  timerBorderColor?: string;
  timerBorderWidth?: number; // -1 = inherit from questionBorderWidth
  questionToOptionsGap?: number; // extra spacing px 0..180
  optionsCenterGap?: number; // extra spacing px 0..140 when centered
  timerColor: string;
  timerBgColor: string;
  timerMatchBackground: boolean;
  useTimerVideo: boolean;

  correctColor: string;
  wrongColor: string;
  revealStyle: RevealStyle;
  showExplanationOnReveal: boolean;
  explanationBgColor?: string;
  explanationTextColor?: string;
  explanationOffsetY?: number;
  showSafeGuides: boolean;

  showEndCard: boolean;
  endCardText: string;
  endCtaText?: string;
  autoFitText?: boolean;

  brandLogoDataUrl?: string;
  brandLogoName?: string;
  brandLogoAnim: BrandLogoAnimation;
  brandLogoSize: number; // px on canvas
  brandLogoPosition: BrandCornerPosition;
  brandLogoX?: number; // percentage 5..95 (when custom)
  brandLogoY?: number; // percentage 5..95 (when custom)
  brandHandleText: string;
  brandOpacity: number; // 0.2..1
  showProgressCounter: boolean;

  // Additive Visual, Depth, Scale & Millionaire Upgrades
  boxStyle?: BoxShapeStyle;
  borderStyle?: BoxBorderStyle;
  shadowIntensity?: number; // 0..1.5
  glowIntensity?: number; // 0..1
  globalScale?: number; // 0.75..1.25
  timerScale?: number; // 0.5..1.8
  badgeScale?: number; // 0.6..1.8
  bgMotion?: BackgroundMotion;
  revealConfetti?: boolean;
  highlightSpokenOption?: boolean;
  showIntroHook?: boolean;
  introHookText?: string;
  introHookDuration?: number; // 0.6..6.0s
  introHookAudio?: SlideAudioClip;
  introHookSfx?: BuiltInSfxId;
  showEndSubscribeCta?: boolean;
  showPrizeLadder?: boolean;
  prizeLadderStyle?: PrizeLadderStyle;
  prizeLadderTitle?: string;
  prizeLadderAmounts?: string[];
  slideTransition?: SlideTransitionStyle;
  optionsAppearMode?: OptionsAppearMode;
  optionTextAlign?: OptionTextAlign;
  optionsRtlColumns?: boolean;

  // Lifelike Interactive Studio Presenter & Growth Hooks
  presenterEnabled?: boolean;
  presenterStyle?: PresenterStyle;
  presenterPhotoDataUrl?: string;
  presenterPhotoName?: string;
  presenterPlacement?: PresenterPlacement;
  presenterScale?: number; // 50..180 (%)
  presenterX?: number; // % 5..95
  presenterY?: number; // % 5..95
  presenterFrameShape?: PresenterFrameShape;
  presenterIntroFullscreen?: boolean;
  presenterOutroFullscreen?: boolean;
  presenterStudioMic?: boolean;
  presenterName?: string;
  presenterMouthY?: number; // 20..48 (% vertical lip line on portrait photo, default 31.2)
  presenterTalkIntensity?: number; // 0..100 (%) mild to expressive mouth motion
  presenterContinuousTalk?: boolean; // legacy toggle kept for compat
  presenterLipSyncMode?: PresenterLipSyncMode; // audioOnly vs audioAndReading
  presenterExpressiveness?: number; // 20..150 (%) overall gesture & brow energy
  presenterGender?: PresenterGender;
  presenterSkinTone?: PresenterSkinTone;
  presenterHairColor?: string;
  presenterEyeColor?: string;
  presenterSuitColor?: string;
  presenterTieColor?: string;
  presenterBeard?: PresenterBeardStyle;
  presenterGlasses?: boolean;
  presenterCommands?: PresenterPhaseCommands;

  endCardAudio?: SlideAudioClip;
  introFlashTeaser?: boolean;
  introFlashHookText?: string;
  showLiveScoreboard?: boolean;
  scoreBoardLabel?: string;
  showDynamicCaptions?: boolean;
  dynamicCaptionStyle?: DynamicCaptionStyle;
  dynamicCaptionY?: number;
  aiPresenter?: AiPresenterOverlay;
}

export type DynamicCaptionStyle = 'pillKaraoke' | 'boldYellow' | 'cleanGlass';

export type AiPresenterBgMode =
  | 'original'
  | 'transparent'
  | 'white'
  | 'color'
  | 'customImage';

export type AiPresenterScope =
  | 'fullTimeline'
  | 'intro'
  | 'outro'
  | 'allSlides'
  | 'slide';

export interface AiPresenterOverlay {
  enabled: boolean;
  provider: 'tavus';
  videoId: string;
  replicaId: string;
  replicaName: string;
  script: string;
  voiceSource: 'script' | 'audioUrl' | 'localAudio';
  transparentRequested?: boolean;
  fastRequested?: boolean;
  mimeType: 'video/mp4' | 'video/webm';
  naturalDuration: number;
  mediaKey: string;
  scope: AiPresenterScope;
  targetSlideIndex?: number;
  placement: PresenterPlacement;
  x: number;
  y: number;
  scale: number;
  frameShape: PresenterFrameShape;
  bgMode: AiPresenterBgMode;
  bgColor?: string;
  customBgDataUrl?: string;
  trimStart: number;
  trimEnd: number;
  startOffset: number;
  displayDuration: number;
  volume: number;
  showNameBadge?: boolean;
  displayName?: string;
  fullscreenInIntro?: boolean;
  fullscreenInOutro?: boolean;
  muteOtherVoices?: boolean;
  afterSpeechBehavior?: 'stayIdle' | 'loop' | 'hide';
  startPhase?: 'timelineStart' | 'firstQuestion';
}

export interface TimingSettings {
  autoSyncWithAudio: boolean; // Auto-advance to next element when uploaded audio finishes
  audioEndGap: number; // small pause after audio finishes (seconds)
  autoDuckMusic: boolean; // Automatically lower background music while presenter speaks
  bgMusicDuckRatio: number; // 0.1..0.6 target music level during speech
  introHold: number; // seconds before question enters (0 = instant with voice)
  questionReadDelay: number; // fallback seconds after question enters if no custom audio
  optionStaggerDelay: number; // fallback seconds between each option if no custom audio
  thinkingDuration: number; // countdown seconds after Option 4
  suspenseDuration: number; // suspense pulse seconds after timer before answer reveal
  revealHoldDuration: number; // seconds correct answer stays highlighted
  transitionGap: number; // seconds between slides
  escalatingSpeed?: boolean; // Gradually shorten countdown on later questions
  escalatingStepSeconds?: number; // Reduction per question (e.g. 0.5 or 1.0)
  escalatingMinSeconds?: number; // Minimum floor (e.g. 2.0s)
}

export interface QuizProject {
  id: string;
  name: string;
  schemaVersion?: number;
  preferredAiVoice?: 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
  slides: QuestionSlide[];
  template: TemplateSettings;
  timing: TimingSettings;
  audio: AudioSettings;
  updatedAt: number;
}

export interface PresetBackdropInfo {
  id: PresetId;
  label: string;
  src?: string;
  wideSrc?: string;
  gradientInner?: string;
  gradientOuter?: string;
  gradientStop?: number;
  swatchColor: string;
}

function withBasePath(relPath: string): string {
  const base =
    (import.meta as unknown as { env?: { BASE_URL?: string } })?.env?.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${relPath.replace(/^\/+/, '')}`;
}

export const PRESENTER_PORTRAIT_URLS = {
  photoMale: withBasePath('src/assets/images/presenter_male_studio_1795630067519.jpg'),
  photoFemale: withBasePath('src/assets/images/presenter_female_studio_1795630068123.jpg'),
} as const;

export const PRESET_BACKDROPS: PresetBackdropInfo[] = [
  {
    id: 'channelSand',
    label: 'قالب القناة الرملي',
    src: withBasePath('src/assets/images/template_channel_sand.jpg'),
    swatchColor: '#EDD6A2',
  },
  {
    id: 'channelNavy',
    label: 'الكحلي الملكي (القناة)',
    gradientInner: '#2b3a6b',
    gradientOuter: '#0b1230',
    gradientStop: 0.7,
    swatchColor: '#1f2a4d',
  },
  {
    id: 'channelEmerald',
    label: 'الزمردي الكلاسيكي (القناة)',
    gradientInner: '#1e6b55',
    gradientOuter: '#0a2a22',
    gradientStop: 0.75,
    swatchColor: '#1e6b55',
  },
  {
    id: 'channelMath',
    label: 'سبورة الرياضيات 🧮',
    src: withBasePath('src/assets/images/math_board_vertical_1795360665242.jpg'),
    wideSrc: withBasePath('src/assets/images/math_board_wide_1795360665477.jpg'),
    swatchColor: '#113328',
  },
  {
    id: 'millionaire',
    label: 'من سيربح المليون 💎',
    gradientInner: '#1a3b8e',
    gradientOuter: '#050b24',
    gradientStop: 0.72,
    swatchColor: '#10286b',
  },
  {
    id: 'tvShowGold',
    label: 'بث المسابقات الذهبي 📺',
    gradientInner: '#2a2461',
    gradientOuter: '#08091a',
    gradientStop: 0.72,
    swatchColor: '#251e57',
  },
  {
    id: 'neonCyber',
    label: 'النيون الحماسي ⚡',
    gradientInner: '#171b3d',
    gradientOuter: '#050712',
    gradientStop: 0.75,
    swatchColor: '#0e1633',
  },
  {
    id: 'parchmentGold',
    label: 'المخطوطة الدافئة 📜',
    gradientInner: '#f5e8ca',
    gradientOuter: '#cbb079',
    gradientStop: 0.85,
    swatchColor: '#e8d4a2',
  },
  {
    id: 'playfulKids',
    label: 'ألوان مبهجة 3D 🎨',
    gradientInner: '#2563eb',
    gradientOuter: '#0f766e',
    gradientStop: 0.82,
    swatchColor: '#1d4ed8',
  },
  {
    id: 'royalPurple',
    label: 'البنفسجي الملكي 👑',
    gradientInner: '#4c1d95',
    gradientOuter: '#120529',
    gradientStop: 0.74,
    swatchColor: '#3b1578',
  },
  {
    id: 'arcticCyan',
    label: 'الجليدي الزجاجي ❄️',
    gradientInner: '#0e4f73',
    gradientOuter: '#041422',
    gradientStop: 0.76,
    swatchColor: '#0c3f5c',
  },
  {
    id: 'sunsetCinema',
    label: 'الغروب السينمائي 🌅',
    gradientInner: '#7c2146',
    gradientOuter: '#17071b',
    gradientStop: 0.75,
    swatchColor: '#5c1836',
  },
  {
    id: 'ramadanLantern',
    label: 'ليالي رمضانية 🌙',
    gradientInner: '#163c4a',
    gradientOuter: '#050f18',
    gradientStop: 0.76,
    swatchColor: '#12323f',
  },
  {
    id: 'crimsonArena',
    label: 'حلبة التحدي 🔥',
    gradientInner: '#7a1222',
    gradientOuter: '#140307',
    gradientStop: 0.72,
    swatchColor: '#5c0e1a',
  },
  {
    id: 'mintEditorial',
    label: 'النعناعي العصري 🌿',
    gradientInner: '#e6f7ee',
    gradientOuter: '#b4dfc9',
    gradientStop: 0.86,
    swatchColor: '#d2efe0',
  },
  {
    id: 'islamicAndalusian',
    label: 'أندلسي وفوانيس 🕌',
    src: withBasePath('src/assets/images/backdrop_islamic_vert_1795621389166.jpg'),
    wideSrc: withBasePath('src/assets/images/backdrop_islamic_wide_1795621389546.jpg'),
    swatchColor: '#0e3a38',
  },
  {
    id: 'cosmicSpace',
    label: 'مجرة الفضاء العميق 🌌',
    src: withBasePath('src/assets/images/backdrop_space_vert_1795621389909.jpg'),
    wideSrc: withBasePath('src/assets/images/backdrop_space_wide_1795621390941.jpg'),
    swatchColor: '#0c1330',
  },
  {
    id: 'stadiumArena',
    label: 'ملعب الأبطال ⚽',
    src: withBasePath('src/assets/images/backdrop_stadium_vert_1795621390645.jpg'),
    wideSrc: withBasePath('src/assets/images/backdrop_stadium_wide_1795621390744.jpg'),
    swatchColor: '#0d2638',
  },
  {
    id: 'ancientHistory',
    label: 'كنوز التاريخ 📜',
    src: withBasePath('src/assets/images/backdrop_history_vert_1795621392312.jpg'),
    wideSrc: withBasePath('src/assets/images/backdrop_history_wide_1795621392014.jpg'),
    swatchColor: '#3b2814',
  },
  {
    id: 'emerald',
    label: 'الزمرد الذهبي',
    src: withBasePath('src/assets/images/template_emerald_studio_1795289851480.jpg'),
    swatchColor: '#10b981',
  },
  {
    id: 'navy',
    label: 'الأزرق الليلي',
    src: withBasePath('src/assets/images/template_navy_classic_1795289852308.jpg'),
    swatchColor: '#1e3a8a',
  },
  {
    id: 'obsidian',
    label: 'البرونز الداكن',
    src: withBasePath('src/assets/images/template_warm_obsidian_1795289851537.jpg'),
    swatchColor: '#78350f',
  },
];

export const DEFAULT_PRIZE_LADDER: string[] = [
  '100$',
  '200$',
  '300$',
  '500$',
  '1,000$',
  '2,000$',
  '4,000$',
  '8,000$',
  '16,000$',
  '32,000$',
  '64,000$',
  '125,000$',
  '250,000$',
  '500,000$',
  '1,000,000$',
];

export function getSlidePrizeTiers(slideCount: number, customAmounts?: string[]): string[] {
  const count = Math.max(1, slideCount);
  const raw = Array.isArray(customAmounts)
    ? customAmounts.map((s) => s.trim()).filter(Boolean)
    : [];
  const source = raw.length > 0 ? raw : DEFAULT_PRIZE_LADDER;

  if (count === source.length) {
    return source;
  }
  if (count === 1) {
    return [source[source.length - 1]];
  }
  if (count < source.length) {
    const picked: string[] = [];
    for (let i = 0; i < count; i++) {
      const idx =
        i === count - 1
          ? source.length - 1
          : Math.round((i / (count - 1)) * (source.length - 1));
      picked.push(source[idx]);
    }
    return picked;
  }
  const expanded: string[] = [];
  for (let i = 0; i < count; i++) {
    expanded.push(source[Math.min(i, source.length - 1)]);
  }
  return expanded;
}

export const CHANNEL_THEME_ORDER: ('channelSand' | 'channelNavy' | 'channelEmerald' | 'channelMath')[] = [
  'channelSand',
  'channelNavy',
  'channelEmerald',
  'channelMath',
];

export const STUDIO_THEME_ORDER: PresetId[] = [
  'channelSand',
  'channelNavy',
  'channelEmerald',
  'channelMath',
  'millionaire',
  'tvShowGold',
  'neonCyber',
  'parchmentGold',
  'playfulKids',
  'royalPurple',
  'arcticCyan',
  'sunsetCinema',
  'ramadanLantern',
  'crimsonArena',
  'mintEditorial',
  'islamicAndalusian',
  'cosmicSpace',
  'stadiumArena',
  'ancientHistory',
];

export function getCanvasDimensions(template?: Pick<TemplateSettings, 'aspectRatio'>): {
  width: number;
  height: number;
} {
  if (template?.aspectRatio === '16:9') {
    return { width: 1920, height: 1080 };
  }
  return { width: 1080, height: 1920 };
}

export function applyChannelThemePreset(
  current: TemplateSettings,
  themeId: 'channelSand' | 'channelNavy' | 'channelEmerald' | 'channelMath'
): TemplateSettings {
  const baseReset: Partial<TemplateSettings> = {
    boxStyle: 'flat',
    borderStyle: 'solid',
    shadowIntensity: 1,
    glowIntensity: 0,
    showPrizeLadder: false,
  };
  if (themeId === 'channelMath') {
    return {
      ...current,
      ...baseReset,
      backgroundType: 'preset',
      presetId: 'channelMath',
      bgDimOpacity: 0.12,
      boxGloss: true,
      enhanceAppearance: true,
      questionTextColor: '#FFFFFF',
      questionBoxColor: '#102a22',
      questionBoxOpacity: 0.92,
      questionBorderColor: '#edd6a2',
      questionBorderWidth: 4,
      optionTextColor: '#FFFFFF',
      optionBoxColor: '#13352b',
      optionBoxOpacity: 0.94,
      optionBorderColor: '#edd6a2',
      optionBorderWidth: 4,
      optionLabelBgColor: '#edd6a2',
      optionLabelTextColor: '#0e241d',
      correctColor: '#00B050',
      wrongColor: '#DC2626',
      revealStyle: 'redWrongGreenCorrect',
      timerMatchBackground: true,
      timerBgColor: '#0f2820',
      timerColor: '#EDD6A2',
    };
  }
  if (themeId === 'channelNavy') {
    return {
      ...current,
      ...baseReset,
      backgroundType: 'preset',
      presetId: 'channelNavy',
      bgDimOpacity: 0,
      boxGloss: true,
      questionTextColor: '#FFFFFF',
      questionBoxColor: '#1f2a4d',
      questionBoxOpacity: 1,
      questionBorderColor: '#d4a73a',
      questionBorderWidth: 5,
      optionTextColor: '#FFFFFF',
      optionBoxColor: '#1f2a4d',
      optionBoxOpacity: 1,
      optionBorderColor: '#d4a73a',
      optionBorderWidth: 5,
      optionLabelBgColor: '#d4a73a',
      optionLabelTextColor: '#0b1230',
      correctColor: '#00B050',
      timerMatchBackground: true,
      timerBgColor: '#131d42',
      timerColor: '#FFFFFF',
    };
  }
  if (themeId === 'channelEmerald') {
    return {
      ...current,
      ...baseReset,
      backgroundType: 'preset',
      presetId: 'channelEmerald',
      bgDimOpacity: 0,
      boxGloss: true,
      questionTextColor: '#12342b',
      questionBoxColor: '#f3efd9',
      questionBoxOpacity: 1,
      questionBorderColor: '#c9a24a',
      questionBorderWidth: 5,
      optionTextColor: '#12342b',
      optionBoxColor: '#f3efd9',
      optionBoxOpacity: 1,
      optionBorderColor: '#c9a24a',
      optionBorderWidth: 5,
      optionLabelBgColor: '#c9a24a',
      optionLabelTextColor: '#12342b',
      correctColor: '#00B050',
      timerMatchBackground: true,
      timerBgColor: '#0e3b2f',
      timerColor: '#FFFFFF',
    };
  }
  return {
    ...current,
    ...baseReset,
    backgroundType: 'preset',
    presetId: 'channelSand',
    bgDimOpacity: 0,
    boxGloss: true,
    questionTextColor: '#000000',
    questionBoxColor: '#EDD6A2',
    questionBoxOpacity: 1,
    questionBorderColor: '#FFFFFF',
    questionBorderWidth: 5,
    optionTextColor: '#000000',
    optionBoxColor: '#EDD6A2',
    optionBoxOpacity: 1,
    optionBorderColor: '#FFFFFF',
    optionBorderWidth: 5,
    optionLabelBgColor: '#d4a73a',
    optionLabelTextColor: '#000000',
    correctColor: '#00B050',
    timerMatchBackground: true,
    timerBgColor: '#F2E3BA',
    timerColor: '#000000',
  };
}

export function applyStudioThemePreset(
  current: TemplateSettings,
  presetId: PresetId
): TemplateSettings {
  const next = applyStudioThemePresetInternal(current, presetId);
  return { ...next, freeLayoutMode: false };
}

function applyStudioThemePresetInternal(
  current: TemplateSettings,
  presetId: PresetId
): TemplateSettings {
  if (
    presetId === 'channelSand' ||
    presetId === 'channelNavy' ||
    presetId === 'channelEmerald' ||
    presetId === 'channelMath'
  ) {
    return applyChannelThemePreset(current, presetId);
  }

  if (presetId === 'millionaire') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'millionaire',
      bgDimOpacity: 0,
      bgMotion: 'particles',
      fontFamily: 'Cairo',
      boxStyle: 'millionaireHex',
      borderStyle: 'gradientGold',
      shadowIntensity: 1.2,
      glowIntensity: 0.45,
      boxGloss: true,
      enhanceAppearance: true,
      questionTextColor: '#FFFFFF',
      questionBoxColor: '#091a4a',
      questionBoxOpacity: 0.96,
      questionBorderColor: '#e5b84b',
      questionBorderWidth: 5,
      questionBorderRadius: 28,
      optionTextColor: '#FFFFFF',
      optionBoxColor: '#0b2059',
      optionBoxOpacity: 0.96,
      optionBorderColor: '#d4a73a',
      optionBorderWidth: 4,
      optionBorderRadius: 24,
      optionLabelStyle: 'arabic',
      optionLabelBgColor: '#d4a73a',
      optionLabelTextColor: '#050b24',
      correctColor: '#00B050',
      wrongColor: '#DC2626',
      revealStyle: 'highlightGlow',
      timerMatchBackground: true,
      timerBgColor: '#091a4a',
      timerColor: '#EDD6A2',
      showPrizeLadder: true,
      prizeLadderStyle: current.prizeLadderStyle || 'topStrip',
      prizeLadderTitle: current.prizeLadderTitle || 'الجائزة',
      prizeLadderAmounts:
        current.prizeLadderAmounts && current.prizeLadderAmounts.length > 0
          ? current.prizeLadderAmounts
          : [...DEFAULT_PRIZE_LADDER],
      highlightSpokenOption: true,
    };
  }

  if (presetId === 'tvShowGold') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'tvShowGold',
      bgDimOpacity: 0,
      bgMotion: 'zoomAndParticles',
      boxStyle: 'bevel3d',
      borderStyle: 'gradientGold',
      shadowIntensity: 1.25,
      glowIntensity: 0.35,
      boxGloss: true,
      enhanceAppearance: true,
      questionTextColor: '#FFFFFF',
      questionBoxColor: '#1e1b4b',
      questionBoxOpacity: 0.96,
      questionBorderColor: '#facc15',
      questionBorderWidth: 5,
      optionTextColor: '#FFFFFF',
      optionBoxColor: '#25215c',
      optionBoxOpacity: 0.96,
      optionBorderColor: '#eab308',
      optionBorderWidth: 4,
      optionLabelBgColor: '#facc15',
      optionLabelTextColor: '#1e1b4b',
      correctColor: '#10b981',
      wrongColor: '#ef4444',
      revealStyle: 'redWrongGreenCorrect',
      timerMatchBackground: true,
      timerBgColor: '#1e1b4b',
      timerColor: '#fde047',
      showPrizeLadder: false,
    };
  }

  if (presetId === 'neonCyber') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'neonCyber',
      bgDimOpacity: 0,
      bgMotion: 'particles',
      boxStyle: 'neon',
      borderStyle: 'gradientNeon',
      shadowIntensity: 1.1,
      glowIntensity: 0.85,
      boxGloss: false,
      enhanceAppearance: true,
      questionTextColor: '#F8FAFC',
      questionBoxColor: '#0b1024',
      questionBoxOpacity: 0.92,
      questionBorderColor: '#22d3ee',
      questionBorderWidth: 4,
      optionTextColor: '#F8FAFC',
      optionBoxColor: '#0e142d',
      optionBoxOpacity: 0.92,
      optionBorderColor: '#a855f7',
      optionBorderWidth: 4,
      optionLabelBgColor: '#22d3ee',
      optionLabelTextColor: '#050712',
      correctColor: '#10b981',
      wrongColor: '#f43f5e',
      revealStyle: 'redWrongGreenCorrect',
      timerMatchBackground: true,
      timerBgColor: '#0b1024',
      timerColor: '#22d3ee',
      showPrizeLadder: false,
    };
  }

  if (presetId === 'parchmentGold') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'parchmentGold',
      bgDimOpacity: 0,
      bgMotion: 'none',
      fontFamily: 'Amiri',
      boxStyle: 'inset',
      borderStyle: 'double',
      shadowIntensity: 0.9,
      glowIntensity: 0.1,
      boxGloss: false,
      enhanceAppearance: true,
      questionTextColor: '#2c1e0f',
      questionBoxColor: '#f7edd4',
      questionBoxOpacity: 0.96,
      questionBorderColor: '#b58428',
      questionBorderWidth: 5,
      optionTextColor: '#2c1e0f',
      optionBoxColor: '#f5e9cb',
      optionBoxOpacity: 0.96,
      optionBorderColor: '#b58428',
      optionBorderWidth: 4,
      optionLabelBgColor: '#b58428',
      optionLabelTextColor: '#FFFFFF',
      correctColor: '#15803d',
      wrongColor: '#b91c1c',
      revealStyle: 'dimOthers',
      timerMatchBackground: true,
      timerBgColor: '#ebd7a7',
      timerColor: '#2c1e0f',
      showPrizeLadder: false,
    };
  }

  if (presetId === 'playfulKids') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'playfulKids',
      bgDimOpacity: 0,
      bgMotion: 'particles',
      fontFamily: 'Cairo',
      boxStyle: 'bevel3d',
      borderStyle: 'solid',
      shadowIntensity: 1.2,
      glowIntensity: 0.25,
      boxGloss: true,
      enhanceAppearance: true,
      questionTextColor: '#0f172a',
      questionBoxColor: '#fef08a',
      questionBoxOpacity: 1,
      questionBorderColor: '#FFFFFF',
      questionBorderWidth: 6,
      optionTextColor: '#0f172a',
      optionBoxColor: '#ffffff',
      optionBoxOpacity: 0.98,
      optionBorderColor: '#38bdf8',
      optionBorderWidth: 5,
      optionLabelBgColor: '#f59e0b',
      optionLabelTextColor: '#FFFFFF',
      correctColor: '#16a34a',
      wrongColor: '#ef4444',
      revealStyle: 'scaleCheck',
      revealConfetti: true,
      timerMatchBackground: true,
      timerBgColor: '#1d4ed8',
      timerColor: '#FFFFFF',
      showPrizeLadder: false,
    };
  }

  if (presetId === 'royalPurple') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'royalPurple',
      bgDimOpacity: 0,
      bgMotion: 'particles',
      fontFamily: 'Cairo',
      boxStyle: 'pill3d',
      borderStyle: 'gradientGold',
      shadowIntensity: 1.2,
      glowIntensity: 0.35,
      boxGloss: true,
      enhanceAppearance: true,
      questionTextColor: '#FFFFFF',
      questionBoxColor: '#291059',
      questionBoxOpacity: 0.96,
      questionBorderColor: '#fbbf24',
      questionBorderWidth: 5,
      questionBorderRadius: 48,
      optionTextColor: '#FFFFFF',
      optionBoxColor: '#341670',
      optionBoxOpacity: 0.96,
      optionBorderColor: '#f59e0b',
      optionBorderWidth: 4,
      optionBorderRadius: 36,
      optionLabelBgColor: '#fbbf24',
      optionLabelTextColor: '#1e0b40',
      correctColor: '#10b981',
      wrongColor: '#f43f5e',
      revealStyle: 'redWrongGreenCorrect',
      timerMatchBackground: true,
      timerBgColor: '#291059',
      timerColor: '#fde68a',
      showPrizeLadder: false,
    };
  }

  if (presetId === 'arcticCyan') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'arcticCyan',
      bgDimOpacity: 0,
      bgMotion: 'slowZoom',
      fontFamily: 'Tajawal',
      boxStyle: 'glass',
      borderStyle: 'metallicSilver',
      shadowIntensity: 1.05,
      glowIntensity: 0.3,
      boxGloss: true,
      enhanceAppearance: true,
      questionTextColor: '#F0F9FF',
      questionBoxColor: '#0c3b5e',
      questionBoxOpacity: 0.85,
      questionBorderColor: '#7dd3fc',
      questionBorderWidth: 4,
      questionBorderRadius: 36,
      optionTextColor: '#F0F9FF',
      optionBoxColor: '#0f466e',
      optionBoxOpacity: 0.84,
      optionBorderColor: '#bae6fd',
      optionBorderWidth: 4,
      optionBorderRadius: 28,
      optionLabelBgColor: '#38bdf8',
      optionLabelTextColor: '#041422',
      correctColor: '#10b981',
      wrongColor: '#ef4444',
      revealStyle: 'scaleCheck',
      timerMatchBackground: true,
      timerBgColor: '#0c3b5e',
      timerColor: '#bae6fd',
      showPrizeLadder: false,
    };
  }

  if (presetId === 'sunsetCinema') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'sunsetCinema',
      bgDimOpacity: 0,
      bgMotion: 'zoomAndParticles',
      fontFamily: 'Cairo',
      boxStyle: 'broadcastBar',
      borderStyle: 'gradientSunset',
      shadowIntensity: 1.2,
      glowIntensity: 0.35,
      boxGloss: true,
      enhanceAppearance: true,
      questionTextColor: '#FFF7ED',
      questionBoxColor: '#3f1232',
      questionBoxOpacity: 0.94,
      questionBorderColor: '#fb7185',
      questionBorderWidth: 4,
      questionBorderRadius: 30,
      optionTextColor: '#FFF7ED',
      optionBoxColor: '#4c163b',
      optionBoxOpacity: 0.94,
      optionBorderColor: '#f59e0b',
      optionBorderWidth: 4,
      optionBorderRadius: 24,
      optionLabelBgColor: '#f97316',
      optionLabelTextColor: '#FFFFFF',
      correctColor: '#10b981',
      wrongColor: '#e11d48',
      revealStyle: 'redWrongGreenCorrect',
      timerMatchBackground: true,
      timerBgColor: '#3f1232',
      timerColor: '#fed7aa',
      showPrizeLadder: false,
    };
  }

  if (presetId === 'ramadanLantern') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'ramadanLantern',
      bgDimOpacity: 0,
      bgMotion: 'particles',
      fontFamily: 'Amiri',
      boxStyle: 'layeredCard',
      borderStyle: 'dashedGold',
      shadowIntensity: 1.15,
      glowIntensity: 0.25,
      boxGloss: false,
      enhanceAppearance: true,
      questionTextColor: '#FEF3C7',
      questionBoxColor: '#0e2d3b',
      questionBoxOpacity: 0.95,
      questionBorderColor: '#eab308',
      questionBorderWidth: 4,
      questionBorderRadius: 34,
      optionTextColor: '#FEF3C7',
      optionBoxColor: '#133a4b',
      optionBoxOpacity: 0.95,
      optionBorderColor: '#d4a73a',
      optionBorderWidth: 4,
      optionBorderRadius: 26,
      optionLabelBgColor: '#eab308',
      optionLabelTextColor: '#081d26',
      correctColor: '#10b981',
      wrongColor: '#ef4444',
      revealStyle: 'highlightGlow',
      timerMatchBackground: true,
      timerBgColor: '#0e2d3b',
      timerColor: '#FDE68A',
      showPrizeLadder: false,
    };
  }

  if (presetId === 'crimsonArena') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'crimsonArena',
      bgDimOpacity: 0,
      bgMotion: 'particles',
      fontFamily: 'Cairo',
      boxStyle: 'chamfer',
      borderStyle: 'cornerBrackets',
      shadowIntensity: 1.25,
      glowIntensity: 0.4,
      boxGloss: true,
      enhanceAppearance: true,
      questionTextColor: '#FFFFFF',
      questionBoxColor: '#2d0811',
      questionBoxOpacity: 0.95,
      questionBorderColor: '#f43f5e',
      questionBorderWidth: 4,
      questionBorderRadius: 18,
      optionTextColor: '#FFFFFF',
      optionBoxColor: '#3a0b16',
      optionBoxOpacity: 0.95,
      optionBorderColor: '#fb7185',
      optionBorderWidth: 4,
      optionBorderRadius: 16,
      optionLabelBgColor: '#f43f5e',
      optionLabelTextColor: '#FFFFFF',
      correctColor: '#16a34a',
      wrongColor: '#991b1b',
      revealStyle: 'scaleCheck',
      timerMatchBackground: true,
      timerBgColor: '#2d0811',
      timerColor: '#fecdd3',
      showPrizeLadder: false,
    };
  }

  if (presetId === 'mintEditorial') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'mintEditorial',
      bgDimOpacity: 0,
      bgMotion: 'none',
      fontFamily: 'Tajawal',
      boxStyle: 'ticket',
      borderStyle: 'solid',
      shadowIntensity: 0.85,
      glowIntensity: 0,
      boxGloss: false,
      enhanceAppearance: true,
      questionTextColor: '#064e3b',
      questionBoxColor: '#ffffff',
      questionBoxOpacity: 0.98,
      questionBorderColor: '#10b981',
      questionBorderWidth: 4,
      questionBorderRadius: 28,
      optionTextColor: '#064e3b',
      optionBoxColor: '#ffffff',
      optionBoxOpacity: 0.98,
      optionBorderColor: '#34d399',
      optionBorderWidth: 4,
      optionBorderRadius: 24,
      optionLabelBgColor: '#10b981',
      optionLabelTextColor: '#FFFFFF',
      correctColor: '#059669',
      wrongColor: '#e11d48',
      revealStyle: 'redWrongGreenCorrect',
      timerMatchBackground: true,
      timerBgColor: '#065f46',
      timerColor: '#064e3b',
      showPrizeLadder: false,
    };
  }

  if (presetId === 'islamicAndalusian') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'islamicAndalusian',
      bgDimOpacity: 0.22,
      bgMotion: 'zoomAndParticles',
      fontFamily: 'Amiri',
      boxStyle: 'layeredCard',
      borderStyle: 'gradientGold',
      shadowIntensity: 1.2,
      glowIntensity: 0.3,
      boxGloss: false,
      enhanceAppearance: true,
      questionTextColor: '#FEF3C7',
      questionBoxColor: '#0a2b29',
      questionBoxOpacity: 0.92,
      questionBorderColor: '#eab308',
      questionBorderWidth: 4,
      questionBorderRadius: 34,
      optionTextColor: '#FEF3C7',
      optionBoxColor: '#0e3633',
      optionBoxOpacity: 0.92,
      optionBorderColor: '#d4a73a',
      optionBorderWidth: 4,
      optionBorderRadius: 26,
      optionLabelBgColor: '#eab308',
      optionLabelTextColor: '#081e1c',
      correctColor: '#10b981',
      wrongColor: '#ef4444',
      revealStyle: 'highlightGlow',
      timerMatchBackground: true,
      timerBgColor: '#0a2b29',
      timerColor: '#FDE68A',
      showPrizeLadder: false,
    };
  }

  if (presetId === 'cosmicSpace') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'cosmicSpace',
      bgDimOpacity: 0.2,
      bgMotion: 'zoomAndParticles',
      fontFamily: 'Cairo',
      boxStyle: 'glass',
      borderStyle: 'gradientNeon',
      shadowIntensity: 1.2,
      glowIntensity: 0.55,
      boxGloss: true,
      enhanceAppearance: true,
      questionTextColor: '#F8FAFC',
      questionBoxColor: '#0c1538',
      questionBoxOpacity: 0.86,
      questionBorderColor: '#38bdf8',
      questionBorderWidth: 4,
      questionBorderRadius: 34,
      optionTextColor: '#F8FAFC',
      optionBoxColor: '#111d4a',
      optionBoxOpacity: 0.86,
      optionBorderColor: '#a855f7',
      optionBorderWidth: 4,
      optionBorderRadius: 26,
      optionLabelBgColor: '#38bdf8',
      optionLabelTextColor: '#050b24',
      correctColor: '#10b981',
      wrongColor: '#f43f5e',
      revealStyle: 'scaleCheck',
      timerMatchBackground: true,
      timerBgColor: '#0c1538',
      timerColor: '#7dd3fc',
      showPrizeLadder: false,
    };
  }

  if (presetId === 'stadiumArena') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'stadiumArena',
      bgDimOpacity: 0.24,
      bgMotion: 'zoomAndParticles',
      fontFamily: 'Cairo',
      boxStyle: 'chamfer',
      borderStyle: 'cornerBrackets',
      shadowIntensity: 1.25,
      glowIntensity: 0.4,
      boxGloss: true,
      enhanceAppearance: true,
      questionTextColor: '#FFFFFF',
      questionBoxColor: '#091f2c',
      questionBoxOpacity: 0.92,
      questionBorderColor: '#22c55e',
      questionBorderWidth: 4,
      questionBorderRadius: 20,
      optionTextColor: '#FFFFFF',
      optionBoxColor: '#0e2b3c',
      optionBoxOpacity: 0.92,
      optionBorderColor: '#38bdf8',
      optionBorderWidth: 4,
      optionBorderRadius: 18,
      optionLabelBgColor: '#22c55e',
      optionLabelTextColor: '#041410',
      correctColor: '#16a34a',
      wrongColor: '#ef4444',
      revealStyle: 'redWrongGreenCorrect',
      timerMatchBackground: true,
      timerBgColor: '#091f2c',
      timerColor: '#86efac',
      showPrizeLadder: false,
    };
  }

  if (presetId === 'ancientHistory') {
    return {
      ...current,
      backgroundType: 'preset',
      presetId: 'ancientHistory',
      bgDimOpacity: 0.22,
      bgMotion: 'slowZoom',
      fontFamily: 'Amiri',
      boxStyle: 'inset',
      borderStyle: 'double',
      shadowIntensity: 1.1,
      glowIntensity: 0.15,
      boxGloss: false,
      enhanceAppearance: true,
      questionTextColor: '#291a0a',
      questionBoxColor: '#f5e7c4',
      questionBoxOpacity: 0.95,
      questionBorderColor: '#a16207',
      questionBorderWidth: 5,
      questionBorderRadius: 28,
      optionTextColor: '#291a0a',
      optionBoxColor: '#f3e2b8',
      optionBoxOpacity: 0.95,
      optionBorderColor: '#a16207',
      optionBorderWidth: 4,
      optionBorderRadius: 24,
      optionLabelBgColor: '#a16207',
      optionLabelTextColor: '#FFFFFF',
      correctColor: '#15803d',
      wrongColor: '#b91c1c',
      revealStyle: 'dimOthers',
      timerMatchBackground: true,
      timerBgColor: '#3b2814',
      timerColor: '#FEF3C7',
      showPrizeLadder: false,
    };
  }

  const preset = PRESET_BACKDROPS.find((p) => p.id === presetId);
  return {
    ...current,
    backgroundType: 'preset',
    presetId,
    timerMatchBackground: true,
    timerBgColor: preset?.swatchColor ?? current.timerBgColor,
    timerColor: '#FFFFFF',
  };
}

export function applyThemeBackgroundOnly(
  current: TemplateSettings,
  presetId: PresetId
): TemplateSettings {
  const preset = PRESET_BACKDROPS.find((p) => p.id === presetId);
  return {
    ...current,
    backgroundType: 'preset',
    presetId,
    timerBgColor: current.timerMatchBackground
      ? preset?.swatchColor ?? current.timerBgColor
      : current.timerBgColor,
  };
}

export const DEFAULT_TEMPLATE: TemplateSettings = {
  aspectRatio: '9:16',

  backgroundType: 'preset',
  presetId: 'channelSand',
  solidBgColor: '#0c0c0c',
  bgDimOpacity: 0,

  fontFamily: 'Cairo',
  freeLayoutMode: false,
  themeApplyMode: 'bgOnly',

  showBadge: false,
  badgeX: 50,
  badgeY: 11,
  badgeBorderRadius: 33,
  badgeBgColor: '#d4a73a',
  badgeTextColor: '#000000',

  questionX: 50,
  questionY: 29,
  questionWidth: 78,
  questionHeightPct: 16,
  questionFontSize: 66,
  questionTextAlign: 'center',
  questionTextColor: '#000000',
  questionBoxColor: '#EDD6A2',
  questionBoxOpacity: 1,
  questionBorderColor: '#FFFFFF',
  questionBorderWidth: 5,
  questionBorderRadius: 48,
  questionAnim: 'pop',

  optionsLayout: 'channel2x2',
  optionsX: 50,
  optionsStartY: 51,
  optionsWidth: 94,
  optionsGap: 26,
  optionsColGap: 0,
  optionHeight: 146,
  optionFontSize: 50,
  optionLabelStyle: 'none',
  optionTextColor: '#000000',
  optionBoxColor: '#EDD6A2',
  optionBoxOpacity: 1,
  optionBorderColor: '#FFFFFF',
  optionBorderWidth: 5,
  optionBorderRadius: 32,
  optionLabelBgColor: '#d4a73a',
  optionLabelTextColor: '#000000',
  optionAnim: 'pop',

  boxGloss: true,
  enhanceAppearance: true,

  timerStyle: 'channelBox',
  timerPlacement: 'aboveOptions',
  timerX: 50,
  timerY: 43,
  timerVisibilityMode: 'afterOptionsBeforeAnswer',
  timerUrgentPulse: true,
  timerUrgentThreshold: 3,
  timerUrgentColor: '#EF4444',
  timerUnitSuffix: '',
  timerOpacity: 1,
  timerBorderColor: '',
  timerBorderWidth: -1,
  questionToOptionsGap: 0,
  optionsCenterGap: 24,
  timerColor: '#000000',
  timerBgColor: '#F2E3BA',
  timerMatchBackground: true,
  useTimerVideo: true,

  correctColor: '#00B050',
  wrongColor: '#DC2626',
  revealStyle: 'dimOthers',
  showExplanationOnReveal: false,
  explanationBgColor: '',
  explanationTextColor: '#FFFFFF',
  explanationOffsetY: 0,
  showSafeGuides: false,

  showEndCard: true,
  endCardText: 'شكراً لمشاهدتكم',
  endCtaText: '',
  autoFitText: false,

  brandLogoAnim: 'pulse',
  brandLogoSize: 108,
  brandLogoPosition: 'topRight',
  brandLogoX: 88,
  brandLogoY: 10,
  brandHandleText: '',
  brandOpacity: 0.92,
  showProgressCounter: false,

  boxStyle: 'flat',
  borderStyle: 'solid',
  shadowIntensity: 1,
  glowIntensity: 0,
  globalScale: 1,
  timerScale: 1,
  badgeScale: 1,
  bgMotion: 'none',
  revealConfetti: false,
  highlightSpokenOption: false,
  showIntroHook: false,
  introHookText: 'اختبر معلوماتك الآن!',
  introHookDuration: 1.2,
  introHookSfx: 'whoosh',
  showEndSubscribeCta: false,
  showPrizeLadder: false,
  prizeLadderStyle: 'topStrip',
  prizeLadderTitle: 'الجائزة',
  prizeLadderAmounts: [...DEFAULT_PRIZE_LADDER],
  slideTransition: 'fade',
  optionsAppearMode: 'stagger',
  optionTextAlign: 'auto',
  optionsRtlColumns: true,

  presenterEnabled: false,
  presenterStyle: 'stylized3d',
  presenterPlacement: 'cornerBottomRight',
  presenterScale: 100,
  presenterX: 84,
  presenterY: 79,
  presenterFrameShape: 'broadcastCard',
  presenterIntroFullscreen: true,
  presenterOutroFullscreen: true,
  presenterStudioMic: true,
  presenterName: 'مذيع الاستوديو',
  presenterMouthY: 31.2,
  presenterTalkIntensity: 70,
  presenterContinuousTalk: true,
  presenterLipSyncMode: 'audioAndReading',
  presenterExpressiveness: 100,
  presenterGender: 'male',
  presenterSkinTone: 'warmWheat',
  presenterHairColor: '#1c1816',
  presenterEyeColor: '#4b2f1c',
  presenterSuitColor: '#14284b',
  presenterTieColor: '#d4a73a',
  presenterBeard: 'trimmed',
  presenterGlasses: false,
  presenterCommands: {
    intro: 'auto',
    readingQuestion: 'auto',
    readingOptions: 'auto',
    thinking: 'auto',
    suspense: 'auto',
    reveal: 'auto',
    outro: 'auto',
  },

  introFlashTeaser: false,
  introFlashHookText: '92% يغلطون في السؤال الأخير! ⚠️',
  showLiveScoreboard: false,
  scoreBoardLabel: 'تحدي الذكاء',
  showDynamicCaptions: false,
  dynamicCaptionStyle: 'pillKaraoke',
  dynamicCaptionY: 85,
};

export const DEFAULT_TIMING: TimingSettings = {
  autoSyncWithAudio: true,
  audioEndGap: 0.15,
  autoDuckMusic: true,
  bgMusicDuckRatio: 0.22,
  introHold: 0,
  questionReadDelay: 0.75,
  optionStaggerDelay: 0.45,
  thinkingDuration: 5,
  suspenseDuration: 1.6,
  revealHoldDuration: 3.0,
  transitionGap: 0.35,
  escalatingSpeed: false,
  escalatingStepSeconds: 0.5,
  escalatingMinSeconds: 2.0,
};

export const DEFAULT_AUDIO: AudioSettings = {
  questionEnter: {
    sourceType: 'builtin',
    builtinId: 'softPop',
    volume: 0.75,
  },
  optionEnter: {
    sourceType: 'builtin',
    builtinId: 'softPop',
    volume: 0.8,
  },
  countdownTick: {
    sourceType: 'builtin',
    builtinId: 'channelTick',
    volume: 0.65,
  },
  suspense: {
    sourceType: 'builtin',
    builtinId: 'suspenseRiser',
    volume: 0.75,
  },
  correctReveal: {
    sourceType: 'builtin',
    builtinId: 'successFanfare',
    volume: 0.85,
  },
  bgMusic: {
    sourceType: 'builtin',
    builtinId: 'none',
    volume: 0.25,
  },
};

export const CHANNEL_SAMPLE_SLIDES: QuestionSlide[] = [
  {
    id: 'channel-slide-1',
    badgeText: 'السؤال 1',
    question: 'كم عدد أركان الإسلام؟',
    options: ['خمسة', 'ثلاثة', 'أربعة', 'ستة'],
    correctIndex: 0,
    explanationText: 'أركان الإسلام خمسة تبدأ بالشهادتين',
  },
  {
    id: 'channel-slide-2',
    badgeText: 'السؤال 2',
    question: 'ما هي أطول سورة في القرآن الكريم؟',
    options: ['آل عمران', 'البقرة', 'النساء', 'المائدة'],
    correctIndex: 1,
    explanationText: 'سورة البقرة أطول سور القرآن بـ 286 آية',
  },
  {
    id: 'channel-slide-3',
    badgeText: 'السؤال 3',
    question: 'في أي شهر يصوم المسلمون؟',
    options: ['شعبان', 'محرم', 'رمضان', 'رجب'],
    correctIndex: 2,
    explanationText: 'شهر رمضان المبارك هو الشهر التاسع في التقويم الهجري',
  },
  {
    id: 'channel-slide-4',
    badgeText: 'السؤال 4',
    question: 'كم عدد سور القرآن الكريم؟',
    options: ['100', '120', '99', '114'],
    correctIndex: 3,
    explanationText: 'عدد سور القرآن الكريم 114 سورة',
  },
];

export const DEFAULT_SLIDES: QuestionSlide[] = CHANNEL_SAMPLE_SLIDES.map((s) => ({
  ...s,
  options: [...s.options] as [string, string, string, string],
}));

function cloneDefaultAudio(): AudioSettings {
  return {
    questionEnter: { ...DEFAULT_AUDIO.questionEnter },
    optionEnter: { ...DEFAULT_AUDIO.optionEnter },
    countdownTick: { ...DEFAULT_AUDIO.countdownTick },
    suspense: { ...DEFAULT_AUDIO.suspense },
    correctReveal: { ...DEFAULT_AUDIO.correctReveal },
    bgMusic: { ...DEFAULT_AUDIO.bgMusic },
  };
}

export function createDefaultProject(): QuizProject {
  return {
    id: 'default-shorts-project',
    name: 'مشروع شورتس القناة',
    schemaVersion: 8,
    preferredAiVoice: 'Kore',
    slides: DEFAULT_SLIDES.map((s) => ({
      ...s,
      options: [...s.options] as [string, string, string, string],
    })),
    template: { ...DEFAULT_TEMPLATE },
    timing: { ...DEFAULT_TIMING },
    audio: cloneDefaultAudio(),
    updatedAt: Date.now(),
  };
}

export interface SlideSchedule {
  slideIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  thinkingDuration: number;
  tQuestionStart: number;
  tOptionStarts: [number, number, number, number];
  tThinkingStart: number;
  tTimerExitStart: number;
  tSuspenseStart: number;
  tRevealStart: number;
}

export const END_CARD_DURATION = 2.0;

export function getEffectiveThinkingDuration(
  timing: TimingSettings,
  slideIndex: number
): number {
  const base = Math.max(0, timing?.thinkingDuration ?? 5);
  if (base <= 0 || !timing?.escalatingSpeed || slideIndex <= 0) {
    return base;
  }
  const step = Math.max(0.25, Math.min(3, timing.escalatingStepSeconds ?? 0.5));
  const floor = Math.max(1.0, Math.min(base, timing.escalatingMinSeconds ?? 2.0));
  const computed = Math.max(floor, base - slideIndex * step);
  return Math.round(computed * 100) / 100;
}

export function getEndCardDuration(
  template?: Pick<
    TemplateSettings,
    'showEndCard' | 'endCardAudio' | 'presenterEnabled' | 'presenterOutroFullscreen'
  >,
  timing?: Pick<TimingSettings, 'autoSyncWithAudio' | 'audioEndGap'>
): number {
  if (!template?.showEndCard) return 0;
  const baseDur =
    template.presenterEnabled && template.presenterOutroFullscreen !== false ? 2.6 : END_CARD_DURATION;
  const auto = timing?.autoSyncWithAudio ?? true;
  const audioDur = template.endCardAudio?.duration ?? 0;
  if (auto && audioDur > 0) {
    const gap = Math.max(0, timing?.audioEndGap ?? 0.15);
    return Math.max(baseDur, audioDur + gap + 0.15);
  }
  return baseDur;
}

export function computeSlideSchedule(
  slide: QuestionSlide,
  slideIndex: number,
  startTime: number,
  timing: TimingSettings,
  audio: AudioSettings,
  template?: Pick<TemplateSettings, 'optionsAppearMode'>
): SlideSchedule {
  const auto = timing?.autoSyncWithAudio ?? true;
  const gap = Math.max(0, timing?.audioEndGap ?? 0.15);

  const tQuestionStart = Math.max(0, timing?.introHold ?? 0);

  const qSlot = audio?.questionEnter;
  const globalQDur =
    qSlot?.sourceType === 'custom' && qSlot.customDataUrl ? qSlot.duration ?? 0 : 0;
  const slideQDur = slide?.voiceover?.question?.duration ?? 0;
  const qDur = slideQDur > 0 ? slideQDur : globalQDur;
  const qDelay = auto && qDur > 0 ? Math.max(0.35, qDur + gap) : Math.max(0.2, timing?.questionReadDelay ?? 0.75);

  const tOpt0 = tQuestionStart + qDelay;

  const optSlot = audio?.optionEnter;
  const globalOptDur =
    optSlot?.sourceType === 'custom' && optSlot.customDataUrl ? optSlot.duration ?? 0 : 0;

  const optionCount =
    slide?.slideType === 'trueFalse' || slide?.slideType === 'versus'
      ? 2
      : slide?.slideType === 'clues' || slide?.slideType === 'multiple3'
        ? 3
        : 4;
  const appearMode = template?.optionsAppearMode || 'stagger';
  const defaultStagger = Math.max(0.15, timing?.optionStaggerDelay ?? 0.45);
  const tOptions: number[] = [tOpt0];
  let lastOptDuration = defaultStagger;

  const getOptStep = (idx: number): number => {
    const slideOptDur = slide?.voiceover?.options?.[idx]?.duration ?? 0;
    const optDur = slideOptDur > 0 ? slideOptDur : globalOptDur;
    return auto && optDur > 0 ? Math.max(0.25, optDur + gap) : defaultStagger;
  };

  if (appearMode === 'allAtOnce') {
    let maxStep = defaultStagger;
    for (let i = 0; i < optionCount; i++) {
      tOptions[i] = tOpt0;
      const s = getOptStep(i);
      if (s > maxStep) maxStep = s;
    }
    lastOptDuration = maxStep;
  } else if (appearMode === 'rowByRow' && optionCount >= 3) {
    const row0Step = Math.max(getOptStep(0), getOptStep(1));
    tOptions[0] = tOpt0;
    tOptions[1] = tOpt0;
    tOptions[2] = tOpt0 + row0Step;
    if (optionCount === 4) {
      const row1Step = Math.max(getOptStep(2), getOptStep(3));
      tOptions[3] = tOpt0 + row0Step;
      lastOptDuration = row1Step;
    } else {
      lastOptDuration = getOptStep(2);
    }
  } else {
    for (let i = 0; i < optionCount; i++) {
      const step = getOptStep(i);
      if (i < optionCount - 1) {
        tOptions.push(tOptions[i] + step);
      } else {
        lastOptDuration = step;
      }
    }
  }

  while (tOptions.length < 4) {
    tOptions.push(tOptions[tOptions.length - 1]);
  }

  const thinkingDur = getEffectiveThinkingDuration(timing, slideIndex);
  const tThinkingStart = tOptions[optionCount - 1] + lastOptDuration;
  const tTimerExitStart = tThinkingStart + thinkingDur;
  const tSuspenseStart = tTimerExitStart;

  const susSlot = audio?.suspense;
  const customSusDur =
    susSlot?.sourceType === 'custom' && susSlot.customDataUrl ? susSlot.duration ?? 0 : 0;
  const configuredSus = Math.max(0, timing?.suspenseDuration ?? 1.6);
  const suspenseDur =
    auto && customSusDur > 0 && configuredSus > 0
      ? Math.max(configuredSus, customSusDur + 0.05)
      : configuredSus;

  const tRevealStart = tSuspenseStart + suspenseDur;

  const revealSlot = audio?.correctReveal;
  const globalAnsDur =
    revealSlot?.sourceType === 'custom' && revealSlot.customDataUrl ? revealSlot.duration ?? 0 : 0;
  const slideAnsDur = slide?.voiceover?.answer?.duration ?? 0;
  const ansDur = slideAnsDur > 0 ? slideAnsDur : globalAnsDur;

  const baseRevealHold = Math.max(0.5, timing?.revealHoldDuration ?? 3.0);
  const revealHold =
    auto && ansDur > 0 ? Math.max(baseRevealHold, ansDur + gap) : baseRevealHold;

  const duration = tRevealStart + revealHold;

  return {
    slideIndex,
    startTime,
    endTime: startTime + duration,
    duration,
    thinkingDuration: thinkingDur,
    tQuestionStart,
    tOptionStarts: [tOptions[0], tOptions[1], tOptions[2], tOptions[3]],
    tThinkingStart,
    tTimerExitStart,
    tSuspenseStart,
    tRevealStart,
  };
}

export function getIntroHookDuration(
  template?: Pick<TemplateSettings, 'showIntroHook' | 'introHookDuration' | 'introHookAudio'>,
  timing?: Pick<TimingSettings, 'autoSyncWithAudio' | 'audioEndGap'>
): number {
  if (!template?.showIntroHook) return 0;
  const rawDur = Number(template.introHookDuration ?? 1.2);
  const baseDur = Math.max(0.5, Math.min(30.0, Number.isFinite(rawDur) ? rawDur : 1.2));
  const auto = timing?.autoSyncWithAudio ?? true;
  const audioDur = template.introHookAudio?.duration ?? 0;
  if (auto && audioDur > 0) {
    const gap = Math.max(0, timing?.audioEndGap ?? 0.15);
    return Math.max(baseDur, audioDur + gap);
  }
  return baseDur;
}

export function computeProjectTimeline(
  slides: QuestionSlide[],
  timing: TimingSettings,
  audio: AudioSettings,
  template?: TemplateSettings
): SlideSchedule[] {
  const schedules: SlideSchedule[] = [];
  let cursor = getIntroHookDuration(template, timing);
  const gap = Math.max(0, timing?.transitionGap ?? 0.35);
  for (let i = 0; i < slides.length; i++) {
    const sched = computeSlideSchedule(slides[i], i, cursor, timing, audio, template);
    schedules.push(sched);
    cursor = sched.endTime + (i < slides.length - 1 ? gap : 0);
  }
  return schedules;
}

export function getSlidesContentDuration(
  slides: QuestionSlide[],
  timing: TimingSettings,
  audio: AudioSettings,
  template?: TemplateSettings
): number {
  const schedules = computeProjectTimeline(slides, timing, audio, template);
  if (schedules.length === 0) return 0;
  return schedules[schedules.length - 1].endTime;
}

export function getTotalDuration(
  slides: QuestionSlide[],
  timing: TimingSettings,
  audio: AudioSettings,
  template?: TemplateSettings
): number {
  const contentDur = getSlidesContentDuration(slides, timing, audio, template);
  if (contentDur <= 0) return 0;
  return contentDur + getEndCardDuration(template, timing);
}

export interface ChannelStarterKit {
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  accentColor: string;
  presetId: PresetId;
  templatePatch: Partial<TemplateSettings>;
  timingPatch: Partial<TimingSettings>;
}

export const CHANNEL_STARTER_KITS: ChannelStarterKit[] = [
  {
    id: 'islamicHeritage',
    title: 'هوية القناة الإسلامية التراثية',
    subtitle: 'خط أميري، كابشن أنيق، مؤقت كلاسيكي ومدة تفكير مريحة',
    emoji: '🕌',
    accentColor: '#eab308',
    presetId: 'islamicAndalusian',
    templatePatch: {
      fontFamily: 'Amiri',
      boxStyle: 'layeredCard',
      borderStyle: 'gradientGold',
      timerStyle: 'hexBadge',
      showProgressCounter: true,
      showEndSubscribeCta: true,
      endCardText: 'بارك الله فيكم.. شاركونا نتيجتكم في التعليقات',
      showDynamicCaptions: true,
      dynamicCaptionStyle: 'cleanGlass',
      dynamicCaptionY: 85,
      revealConfetti: false,
    },
    timingPatch: {
      thinkingDuration: 5,
      suspenseDuration: 1.5,
      revealHoldDuration: 3.2,
    },
  },
  {
    id: 'fastViralChallenge',
    title: 'تحدي شورتس سريع وحماسي',
    subtitle: 'نيون، مؤقت يتسارع، كابشن أصفر بارز ومذيع تفاعلي',
    emoji: '⚡',
    accentColor: '#22d3ee',
    presetId: 'neonCyber',
    templatePatch: {
      fontFamily: 'Cairo',
      boxStyle: 'neon',
      borderStyle: 'gradientNeon',
      timerStyle: 'neonRing',
      showProgressCounter: true,
      showLiveScoreboard: true,
      scoreBoardLabel: 'تحدي الثواني',
      introFlashTeaser: true,
      introFlashHookText: '90% يخطئون في السؤال الأخير! 🔥',
      showEndSubscribeCta: true,
      showDynamicCaptions: true,
      dynamicCaptionStyle: 'boldYellow',
      dynamicCaptionY: 85,
      revealConfetti: true,
      presenterEnabled: true,
      presenterPlacement: 'cornerBottomRight',
      presenterScale: 88,
    },
    timingPatch: {
      thinkingDuration: 4,
      escalatingSpeed: true,
      escalatingStepSeconds: 0.5,
      escalatingMinSeconds: 2,
      suspenseDuration: 1.1,
      revealHoldDuration: 2.6,
    },
  },
  {
    id: 'mathBoardAcademy',
    title: 'أكاديمية الرياضيات والألغاز',
    subtitle: 'سبورة خضراء، كابشن كاريوكي، إبراز الخيار وتوضيح الحل',
    emoji: '🧮',
    accentColor: '#EDD6A2',
    presetId: 'channelMath',
    templatePatch: {
      fontFamily: 'Cairo',
      timerStyle: 'circle',
      showExplanationOnReveal: true,
      showProgressCounter: true,
      showDynamicCaptions: true,
      dynamicCaptionStyle: 'pillKaraoke',
      dynamicCaptionY: 86,
      showEndSubscribeCta: true,
      endCardText: 'اكتب نتيجتك من 4 في التعليقات!',
    },
    timingPatch: {
      thinkingDuration: 6,
      suspenseDuration: 1.2,
      revealHoldDuration: 3.8,
    },
  },
  {
    id: 'millionaireShow',
    title: 'برنامج المسابقات الذهبي',
    subtitle: 'سلم جوائز، بطاقات سداسية، مؤقت ذهبي وتشويق تلفزيوني',
    emoji: '💎',
    accentColor: '#facc15',
    presetId: 'millionaire',
    templatePatch: {
      fontFamily: 'Cairo',
      showPrizeLadder: true,
      prizeLadderStyle: 'topStrip',
      timerStyle: 'pillCountdown',
      highlightSpokenOption: true,
      showDynamicCaptions: true,
      dynamicCaptionStyle: 'pillKaraoke',
      dynamicCaptionY: 86,
      revealConfetti: true,
      showEndSubscribeCta: true,
    },
    timingPatch: {
      thinkingDuration: 5,
      suspenseDuration: 2.0,
      revealHoldDuration: 3.2,
    },
  },
];

export function applyChannelStarterKit(project: QuizProject, kitId: string): QuizProject {
  const kit = CHANNEL_STARTER_KITS.find((k) => k.id === kitId);
  if (!kit) return project;
  const themed = applyStudioThemePreset(project.template, kit.presetId);
  return {
    ...project,
    template: {
      ...themed,
      ...kit.templatePatch,
    },
    timing: {
      ...project.timing,
      ...kit.timingPatch,
    },
    updatedAt: Date.now(),
  };
}
