// Pure Canvas 2D Mathematical Expression & Mixed Arabic RTL/Math Renderer
// Zero DOM / SVG foreignObject so canvas.captureStream() stays untainted on all browsers & Android WebView.

type MathAstNode =
  | { type: 'seq'; items: MathAstNode[] }
  | { type: 'text'; value: string }
  | { type: 'frac'; num: MathAstNode; den: MathAstNode }
  | { type: 'sqrt'; radicand: MathAstNode }
  | { type: 'sup'; base: MathAstNode; sup: MathAstNode }
  | { type: 'sub'; base: MathAstNode; sub: MathAstNode }
  | { type: 'subsup'; base: MathAstNode; sub: MathAstNode; sup: MathAstNode };

const LATEX_SYMBOLS: Record<string, string> = {
  times: '×',
  cdot: '·',
  div: '÷',
  pm: '±',
  mp: '∓',
  neq: '≠',
  ne: '≠',
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  approx: '≈',
  equiv: '≡',
  infty: '∞',
  pi: 'π',
  theta: 'θ',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  Delta: 'Δ',
  sigma: 'σ',
  Sigma: 'Σ',
  sum: '∑',
  prod: '∏',
  int: '∫',
  degree: '°',
  circ: '°',
  angle: '∠',
  perp: '⊥',
  parallel: '∥',
  rightarrow: '→',
  to: '→',
  leftarrow: '←',
  leftrightarrow: '↔',
  implies: '⇒',
  percent: '%',
};

const ARABIC_CHAR_RE = /[\u0600-\u06FF]/;
const MATH_COMMAND_RE =
  /(\$\$[\s\S]+?\$\$|\$[^$]+\$|\\(?:frac|sqrt|times|div|pm|pi|theta|alpha|beta|gamma|Delta|leq|geq|neq|approx|infty|sum|int|cdot|circ)|[_^]\{)/;

export function hasMathSyntax(text: string): boolean {
  return MATH_COMMAND_RE.test(text);
}

function unwrapLatexCmd(expr: string): string {
  return expr
    .replace(/^\$\$?|\$\$?$/g, '')
    .replace(/\\left\s*/g, '')
    .replace(/\\right\s*/g, '')
    .replace(/\\,/g, ' ')
    .replace(/\\;/g, ' ')
    .replace(/\\quad/g, '  ')
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\mathrm\{([^}]*)\}/g, '$1')
    .trim();
}

function parseGroupOrAtom(src: string, pos: { i: number }): MathAstNode {
  while (pos.i < src.length && src[pos.i] === ' ') pos.i++;
  if (pos.i >= src.length) return { type: 'text', value: '' };

  if (src[pos.i] === '{') {
    pos.i++; // consume {
    const inner = parseSequence(src, pos, '}');
    if (src[pos.i] === '}') pos.i++;
    return inner;
  }

  if (src[pos.i] === '\\') {
    pos.i++;
    let cmd = '';
    while (pos.i < src.length && /[a-zA-Z]/.test(src[pos.i])) {
      cmd += src[pos.i++];
    }
    if (!cmd && pos.i < src.length) {
      return { type: 'text', value: src[pos.i++] };
    }
    if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
      const num = parseGroupOrAtom(src, pos);
      const den = parseGroupOrAtom(src, pos);
      return { type: 'frac', num, den };
    }
    if (cmd === 'sqrt') {
      // Optional root index [n] skipped/prefixed simply
      if (src[pos.i] === '[') {
        while (pos.i < src.length && src[pos.i] !== ']') pos.i++;
        if (src[pos.i] === ']') pos.i++;
      }
      const radicand = parseGroupOrAtom(src, pos);
      return { type: 'sqrt', radicand };
    }
    if (cmd in LATEX_SYMBOLS) {
      return { type: 'text', value: ` ${LATEX_SYMBOLS[cmd]} ` };
    }
    return { type: 'text', value: cmd };
  }

  const ch = src[pos.i++];
  return { type: 'text', value: ch };
}

