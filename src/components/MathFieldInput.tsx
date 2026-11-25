import React, { useEffect, useRef, useState } from 'react';
import { Check, Calculator, X } from 'lucide-react';
import { registerBackHandler } from '../utils/androidBack';

interface MathFieldElement extends HTMLElement {
  value: string;
  executeCommand?: (cmd: string | [string, ...unknown[]]) => void;
  insert?: (latex: string, options?: Record<string, unknown>) => void;
}

interface MathFieldInputProps {
  initialText: string;
  mode: 'replace' | 'insertIntoText';
  onApply: (nextText: string) => void;
  onClose: () => void;
}

const QUICK_MATH_TOKENS: { label: string; latex: string; title: string }[] = [
  { label: 'كسر a/b', latex: '\\frac{#0}{#?}', title: 'إدراج كسر' },
  { label: 'جذر √', latex: '\\sqrt{#0}', title: 'جذر تربيعي' },
  { label: 'أس x²', latex: '^{2}', title: 'أس تربيعي' },
  { label: 'أس xⁿ', latex: '^{#0}', title: 'أس مخصص' },
  { label: '×', latex: '\\times ', title: 'ضرب' },
  { label: '÷', latex: '\\div ', title: 'قسمة' },
  { label: '+', latex: '+', title: 'جمع' },
  { label: '-', latex: '-', title: 'طرح' },
  { label: '=', latex: '=', title: 'يساوي' },
  { label: 'π', latex: '\\pi ', title: 'باي' },
  { label: '±', latex: '\\pm ', title: 'زائد أو ناقص' },
  { label: '°', latex: '^{\\circ}', title: 'درجة' },
];

function extractExistingLatex(text: string): string {
  const match = text.match(/\$\$([\s\S]+?)\$\$|\$([^$]+)\$/);
  if (match) {
    return (match[1] ?? match[2] ?? '').trim();
  }
  const trimmed = text.trim();
  if (/^[0-9a-zA-Z\\+\-*/=^_{}().,\s%]+$/.test(trimmed)) {
    return trimmed;
  }
  return '';
}

export const MathFieldInput: React.FC<MathFieldInputProps> = ({
  initialText,
  mode,
  onApply,
  onClose,
}) => {
  const mfRef = useRef<MathFieldElement | null>(null);
  const [latex, setLatex] = useState<string>(() => extractExistingLatex(initialText));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    return registerBackHandler(() => {
      onClose();
      return true;
    });
  }, [onClose]);

  useEffect(() => {
    let active = true;
    void import('mathlive').then((mod) => {
      if (mod.MathfieldElement) {
        const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
        mod.MathfieldElement.fontsDirectory = `${baseUrl}mathlive/fonts`;
        mod.MathfieldElement.soundsDirectory = `${baseUrl}mathlive/sounds`;
      }
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const el = mfRef.current;
    if (!el || !ready) return;
    if (el.value !== latex) {
      el.value = latex;
    }
    const handleInput = () => {
      setLatex(el.value || '');
    };
    el.addEventListener('input', handleInput);
    return () => {
      el.removeEventListener('input', handleInput);
    };
  }, [ready]);

  const insertToken = (tokenLatex: string) => {
    const el = mfRef.current;
    if (el && typeof el.insert === 'function') {
      el.focus();
      el.insert(tokenLatex);
      setLatex(el.value || '');
    } else {
      setLatex((prev) => `${prev}${tokenLatex}`);
    }
  };

  const handleConfirm = () => {
    const clean = (mfRef.current?.value ?? latex).trim();
    if (!clean) {
      onClose();
      return;
    }
    const wrapped = `$${clean}$`;
    if (mode === 'insertIntoText' && /\$\$?[^$]+\$\$?/.test(initialText)) {
      onApply(initialText.replace(/\$\$[\s\S]+?\$\$|\$[^$]+\$/, wrapped));
    } else if (mode === 'insertIntoText' && initialText.trim()) {
      onApply(`${initialText.trim()} ${wrapped}`);
    } else {
      onApply(wrapped);
    }
    onClose();
  };

  return (
    <div
      className="flex flex-col gap-2.5 p-3 rounded-xl bg-[var(--panel)] border border-[#00B050]/60 shadow-lg"
      dir="ltr"
    >
      <div className="flex items-center justify-between gap-2" dir="rtl">
        <div className="flex items-center gap-1.5 text-xs font-bold text-[#00B050] dark:text-[#6ee7b7]">
          <Calculator className="w-3.5 h-3.5" />
          <span>محرر معادلات الرياضيات (MathLive)</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="إغلاق"
          className="p-1 rounded text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Quick Math Toolbar */}
      <div className="flex flex-wrap items-center gap-1">
        {QUICK_MATH_TOKENS.map((t) => (
          <button
            key={t.label}
            type="button"
            title={t.title}
            onClick={() => insertToken(t.latex)}
            className="px-2 py-1 rounded-md bg-[var(--surface)] hover:border-[#00B050] border border-[var(--pline)] text-[11px] font-bold text-[var(--ptxt)] transition-colors cursor-pointer"
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Interactive MathLive Field */}
      <div className="rounded-lg bg-white text-slate-900 border border-[var(--pline)] px-2.5 py-2 min-h-[48px] flex items-center">
        {ready ? (
          // @ts-expect-error math-field is registered dynamically by mathlive
          <math-field
            ref={mfRef}
            virtual-keyboard-mode="onfocus"
            style={{ width: '100%', fontSize: '20px', background: 'transparent', color: '#0f172a' }}
          />
        ) : (
          <span className="text-xs text-slate-500">جارٍ تحميل لوحة الرياضيات...</span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2" dir="rtl">
        <span className="text-[10px] text-[var(--pmuted)] font-mono-nums truncate max-w-[60%]" dir="ltr">
          {latex ? `$${latex}$` : 'مثال: 3/4 + sqrt(16)'}
        </span>

        <button
          type="button"
          onClick={handleConfirm}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold transition-colors cursor-pointer"
        >
          <Check className="w-3.5 h-3.5" />
          <span>{mode === 'insertIntoText' ? 'إدراج المعادلة' : 'اعتماد المعادلة'}</span>
        </button>
      </div>
    </div>
  );
};
