// تحويل ملفات Word / Excel / CSV / TXT إلى صيغة النص الذي يفهمه الاستيراد السريع:
// سطر للسؤال، 4 أسطر للخيارات (* قبل الصحيح)، سطر اختياري للمعلومة، وسطر فارغ بين الأسئلة.

export interface FileImportResult {
  text: string;
  count: number;
  missing: number; // أسئلة لم نعثر فيها على علامة الإجابة الصحيحة
}

interface RawQ {
  question: string;
  options: string[];
  correct: number; // -1 = غير معروف
  explanation: string;
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const normDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

const QNUM_RE = /^\s*(?:السؤال\s*)?(?:س\s*)?[\d٠-٩]+\s*[).\-:/،]\s*/;
const OPT_PREFIX_RE = /^\s*(?:[أابجدهـ]|[A-Da-d]|[1-4١-٤])\s*[).\-:،]\s+/;

function letterToIndex(v: string): number {
  const t = normDigits(v.trim()).replace(/[).\s]/g, '');
  if (/^[1-4]$/.test(t)) return Number(t) - 1;
  if (/^[أا]$/.test(t) || /^[Aa]$/.test(t)) return 0;
  if (/^ب$/.test(t) || /^[Bb]$/.test(t)) return 1;
  if (/^ج$/.test(t) || /^[Cc]$/.test(t)) return 2;
  if (/^د$/.test(t) || /^[Dd]$/.test(t)) return 3;
  return -1;
}

function buildText(items: RawQ[]): FileImportResult {
  let missing = 0;
  const blocks = items.map((q) => {
    let c = q.correct;
    if (c < 0 || c > 3) {
      missing += 1;
      c = 0;
    }
    const lines = [q.question, ...q.options.map((o, i) => (i === c ? `* ${o}` : o))];
    if (q.explanation) lines.push(q.explanation);
    return lines.join('\n');
  });
  return { text: blocks.join('\n\n'), count: items.length, missing };
}

// ---------- CSV / Excel ----------
function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function rowsToQuestions(rows: unknown[][]): RawQ[] {
  const out: RawQ[] = [];
  rows.forEach((r, idx) => {
    const cells = r.map((c) => (c === null || c === undefined ? '' : String(c).trim()));
    if (cells.filter(Boolean).length < 5) return;
    if (idx === 0 && /^(السؤال|سؤال|question)/i.test(cells[0]) && cells[0].length < 20) return;
    const options = cells.slice(1, 5);
    let correct = -1;
    const raw = cells[5] ?? '';
    if (raw) {
      correct = letterToIndex(raw);
      if (correct < 0) {
        const byText = options.findIndex((o) => o === raw);
        correct = byText;
      }
    }
    out.push({ question: cells[0], options, correct, explanation: cells[6] ?? '' });
  });
  return out;
}

// ---------- Word ----------
interface DocLine {
  text: string;
  bold: boolean;
}

const EXPLICIT_Q_RE = /^\s*(?:السؤال|س)\s*[\d٠-٩]*\s*[).\-:/،]?\s*/;