function parseSequence(src: string, pos: { i: number }, stopChar?: string): MathAstNode {
  const items: MathAstNode[] = [];

  while (pos.i < src.length) {
    if (stopChar && src[pos.i] === stopChar) break;

    if (src[pos.i] === ' ') {
      pos.i++;
      if (items.length > 0) {
        const last = items[items.length - 1];
        if (last.type === 'text' && !last.value.endsWith(' ')) {
          last.value += ' ';
        }
      }
      continue;
    }

    if (src[pos.i] === '^' || src[pos.i] === '_') {
      const scriptKind = src[pos.i++];
      const scriptNode = parseGroupOrAtom(src, pos);
      const base = items.pop() ?? { type: 'text', value: '' };

      if (scriptKind === '^') {
        if (base.type === 'sub') {
          items.push({ type: 'subsup', base: base.base, sub: base.sub, sup: scriptNode });
        } else {
          items.push({ type: 'sup', base, sup: scriptNode });
        }
      } else {
        if (base.type === 'sup') {
          items.push({ type: 'subsup', base: base.base, sub: scriptNode, sup: base.sup });
        } else {
          items.push({ type: 'sub', base, sub: scriptNode });
        }
      }
      continue;
    }

    const atom = parseGroupOrAtom(src, pos);
    if (atom.type === 'text' && items.length > 0 && items[items.length - 1].type === 'text') {
      const prev = items[items.length - 1] as { type: 'text'; value: string };
      prev.value += atom.value;
    } else {
      items.push(atom);
    }
  }

  // Collapse double spaces
  for (const item of items) {
    if (item.type === 'text') {
      item.value = item.value.replace(/\s+/g, ' ');
    }
  }

  if (items.length === 1) return items[0];
  return { type: 'seq', items };
}

export function parseLatexToAst(latex: string): MathAstNode {
  const clean = unwrapLatexCmd(latex);
  return parseSequence(clean, { i: 0 });
}

interface BoxMetrics {
  width: number;
  ascent: number;
  descent: number;
}

function buildFontString(weight: number | string, size: number, family: string, isMath: boolean): string {
  if (isMath) {
    return `${weight} ${Math.round(size)}px 'Cairo', 'Times New Roman', serif`;
  }
  return `${weight} ${Math.round(size)}px ${family}`;
}

