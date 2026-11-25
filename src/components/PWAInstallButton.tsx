import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'inline' | 'menuItem';
  onAction?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'inline',
  onAction,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const baseClass =
    variant === 'menuItem'
      ? 'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-semibold text-[#00B050] dark:text-[#6ee7b7] hover:bg-[var(--surface)] transition-colors cursor-pointer whitespace-nowrap'
      : 'flex items-center gap-1 text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7] hover:underline cursor-pointer whitespace-nowrap';

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => {
          onAction?.();
          void install();
        }}
        className={baseClass}
        title="تثبيت التطبيق على الجهاز"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>تثبيت التطبيق</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={baseClass}
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>تثبيت على iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-[var(--panel)] border border-[var(--pline)] p-5 shadow-2xl text-[var(--ptxt)]">
              <h3 className="text-base font-bold">تثبيت التطبيق على iPhone / iPad</h3>
              <p className="mt-2 text-xs text-[var(--pmuted)] leading-relaxed">
                1. اضغط على زر <strong>المشاركة (Share)</strong> في شريط Safari.
                <br />
                2. اختر <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-xl bg-[#00B050] py-2.5 text-xs font-bold text-white cursor-pointer"
              >
                حسناً
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
