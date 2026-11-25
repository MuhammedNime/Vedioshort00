import React, { useRef, useState } from 'react';
import { Archive, Download, FileUp, Layers, RotateCcw, Sparkles } from 'lucide-react';
import { buildFullStudioBackup, restoreFullStudioBackup } from '../storage/backupVault';
import { CHANNEL_SAMPLE_SLIDES, QuestionSlide, QuizProject } from '../types/quiz';
import { fileToImportText } from '../utils/fileImport';
import { saveOrDownloadBlob } from '../utils/nativeDownload';

interface BulkImportPanelProps {
  project: QuizProject;
  onReplaceSlides: (slides: QuestionSlide[]) => void;
  onAppendSlides: (slides: QuestionSlide[]) => void;
  onImportFullProject: (project: QuizProject) => void;
}

const SAMPLE_TEXT = `ما هي عاصمة دولة قطر؟
الكويت
* الدوحة
المنامة
مسقط
تقع مدينة الدوحة على ساحل الخليج العربي

كم عدد ألوان قوس قزح؟
5 ألوان
6 ألوان
* 7 ألوان
8 ألوان`;

export const BulkImportPanel: React.FC<BulkImportPanelProps> = ({
  project,
  onReplaceSlides,
  onAppendSlides,
  onImportFullProject,
}) => {
  const [rawText, setRawText] = useState('');
  const [importFormat, setImportFormat] = useState<'auto' | 'multiple3'>('auto');
  const [feedback, setFeedback] = useState<string | null>(null);
  const projectFileRef = useRef<HTMLInputElement | null>(null);
  const questionsFileRef = useRef<HTMLInputElement | null>(null);

  const handleQuestionsFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setFeedback('جارٍ قراءة الملف...');
      const res = await fileToImportText(file);
      if (res.count === 0) {
        setFeedback('ما لقيت أسئلة بالملف. تأكد إن كل سؤال تحته 4 خيارات.');
      } else {
        setRawText(res.text);
        setFeedback(
          `تمت قراءة ${res.count} سؤال، راجعهم بالمربع تحت ثم اضغط "إضافة للقائمة".` +
            (res.missing > 0
              ? ` (${res.missing} سؤال بدون علامة إجابة صحيحة، اعتُبر الخيار الأول صحيحاً، عدّله بوضع * قبل الجواب الصحيح)`
              : '')
        );
      }
    } catch {
      setFeedback('تعذرت قراءة الملف. جرّب ملف Word (.docx) أو Excel (.xlsx) أو CSV أو TXT.');
    }
    e.target.value = '';
  };

  const parseBulkText = (text: string): QuestionSlide[] => {
    const blocks = text
      .trim()
      .split(/\n\s*\n+/)
      .map((b) => b.trim())
      .filter(Boolean);

    const parsed: QuestionSlide[] = [];

    blocks.forEach((block, bIdx) => {
      const lines = block
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length < 3) return;

      const question = lines[0];

      if (importFormat === 'multiple3' && lines.length >= 4) {
        const rawThree = lines.slice(1, 4);
        let correctIndex: 0 | 1 | 2 = 0;
        const cleanThree = rawThree.map((opt, idx) => {
          if (opt.startsWith('*') || opt.startsWith('✓') || opt.startsWith('+')) {
            correctIndex = idx as 0 | 1 | 2;
            return opt.replace(/^[*✓+]\s*/, '').trim();
          }
          return opt;
        });
        const explanationText = lines[4] ? lines.slice(4).join(' ') : '';
        parsed.push({
          id: `slide-${Date.now()}-${bIdx}`,
          slideType: 'multiple3',
          badgeText: `السؤال ${bIdx + 1}`,
          question,
          options: [cleanThree[0] || '', cleanThree[1] || '', cleanThree[2] || '', ''],
          correctIndex,
          explanationText,
        });
        return;
      }

      // Support 2-option True/False blocks (3 or 4 lines)
      if (lines.length < 5) {
        const rawTwo = lines.slice(1, 3);
        let correctIndex: 0 | 1 = 0;
        const cleanTwo = rawTwo.map((opt, idx) => {
          if (opt.startsWith('*') || opt.startsWith('✓') || opt.startsWith('+')) {
            correctIndex = idx as 0 | 1;
            return opt.replace(/^[*✓+]\s*/, '').trim();
          }
          return opt;
        });
        const explanationText = lines[3] ? lines[3] : '';
        parsed.push({
          id: `slide-${Date.now()}-${bIdx}`,
          slideType: 'trueFalse',
          badgeText: `صح أم خطأ · ${bIdx + 1}`,
          question,
          options: [cleanTwo[0] || 'صح', cleanTwo[1] || 'خطأ', '', ''],
          correctIndex,
          explanationText,
        });
        return;
      }

      const rawOpts = lines.slice(1, 5);
      let correctIndex: 0 | 1 | 2 | 3 = 0;

      const cleanOpts = rawOpts.map((opt, idx) => {
        if (opt.startsWith('*') || opt.startsWith('✓') || opt.startsWith('+')) {
          correctIndex = idx as 0 | 1 | 2 | 3;
          return opt.replace(/^[*✓+]\s*/, '').trim();
        }
        return opt;
      }) as [string, string, string, string];

      const explanationText = lines[5] ? lines.slice(5).join(' ') : '';

      parsed.push({
        id: `slide-${Date.now()}-${bIdx}`,
        slideType: 'multiple',
        badgeText: `السؤال ${bIdx + 1}`,
        question,
        options: cleanOpts,
        correctIndex,
        explanationText,
      });
    });

    return parsed;
  };

  const handleImport = (mode: 'replace' | 'append') => {
    const slides = parseBulkText(rawText);
    if (slides.length === 0) {
      setFeedback(
        'تأكد من كتابة السؤال في السطر الأول ثم 4 خيارات في الأسطر الأربعة التالية، وضع علامة * قبل الإجابة الصحيحة.'
      );
      return;
    }

    if (mode === 'replace') {
      onReplaceSlides(slides);
      setFeedback(`تم استيراد ${slides.length} سؤال واستبدال القائمة الحالية.`);
    } else {
      onAppendSlides(slides);
      setFeedback(`تمت إضافة ${slides.length} سؤال إلى القائمة الحالية.`);
    }
    setRawText('');
  };

  const handleLoadChannelSamples = () => {
    const cloned = CHANNEL_SAMPLE_SLIDES.map((s, i) => ({
      ...s,
      id: `channel-slide-${Date.now()}-${i}`,
      options: [...s.options] as [string, string, string, string],
    }));
    onReplaceSlides(cloned);
    setFeedback('تم تحميل أسئلة القناة الافتراضية الأربعة بنجاح.');
  };

  const handleDownloadBackup = async () => {
    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const fileName = `shorts-quiz-project-${Date.now()}.json`;
    const res = await saveOrDownloadBlob(blob, fileName, 'application/json');
    if (res.savedNatively && res.ok) {
      setFeedback(`تم حفظ النسخة الاحتياطية في التنزيلات: ${fileName}`);
    }
  };

  const handleDownloadFullWorkspaceBackup = async () => {
    try {
      const bundle = await buildFullStudioBackup(project);
      const json = JSON.stringify(bundle, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const fileName = `shorts-studio-backup-${Date.now()}.json`;
      const res = await saveOrDownloadBlob(blob, fileName, 'application/json');
      if (res.ok) {
        setFeedback(
          `تم حفظ النسخة الشاملة (${bundle.projects.length} مشاريع و ${bundle.customPresets.length} ستايل).`
        );
      }
    } catch {
      setFeedback('تعذر تجهيز النسخة الشاملة.');
    }
  };

  const handleLoadBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      const restored = await restoreFullStudioBackup(content);
      onImportFullProject(restored.activeProject);
      setFeedback(
        restored.restoredProjectsCount > 1 || restored.restoredPresetsCount > 0
          ? `تمت استعادة ${restored.restoredProjectsCount} مشروع و ${restored.restoredPresetsCount} ستايل بنجاح.`
          : 'تم استرجاع ملف المشروع بنجاح مع القالب والأصوات.'
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'تعذر قراءة ملف المشروع.');
    }
    e.target.value = '';
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[var(--ptxt)]">
            استيراد عدة أسئلة دفعة واحدة
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleLoadChannelSamples}
              className="flex items-center gap-1 text-xs text-[var(--gold)] hover:underline font-bold cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>أمثلة القناة (4)</span>
            </button>
            <button
              type="button"
              onClick={() => setRawText(SAMPLE_TEXT)}
              className="flex items-center gap-1 text-xs text-[#00B050] hover:underline font-bold cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>نموذج نصي</span>
            </button>
          </div>
        </div>

        <p className="text-xs text-[var(--pmuted)] leading-relaxed">
          اكتب كل سؤال في سطر (أو ارفع ملف Word فيه الجواب الصحيح بخط عريض، أو Excel أعمدته: السؤال، 4 خيارات، رقم الصحيح، معلومة)، ثم تحته 4 خيارات، وضع نجمة{' '}
          <span className="text-[#00B050] font-bold">*</span> قبل الخيار الصحيح، واترك
          سطراً فارغاً بين كل سؤال والآخر.
        </p>

        <input
          ref={questionsFileRef}
          type="file"
          accept=".docx,.xlsx,.csv,.txt"
          onChange={(e) => void handleQuestionsFile(e)}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => questionsFileRef.current?.click()}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-[var(--surface)] hover:border-[var(--gold)] text-[var(--ptxt)] border border-[var(--pline)] text-xs font-semibold transition-colors cursor-pointer"
        >
          <FileUp className="w-3.5 h-3.5 text-[#00B050]" />
          <span>استيراد من ملف (Word / Excel / CSV / TXT)</span>
        </button>

        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
          <button
            type="button"
            onClick={() => setImportFormat('auto')}
            className={`py-1.5 px-2 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
              importFormat === 'auto'
                ? 'bg-[#00B050] text-white'
                : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
            }`}
          >
            تلقائي (4 خيارات / صح وخطأ)
          </button>
          <button
            type="button"
            onClick={() => setImportFormat('multiple3')}
            className={`py-1.5 px-2 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
              importFormat === 'multiple3'
                ? 'bg-[#00B050] text-white'
                : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
            }`}
          >
            نمط 3 خيارات فقط 🎯
          </button>
        </div>

        <textarea
          rows={8}
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={
            importFormat === 'multiple3'
              ? `نص السؤال هنا\nالخيار الأول\n* الخيار الثاني الصحيح\nالخيار الثالث\nمعلومة إضافية اختيارية`
              : `نص السؤال هنا\nالخيار الأول\n* الخيار الثاني الصحيح\nالخيار الثالث\nالخيار الرابع\nمعلومة إضافية اختيارية`
          }
          className="w-full p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] focus:border-[#00B050] focus:outline-none text-xs text-[var(--ptxt)] placeholder:text-[var(--pmuted)] leading-relaxed"
        />

        {feedback && (
          <div className="px-3 py-2 rounded-lg bg-[#00B050]/12 border border-[#00B050]/35 text-xs text-[#00B050] dark:text-[#6ee7b7]">
            {feedback}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => handleImport('append')}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>إضافة للقائمة</span>
          </button>
          <button
            type="button"
            onClick={() => handleImport('replace')}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-[var(--surface)] hover:border-[var(--gold)] text-[var(--ptxt)] border border-[var(--pline)] text-xs font-semibold transition-colors cursor-pointer"
          >
            <span>استبدال الأسئلة</span>
          </button>
        </div>
      </section>

      {/* Project Backup Section */}
      <section className="flex flex-col gap-3 border-t border-[var(--pline)] pt-5">
        <h2 className="text-sm font-bold text-[var(--ptxt)]">
          حفظ واسترجاع القالب والمشروع كملف
        </h2>
        <p className="text-xs text-[var(--pmuted)] leading-relaxed">
          يحفظ جميع الأسئلة مع القالب والأصوات المخصصة في ملف واحد لفتحه من أي جهاز.
        </p>

        <input
          ref={projectFileRef}
          type="file"
          accept=".json,application/json"
          onChange={(e) => void handleLoadBackup(e)}
          className="hidden"
        />

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => void handleDownloadBackup()}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-[var(--surface)] hover:border-[var(--gold)] text-[var(--ptxt)] border border-[var(--pline)] text-xs font-semibold transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[var(--gold)]" />
            <span>حفظ ملف المشروع</span>
          </button>

          <button
            type="button"
            onClick={() => projectFileRef.current?.click()}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-[var(--surface)] hover:border-[var(--gold)] text-[var(--ptxt)] border border-[var(--pline)] text-xs font-semibold transition-colors cursor-pointer"
          >
            <FileUp className="w-3.5 h-3.5 text-[#00B050]" />
            <span>استعادة مشروع / نسخة شاملة</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => void handleDownloadFullWorkspaceBackup()}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-[#00B050]/12 hover:bg-[#00B050]/20 border border-[#00B050]/40 text-[#00B050] dark:text-[#6ee7b7] text-xs font-bold transition-colors cursor-pointer"
        >
          <Archive className="w-3.5 h-3.5" />
          <span>حفظ نسخة شاملة (كل المشاريع والستايلات)</span>
        </button>
      </section>
    </div>
  );
};
