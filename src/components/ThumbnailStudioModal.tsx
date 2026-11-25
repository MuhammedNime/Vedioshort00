import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, Image, Sparkles, X, Youtube } from 'lucide-react';
import {
  ThumbnailRenderConfig,
  exportCustomThumbnailBlob,
  renderQuizThumbnailCanvas,
} from '../canvas/thumbnailRenderer';
import { QuizProject } from '../types/quiz';
import { saveOrDownloadBlob } from '../utils/nativeDownload';

interface ThumbnailStudioModalProps {
  isOpen: boolean;
  project: QuizProject;
  activeSlideIndex: number;
  hasAttachedThumbnail: boolean;
  onClose: () => void;
  onAttachForYouTube: (blob: Blob, previewDataUrl: string) => void;
  onClearAttachedThumbnail: () => void;
}

const BADGE_PRESETS = [
  '90% يخطئون! 🤯',
  'تحدي العباقرة! 🧠',
  'اختبر معلوماتك 🕌',
  'هل تعرف الجواب؟ 🔥',
  'تحدي الأساطير 🏆',
];

export const ThumbnailStudioModal: React.FC<ThumbnailStudioModalProps> = ({
  isOpen,
  project,
  activeSlideIndex,
  hasAttachedThumbnail,
  onClose,
  onAttachForYouTube,
  onClearAttachedThumbnail,
}) => {
  const activeSlide = project.slides[activeSlideIndex] ?? project.slides[0];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [config, setConfig] = useState<ThumbnailRenderConfig>(() => ({
    aspectRatio: project.template.aspectRatio === '16:9' ? '16:9' : '16:9',
    headline: activeSlide?.question || 'اختبر ذكاءك في هذا التحدي!',
    subline:
      project.slides.length > 1
        ? `${project.slides.length} أسئلة سريعة — هل تحلها كلها؟`
        : 'اكتب إجابتك في التعليقات!',
    badgeText: 'تحدي الذكاء! 🧠',
    badgeBgColor: '#F59E0B',
    headlineColor: '#FFFFFF',
    includeSlideImage: Boolean(activeSlide?.imageDataUrl),
    blurSlideImage: Boolean(
      activeSlide?.imageChallengeMode && activeSlide.imageChallengeMode !== 'normal'
    ),
  }));

  const [statusNotice, setStatusNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setConfig((prev) => ({
      ...prev,
      headline: activeSlide?.question || prev.headline,
      includeSlideImage: Boolean(activeSlide?.imageDataUrl),
      blurSlideImage: Boolean(
        activeSlide?.imageChallengeMode && activeSlide.imageChallengeMode !== 'normal'
      ),
    }));
    setStatusNotice('');
  }, [isOpen, activeSlide?.id]);

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    let cancelled = false;
    void renderQuizThumbnailCanvas(canvasRef.current, project.template, activeSlide, config).catch(
      () => {
        if (!cancelled) {
          // ignore transient render error
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [isOpen, project.template, activeSlide, config]);

  if (!isOpen) return null;

  const handleDownloadPng = async () => {
    setBusy(true);
    setStatusNotice('');
    try {
      const out = await exportCustomThumbnailBlob(project.template, activeSlide, config, 'image/png');
      if (!out) return;
      await saveOrDownloadBlob(
        out.blob,
        `thumbnail-${config.aspectRatio === '16:9' ? '1280x720' : '1080x1920'}.png`,
        'image/png'
      );
      setStatusNotice('تم حفظ صورة الغلاف PNG على جهازك بنجاح!');
    } finally {
      setBusy(false);
    }
  };

  const handleAttachToYouTube = async () => {
    setBusy(true);
    setStatusNotice('');
    try {
      // YouTube thumbnail API uses max 2MB JPEG/PNG — JPEG 94% keeps high crispness under 350KB
      const out = await exportCustomThumbnailBlob(project.template, activeSlide, config, 'image/jpeg');
      if (!out) return;
      onAttachForYouTube(out.blob, out.dataUrl);
      setStatusNotice('تم اعتماد الغلاف وسيُرفع تلقائياً مع الفيديو على YouTube!');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4">
      <div className="w-full max-w-4xl max-h-[94dvh] rounded-2xl bg-[var(--panel)] border border-[var(--pline)] text-[var(--ptxt)] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-[var(--pline)] shrink-0">
          <div className="flex items-center gap-2">
            <Image className="w-5 h-5 text-[var(--gold)]" />
            <h3 className="text-sm sm:text-base font-extrabold">
              استوديو تصميم الغلاف المصغّر (YouTube Thumbnail)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="p-1.5 rounded-lg text-[var(--pmuted)] hover:text-[var(--ptxt)] hover:bg-[var(--surface)] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
          {/* Live Canvas Preview */}
          <div className="flex flex-col gap-2.5 items-center justify-center p-3 rounded-2xl bg-[var(--surface)] border border-[var(--pline)]">
            <div className="w-full flex items-center justify-between text-[11px] text-[var(--pmuted)]">
              <span>معاينة حية بدقة يوتيوب الأصلية</span>
              <span className="font-mono-nums font-bold text-[var(--gold)]">
                {config.aspectRatio === '16:9' ? '1280 × 720 px' : '1080 × 1920 px'}
              </span>
            </div>
            <div className="w-full flex items-center justify-center max-h-[420px] overflow-hidden rounded-xl bg-black/40 p-2">
              <canvas
                ref={canvasRef}
                className="max-w-full max-h-[380px] w-auto h-auto rounded-lg shadow-lg"
              />
            </div>

            {statusNotice && (
              <div className="w-full flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#00B050]/14 border border-[#00B050]/45 text-xs font-bold text-[#00B050] dark:text-[#6ee7b7]">
                <Check className="w-4 h-4 shrink-0" />
                <span>{statusNotice}</span>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <button
                type="button"
                onClick={() => setConfig((c) => ({ ...c, aspectRatio: '16:9' }))}
                className={`py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  config.aspectRatio === '16:9'
                    ? 'bg-[#00B050] text-white'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                غلاف عريض 16:9 (يوتيوب)
              </button>
              <button
                type="button"
                onClick={() => setConfig((c) => ({ ...c, aspectRatio: '9:16' }))}
                className={`py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  config.aspectRatio === '9:16'
                    ? 'bg-[#00B050] text-white'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                غلاف عمودي 9:16 (شورتس)
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-[var(--ptxt)]">الشارة التحفيزية (أعلى الغلاف)</span>
              <input
                type="text"
                value={config.badgeText}
                onChange={(e) => setConfig((c) => ({ ...c, badgeText: e.target.value }))}
                placeholder="اتركه فارغاً لإخفاء الشارة..."
                className="w-full px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
              />
              <div className="flex flex-wrap gap-1">
                {BADGE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setConfig((c) => ({ ...c, badgeText: preset }))}
                    className="px-2 py-0.5 rounded-md bg-[var(--surface)] border border-[var(--pline)] hover:border-[var(--gold)] text-[10px] font-bold text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-[var(--ptxt)]">العنوان العريض على الغلاف</span>
              <textarea
                rows={2}
                value={config.headline}
                onChange={(e) => setConfig((c) => ({ ...c, headline: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none resize-none"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-[var(--ptxt)]">سطر فرعي تشويقي (أسفل العنوان)</span>
              <input
                type="text"
                value={config.subline}
                onChange={(e) => setConfig((c) => ({ ...c, subline: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
              />
            </label>

            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <span className="text-xs font-bold">ألوان الغلاف (لون الشارة / لون النص)</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.badgeBgColor}
                  onChange={(e) => setConfig((c) => ({ ...c, badgeBgColor: e.target.value }))}
                  title="لون الشارة والإطار"
                  className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                />
                <input
                  type="color"
                  value={config.headlineColor}
                  onChange={(e) => setConfig((c) => ({ ...c, headlineColor: e.target.value }))}
                  title="لون النص الرئيسي"
                  className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                />
              </div>
            </div>

            {activeSlide?.imageDataUrl && (
              <div className="flex flex-col gap-1.5 px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
                <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.includeSlideImage}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, includeSlideImage: e.target.checked }))
                    }
                    className="w-4 h-4 accent-[#00B050]"
                  />
                  <span>تضمين صورة السؤال داخل الغلاف</span>
                </label>
                {config.includeSlideImage && (
                  <label className="flex items-center gap-2 text-[11px] text-[var(--pmuted)] cursor-pointer pr-6">
                    <input
                      type="checkbox"
                      checked={config.blurSlideImage}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, blurSlideImage: e.target.checked }))
                      }
                      className="w-3.5 h-3.5 accent-[#00B050]"
                    />
                    <span>تمويه الصورة بعلامة استفهام تشويقية (؟)</span>
                  </label>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleAttachToYouTube()}
                className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-50 text-white text-xs sm:text-sm font-extrabold cursor-pointer"
              >
                <Youtube className="w-4 h-4" />
                <span>اعتماد كغلاف للرفع المباشر على YouTube</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDownloadPng()}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[var(--gold)] hover:brightness-105 disabled:opacity-50 text-black text-xs font-extrabold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تنزيل الغلاف PNG</span>
                </button>
                {hasAttachedThumbnail ? (
                  <button
                    type="button"
                    onClick={() => {
                      onClearAttachedThumbnail();
                      setStatusNotice('تمت إزالة الغلاف المخصص عن الرفع.');
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-rose-500/12 border border-rose-500/40 text-rose-400 text-xs font-bold cursor-pointer"
                  >
                    <span>إلغاء اعتماد الغلاف</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setConfig((c) => ({
                        ...c,
                        badgeText: BADGE_PRESETS[Math.floor(Math.random() * BADGE_PRESETS.length)],
                      }))
                    }
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] text-xs font-bold cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[var(--gold)]" />
                    <span>تغيير عبارة الجذب</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