function measureMathNode(
  ctx: CanvasRenderingContext2D,
  node: MathAstNode,
  fontSize: number,
  fontFamily: string,
  weight: number | string
): BoxMetrics {
  switch (node.type) {
    case 'text': {
      ctx.save();
      ctx.font = buildFontString(weight, fontSize, fontFamily, true);
      const trimmed = node.value;
      const w = ctx.measureText(trimmed).width;
      ctx.restore();
      return {
        width: w,
        ascent: fontSize * 0.72,
        descent: fontSize * 0.25,
      };
    }
    case 'seq': {
      let width = 0;
      let ascent = fontSize * 0.65;
      let descent = fontSize * 0.22;
      for (const child of node.items) {
        const m = measureMathNode(ctx, child, fontSize, fontFamily, weight);
        width += m.width;
        ascent = Math.max(ascent, m.ascent);
        descent = Math.max(descent, m.descent);
      }
      return { width, ascent, descent };
    }
    case 'frac': {
      const subSize = Math.max(18, fontSize * 0.78);
      const mNum = measureMathNode(ctx, node.num, subSize, fontFamily, weight);
      const mDen = measureMathNode(ctx, node.den, subSize, fontFamily, weight);
      const innerW = Math.max(mNum.width, mDen.width) + fontSize * 0.28;
      const numH = mNum.ascent + mNum.descent;
      const denH = mDen.ascent + mDen.descent;
      return {
        width: innerW + fontSize * 0.16,
        ascent: numH + fontSize * 0.26,
        descent: denH + fontSize * 0.18,
      };
    }
    case 'sqrt': {
      const inner = measureMathNode(ctx, node.radicand, fontSize, fontFamily, weight);
      const hookW = fontSize * 0.56;
      const padR = fontSize * 0.14;
      return {
        width: hookW + inner.width + padR,
        ascent: Math.max(fontSize * 0.85, inner.ascent + fontSize * 0.22),
        descent: Math.max(fontSize * 0.25, inner.descent),
      };
    }
    case 'sup': {
      const b = measureMathNode(ctx, node.base, fontSize, fontFamily, weight);
      const s = measureMathNode(ctx, node.sup, Math.max(15, fontSize * 0.62), fontFamily, weight);
      return {
        width: b.width + s.width + 2,
        ascent: Math.max(b.ascent, fontSize * 0.36 + s.ascent),
        descent: b.descent,
      };
    }
    case 'sub': {
      const b = measureMathNode(ctx, node.base, fontSize, fontFamily, weight);
      const s = measureMathNode(ctx, node.sub, Math.max(15, fontSize * 0.62), fontFamily, weight);
      return {
        width: b.width + s.width + 2,
        ascent: b.ascent,
        descent: Math.max(b.descent, fontSize * 0.18 + s.descent),
      };
    }
    case 'subsup': {
      const b = measureMathNode(ctx, node.base, fontSize, fontFamily, weight);
      const s1 = measureMathNode(ctx, node.sub, Math.max(15, fontSize * 0.6), fontFamily, weight);
      const s2 = measureMathNode(ctx, node.sup, Math.max(15, fontSize * 0.6), fontFamily, weight);
      return {
        width: b.width + Math.max(s1.width, s2.width) + 2,
        ascent: Math.max(b.ascent, fontSize * 0.36 + s2.ascent),
        descent: Math.max(b.descent, fontSize * 0.18 + s1.descent),
      };
    }
  }
}