function groupLines(lines: DocLine[]): RawQ[] {
  const nonBlank = lines.filter((l) => l.text.length > 0);
  const explicitHeads = nonBlank.filter((l) => EXPLICIT_Q_RE.test(l.text) || (QNUM_RE.test(l.text) && !OPT_PREFIX_RE.test(l.text))).length;
  const numericHeads = nonBlank.filter((l) => QNUM_RE.test(l.text)).length;

  const groups: DocLine[][] = [];

  if (explicitHeads >= 2 || (numericHeads >= 2 && nonBlank.length >= 10)) {
    let cur: DocLine[] | null = null;
    for (const l of nonBlank) {
      const isExplicitQ = EXPLICIT_Q_RE.test(l.text);
      const isQNum = QNUM_RE.test(l.text);
      const looksLikeOptionInsideQuestion =
        cur !== null && cur.length >= 1 && cur.length < 5 && OPT_PREFIX_RE.test(l.text);

      if (isExplicitQ || (isQNum && !looksLikeOptionInsideQuestion && (cur === null || cur.length >= 5))) {
        cur = [{ ...l, text: l.text.replace(QNUM_RE, '').trim() || l.text }];
        groups.push(cur);
      } else if (cur) {
        cur.push(l);
      }
    }
  } else {
    // Check if document separates questions by blank paragraphs
    const blankSeparated: DocLine[][] = [];
    let curBlock: DocLine[] = [];
    for (const l of lines) {
      if (!l.text) {
        if (curBlock.length > 0) {
          blankSeparated.push(curBlock);
          curBlock = [];
        }
      } else {
        curBlock.push(l);
      }
    }
    if (curBlock.length > 0) blankSeparated.push(curBlock);

    if (blankSeparated.length >= 2 && blankSeparated.every((b) => b.length >= 5)) {
      groups.push(...blankSeparated);
    } else {
      for (let i = 0; i + 4 < nonBlank.length; i += 5) {
        groups.push(nonBlank.slice(i, i + 5));
      }
    }
  }

  const out: RawQ[] = [];
  for (const g of groups) {
    if (g.length < 5) continue;
    const question = g[0].text.replace(QNUM_RE, '').trim() || g[0].text.trim();
    let correct = -1;
    const options = g.slice(1, 5).map((l, i) => {
      let t = l.text.trim();
      if (/^[*✓+]/.test(t)) {
        correct = i;
        t = t.replace(/^[*✓+]\s*/, '');
      } else if (l.bold && correct < 0) {
        correct = i;
      }
      return t.replace(OPT_PREFIX_RE, '').trim();
    });
    const extra: string[] = [];
    for (const l of g.slice(5)) {
      const m = l.text.match(/(?:الإجابة|الاجابة|الجواب)(?:\s*الصحيحة)?\s*[:：]\s*(.+)/);
      if (m) {
        const idx = letterToIndex(m[1]);
        if (idx >= 0) correct = idx;
        else {
          const byText = options.findIndex((o) => o && m[1].includes(o));
          if (byText >= 0) correct = byText;
        }
      } else extra.push(l.text.trim());
    }
    out.push({ question, options, correct, explanation: extra.join(' ') });
  }
  return out;
}

async function docxToLines(file: File): Promise<DocLine[]> {
  const mammoth = (await import('mammoth/mammoth.browser.js')).default as {
    convertToHtml: (i: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  };
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const doc = new DOMParser().parseFromString(value, 'text/html');
  const lines: DocLine[] = [];
  doc.querySelectorAll('p, li').forEach((el) => {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) {
      if (lines.length > 0 && lines[lines.length - 1].text !== '') {
        lines.push({ text: '', bold: false });
      }
      return;
    }
    const boldLen = Array.from(el.querySelectorAll('strong, b')).reduce(
      (n, b) => n + (b.textContent ?? '').trim().length,
      0
    );
    lines.push({ text, bold: boldLen >= text.length * 0.6 });
  });
  return lines;
}

// ---------- نقطة الدخول ----------
export async function fileToImportText(file: File): Promise<FileImportResult> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.docx')) {
    const items = groupLines(await docxToLines(file));
    return buildText(items);
  }
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    const rows = (await readSheet(file)) as unknown[][];
    return buildText(rowsToQuestions(rows));
  }
  if (name.endsWith('.csv')) {
    const text = (await file.text()).replace(/^\uFEFF/, '');
    return buildText(rowsToQuestions(parseCsv(text)));
  }
  // .txt وغيره: نفس صيغة الاستيراد السريع مباشرة
  const text = (await file.text()).replace(/^\uFEFF/, '').trim();
  const count = text ? text.split(/\n\s*\n+/).length : 0;
  return { text, count, missing: 0 };
}
