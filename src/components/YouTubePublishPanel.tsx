import React, { useState } from 'react';
import {
  CalendarClock,
  Check,
  Copy,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Loader2,
  LogOut,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Youtube,
} from 'lucide-react';
import { YoutubePublishKit, generateYoutubePublishKit } from '../services/aiClient';
import {
  YouTubeChannelInfo,
  YouTubePlaylistItem,
  YouTubePrivacyStatus,
  getWebLoginBaseUrl,
  getYouTubeNativeMode,
  launchWebLinkLoginForApk,
} from '../services/youtubeClient';
import { QuizProject } from '../types/quiz';

interface GoogleSignInButtonProps {
  disabled?: boolean;
  loading?: boolean;
  label?: string;
  onClick: () => void;
}

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  disabled = false,
  loading = false,
  label = 'تسجيل الدخول بحساب Google',
  onClick,
}) => (
  <button
    type="button"
    disabled={disabled || loading}
    onClick={onClick}
    className="flex items-center justify-center gap-3 w-full py-2.5 px-4 rounded-xl bg-white hover:bg-[#f8f9fa] active:bg-[#eef1f5] text-[#1f1f1f] border border-[#747775]/45 disabled:opacity-60 text-xs sm:text-sm font-bold shadow-sm transition-colors cursor-pointer"
  >
    {loading ? (
      <Loader2 className="w-4 h-4 animate-spin text-[#1f1f1f] shrink-0" />
    ) : (
      <svg
        version="1.1"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 48 48"
        className="w-[18px] h-[18px] shrink-0 block"
        aria-hidden="true"
      >
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
        <path fill="none" d="M0 0h48v48H0z" />
      </svg>
    )}
    <span className="whitespace-nowrap">
      {loading ? 'جارٍ فتح نافذة اختيار الحساب...' : label}
    </span>
  </button>
);

interface YouTubePublishPanelProps {
  project: QuizProject;
  publishKit: YoutubePublishKit;
  tagsInput: string;
  onUpdatePublishKit: (updater: (prev: YoutubePublishKit) => YoutubePublishKit) => void;
  onUpdateTagsInput: (val: string) => void;
  onResetDefaultKit: () => void;
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
  onConnectYouTube: () => void;
  onDisconnectYouTube: () => void;
  onOpenExport: () => void;
  customThumbnailPreviewUrl?: string | null;
  onOpenThumbnailStudio?: () => void;
}