function drawMathNode(
  ctx: CanvasRenderingContext2D,
  node: MathAstNode,
  x: number,
  baselineY: number,
  fontSize: number,
  fontFamily: string,
  weight: number | string,
  color: string
): number {
  switch (node.type) {
    case 'text': {
      ctx.save();
      ctx.font = buildFontString(weight, fontSize, fontFamily, true);
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = color;
      ctx.fillText(node.value, x, baselineY);
      const w = ctx.measureText(node.value).width;
      ctx.restore();
      return w;
    }
    case 'seq': {
      let cursor = x;
      for (const child of node.items) {
        cursor += drawMathNode(ctx, child, cursor, baselineY, fontSize, fontFamily, weight, color);
      }
      return cursor - x;
    }
    case 'frac': {
      const subSize = Math.max(18, fontSize * 0.78);
      const mNum = measureMathNode(ctx, node.num, subSize, fontFamily, weight);
      const mDen = measureMathNode(ctx, node.den, subSize, fontFamily, weight);
      const barW = Math.max(mNum.width, mDen.width) + fontSize * 0.28;
      const totalW = barW + fontSize * 0.16;
      const barY = baselineY - fontSize * 0.26;
      const padX = fontSize * 0.08;

      // Numerator centered above bar
      const numX = x + padX + (barW - mNum.width) / 2;
      const numBaseY = barY - fontSize * 0.14 - mNum.descent;
      drawMathNode(ctx, node.num, numX, numBaseY, subSize, fontFamily, weight, color);

      // Fraction bar
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2.5, Math.round(fontSize * 0.065));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + padX, barY);
      ctx.lineTo(x + padX + barW, barY);
      ctx.stroke();
      ctx.restore();

      // Denominator centered below bar
      const denX = x + padX + (barW - mDen.width) / 2;
      const denBaseY = barY + fontSize * 0.14 + mDen.ascent;
      drawMathNode(ctx, node.den, denX, denBaseY, subSize, fontFamily, weight, color);

      return totalW;
    }
    case 'sqrt': {
      const inner = measureMathNode(ctx, node.radicand, fontSize, fontFamily, weight);
      const hookW = fontSize * 0.56;
      const padR = fontSize * 0.14;
      const topY = baselineY - inner.ascent - fontSize * 0.14;
      const botY = baselineY + Math.max(fontSize * 0.12, inner.descent * 0.6);
      const midY = (topY + botY) * 0.55;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2.5, Math.round(fontSize * 0.065));
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + fontSize * 0.06, midY);
      ctx.lineTo(x + hookW * 0.42, botY);
      ctx.lineTo(x + hookW * 0.85, topY);
      ctx.lineTo(x + hookW + inner.width + padR * 0.6, topY);
      ctx.stroke();
      ctx.restore();

      drawMathNode(ctx, node.radicand, x + hookW, baselineY, fontSize, fontFamily, weight, color);
      return hookW + inner.width + padR;
    }
    case 'sup': {
      const wBase = drawMathNode(ctx, node.base, x, baselineY, fontSize, fontFamily, weight, color);
      const supSize = Math.max(15, fontSize * 0.62);
      const wSup = drawMathNode(
        ctx,
        node.sup,
        x + wBase + 1,
        baselineY - fontSize * 0.4,
        supSize,
        fontFamily,
        weight,
        color
      );
      return wBase + wSup + 2;
    }
    case 'sub': {
      const wBase = drawMathNode(ctx, node.base, x, baselineY, fontSize, fontFamily, weight, color);
      const subSize = Math.max(15, fontSize * 0.62);
      const wSub = drawMathNode(
        ctx,
        node.sub,
        x + wBase + 1,
        baselineY + fontSize * 0.22,
        subSize,
        fontFamily,
        weight,
        color
      );
      return wBase + wSub + 2;
    }
    case 'subsup': {
      const wBase = drawMathNode(ctx, node.base, x, baselineY, fontSize, fontFamily, weight, color);
      const scriptSize = Math.max(15, fontSize * 0.6);
      const w1 = drawMathNode(
        ctx,
        node.sub,
        x + wBase + 1,
        baselineY + fontSize * 0.22,
        scriptSize,
        fontFamily,
        weight,
        color
      );
      const w2 = drawMathNode(
        ctx,
        node.sup,
        x + wBase + 1,
        baselineY - fontSize * 0.4,
        scriptSize,
        fontFamily,
        weight,
        color
      );
      return wBase + Math.max(w1, w2) + 2;
    }
  }
}

interface MixedSegment {
  kind: 'rtl' | 'math';
  text?: string;
  ast?: MathAstNode;
}

function splitMixedSegments(raw: string): MixedSegment[] {
  const parts = raw.split(/(\$\$[\s\S]+?\$\$|\$[^$]+\$)/g).filter(Boolean);
  const segs: MixedSegment[] = [];

  for (const part of parts) {
    if (part.startsWith('$') && part.endsWith('$')) {
      segs.push({ kind: 'math', ast: parseLatexToAst(part) });
    } else if (!ARABIC_CHAR_RE.test(part) && hasMathSyntax(part)) {
      segs.push({ kind: 'math', ast: parseLatexToAst(part) });
    } else {
      segs.push({ kind: 'rtl', text: part });
    }
  }
  return segs;
}

interface LayoutRowItem {
  seg: MixedSegment;
  width: number;
  ascent: number;
  descent: number;
}

interface SmartTextLayout {
  visibleRows: LayoutRowItem[][];
  rowTotals: Array<{ totalW: number; maxAscent: number; maxDescent: number }>;
  rowHeights: number[];
  totalBlockH: number;
}

