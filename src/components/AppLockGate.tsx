import React, { useState } from 'react';
import { KeyRound, Lock, ShieldCheck, Unlock, X } from 'lucide-react';
import {
  clearAppPasscode,
  isAppLockEnabled,
  setAppPasscode,
  verifyAppPasscode,
} from '../utils/appLock';

interface LockScreenProps {
  onUnlock: () => void;
}

export const AppLockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) return;
    setChecking(true);
    setError('');
    const ok = await verifyAppPasscode(pin);
    setChecking(false);
    if (ok) {
      onUnlock();
    } else {
      setError('كلمة المرور غير صحيحة، حاول مجدداً.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--page)] text-[var(--ptxt)] p-4"
      dir="rtl"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-sm rounded-2xl bg-[var(--panel)] border border-[var(--pline)] p-6 shadow-2xl flex flex-col gap-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#00B050]/15 border border-[#00B050]/40 text-[#00B050] flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-extrabold">استوديو شورتس الأسئلة</h1>
            <p className="text-xs text-[var(--pmuted)]">التطبيق محمي بكلمة المرور الشخصية</p>
          </div>
        </div>

        <input
          type="password"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="أدخل كلمة المرور لفتح الاستوديو..."
          className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] focus:border-[#00B050] focus:outline-none text-sm text-[var(--ptxt)]"
        />

        {error && <p className="text-xs text-rose-400 font-semibold">{error}</p>}

        <button
          type="submit"
          disabled={checking}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-50 text-white text-sm font-bold transition-colors cursor-pointer"
        >
          <Unlock className="w-4 h-4" />
          <span>{checking ? 'جارٍ التحقق...' : 'فتح التطبيق'}</span>
        </button>
      </form>
    </div>
  );
};

interface ManageLockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLockNow: () => void;
}

export const ManageLockModal: React.FC<ManageLockModalProps> = ({
  isOpen,
  onClose,
  onLockNow,
}) => {
  const [enabled, setEnabled] = useState(() => isAppLockEnabled());
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [notice, setNotice] = useState('');

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.trim().length < 4) {
      setNotice('يرجى إدخال 4 أحرف أو أرقام على الأقل.');
      return;
    }
    if (newPin !== confirmPin) {
      setNotice('كلمتا المرور غير متطابقتين.');
      return;
    }
    await setAppPasscode(newPin);
    setEnabled(true);
    setNewPin('');
    setConfirmPin('');
    setNotice('تم تفعيل كلمة المرور وحفظها محلياً على جهازك بنجاح.');
  };

  const handleRemove = () => {
    clearAppPasscode();
    setEnabled(false);
    setNotice('تم إيقاف القفل بنجاح.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" dir="rtl">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--panel)] border border-[var(--pline)] shadow-2xl overflow-hidden text-[var(--ptxt)]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--pline)]">
          <div className="flex items-center gap-2 text-sm font-bold">
            <KeyRound className="w-4 h-4 text-[#00B050]" />
            <span>قفل الخصوصية الشخصي للتطبيق</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
            <ShieldCheck className={`w-4 h-4 shrink-0 ${enabled ? 'text-[#00B050]' : 'text-[var(--pmuted)]'}`} />
            <span>
              {enabled
                ? 'القفل الشخصي مفعّل: لن يفتح التطبيق إلا بكلمة مرورك.'
                : 'القفل متوقف حالياً. يمكنك وضع كلمة مرور خاصة بك لحماية التطبيق على الهاتف.'}
            </span>
          </div>

          <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-2.5">
            <input
              type="password"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder={enabled ? 'تعيين كلمة مرور جديدة...' : 'أدخل كلمة مرور جديدة (4+ أحرف/أرقام)'}
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] focus:border-[#00B050] focus:outline-none text-xs"
            />
            <input
              type="password"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              placeholder="تأكيد كلمة المرور..."
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] focus:border-[#00B050] focus:outline-none text-xs"
            />

            {notice && <p className="text-xs text-[#00B050] dark:text-[#6ee7b7] font-semibold">{notice}</p>}

            <button
              type="submit"
              className="py-2 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold transition-colors cursor-pointer"
            >
              {enabled ? 'تحديث كلمة المرور' : 'تفعيل قفل التطبيق'}
            </button>
          </form>

          {enabled && (
            <div className="flex items-center gap-2 pt-2 border-t border-[var(--pline)]">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLockNow();
                }}
                className="flex-1 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] hover:border-[var(--gold)] text-xs font-bold cursor-pointer"
              >
                قفل الشاشة الآن
              </button>
              <button
                type="button"
                onClick={handleRemove}
                className="flex-1 py-2 rounded-lg bg-rose-500/12 border border-rose-500/35 text-rose-400 text-xs font-bold cursor-pointer"
              >
                إلغاء القفل
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
