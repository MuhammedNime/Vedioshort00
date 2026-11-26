import {
  DynamicCaptionStyle,
  QuestionSlide,
  SlideSchedule,
  TemplateSettings,
} from '../types/quiz';

export interface ActiveCaptionState {
  text: string;
  words: string[];
  activeWordIndex: number;
  phase: 'question' | 'option' | 'explanation';
  alpha: number;
}

export function tokenizeCaptionWords(rawText: string): string[] {
  if (!rawText) return [];
  const cleaned = rawText
    .replace(/\$\$?/g, ' ')
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\sqrt\{([^}]+)\}/g, '√$1')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 / $2')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return [];
  return cleaned.split(' ').filter(Boolean);
}

export function computeActiveCaptionState(
  slide: QuestionSlide,
  localTime: number,
  schedule: SlideSchedule
): ActiveCaptionState | null {
  const { tQuestionStart, tOptionStarts, tThinkingStart, tRevealStart, endTime, startTime } =
    schedule;
  const slideDur = endTime - startTime;

  const optCount =
    slide.slideType === 'trueFalse' || slide.slideType === 'versus'
      ? 2
      : slide.slideType === 'clues' || slide.slideType === 'multiple3'
        ? 3
        : 4;

  // Phase 1: Question reading
  if (localTime >= tQuestionStart && localTime < tOptionStarts[0]) {
    const words = tokenizeCaptionWords(slide.question);
    if (words.length === 0) return null;
    const span = Math.max(0.25, tOptionStarts[0] - tQuestionStart);
    const p = Math.max(0, Math.min(0.999, (localTime - tQuestionStart) / span));
    return {
      text: words.join(' '),
      words,
      activeWordIndex: Math.min(words.length - 1, Math.floor(p * words.length)),
      phase: 'question',
      alpha: Math.min(1, (localTime - tQuestionStart) / 0.16),
    };
  }

  // Phase 2: Options reading
  if (localTime >= tOptionStarts[0] && localTime < tThinkingStart) {
    let activeOpt = 0;
    for (let i = 0; i < optCount; i++) {
      if (localTime >= tOptionStarts[i]) {
        activeOpt = i;
      }
    }
    const optStart = tOptionStarts[activeOpt];
    const optEnd =
      activeOpt < optCount - 1 && tOptionStarts[activeOpt + 1] > optStart + 0.02
        ? tOptionStarts[activeOpt + 1]
        : tThinkingStart;
    const optText = slide.options[activeOpt] || '';
    const words = tokenizeCaptionWords(optText);
    if (words.length === 0) return null;
    const span = Math.max(0.22, optEnd - optStart);
    const p = Math.max(0, Math.min(0.999, (localTime - optStart) / span));
    return {
      text: words.join(' '),
      words,
      activeWordIndex: Math.min(words.length - 1, Math.floor(p * words.length)),
      phase: 'option',
      alpha: Math.min(1, (localTime - optStart) / 0.12),
    };
  }

  // Phase 3: Answer & Explanation reveal
  if (localTime >= tRevealStart && localTime <= slideDur) {
    const answerText = slide.options[slide.correctIndex] || '';
    const expl = slide.explanationText?.trim() || '';
    const fullPhrase = expl ? `${answerText} — ${expl}` : `الإجابة الصحيحة: ${answerText}`;
    const words = tokenizeCaptionWords(fullPhrase);
    if (words.length === 0) return null;
    const span = Math.max(0.5, slideDur - tRevealStart - 0.15);
    const p = Math.max(0, Math.min(0.999, (localTime - tRevealStart) / span));
    return {
      text: words.join(' '),
      words,
      activeWordIndex: Math.min(words.length - 1, Math.floor(p * words.length)),
      phase: 'explanation',
      alpha: Math.min(1, (localTime - tRevealStart) / 0.18),
    };
  }

  return null;
}

function drawRoundedCaptionPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function drawDynamicCaptionsOverlay(
  ctx: CanvasRenderingContext2D,
  state: ActiveCaptionState | null,
  template: TemplateSettings,
  W: number,
  H: number,
  fontStack: string
): void {
  if (!state || state.words.length === 0 || state.alpha <= 0.02) return;

  const isWide = W > H;
  const style: DynamicCaptionStyle = template.dynamicCaptionStyle || 'pillKaraoke';
  const defaultY = isWide ? 87 : 85;
  const captionY = H * (Math.max(12, Math.min(93, template.dynamicCaptionY ?? defaultY)) / 100);
  const maxBoxW = isWide ? W * 0.72 : W * 0.84;

  // Show a focused window of words so Shorts captions remain punchy and readable
  const windowSize = isWide ? 8 : 6;
  const chunkIdx = Math.floor(state.activeWordIndex / windowSize);
  const startWord = chunkIdx * windowSize;
  const visibleWords = state.words.slice(startWord, startWord + windowSize);
  const localActiveIdx = state.activeWordIndex - startWord;

  if (visibleWords.length === 0) return;

  const fontSize = isWide ? 36 : 42;
  const wordGap = 14;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, state.alpha));
  ctx.font = `800 ${fontSize}px ${fontStack}`;
  ctx.textBaseline = 'middle';

  // Wrap visibleWords into at most 2 lines RTL-aware
  const measured = visibleWords.map((w, idx) => ({
    word: w,
    isActive: idx === localActiveIdx,
    isPast: idx < localActiveIdx,
    width: ctx.measureText(w).width + (style === 'pillKaraoke' ? 22 : 6),
  }));

  const lines: typeof measured[] = [[]];
  let currentLineW = 0;
  for (const item of measured) {
    const added = item.width + (lines[lines.length - 1].length > 0 ? wordGap : 0);
    if (lines[lines.length - 1].length > 0 && currentLineW + added > maxBoxW - 44) {
      lines.push([item]);
      currentLineW = item.width;
    } else {
      lines[lines.length - 1].push(item);
      currentLineW += added;
    }
  }

  const lineH = fontSize * 1.48;
  const totalH = lines.length * lineH + 22;
  const maxLineW = Math.max(
    180,
    ...lines.map(
      (ln) => ln.reduce((acc, it) => acc + it.width, 0) + Math.max(0, ln.length - 1) * wordGap
    )
  );
  const containerW = Math.min(maxBoxW, maxLineW + 46);
  const containerX = (W - containerW) / 2;
  const containerY = captionY - totalH / 2;

  if (style === 'cleanGlass') {
    drawRoundedCaptionPill(ctx, containerX, containerY, containerW, totalH, 24);
    ctx.fillStyle = 'rgba(10, 14, 24, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (style === 'pillKaraoke') {
    drawRoundedCaptionPill(ctx, containerX, containerY, containerW, totalH, 26);
    ctx.fillStyle = 'rgba(11, 15, 23, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(237, 214, 162, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const hasArabicText = /[\u0600-\u06FF]/.test(visibleWords.join(' '));
  const activeBg =
    state.phase === 'explanation'
      ? template.correctColor || '#10b981'
      : style === 'boldYellow'
        ? '#facc15'
        : '#f59e0b';

  for (let lIdx = 0; lIdx < lines.length; lIdx++) {
    const line = lines[lIdx];
    const lineW =
      line.reduce((acc, it) => acc + it.width, 0) + Math.max(0, line.length - 1) * wordGap;
    const cy = containerY + 11 + lineH * (lIdx + 0.5);

    // Draw words right-to-left if Arabic, left-to-right if English/Numbers
    let cursor = hasArabicText ? W / 2 + lineW / 2 : W / 2 - lineW / 2;

    for (const item of line) {
      const wX = hasArabicText ? cursor - item.width : cursor;
      const wordCenterX = wX + item.width / 2;

      if (item.isActive && style === 'pillKaraoke') {
        drawRoundedCaptionPill(ctx, wX, cy - lineH * 0.42, item.width, lineH * 0.84, 14);
        ctx.fillStyle = activeBg;
        ctx.fill();
      }

      ctx.textAlign = 'center';
      if (style === 'boldYellow') {
        ctx.lineJoin = 'round';
        ctx.lineWidth = 10;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)';
        ctx.strokeText(item.word, wordCenterX, cy);
        ctx.fillStyle = item.isActive
          ? state.phase === 'explanation'
            ? '#4ade80'
            : '#facc15'
          : item.isPast
            ? '#FFFFFF'
            : 'rgba(255, 255, 255, 0.78)';
        ctx.fillText(item.word, wordCenterX, cy);
      } else if (style === 'cleanGlass') {
        ctx.fillStyle = item.isActive
          ? state.phase === 'explanation'
            ? '#4ade80'
            : '#fde047'
          : item.isPast
            ? '#F8FAFC'
            : 'rgba(226, 232, 240, 0.72)';
        ctx.fillText(item.word, wordCenterX, cy);
      } else {
        // pillKaraoke
        ctx.fillStyle = item.isActive
          ? '#0b0f17'
          : item.isPast
            ? '#FFFFFF'
            : 'rgba(255, 255, 255, 0.74)';
        ctx.fillText(item.word, wordCenterX, cy);
      }

      cursor = hasArabicText ? wX - wordGap : wX + item.width + wordGap;
    }
  }

  ctx.restore();
}