function layoutSmartQuizText(
  ctx: CanvasRenderingContext2D,
  rawText: string,
  maxWidth: number,
  fontSize: number,
  fontStack: string,
  weight: number | string,
  maxLines = 3
): SmartTextLayout {
  const segments = splitMixedSegments(rawText);

  const measured: LayoutRowItem[] = segments.map((seg) => {
    if (seg.kind === 'math' && seg.ast) {
      const m = measureMathNode(ctx, seg.ast, fontSize, fontStack, weight);
      return { seg, width: m.width, ascent: m.ascent, descent: m.descent };
    }
    ctx.save();
    ctx.font = buildFontString(weight, fontSize, fontStack, false);
    const w = ctx.measureText(seg.text ?? '').width;
    ctx.restore();
    return {
      seg,
      width: w,
      ascent: fontSize * 0.72,
      descent: fontSize * 0.28,
    };
  });

  type LineRow = LayoutRowItem[];
  const rows: LineRow[] = [];
  let currentRow: LineRow = [];
  let currentW = 0;

  for (const item of measured) {
    if (item.seg.kind === 'rtl' && item.width > maxWidth * 0.94) {
      const words = (item.seg.text ?? '').trim().split(/\s+/).filter(Boolean);
      let buf = '';
      for (const word of words) {
        const candidate = buf ? `${buf} ${word}` : word;
        ctx.save();
        ctx.font = buildFontString(weight, fontSize, fontStack, false);
        const candW = ctx.measureText(candidate).width;
        ctx.restore();
        if (currentW + candW > maxWidth && (currentRow.length > 0 || buf)) {
          if (buf) {
            ctx.save();
            ctx.font = buildFontString(weight, fontSize, fontStack, false);
            const bw = ctx.measureText(buf + ' ').width;
            ctx.restore();
            currentRow.push({
              seg: { kind: 'rtl', text: buf + ' ' },
              width: bw,
              ascent: fontSize * 0.72,
              descent: fontSize * 0.28,
            });
          }
          rows.push(currentRow);
          currentRow = [];
          currentW = 0;
          buf = word;
        } else {
          buf = candidate;
        }
      }
      if (buf) {
        ctx.save();
        ctx.font = buildFontString(weight, fontSize, fontStack, false);
        const bw = ctx.measureText(' ' + buf + ' ').width;
        ctx.restore();
        currentRow.push({
          seg: { kind: 'rtl', text: ' ' + buf + ' ' },
          width: bw,
          ascent: fontSize * 0.72,
          descent: fontSize * 0.28,
        });
        currentW += bw;
      }
      continue;
    }

    if (currentW + item.width > maxWidth && currentRow.length > 0) {
      rows.push(currentRow);
      currentRow = [item];
      currentW = item.width;
    } else {
      currentRow.push(item);
      currentW += item.width;
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  const visibleRows = rows.slice(0, maxLines);

  const rowTotals = visibleRows.map((row) => ({
    totalW: row.reduce((s, r) => s + r.width, 0),
    maxAscent: Math.max(...row.map((r) => r.ascent), fontSize * 0.7),
    maxDescent: Math.max(...row.map((r) => r.descent), fontSize * 0.26),
  }));

  const rowHeights = rowTotals.map((rt) => rt.maxAscent + rt.maxDescent + fontSize * 0.34);
  const totalBlockH = rowHeights.reduce((s, h) => s + h, 0);

  return { visibleRows, rowTotals, rowHeights, totalBlockH };
}

export function measureSmartQuizTextHeight(
  ctx: CanvasRenderingContext2D,
  rawText: string,
  maxWidth: number,
  fontSize: number,
  fontStack: string,
  weight: number | string,
  maxLines = 3
): number {
  return layoutSmartQuizText(ctx, rawText, maxWidth, fontSize, fontStack, weight, maxLines).totalBlockH;
}

export function drawSmartQuizText(
  ctx: CanvasRenderingContext2D,
  rawText: string,
  centerX: number,
  centerY: number,
  maxWidth: number,
  fontSize: number,
  fontStack: string,
  weight: number | string,
  color: string,
  maxLines = 3
): void {
  const { visibleRows, rowTotals, rowHeights, totalBlockH } = layoutSmartQuizText(
    ctx,
    rawText,
    maxWidth,
    fontSize,
    fontStack,
    weight,
    maxLines
  );

  let cursorY = centerY - totalBlockH / 2;

  visibleRows.forEach((row, rIdx) => {
    const rt = rowTotals[rIdx];
    const rowH = rowHeights[rIdx];
    const scaleDown = rt.totalW > maxWidth ? Math.max(0.65, maxWidth / rt.totalW) : 1;
    const baselineY = cursorY + rt.maxAscent + (rowH - (rt.maxAscent + rt.maxDescent)) * 0.5;

    ctx.save();
    if (scaleDown < 1) {
      ctx.translate(centerX, baselineY);
      ctx.scale(scaleDown, scaleDown);
      ctx.translate(-centerX, -baselineY);
    }

    // In RTL visual layout, first logical segment sits on the RIGHT edge of the centered row
    let cursorRight = centerX + rt.totalW / 2;

    for (const item of row) {
      const segLeft = cursorRight - item.width;
      if (item.seg.kind === 'math' && item.seg.ast) {
        drawMathNode(ctx, item.seg.ast, segLeft, baselineY, fontSize, fontStack, weight, color);
      } else {
        ctx.save();
        ctx.font = buildFontString(weight, fontSize, fontStack, false);
        ctx.direction = 'rtl';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = color;
        ctx.fillText(item.seg.text ?? '', cursorRight, baselineY);
        ctx.restore();
      }
      cursorRight = segLeft;
    }

    ctx.restore();
    cursorY += rowH;
  });
}

// Convert LaTeX equations into clear spoken Arabic so TTS reads fractions/roots/powers naturally
export function latexToSpokenArabic(text: string): string {
  let out = text;

  // Fractions: \frac{a}{b} -> a على b
  for (let pass = 0; pass < 3; pass++) {
    out = out.replace(/\\(?:d|t)?frac\{([^{}]+)\}\{([^{}]+)\}/g, ' $1 على $2 ');
  }
  out = out.replace(/\\sqrt\{([^{}]+)\}/g, ' الجذر التربيعي لـ $1 ');
  out = out.replace(/\^\{2\}|\^2/g, ' تربيع ');
  out = out.replace(/\^\{3\}|\^3/g, ' تكعيب ');
  out = out.replace(/\^\{([^{}]+)\}/g, ' أس $1 ');
  out = out.replace(/\^([0-9a-zA-Z])/g, ' أس $1 ');
  out = out.replace(/_\{([^{}]+)\}/g, ' $1 ');

  out = out
    .replace(/\\times/g, ' ضرب ')
    .replace(/\\cdot/g, ' ضرب ')
    .replace(/\\div/g, ' تقسيم ')
    .replace(/\\pm/g, ' زائد أو ناقص ')
    .replace(/\\pi/g, ' باي ')
    .replace(/\\theta/g, ' ثيتا ')
    .replace(/\\alpha/g, ' ألفا ')
    .replace(/\\beta/g, ' بيتا ')
    .replace(/\\leq/g, ' أصغر من أو يساوي ')
    .replace(/\\geq/g, ' أكبر من أو يساوي ')
    .replace(/\\neq/g, ' لا يساوي ')
    .replace(/\\approx/g, ' يساوي تقريباً ')
    .replace(/\\infty/g, ' ما لا نهاية ')
    .replace(/\\circ|\\degree/g, ' درجة ')
    .replace(/\\left|\\right/g, '')
    .replace(/\$/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\\/g, ' ')
    .replace(/\+/g, ' زائد ')
    .replace(/=/g, ' يساوي ')
    .replace(/\s+/g, ' ')
    .trim();

  return out;
}