export const YouTubePublishPanel: React.FC<YouTubePublishPanelProps> = ({
  project,
  publishKit,
  tagsInput,
  onUpdatePublishKit,
  onUpdateTagsInput,
  onResetDefaultKit,
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
  onOpenExport,
  customThumbnailPreviewUrl,
  onOpenThumbnailStudio,
}) => {
  const [isGeneratingKit, setIsGeneratingKit] = useState(false);
  const [kitError, setKitError] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [webLoginUrl, setWebLoginUrl] = useState(() => getWebLoginBaseUrl());
  const [showWebUrlEdit, setShowWebUrlEdit] = useState(false);
  const [webLinkError, setWebLinkError] = useState('');

  const handleGenerateKit = async () => {
    if (isGeneratingKit) return;
    setIsGeneratingKit(true);
    setKitError('');
    try {
      const generated = await generateYoutubePublishKit(
        project.slides,
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
      setKitError(
        err instanceof Error ? err.message : 'تعذر توليد حزمة النشر بالذكاء الاصطناعي.'
      );
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

  return (
    <div className="flex flex-col gap-4 pb-6">
      {/* 1. Google / YouTube Channel Account Connection */}
      <section className="rounded-xl bg-[var(--surface)] border border-rose-500/35 p-3.5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Youtube className="w-4 h-4 text-rose-500 shrink-0" />
            <h2 className="text-xs sm:text-sm font-extrabold text-[var(--ptxt)]">
              حساب وقناة YouTube للرفع المباشر
            </h2>
          </div>
          {ytConnected && (
            <span className="text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7] whitespace-nowrap">
              متصل وجاهز
            </span>
          )}
        </div>

        {!ytConnected ? (
          getYouTubeNativeMode() === 'standalone-apk' ? (
            <div className="flex flex-col gap-2.5 p-2.5 rounded-xl bg-[var(--panel)] border border-[var(--pline)]">
              <p className="text-[11px] text-[var(--pmuted)] leading-relaxed">
                يمكنك تسجيل الدخول عبر{' '}
                <strong className="text-[var(--ptxt)]">رابط الموقع في المتصفح</strong>{' '}
                (تضغط الرابط فيفتح Chrome لتسجيل الدخول بحساب Google ثم يعود بك تلقائياً للتطبيق)، أو تصدير الفيديو ومشاركته لتطبيق يوتيوب مباشرة.
              </p>

              <button
                type="button"
                onClick={() => {
                  setWebLinkError('');
                  const ok = launchWebLinkLoginForApk(webLoginUrl);
                  if (!ok) {
                    setWebLinkError('يرجى التأكد من صحة رابط الموقع (يبدأ بـ https://).');
                  }
                }}
                className="flex items-center justify-center gap-2 w-full py-2.5 px-3 rounded-xl bg-white hover:bg-[#f8f9fa] text-[#1f1f1f] border border-[#747775]/45 text-xs font-extrabold shadow-sm transition-colors cursor-pointer"
              >
                <ExternalLink className="w-4 h-4 text-[#4285F4]" />
                <span>تسجيل الدخول عبر رابط الموقع (Chrome) والعودة للتطبيق</span>
              </button>

              <div className="flex items-center justify-between text-[10px] text-[var(--pmuted)]">
                <span className="truncate max-w-[210px]" dir="ltr">
                  {webLoginUrl}
                </span>
                <button
                  type="button"
                  onClick={() => setShowWebUrlEdit((v) => !v)}
                  className="text-[#00B050] font-bold hover:underline cursor-pointer shrink-0"
                >
                  {showWebUrlEdit ? 'إغلاق' : 'تعديل رابط الموقع'}
                </button>
              </div>

              {showWebUrlEdit && (
                <input
                  type="url"
                  dir="ltr"
                  value={webLoginUrl}
                  onChange={(e) => setWebLoginUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-[11px] text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                />
              )}

              {webLinkError && (
                <p className="text-[11px] text-rose-400">{webLinkError}</p>
              )}

              <button
                type="button"
                onClick={onOpenExport}
                className="flex items-center justify-center gap-2 w-full py-2.5 px-3 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold transition-colors cursor-pointer"
              >
                <Film className="w-4 h-4" />
                <span>تصدير الفيديو والحفظ في المعرض / النشر</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <p className="text-[11px] text-[var(--pmuted)] leading-relaxed">
                سجّل الدخول بأي حساب Google تريده (حسابك الشخصي أو حساب قناة أخرى). يمكنك اختيار الحساب وتبديل القناة في أي وقت.
              </p>
              <GoogleSignInButton
                loading={isConnectingYt}
                label="تسجيل الدخول بحساب Google / ربط قناة"
                onClick={onConnectYouTube}
              />
            </div>
          )
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2.5 p-2.5 rounded-xl bg-[var(--panel)] border border-[var(--pline)]">
              <div className="flex items-center gap-2.5 min-w-0">
                {ytChannel?.thumbnailUrl ? (
                  <img
                    src={ytChannel.thumbnailUrl}
                    alt={ytChannel.title}
                    className="w-9 h-9 rounded-full shrink-0 border border-[var(--pline)]"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-rose-500/15 border border-rose-500/35 flex items-center justify-center shrink-0">
                    <Youtube className="w-4 h-4 text-rose-500" />
                  </div>
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-extrabold text-[var(--ptxt)] truncate">
                    {ytChannel?.title || 'حساب Google متصل'}
                  </span>
                  {ytEmail && (
                    <span className="text-[11px] text-[var(--pmuted)] truncate" dir="ltr">
                      {ytEmail}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={isConnectingYt}
                  onClick={onConnectYouTube}
                  title="اختيار حساب Google أو قناة أخرى"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] text-[11px] font-bold text-[var(--ptxt)] transition-colors cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw className={`w-3 h-3 text-[#00B050] ${isConnectingYt ? 'animate-spin' : ''}`} />
                  <span>تبديل الحساب</span>
                </button>
                <button
                  type="button"
                  onClick={onDisconnectYouTube}
                  title="تسجيل الخروج"
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)] hover:border-rose-500/50 text-[11px] font-semibold text-[var(--pmuted)] hover:text-rose-500 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <LogOut className="w-3 h-3" />
                  <span>خروج</span>
                </button>
              </div>
            </div>

            {!ytChannel && (
              <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/35 text-[11px] text-amber-700 dark:text-amber-200 leading-relaxed">
                هذا الحساب متصل، لكن لا توجد عليه قناة YouTube مفعّلة بعد. أنشئ قناة على YouTube لهذا الحساب أو اضغط «تبديل الحساب» لاختيار حسابك الذي يحتوي على القناة.
              </div>
            )}
          </div>
        )}

        {ytAuthError && (
          <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/35 text-[11px] text-rose-600 dark:text-rose-300 leading-relaxed">
            {ytAuthError}
          </div>
        )}
      </section>

      {/* 2. AI YouTube Publishing Kit */}
      <section className="rounded-xl bg-[var(--surface)] border border-[var(--pline)] p-3.5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--gold)] shrink-0" />
            <h2 className="text-xs sm:text-sm font-extrabold text-[var(--ptxt)]">
              حزمة النشر بالذكاء الاصطناعي
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={isGeneratingKit}
              onClick={() => void handleGenerateKit()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-60 text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
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
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[var(--gold)] text-[11px] font-bold cursor-pointer whitespace-nowrap"
            >
              {copiedField === 'all' ? (
                <Check className="w-3.5 h-3.5 text-[#00B050]" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-[var(--gold)]" />
              )}
              <span>{copiedField === 'all' ? 'تم النسخ' : 'نسخ الكل'}</span>
            </button>
            <button
              type="button"
              onClick={onResetDefaultKit}
              title="إعادة التوليد التلقائي من أسئلة المشروع الحالية"
              className="p-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[var(--gold)] text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {kitError && (
          <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/35 text-[11px] text-rose-600 dark:text-rose-300">
            {kitError}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {/* Title */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[var(--pmuted)]">
                عنوان الفيديو ({publishKit.title.length}/100)
              </span>
              <button
                type="button"
                onClick={() => void copyText('title', publishKit.title)}
                className="text-[11px] text-[#00B050] hover:underline flex items-center gap-1 cursor-pointer"
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
              placeholder="مثال: اختبار معلومات عامة مستحيل تجيب كل الأسئلة #Shorts"
              className="w-full px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            />
          </div>

          {/* Description & Hashtags */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[var(--pmuted)]">
                الوصف والهاشتاغات (#Shorts)
              </span>
              <button
                type="button"
                onClick={() => void copyText('desc', publishKit.description)}
                className="text-[11px] text-[#00B050] hover:underline flex items-center gap-1 cursor-pointer"
              >
                {copiedField === 'desc' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedField === 'desc' ? 'نُسخ' : 'نسخ'}</span>
              </button>
            </div>
            <textarea
              rows={4}
              value={publishKit.description}
              onChange={(e) =>
                onUpdatePublishKit((p) => ({ ...p, description: e.target.value }))
              }
              className="w-full px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none resize-y leading-relaxed"
            />
          </div>

          {/* Keywords / Tags */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[var(--pmuted)]">
                الكلمات المفتاحية (Tags - مفصولة بفاصلة)
              </span>
              <button
                type="button"
                onClick={() => void copyText('tags', tagsInput)}
                className="text-[11px] text-[#00B050] hover:underline flex items-center gap-1 cursor-pointer"
              >
                {copiedField === 'tags' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedField === 'tags' ? 'نُسخ' : 'نسخ'}</span>
              </button>
            </div>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => onUpdateTagsInput(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            />
          </div>

          {/* Pinned Comment */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[var(--pmuted)]">
                التعليق التفاعلي الجاهز للتثبيت
              </span>
              <button
                type="button"
                onClick={() => void copyText('comment', publishKit.pinnedComment)}
                className="text-[11px] text-[#00B050] hover:underline flex items-center gap-1 cursor-pointer"
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
              className="w-full px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* 3. Direct Upload Preferences */}
      <section className="rounded-xl bg-[var(--surface)] border border-[var(--pline)] p-3.5 flex flex-col gap-3">
        <span className="text-xs font-extrabold text-[var(--ptxt)]">
          إعدادات النشر على القناة
        </span>

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
              className={`py-2 px-2 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer ${
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
              className="px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] text-[var(--ptxt)]"
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
              className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
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
      </section>

      {/* 4. Thumbnail & Export CTA */}
      {onOpenThumbnailStudio && (
        <div className="rounded-xl bg-[var(--surface)] border border-[var(--pline)] p-3 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            {customThumbnailPreviewUrl ? (
              <img
                src={customThumbnailPreviewUrl}
                alt="غلاف يوتيوب المخصص"
                className="w-16 h-10 rounded-lg object-cover border border-[#00B050]/60 shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-[var(--panel)] border border-[var(--pline)] flex items-center justify-center shrink-0">
                <ImageIcon className="w-5 h-5 text-[var(--gold)]" />
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-extrabold text-[var(--ptxt)] truncate">
                {customThumbnailPreviewUrl ? 'غلاف يوتيوب مخصص مُرفق ✅' : 'غلاف الفيديو (Thumbnail)'}
              </span>
              <span className="text-[10px] text-[var(--pmuted)] truncate">
                {customThumbnailPreviewUrl
                  ? 'سيُرفع تلقائياً كصورة غلاف للفيديو'
                  : 'صمّم غلافاً احترافياً لزيادة نسبة النقر'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenThumbnailStudio}
            className="px-3 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--gold)]/60 hover:border-[var(--gold)] text-[11px] font-extrabold text-[var(--gold)] shrink-0 cursor-pointer"
          >
            {customThumbnailPreviewUrl ? 'تعديل الغلاف' : 'تصميم الغلاف'}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onOpenExport}
        className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs sm:text-sm font-extrabold shadow-sm transition-colors cursor-pointer"
      >
        <Film className="w-4 h-4" />
        <span>تصدير الفيديو والرفع المباشر إلى YouTube</span>
      </button>
    </div>
  );
};
