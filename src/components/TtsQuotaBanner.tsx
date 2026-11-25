import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, KeyRound, RefreshCw, Volume2 } from 'lucide-react';
import {
  TtsQuotaSnapshot,
  fetchTtsQuota,
  getCachedTtsQuota,
  subscribeTtsQuota,
} from '../services/aiClient';

interface TtsQuotaBannerProps {
  compact?: boolean;
}

function formatResetCountdown(nextResetIso: string): string {
  const target = Date.parse(nextResetIso);
  if (Number.isNaN(target)) return '00:00 UTC';
  const diffMin = Math.max(1, Math.round((target - Date.now()) / 60_000));
  const hrs = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hrs > 0) {
    return `${hrs} س ${mins} د`;
  }
  return `${mins} دقيقة`;
}

export const TtsQuotaBanner: React.FC<TtsQuotaBannerProps> = ({ compact = false }) => {
  const [quota, setQuota] = useState<TtsQuotaSnapshot | null>(() => getCachedTtsQuota());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [, setClockTick] = useState(0);
  const lastAutoFetchRef = useRef(0);

  const refreshQuota = async (manual = false) => {
    const now = Date.now();
    if (!manual && now - lastAutoFetchRef.current < 15_000) return;
    lastAutoFetchRef.current = now;
    if (manual) setIsRefreshing(true);
    try {
      await fetchTtsQuota();
    } finally {
      if (manual) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const unsub = subscribeTtsQuota((next) => {
      setQuota(next);
    });
    void refreshQuota(false);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshQuota(false);
      }
    };
    const onFocus = () => {
      void refreshQuota(false);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    const intervalId = window.setInterval(() => {
      setClockTick((t) => t + 1);
    }, 60_000);

    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.clearInterval(intervalId);
    };
  }, []);

  if (!quota) {
    return (
      <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-[11px] text-[var(--pmuted)]">
        <div className="flex items-center gap-1.5">
          <Volume2 className="w-3.5 h-3.5 text-[#00B050]" />
          <span>جارٍ قراءة حصة الصوت من الخادم...</span>
        </div>
        <button
          type="button"
          onClick={() => void refreshQuota(true)}
          className="p-1 rounded hover:bg-[var(--surface)] text-[var(--ptxt)] cursor-pointer"
          title="تحديث الحصة من الخادم"
        >
          <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    );
  }

  const hasKeys = quota.totalKeys > 0;
  const pct =
    quota.totalDailyLimit > 0
      ? Math.max(0, Math.min(100, Math.round((quota.remainingToday / quota.totalDailyLimit) * 100)))
      : 0;
  const barColor = !hasKeys || quota.allExhausted
    ? 'bg-rose-500'
    : pct <= 25
      ? 'bg-amber-500'
      : 'bg-[#00B050]';
  const countColor = !hasKeys || quota.allExhausted
    ? 'text-rose-400'
    : pct <= 25
      ? 'text-amber-400'
      : 'text-[#00B050] dark:text-[#6ee7b7]';

  return (
    <div
      className={`flex flex-col gap-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] ${
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <KeyRound className="w-3.5 h-3.5 text-[var(--gold)] shrink-0" />
          <span className="text-[11px] font-bold text-[var(--ptxt)] truncate">
            رصيد الأصوات اليومي
          </span>
          {hasKeys && (
            <span className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--pline)] text-[10px] font-mono-nums text-[var(--pmuted)] shrink-0">
              {quota.activeKeys}/{quota.totalKeys}{' '}
              {quota.totalKeys === 1 ? 'مفتاح' : 'مفاتيح'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[11px] font-mono-nums font-extrabold ${countColor}`}>
            {hasKeys
              ? quota.beyondFreeTier
                ? `${quota.usedToday} مستخدم (مفتوح)`
                : `${quota.remainingToday} / ${quota.totalDailyLimit} متبقي`
              : 'بدون مفاتيح'}
          </span>

          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => void refreshQuota(true)}
            title="مزامنة وتحديث الحصة من الخادم الآن"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] text-[10px] font-bold text-[var(--ptxt)] cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 text-[#00B050] ${isRefreshing ? 'animate-spin' : ''}`} />
            {!compact && <span>تحديث</span>}
          </button>
        </div>
      </div>

      {hasKeys && (
        <div className="w-full h-1.5 rounded-full bg-[var(--surface)] overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${barColor}`}
            style={{ width: `${quota.beyondFreeTier ? 100 : pct}%` }}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--pmuted)]">
        <span>
          {hasKeys
            ? quota.allExhausted
              ? `اكتملت الحصة اليومية · تتجدد بعد ${formatResetCountdown(quota.nextResetAtIso)}`
              : `استُهلك ${quota.usedToday} · يتجدد بعد ${formatResetCountdown(quota.nextResetAtIso)}`
            : 'أضف GEMINI_API_KEY في الخادم لتفعيل توليد الأصوات.'}
        </span>

        {quota.keys.length > 1 && (
          <button
            type="button"
            onClick={() => setShowKeys((v) => !v)}
            className="flex items-center gap-0.5 text-[10px] font-bold text-[var(--gold)] hover:underline cursor-pointer shrink-0"
          >
            <span>تفاصيل المفاتيح</span>
            {showKeys ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
        )}
      </div>

      {showKeys && quota.keys.length > 1 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 pt-1 border-t border-[var(--pline)]/70">
          {quota.keys.map((k) => {
            const kStyle =
              k.status === 'ready'
                ? 'border-[#00B050]/40 bg-[#00B050]/10 text-[#00B050] dark:text-[#6ee7b7]'
                : k.status === 'cooldown'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                  : 'border-rose-500/35 bg-rose-500/10 text-rose-400';
            return (
              <div
                key={k.index}
                className={`flex items-center justify-between gap-1 px-2 py-1 rounded border text-[10px] font-mono-nums ${kStyle}`}
              >
                <span className="truncate">
                  #{k.index} {k.tail}
                </span>
                <span className="font-bold shrink-0">
                  {k.status === 'invalid'
                    ? 'معطل'
                    : k.status === 'cooldown'
                      ? `${k.cooldownRemainingSec}ث`
                      : `${k.remaining}/${k.limit}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
