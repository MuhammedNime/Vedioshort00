import React, { useRef } from 'react';
import {
  ImagePlus,
  RefreshCw,
  Scissors,
  Trash2,
  UserCheck,
  Volume2,
} from 'lucide-react';
import { readFileAsDataUrl } from '../storage/projectStore';
import {
  AiPresenterBgMode,
  AiPresenterOverlay,
  AiPresenterScope,
  PresenterFrameShape,
  PresenterPlacement,
  QuestionSlide,
} from '../types/quiz';

interface AiPresenterEditorControlsProps {
  aiPresenter: AiPresenterOverlay;
  slides: QuestionSlide[];
  onChange: (next: AiPresenterOverlay, immediate?: boolean) => void;
  onOpenStudioForReplace: () => void;
  onDelete: () => void;
}

export const AiPresenterEditorControls: React.FC<AiPresenterEditorControlsProps> = ({
  aiPresenter,
  slides,
  onChange,
  onOpenStudioForReplace,
  onDelete,
}) => {
  const customBgInputRef = useRef<HTMLInputElement | null>(null);

  const patch = (partial: Partial<AiPresenterOverlay>, immediate = true) => {
    onChange({ ...aiPresenter, ...partial }, immediate);
  };

  const natDur = Math.max(0.5, aiPresenter.naturalDuration || 5);
  const trimStart = Math.max(0, Math.min(natDur - 0.2, aiPresenter.trimStart || 0));
  const trimEnd = Math.max(trimStart + 0.2, Math.min(natDur, aiPresenter.trimEnd || natDur));

  const handleUploadCustomBg = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      patch({ bgMode: 'customImage', customBgDataUrl: dataUrl });
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3 rounded-xl bg-[var(--surface)] border border-[#00B050]/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#00B050]/15 border border-[#00B050]/35 flex items-center justify-center text-[#00B050] shrink-0">
            <UserCheck className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-[var(--ptxt)] truncate">
              {aiPresenter.replicaName || 'الراوي البشري الحقيقي'}
            </div>
            <div className="text-[10px] text-[var(--pmuted)] font-mono-nums">
              {aiPresenter.naturalDuration.toFixed(1)}ث ·{' '}
              {aiPresenter.mimeType === 'video/webm' ? 'WebM شفاف' : 'MP4'}
            </div>
          </div>
        </div>

        <label className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--ptxt)] cursor-pointer shrink-0">
          <span>مفعّل</span>
          <input
            type="checkbox"
            checked={aiPresenter.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
          />
        </label>
      </div>

      {/* Placement & Scope */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--pmuted)] font-semibold">أين يظهر الراوي؟</span>
          <select
            value={aiPresenter.scope}
            onChange={(e) => patch({ scope: e.target.value as AiPresenterScope })}
            className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
          >
            <option value="fullTimeline">طوال الفيديو (مستمر)</option>
            <option value="intro">في المقدمة فقط</option>
            <option value="slide">في سؤال محدد فقط</option>
            <option value="allSlides">في بداية كل سؤال</option>
            <option value="outro">في الخاتمة فقط</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--pmuted)] font-semibold">الموضع على الشاشة</span>
          <select
            value={aiPresenter.placement}
            onChange={(e) => patch({ placement: e.target.value as PresenterPlacement })}
            className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
          >
            <option value="cornerBottomRight">أسفل اليمين</option>
            <option value="cornerBottomLeft">أسفل اليسار</option>
            <option value="topRight">أعلى اليمين</option>
            <option value="topLeft">أعلى اليسار</option>
            <option value="sideStage">جانبي</option>
            <option value="floating">موضع حر (اسحبه بالمعاينة)</option>
          </select>
        </label>
      </div>

      {aiPresenter.scope === 'slide' && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--pmuted)] font-semibold">اختر السؤال</span>
          <select
            value={aiPresenter.targetSlideIndex ?? 0}
            onChange={(e) => patch({ targetSlideIndex: parseInt(e.target.value, 10) || 0 })}
            className="px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)]"
          >
            {slides.map((s, idx) => (
              <option key={s.id} value={idx}>
                {idx + 1}. {s.question.slice(0, 40)}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Scale & Free X/Y */}
      <label className="flex flex-col gap-1">
        <div className="flex justify-between text-[11px] text-[var(--ptxt)]">
          <span>حجم الراوي</span>
          <span className="font-mono-nums font-bold">{Math.round(aiPresenter.scale)}%</span>
        </div>
        <input
          type="range"
          min={45}
          max={210}
          step={5}
          value={aiPresenter.scale}
          onChange={(e) => patch({ scale: parseInt(e.target.value, 10) }, false)}
        />
      </label>

      {aiPresenter.placement === 'floating' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-[10px] text-[var(--ptxt)]">
              <span>X أفقياً</span>
              <span className="font-mono-nums">{Math.round(aiPresenter.x)}%</span>
            </div>
            <input
              type="range"
              min={5}
              max={95}
              step={1}
              value={aiPresenter.x}
              onChange={(e) => patch({ x: parseFloat(e.target.value) }, false)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-[10px] text-[var(--ptxt)]">
              <span>Y عمودياً</span>
              <span className="font-mono-nums">{Math.round(aiPresenter.y)}%</span>
            </div>
            <input
              type="range"
              min={5}
              max={95}
              step={1}
              value={aiPresenter.y}
              onChange={(e) => patch({ y: parseFloat(e.target.value) }, false)}
            />
          </label>
        </div>
      )}

      {/* Frame Shape & Background */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-[var(--pmuted)] font-semibold">شكل الإطار</span>
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { id: 'cutout' as PresenterFrameShape, label: 'حر / بدون إطار' },
            { id: 'broadcastCard' as PresenterFrameShape, label: 'بطاقة تلفزيونية' },
            { id: 'circleCam' as PresenterFrameShape, label: 'دائري' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => patch({ frameShape: f.id })}
              className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer ${
                aiPresenter.frameShape === f.id
                  ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                  : 'bg-[var(--panel)] border-[var(--pline)] text-[var(--ptxt)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-[var(--pmuted)] font-semibold">خلفية الراوي داخل المشهد</span>
        <div className="grid grid-cols-5 gap-1">
          {[
            { id: 'original' as AiPresenterBgMode, label: 'أصلية' },
            { id: 'transparent' as AiPresenterBgMode, label: 'شفافة' },
            { id: 'white' as AiPresenterBgMode, label: 'بيضاء' },
            { id: 'color' as AiPresenterBgMode, label: 'ملونة' },
            { id: 'customImage' as AiPresenterBgMode, label: 'صورة' },
          ].map((bg) => (
            <button
              key={bg.id}
              type="button"
              onClick={() => {
                if (bg.id === 'customImage' && !aiPresenter.customBgDataUrl) {
                  customBgInputRef.current?.click();
                  return;
                }
                patch({ bgMode: bg.id });
              }}
              className={`px-1.5 py-1.5 rounded-lg border text-[10px] font-bold cursor-pointer ${
                aiPresenter.bgMode === bg.id
                  ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                  : 'bg-[var(--panel)] border-[var(--pline)] text-[var(--ptxt)]'
              }`}
            >
              {bg.label}
            </button>
          ))}
        </div>

        {aiPresenter.bgMode === 'color' && (
          <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
            <span className="text-[11px] text-[var(--ptxt)]">اختر لون الخلفية</span>
            <input
              type="color"
              value={aiPresenter.bgColor || '#0f172a'}
              onChange={(e) => patch({ bgColor: e.target.value })}
              className="w-8 h-6 rounded border-0 cursor-pointer"
            />
          </label>
        )}

        {aiPresenter.bgMode === 'customImage' && (
          <button
            type="button"
            onClick={() => customBgInputRef.current?.click()}
            className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] font-bold text-[var(--ptxt)] cursor-pointer"
          >
            <ImagePlus className="w-3.5 h-3.5 text-[#00B050]" />
            <span>{aiPresenter.customBgDataUrl ? 'تغيير صورة الخلفية' : 'رفع صورة خلفية'}</span>
          </button>
        )}
        <input
          ref={customBgInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUploadCustomBg}
        />
      </div>

      {/* Trim & Duration Controls */}
      <div className="flex flex-col gap-2 p-2.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
        <div className="flex items-center justify-between text-[11px] font-bold text-[var(--ptxt)]">
          <span className="flex items-center gap-1">
            <Scissors className="w-3.5 h-3.5 text-[#00B050]" />
            <span>قص المقطع والتحكم بالمدة</span>
          </span>
          <span className="font-mono-nums text-[10px] text-[var(--pmuted)]">
            {(trimEnd - trimStart).toFixed(1)}ث فعلياً
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <div className="flex justify-between text-[10px] text-[var(--pmuted)]">
              <span>بداية القص</span>
              <span className="font-mono-nums">{trimStart.toFixed(1)}ث</span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, trimEnd - 0.3)}
              step={0.1}
              value={trimStart}
              onChange={(e) => patch({ trimStart: parseFloat(e.target.value) }, false)}
            />
          </label>

          <label className="flex flex-col gap-0.5">
            <div className="flex justify-between text-[10px] text-[var(--pmuted)]">
              <span>نهاية القص</span>
              <span className="font-mono-nums">{trimEnd.toFixed(1)}ث</span>
            </div>
            <input
              type="range"
              min={Math.min(natDur, trimStart + 0.3)}
              max={natDur}
              step={0.1}
              value={trimEnd}
              onChange={(e) => patch({ trimEnd: parseFloat(e.target.value) }, false)}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <div className="flex justify-between text-[10px] text-[var(--pmuted)]">
              <span>تأخير البداية</span>
              <span className="font-mono-nums">{aiPresenter.startOffset.toFixed(1)}ث</span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              step={0.1}
              value={aiPresenter.startOffset}
              onChange={(e) => patch({ startOffset: parseFloat(e.target.value) }, false)}
            />
          </label>

          <label className="flex flex-col gap-0.5">
            <div className="flex justify-between text-[10px] text-[var(--pmuted)]">
              <span>مدة الظهور القصوى</span>
              <span className="font-mono-nums">
                {aiPresenter.displayDuration > 0 ? `${aiPresenter.displayDuration.toFixed(1)}ث` : 'تلقائي'}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.ceil(natDur)}
              step={0.5}
              value={aiPresenter.displayDuration}
              onChange={(e) => patch({ displayDuration: parseFloat(e.target.value) }, false)}
            />
          </label>
        </div>

        <label className="flex flex-col gap-0.5">
          <div className="flex justify-between text-[10px] text-[var(--pmuted)]">
            <span className="flex items-center gap-1">
              <Volume2 className="w-3 h-3 text-[#00B050]" />
              <span>مستوى صوت الراوي</span>
            </span>
            <span className="font-mono-nums">{Math.round((aiPresenter.volume ?? 1) * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1.4}
            step={0.05}
            value={aiPresenter.volume ?? 1}
            onChange={(e) => patch({ volume: parseFloat(e.target.value) }, false)}
          />
        </label>
      </div>

      {/* Intro/Outro hero & badge toggles */}
      <div className="flex flex-col gap-1.5 text-[11px]">
        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="text-[var(--ptxt)] font-semibold">ظهور بملء الإطار في المقدمة (إن وُجدت)</span>
          <input
            type="checkbox"
            checked={aiPresenter.fullscreenInIntro !== false}
            onChange={(e) => patch({ fullscreenInIntro: e.target.checked })}
            className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
          />
        </label>
        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="text-[var(--ptxt)] font-semibold">ظهور بملء الإطار في الخاتمة (إن وُجدت)</span>
          <input
            type="checkbox"
            checked={aiPresenter.fullscreenInOutro !== false}
            onChange={(e) => patch({ fullscreenInOutro: e.target.checked })}
            className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
          />
        </label>
      </div>

      {/* Action Buttons: Replace / Delete */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          onClick={onOpenStudioForReplace}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#00B050]/14 border border-[#00B050]/45 hover:border-[#00B050] text-xs font-bold text-[#00B050] dark:text-[#6ee7b7] cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>استبدال / توليد جديد</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/35 hover:border-red-500 text-xs font-bold text-red-400 cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>حذف الراوي</span>
        </button>
      </div>
    </div>
  );
};
