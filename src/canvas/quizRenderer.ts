import {
  AnimationStyle,
  AudioSettings,
  BoxBorderStyle,
  BoxShapeStyle,
  ImageChallengeMode,
  ImageFitMode,
  OptionImagePlacement,
  PRESET_BACKDROPS,
  PresenterPoseId,
  QuestionImageInsideLayout,
  QuestionImagePlacement,
  QuestionSlide,
  SlideSchedule,
  SlideTransitionStyle,
  TemplateSettings,
  TimerPlacement,
  TimerVisibilityMode,
  TimingSettings,
  computeProjectTimeline,
  getCanvasDimensions,
  getEndCardDuration,
  getIntroHookDuration,
  getSlidePrizeTiers,
  getSlidesContentDuration,
} from '../types/quiz';
import { drawSmartQuizText, hasMathSyntax, measureSmartQuizTextHeight } from './mathCanvasRenderer';
import { computeAiPresenterFrameTiming } from './aiPresenterMedia';
import {
  PresenterPhase,
  computePresenterChoreography,
  drawAiPresenterVideoFrame,
  drawPresenterHostFrame,
  preloadPresenterAssets,
  resolveAiPresenterRect,
  resolveSlidePresenterRect,
} from './presenterRenderer';
import { computeActiveCaptionState, drawDynamicCaptionsOverlay } from './captionsRenderer';

export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1920;

export interface TimelineSoundEvent {
  type:
    | 'introHook'
    | 'questionEnter'
    | 'optionEnter'
    | 'countdownTick'
    | 'suspense'
    | 'correctReveal'
    | 'endCardEnter';
  slideIndex: number;
  optionIndex?: number;
  tickSecond?: number;
  urgent?: boolean;
  maxDuration?: number;
}

export type DragTargetId = 'badge' | 'question' | 'options' | 'timer' | 'brand' | 'presenter';

export interface StageElementHitbox {
  id: DragTargetId;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface InteractiveStageState {
  dragMode?: boolean;
  activeTarget?: DragTargetId | null;
  demoPresenterPose?: PresenterPoseId | null;
  demoPresenterAnimClock?: number;
}

export interface SlideTimeInfo {
  slideIndex: number;
  slide: QuestionSlide;
  localTime: number;
  schedule: SlideSchedule;
}

export function getSlideTimeInfo(
  globalTime: number,
  slides: QuestionSlide[],
  timing: TimingSettings,
  audio: AudioSettings,
  template?: TemplateSettings
): SlideTimeInfo | null {
  if (slides.length === 0) return null;
  const schedules = computeProjectTimeline(slides, timing, audio, template);

  let chosen = schedules[schedules.length - 1];
  for (let i = 0; i < schedules.length; i++) {
    const s = schedules[i];
    const nextStart = i < schedules.length - 1 ? schedules[i + 1].startTime : Infinity;
    if (globalTime < nextStart) {
      chosen = s;
      break;
    }
  }

  const localTime = Math.max(0, Math.min(chosen.duration, globalTime - chosen.startTime));
  return {
    slideIndex: chosen.slideIndex,
    slide: slides[chosen.slideIndex],
    localTime,
    schedule: chosen,
  };
}

export function collectSoundEventsInInterval(
  prevTime: number,
  currTime: number,
  slides: QuestionSlide[],
  timing: TimingSettings,
  audio: AudioSettings,
  template?: TemplateSettings
): TimelineSoundEvent[] {
  const events: TimelineSoundEvent[] = [];
  if (currTime <= prevTime || slides.length === 0) return events;

  const schedules = computeProjectTimeline(slides, timing, audio, template);
  const introDur = getIntroHookDuration(template, timing);

  if (introDur > 0 && prevTime < 0 && currTime >= 0) {
    const firstSlideStart = schedules[0]?.startTime ?? introDur;
    events.push({
      type: 'introHook',
      slideIndex: 0,
      maxDuration: Math.max(0.15, firstSlideStart - 0.02),
    });
  }

  for (let idx = 0; idx < schedules.length; idx++) {
    const sched = schedules[idx];
    const sIdx = sched.slideIndex;
    const slide = slides[sIdx];
    const base = sched.startTime;
    const nextSlideStart =
      idx < schedules.length - 1 ? schedules[idx + 1].startTime : base + sched.duration;
    const tQ = base + sched.tQuestionStart;
    const tOpts = sched.tOptionStarts.map((t) => base + t);
    const tThink = base + sched.tThinkingStart;
    const tSus = base + sched.tSuspenseStart;
    const tReveal = base + sched.tRevealStart;
    const optCount =
      slide?.slideType === 'trueFalse' || slide?.slideType === 'versus'
        ? 2
        : slide?.slideType === 'clues'
          ? 3
          : 4;
    const hasAnyOptVoice = Array.from({ length: optCount }).some((_, oi) =>
      Boolean(slide?.voiceover?.options?.[oi]?.dataUrl)
    );

    if (prevTime < tQ && currTime >= tQ) {
      const qMaxDur = slide?.voiceover?.question?.dataUrl
        ? Math.max(0.15, (hasAnyOptVoice ? tOpts[0] : tThink) - tQ - 0.02)
        : Math.max(0.15, tOpts[0] - tQ - 0.02);
      events.push({
        type: 'questionEnter',
        slideIndex: sIdx,
        maxDuration: qMaxDur,
      });
    }

    let optVoiceCursor = tOpts[0] ?? tQ;
    for (let oIdx = 0; oIdx < optCount; oIdx++) {
      const tOpt = tOpts[oIdx];
      const oClip = slide?.voiceover?.options?.[oIdx];
      const sameTimeAsPrev = oIdx > 0 && Math.abs(tOpt - tOpts[oIdx - 1]) < 0.01;
      let groupEndBoundary = tThink;
      for (let k = oIdx + 1; k < optCount; k++) {
        if (tOpts[k] > tOpt + 0.01) {
          groupEndBoundary = tOpts[k];
          break;
        }
      }
      const isGroupedSameStart =
        oIdx < optCount - 1 && Math.abs(tOpts[oIdx + 1] - tOpt) < 0.01;

      if (oClip?.dataUrl) {
        const scheduledStart = isGroupedSameStart || sameTimeAsPrev
          ? Math.max(tOpt, optVoiceCursor)
          : tOpt;
        const maxBound = Math.max(scheduledStart + 0.15, groupEndBoundary - 0.02);
        if (scheduledStart < maxBound - 0.04) {
          if (prevTime < scheduledStart && currTime >= scheduledStart) {
            events.push({
              type: 'optionEnter',
              slideIndex: sIdx,
              optionIndex: oIdx,
              maxDuration: Math.max(0.15, maxBound - scheduledStart),
            });
          }
          const clipDur = oClip.duration > 0.05 ? oClip.duration : 1.0;
          optVoiceCursor = Math.min(maxBound, scheduledStart + clipDur + 0.04);
        }
      } else if (!sameTimeAsPrev && prevTime < tOpt && currTime >= tOpt) {
        events.push({
          type: 'optionEnter',
          slideIndex: sIdx,
          optionIndex: oIdx,
          maxDuration: Math.max(0.15, groupEndBoundary - tOpt - 0.02),
        });
      }
    }

    const totalTicks = Math.floor(sched.thinkingDuration);
    const urgentThreshold = Math.max(1, Math.min(10, template?.timerUrgentThreshold ?? 3));
    for (let sec = 0; sec < totalTicks; sec++) {
      const tTick = tThink + sec;
      const tickSecond = totalTicks - sec;
      if (prevTime < tTick && currTime >= tTick) {
        events.push({
          type: 'countdownTick',
          slideIndex: sIdx,
          tickSecond,
          urgent: tickSecond <= urgentThreshold,
          maxDuration: Math.max(0.08, Math.min(0.88, tSus - tTick - 0.02)),
        });
      }
    }

    if ((timing.suspenseDuration ?? 0) > 0 && prevTime < tSus && currTime >= tSus) {
      events.push({
        type: 'suspense',
        slideIndex: sIdx,
        maxDuration: Math.max(0.15, tReveal - tSus - 0.02),
      });
    }

    if (prevTime < tReveal && currTime >= tReveal) {
      events.push({
        type: 'correctReveal',
        slideIndex: sIdx,
        maxDuration: Math.max(0.25, nextSlideStart - tReveal - 0.03),
      });
    }
  }

  const contentEnd = schedules.length > 0 ? schedules[schedules.length - 1].endTime : introDur;
  const endCardDur = getEndCardDuration(template, timing);
  if (endCardDur > 0 && prevTime < contentEnd && currTime >= contentEnd) {
    events.push({
      type: 'endCardEnter',
      slideIndex: slides.length - 1,
      maxDuration: Math.max(0.3, endCardDur - 0.05),
    });
  }

  return events;
}

// Easing helpers
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

function easeOutBack(t: number): number {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

interface AnimTransform {
  opacity: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

function computeAnimTransform(progress: number, style: AnimationStyle): AnimTransform {
  if (progress <= 0) {
    return { opacity: 0, scale: 0.8, offsetX: 0, offsetY: 0 };
  }
  if (progress >= 1) {
    return { opacity: 1, scale: 1, offsetX: 0, offsetY: 0 };
  }

  const eased = easeOutCubic(progress);
  const back = easeOutBack(progress);

  switch (style) {
    case 'scale':
      return {
        opacity: eased,
        scale: 0.78 + 0.22 * eased,
        offsetX: 0,
        offsetY: 0,
      };
    case 'pop':
      return {
        opacity: clamp01(progress * 2.2),
        scale: 0.65 + 0.35 * back,
        offsetX: 0,
        offsetY: 0,
      };
    case 'slideUp':
      return {
        opacity: eased,
        scale: 1,
        offsetX: 0,
        offsetY: (1 - eased) * 85,
      };
    case 'slideRight':
      return {
        opacity: eased,
        scale: 1,
        offsetX: -(1 - eased) * 180,
        offsetY: 0,
      };
    case 'slideLeft':
      return {
        opacity: eased,
        scale: 1,
        offsetX: (1 - eased) * 180,
        offsetY: 0,
      };
    case 'fade':
    default:
      return {
        opacity: eased,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      };
  }
}

function hexToRgba(hex: string | undefined, alpha: number): string {
  const safeAlpha = Number.isFinite(alpha) ? clamp01(alpha) : 1;
  const clean = (hex || '').replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
    }
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
    }
  }
  return `rgba(15, 23, 42, ${safeAlpha})`;
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = (hex || '').replace('#', '').trim();
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) || 0,
      parseInt(clean[1] + clean[1], 16) || 0,
      parseInt(clean[2] + clean[2], 16) || 0,
    ];
  }
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16) || 0,
      parseInt(clean.slice(2, 4), 16) || 0,
      parseInt(clean.slice(4, 6), 16) || 0,
    ];
  }
  return [0, 0, 0];
}

function isColorDark(hex: string, dimOpacity = 0): boolean {
  const [r, g, b] = hexToRgbTuple(hex);
  const factor = 1 - clamp01(dimOpacity);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) * factor;
  return luma < 145;
}

function isBackgroundDark(template: TemplateSettings): boolean {
  if (template.backgroundType === 'color') {
    return isColorDark(template.solidBgColor || '#0c0c0c', template.bgDimOpacity);
  }
  if (template.backgroundType === 'preset') {
    if (
      template.presetId === 'channelSand' ||
      template.presetId === 'parchmentGold' ||
      template.presetId === 'mintEditorial'
    ) {
      return template.bgDimOpacity >= 0.35;
    }
    return true;
  }
  return template.bgDimOpacity >= 0.35;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function traceBoxPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  boxStyle: BoxShapeStyle = 'flat'
): void {
  if (boxStyle === 'millionaireHex') {
    const tip = Math.min(w * 0.14, Math.max(22, h * 0.44), 48);
    ctx.beginPath();
    ctx.moveTo(x + tip, y);
    ctx.lineTo(x + w - tip, y);
    ctx.lineTo(x + w, y + h / 2);
    ctx.lineTo(x + w - tip, y + h);
    ctx.lineTo(x + tip, y + h);
    ctx.lineTo(x, y + h / 2);
    ctx.closePath();
    return;
  }
  if (boxStyle === 'chamfer') {
    const cut = Math.min(w * 0.12, h * 0.34, Math.max(18, r * 0.72));
    ctx.beginPath();
    ctx.moveTo(x + cut, y);
    ctx.lineTo(x + w - cut, y);
    ctx.lineTo(x + w, y + cut);
    ctx.lineTo(x + w, y + h - cut);
    ctx.lineTo(x + w - cut, y + h);
    ctx.lineTo(x + cut, y + h);
    ctx.lineTo(x, y + h - cut);
    ctx.lineTo(x, y + cut);
    ctx.closePath();
    return;
  }
  if (boxStyle === 'pill3d') {
    drawRoundedRect(ctx, x, y, w, h, Math.min(w, h) / 2);
    return;
  }
  if (boxStyle === 'ticket') {
    const notch = Math.min(20, Math.max(11, h * 0.14));
    const rr = Math.max(8, Math.min(r, w * 0.18, h * 0.32));
    const midY = y + h / 2;
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, midY - notch);
    ctx.arc(x + w, midY, notch, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, midY + notch);
    ctx.arc(x, midY, notch, Math.PI / 2, -Math.PI / 2, true);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
    return;
  }
  drawRoundedRect(ctx, x, y, w, h, r);
}

function applyBoxGloss(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  enhanced = false,
  boxStyle: BoxShapeStyle = 'flat'
): void {
  traceBoxPath(ctx, x, y, w, h, r, boxStyle);
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, enhanced ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.22)');
  grad.addColorStop(0.48, enhanced ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.04)');
  grad.addColorStop(1, enhanced ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fill();

  if (enhanced && w > 24 && h > 24) {
    traceBoxPath(ctx, x + 3, y + 3, w - 6, h - 6, Math.max(0, r - 3), boxStyle);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function darkenHex(hex: string, amount = 0.38): string {
  const [r, g, b] = hexToRgbTuple(hex);
  const f = clamp01(1 - amount);
  return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
}

function resolveBoxStrokeStyle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  baseColor: string,
  borderStyle: BoxBorderStyle
): string | CanvasGradient {
  if (borderStyle === 'gradientGold' || borderStyle === 'dashedGold') {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#fff3b0');
    grad.addColorStop(0.28, '#e5b84b');
    grad.addColorStop(0.5, '#9e6f18');
    grad.addColorStop(0.75, '#f6dc88');
    grad.addColorStop(1, '#c8952c');
    return grad;
  }
  if (borderStyle === 'gradientNeon') {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#22d3ee');
    grad.addColorStop(0.5, '#a855f7');
    grad.addColorStop(1, '#ec4899');
    return grad;
  }
  if (borderStyle === 'metallicSilver') {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.25, '#cbd5e1');
    grad.addColorStop(0.55, '#64748b');
    grad.addColorStop(0.8, '#f1f5f9');
    grad.addColorStop(1, '#94a3b8');
    return grad;
  }
  if (borderStyle === 'gradientSunset') {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#fde047');
    grad.addColorStop(0.35, '#fb923c');
    grad.addColorStop(0.7, '#f43f5e');
    grad.addColorStop(1, '#a855f7');
    return grad;
  }
  return baseColor;
}

function drawStyledBoxContainer(
  ctx: CanvasRenderingContext2D,
  params: {
    x: number;
    y: number;
    w: number;
    h: number;
    radius: number;
    fillColorHex: string;
    fillRgba: string;
    opacity: number;
    borderColor: string;
    borderWidth: number;
    boxStyle: BoxShapeStyle;
    borderStyle: BoxBorderStyle;
    boxGloss: boolean;
    enhanced: boolean;
    shadowIntensity: number;
    glowIntensity: number;
    isHighlighted?: boolean;
    shadowOffsetY?: number;
    drawFill?: boolean;
    drawBorder?: boolean;
    wingExtensions?: boolean;
  }
): void {
  const {
    x,
    y,
    w,
    h,
    radius,
    fillColorHex,
    fillRgba,
    opacity,
    borderColor,
    borderWidth,
    boxStyle,
    borderStyle,
    boxGloss,
    enhanced,
    shadowIntensity,
    glowIntensity,
    isHighlighted = false,
    shadowOffsetY = 9,
    drawFill = true,
    drawBorder = true,
    wingExtensions = false,
  } = params;

  const isMillionaire = boxStyle === 'millionaireHex';

  // Optional side wing lines for Millionaire hexagonal frames (clamped so wings stay strictly within stage margins)
  if (isMillionaire && wingExtensions && drawBorder) {
    ctx.save();
    const wingLen = 44;
    const wingGradL = ctx.createLinearGradient(x - wingLen, 0, x, 0);
    wingGradL.addColorStop(0, 'rgba(229, 184, 75, 0)');
    wingGradL.addColorStop(1, borderColor || '#e5b84b');
    ctx.strokeStyle = wingGradL;
    ctx.lineWidth = Math.max(2.5, borderWidth * 0.65);
    ctx.beginPath();
    ctx.moveTo(x - wingLen, y + h / 2);
    ctx.lineTo(x + 2, y + h / 2);
    ctx.stroke();

    const wingGradR = ctx.createLinearGradient(x + w, 0, x + w + wingLen, 0);
    wingGradR.addColorStop(0, borderColor || '#e5b84b');
    wingGradR.addColorStop(1, 'rgba(229, 184, 75, 0)');
    ctx.strokeStyle = wingGradR;
    ctx.beginPath();
    ctx.moveTo(x + w - 2, y + h / 2);
    ctx.lineTo(x + w + wingLen, y + h / 2);
    ctx.stroke();
    ctx.restore();
  }

  if (drawFill) {
    // 1. Optional Outer Glow / Enhanced Halo
    if (glowIntensity > 0.02 || isHighlighted) {
      const gAlpha = isHighlighted ? Math.max(0.32, glowIntensity * 0.45) : glowIntensity * 0.34;
      traceBoxPath(ctx, x - 6, y - 6, w + 12, h + 12, radius + 4, boxStyle);
      ctx.fillStyle = hexToRgba(borderColor || '#EDD6A2', clamp01(gAlpha));
      ctx.fill();
    } else if (enhanced && boxStyle === 'flat') {
      traceBoxPath(ctx, x - 5, y - 5, w + 10, h + 10, radius + 4, boxStyle);
      ctx.fillStyle = hexToRgba(borderColor || '#FFFFFF', 0.14);
      ctx.fill();
    }

    // 2. Drop Shadow
    if (shadowIntensity > 0.02) {
      const sOff = Math.round(shadowOffsetY * Math.min(1.5, Math.max(0.2, shadowIntensity)));
      traceBoxPath(ctx, x, y + sOff, w, h, radius, boxStyle);
      const baseAlpha = enhanced ? 0.34 : 0.22;
      ctx.fillStyle = `rgba(0, 0, 0, ${clamp01(baseAlpha * shadowIntensity).toFixed(3)})`;
      ctx.fill();
    }

    // 2B. Stacked Backing Card for layeredCard
    if (boxStyle === 'layeredCard') {
      ctx.save();
      traceBoxPath(ctx, x + 9, y + 10, w, h, radius, 'flat');
      ctx.fillStyle = hexToRgba(borderColor || '#d4a73a', 0.32);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(borderColor || '#d4a73a', 0.72);
      ctx.lineWidth = Math.max(2, borderWidth * 0.55);
      ctx.stroke();
      ctx.restore();
    }

    // 3. 3D Extruded Bottom Lip for bevel3d / pill3d
    if (boxStyle === 'bevel3d' || boxStyle === 'pill3d') {
      const lipDepth = boxStyle === 'pill3d' ? 9 : 11;
      traceBoxPath(ctx, x, y + lipDepth, w, h, radius, boxStyle);
      ctx.fillStyle = darkenHex(fillColorHex, 0.44);
      ctx.fill();
    }

    // 4. Main Box Body Fill
    traceBoxPath(ctx, x, y, w, h, radius, boxStyle);
    if (boxStyle === 'glass') {
      const glassGrad = ctx.createLinearGradient(x, y, x + w, y + h);
      const baseAlpha = Math.max(0.22, Math.min(0.75, opacity * 0.65));
      glassGrad.addColorStop(0, hexToRgba(fillColorHex, Math.min(0.85, baseAlpha + 0.14)));
      glassGrad.addColorStop(0.5, hexToRgba(fillColorHex, baseAlpha));
      glassGrad.addColorStop(1, hexToRgba(fillColorHex, Math.min(0.85, baseAlpha + 0.08)));
      ctx.fillStyle = glassGrad;
      ctx.fill();

      // Frosted specular streak
      ctx.save();
      traceBoxPath(ctx, x, y, w, h, radius, boxStyle);
      ctx.clip();
      const streak = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
      streak.addColorStop(0, 'rgba(255, 255, 255, 0.26)');
      streak.addColorStop(0.45, 'rgba(255, 255, 255, 0.05)');
      streak.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = streak;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    } else if (boxStyle === 'neon') {
      ctx.save();
      ctx.shadowColor = borderColor || '#22d3ee';
      ctx.shadowBlur = Math.round(14 + glowIntensity * 26);
      ctx.fillStyle = fillRgba;
      ctx.fill();
      ctx.restore();
    } else if (boxStyle === 'minimalOutline') {
      ctx.fillStyle = hexToRgba(fillColorHex, Math.min(opacity, 0.26));
      ctx.fill();
    } else if (boxStyle === 'broadcastBar') {
      const bGrad = ctx.createLinearGradient(0, y, 0, y + h);
      bGrad.addColorStop(0, hexToRgba(fillColorHex, Math.min(1, opacity)));
      bGrad.addColorStop(0.52, fillRgba);
      bGrad.addColorStop(1, darkenHex(fillColorHex, 0.34));
      ctx.fillStyle = bGrad;
      ctx.fill();

      // Side broadcast accent stripes
      ctx.save();
      traceBoxPath(ctx, x, y, w, h, radius, boxStyle);
      ctx.clip();
      ctx.fillStyle = borderColor || '#fbbf24';
      ctx.fillRect(x, y, 10, h);
      ctx.fillRect(x + w - 10, y, 10, h);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.fillRect(x, y, w, 4);
      ctx.restore();
    } else if (boxStyle === 'pill3d') {
      const pGrad = ctx.createLinearGradient(0, y, 0, y + h);
      pGrad.addColorStop(0, hexToRgba(fillColorHex, Math.min(1, opacity)));
      pGrad.addColorStop(0.55, fillRgba);
      pGrad.addColorStop(1, darkenHex(fillColorHex, 0.22));
      ctx.fillStyle = pGrad;
      ctx.fill();
    } else if (boxStyle === 'millionaireHex' || boxStyle === 'chamfer') {
      const hexGrad = ctx.createLinearGradient(0, y, 0, y + h);
      hexGrad.addColorStop(0, hexToRgba(fillColorHex, Math.min(1, opacity)));
      hexGrad.addColorStop(0.5, fillRgba);
      hexGrad.addColorStop(1, darkenHex(fillColorHex, 0.28));
      ctx.fillStyle = hexGrad;
      ctx.fill();
    } else {
      ctx.fillStyle = fillRgba;
      ctx.fill();
    }

    // 5. Recessed Inner Hollow or Special Inner Detail
    if (boxStyle === 'inset') {
      ctx.save();
      traceBoxPath(ctx, x, y, w, h, radius, boxStyle);
      ctx.clip();

      const topShadow = ctx.createLinearGradient(0, y, 0, y + Math.min(40, h * 0.42));
      topShadow.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
      topShadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = topShadow;
      ctx.fillRect(x, y, w, Math.min(40, h * 0.42));

      const botLight = ctx.createLinearGradient(0, y + h - Math.min(28, h * 0.3), 0, y + h);
      botLight.addColorStop(0, 'rgba(255, 255, 255, 0)');
      botLight.addColorStop(1, 'rgba(255, 255, 255, 0.22)');
      ctx.fillStyle = botLight;
      ctx.fillRect(x, y + h - Math.min(28, h * 0.3), w, Math.min(28, h * 0.3));

      if (w > 24 && h > 24) {
        traceBoxPath(ctx, x + 5, y + 5, w - 10, h - 10, Math.max(0, radius - 5), boxStyle);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.24)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.restore();
    } else if (boxStyle === 'ticket' && w > 80 && h > 40) {
      ctx.save();
      ctx.strokeStyle = hexToRgba(borderColor || '#FFFFFF', 0.38);
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(x + 26, y + 10);
      ctx.lineTo(x + 26, y + h - 10);
      ctx.moveTo(x + w - 26, y + 10);
      ctx.lineTo(x + w - 26, y + h - 10);
      ctx.stroke();
      ctx.restore();
    } else if ((boxGloss || enhanced) && boxStyle !== 'neon' && boxStyle !== 'minimalOutline') {
      applyBoxGloss(ctx, x, y, w, h, radius, enhanced, boxStyle);
    }
  }

  // 6. Box Border Styling
  if (drawBorder && (borderWidth > 0 || boxStyle === 'minimalOutline' || borderStyle === 'cornerBrackets')) {
    const effLineW = Math.max(boxStyle === 'minimalOutline' ? 3 : 1.5, borderWidth);
    ctx.save();
    if (boxStyle === 'neon' || glowIntensity > 0.25) {
      ctx.shadowColor = borderColor || '#22d3ee';
      ctx.shadowBlur = Math.round((boxStyle === 'neon' ? 16 : 8) + glowIntensity * 20);
    }

    if (borderStyle === 'dashedGold') {
      ctx.setLineDash([14, 8]);
    }

    traceBoxPath(ctx, x, y, w, h, radius, boxStyle);
    ctx.strokeStyle = resolveBoxStrokeStyle(ctx, x, y, w, h, borderColor, borderStyle);
    ctx.lineWidth = borderStyle === 'cornerBrackets' ? Math.max(1.5, effLineW * 0.45) : effLineW;
    ctx.stroke();
    ctx.setLineDash([]);

    if (borderStyle === 'cornerBrackets' && w > 40 && h > 40) {
      const bLen = Math.min(28, Math.min(w, h) * 0.24);
      const bOff = 4;
      ctx.strokeStyle = borderColor || '#fb7185';
      ctx.lineWidth = Math.max(4, effLineW + 1.5);
      ctx.lineCap = 'round';
      ctx.beginPath();
      // Top-left
      ctx.moveTo(x - bOff, y + bLen);
      ctx.lineTo(x - bOff, y - bOff);
      ctx.lineTo(x + bLen, y - bOff);
      // Top-right
      ctx.moveTo(x + w - bLen, y - bOff);
      ctx.lineTo(x + w + bOff, y - bOff);
      ctx.lineTo(x + w + bOff, y + bLen);
      // Bottom-left
      ctx.moveTo(x - bOff, y + h - bLen);
      ctx.lineTo(x - bOff, y + h + bOff);
      ctx.lineTo(x + bLen, y + h + bOff);
      // Bottom-right
      ctx.moveTo(x + w - bLen, y + h + bOff);
      ctx.lineTo(x + w + bOff, y + h + bOff);
      ctx.lineTo(x + w + bOff, y + h - bLen);
      ctx.stroke();
    } else if (borderStyle === 'double' && w > 28 && h > 28) {
      ctx.shadowBlur = 0;
      traceBoxPath(ctx, x + 7, y + 7, w - 14, h - 14, Math.max(0, radius - 6), boxStyle);
      ctx.strokeStyle = hexToRgba(borderColor || '#FFFFFF', 0.65);
      ctx.lineWidth = Math.max(1.5, effLineW * 0.42);
      ctx.stroke();
    } else if (boxStyle === 'neon' && w > 18 && h > 18) {
      ctx.shadowBlur = 0;
      traceBoxPath(ctx, x + 2, y + 2, w - 4, h - 4, Math.max(0, radius - 2), boxStyle);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    } else if ((boxStyle === 'millionaireHex' || boxStyle === 'chamfer') && w > 28 && h > 28) {
      ctx.shadowBlur = 0;
      traceBoxPath(ctx, x + 5, y + 5, w - 10, h - 10, Math.max(0, radius - 5), boxStyle);
      ctx.strokeStyle = 'rgba(255, 244, 196, 0.32)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
}

const wrapCache = new Map<string, string[]>();

export function clearRendererCaches(): void {
  wrapCache.clear();
  bgCacheKey = '';
}

export async function ensureQuizFontsLoaded(primaryFont = 'Cairo'): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const families = Array.from(new Set([primaryFont, 'Cairo', 'Tajawal', 'Amiri', 'JetBrains Mono']));
  const loads: Promise<unknown>[] = [];
  for (const fam of families) {
    const weights = fam === 'JetBrains Mono' ? ['700', '800'] : ['700', '800', '900'];
    const sizes = fam === 'JetBrains Mono' ? ['42px', '64px'] : ['34px', '52px', '72px'];
    for (const w of weights) {
      for (const sz of sizes) {
        try {
          loads.push(document.fonts.load(`${w} ${sz} '${fam}'`).catch(() => []));
        } catch {
          // ignore
        }
      }
    }
  }
  const waitFonts = Promise.all([document.fonts.ready.catch(() => undefined), ...loads]).catch(
    () => undefined
  );
  const timeout = new Promise<void>((resolve) => {
    window.setTimeout(resolve, 3500);
  });
  await Promise.race([waitFonts, timeout]);
  wrapCache.clear();
}

export function wrapArabicText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const safeMaxW = Math.max(40, maxWidth);
  const key = `${ctx.font}|${Math.round(safeMaxW)}|${text}`;
  const cached = wrapCache.get(key);
  if (cached) return cached;

  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
      const testLine = `${currentLine} ${words[i]}`;
      if (ctx.measureText(testLine).width <= safeMaxW) {
        currentLine = testLine;
      } else {
        lines.push(currentLine);
        currentLine = words[i];
      }
    }
    lines.push(currentLine);
  }

  if (wrapCache.size >= 500) {
    wrapCache.clear();
  }
  wrapCache.set(key, lines);
  return lines;
}

function getOptionBadgeLabel(index: number, style: TemplateSettings['optionLabelStyle']): string {
  if (style === 'arabic') return ['أ', 'ب', 'ج', 'د'][index] ?? '';
  if (style === 'numbers') return String(index + 1);
  if (style === 'english') return ['A', 'B', 'C', 'D'][index] ?? '';
  return '';
}

const imageCache = new Map<string, HTMLImageElement>();
let blurPassCanvasA: HTMLCanvasElement | null = null;
let blurPassCanvasB: HTMLCanvasElement | null = null;

function drawImageWithFit(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  srcW: number,
  srcH: number,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: ImageFitMode = 'cover'
): void {
  if (srcW <= 0 || srcH <= 0 || w <= 0 || h <= 0) return;
  if (fit === 'contain') {
    const scale = Math.min(w / srcW, h / srcH);
    const dw = srcW * scale;
    const dh = srcH * scale;
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    ctx.drawImage(img, 0, 0, srcW, srcH, dx, dy, dw, dh);
  } else {
    const scale = Math.max(w / srcW, h / srcH);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (srcW - sw) / 2;
    const sy = (srcH - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }
}

function drawBlurredChallengeImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  blurStrength: number,
  mysteryAlpha: number,
  fontStack: string,
  fit: ImageFitMode = 'cover',
  imgMode: ImageChallengeMode = 'normal',
  revealProgress01 = 1
): void {
  const natW = img.naturalWidth || img.width || 1;
  const natH = img.naturalHeight || img.height || 1;

  if (imgMode === 'zoomOutReveal') {
    const t = easeOutCubic(clamp01(revealProgress01));
    const zoom = 3.2 - 2.2 * t;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(zoom, zoom);
    drawImageWithFit(ctx, img, natW, natH, -w / 2, -h / 2, w, h, fit);
    ctx.restore();
    if (revealProgress01 < 0.96) {
      ctx.save();
      ctx.globalAlpha *= 0.85 * (1 - revealProgress01);
      ctx.font = `800 ${Math.max(18, Math.round(Math.min(w, h) * 0.11))}px ${fontStack}`;
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#EDD6A2';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 8;
      ctx.fillText('خمّن ما في الصورة 🔍', x + w / 2, y + h - 10);
      ctx.restore();
    }
    return;
  }

  if (imgMode === 'tileGridReveal') {
    drawImageWithFit(ctx, img, natW, natH, x, y, w, h, fit);
    if (revealProgress01 < 0.99) {
      const cols = 3;
      const rows = 2;
      const order = [0, 4, 2, 5, 1, 3]; // Engaging criss-cross reveal order
      const openCount = Math.floor(clamp01(revealProgress01) * (cols * rows));
      const tileW = w / cols;
      const tileH = h / rows;

      ctx.save();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const rank = order.indexOf(idx);
          const localOpen = clamp01(revealProgress01 * (cols * rows) - rank);
          if (rank < openCount && localOpen >= 1) continue;
          const tileAlpha = 1 - easeOutCubic(localOpen);
          if (tileAlpha <= 0.02) continue;

          const tx = x + c * tileW;
          const ty = y + r * tileH;
          ctx.save();
          ctx.globalAlpha *= tileAlpha;
          ctx.fillStyle = (r + c) % 2 === 0 ? '#0f172a' : '#1e293b';
          ctx.fillRect(tx + 1, ty + 1, tileW - 2, tileH - 2);
          ctx.strokeStyle = 'rgba(237, 214, 162, 0.55)';
          ctx.lineWidth = 2;
          ctx.strokeRect(tx + 1.5, ty + 1.5, tileW - 3, tileH - 3);

          ctx.font = `900 ${Math.max(18, Math.round(Math.min(tileW, tileH) * 0.42))}px ${fontStack}`;
          ctx.fillStyle = '#EDD6A2';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('؟', tx + tileW / 2, ty + tileH / 2 + 2);
          ctx.restore();
        }
      }
      ctx.restore();
    }
    return;
  }

  if (blurStrength <= 0.8 || typeof document === 'undefined') {
    drawImageWithFit(ctx, img, natW, natH, x, y, w, h, fit);
    return;
  }

  // Deterministic 2-stage bilinear downscale/upscale blur (artifact-free across all mobile WebViews & exports)
  if (!blurPassCanvasA) blurPassCanvasA = document.createElement('canvas');
  if (!blurPassCanvasB) blurPassCanvasB = document.createElement('canvas');

  const div = Math.max(2, blurStrength * 0.72);
  const smallW = Math.max(5, Math.round(w / div));
  const smallH = Math.max(5, Math.round(h / div));
  const midW = Math.max(smallW * 2, Math.round(w / Math.max(2, div * 0.45)));
  const midH = Math.max(smallH * 2, Math.round(h / Math.max(2, div * 0.45)));

  blurPassCanvasA.width = midW;
  blurPassCanvasA.height = midH;
  const ctxA = blurPassCanvasA.getContext('2d');
  if (ctxA) {
    ctxA.imageSmoothingEnabled = true;
    ctxA.imageSmoothingQuality = 'high';
    ctxA.clearRect(0, 0, midW, midH);
    drawImageWithFit(ctxA, img, natW, natH, 0, 0, midW, midH, fit);
  }

  blurPassCanvasB.width = smallW;
  blurPassCanvasB.height = smallH;
  const ctxB = blurPassCanvasB.getContext('2d');
  if (ctxB && ctxA) {
    ctxB.imageSmoothingEnabled = true;
    ctxB.imageSmoothingQuality = 'high';
    ctxB.clearRect(0, 0, smallW, smallH);
    ctxB.drawImage(blurPassCanvasA, 0, 0, smallW, smallH);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(blurPassCanvasB, x, y, w, h);
    ctx.restore();
  } else {
    drawImageWithFit(ctx, img, natW, natH, x, y, w, h, fit);
  }

  if (mysteryAlpha > 0.04) {
    ctx.save();
    ctx.globalAlpha *= clamp01(mysteryAlpha);
    ctx.fillStyle = 'rgba(8, 12, 24, 0.24)';
    ctx.fillRect(x, y, w, h);

    const badgeR = Math.max(26, Math.min(44, Math.min(w, h) * 0.18));
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(11, 15, 23, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(237, 214, 162, 0.85)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = `900 ${Math.round(badgeR * 1.15)}px ${fontStack}`;
    ctx.fillStyle = '#EDD6A2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('؟', cx, cy + 2);
    ctx.restore();
  }
}

function loadImageCached(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  const cached = imageCache.get(src);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached);
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (res: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(res);
    };
    const timer = window.setTimeout(() => done(null), 8000);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.set(src, img);
      done(img);
    };
    img.onerror = () => done(null);
    img.src = src;
  });
}

function getCachedImage(src?: string): HTMLImageElement | null {
  if (!src) return null;
  const cached = imageCache.get(src);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return cached;
  }
  void loadImageCached(src);
  return null;
}

function getTemplateBgSrc(template: TemplateSettings): string {
  if (template.backgroundType === 'custom' && template.customBgDataUrl) {
    return template.customBgDataUrl;
  }
  if (template.backgroundType === 'preset') {
    const preset = PRESET_BACKDROPS.find((p) => p.id === template.presetId) ?? PRESET_BACKDROPS[0];
    if (template.aspectRatio === '16:9' && preset.wideSrc) {
      return preset.wideSrc;
    }
    return preset.src ?? '';
  }
  return '';
}

export async function preloadTemplateBackground(
  template: TemplateSettings,
  slides?: QuestionSlide[]
): Promise<HTMLImageElement | null> {
  const tasks: Promise<unknown>[] = [];
  const bgSrc = getTemplateBgSrc(template);
  const bgPromise = bgSrc ? loadImageCached(bgSrc) : Promise.resolve(null);
  tasks.push(bgPromise);

  if (template.brandLogoDataUrl) {
    tasks.push(loadImageCached(template.brandLogoDataUrl));
  }

  if (slides && slides.length > 0) {
    for (const s of slides) {
      if (s.imageDataUrl) {
        tasks.push(loadImageCached(s.imageDataUrl));
      }
      if (Array.isArray(s.optionImages)) {
        for (const oi of s.optionImages) {
          if (oi?.dataUrl) {
            tasks.push(loadImageCached(oi.dataUrl));
          }
        }
      }
    }
  }

  tasks.push(preloadPresenterAssets(template, slides));

  await Promise.all(tasks);
  return bgPromise;
}

function getLoadedBackgroundImage(template: TemplateSettings): HTMLImageElement | null {
  return getCachedImage(getTemplateBgSrc(template));
}

// Fast resolved loader (countdown renders deterministically via vector typography for 1:1 preview/export)
export function preloadTimerVideo(): Promise<HTMLVideoElement | null> {
  return Promise.resolve(null);
}

let bgCacheCanvas: HTMLCanvasElement | null = null;
let bgCacheKey = '';

function drawProceduralPresetDecor(
  bctx: CanvasRenderingContext2D,
  presetId: string,
  W: number,
  H: number
): void {
  if (presetId === 'millionaire' || presetId === 'tvShowGold' || presetId === 'royalPurple') {
    const isMill = presetId === 'millionaire';
    const isRoyal = presetId === 'royalPurple';
    const beamColor = isMill
      ? 'rgba(110, 170, 255, 0.14)'
      : isRoyal
        ? 'rgba(192, 132, 252, 0.16)'
        : 'rgba(250, 204, 21, 0.13)';
    for (const srcX of [W * 0.12, W * 0.88]) {
      const grad = bctx.createLinearGradient(srcX, 0, W * 0.5, H * 0.72);
      grad.addColorStop(0, beamColor);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      bctx.fillStyle = grad;
      bctx.beginPath();
      bctx.moveTo(srcX - 70, 0);
      bctx.lineTo(srcX + 70, 0);
      bctx.lineTo(W * 0.5 + W * 0.38, H * 0.85);
      bctx.lineTo(W * 0.5 - W * 0.38, H * 0.85);
      bctx.closePath();
      bctx.fill();
    }

    bctx.save();
    bctx.strokeStyle = isMill
      ? 'rgba(229, 184, 75, 0.11)'
      : isRoyal
        ? 'rgba(251, 191, 36, 0.12)'
        : 'rgba(250, 204, 21, 0.09)';
    bctx.lineWidth = 2;
    const cx = W * 0.5;
    const cy = H * 0.42;
    for (const r of [W * 0.22, W * 0.34, W * 0.48]) {
      bctx.beginPath();
      bctx.arc(cx, cy, r, 0, Math.PI * 2);
      bctx.stroke();
    }
    bctx.restore();
  } else if (presetId === 'neonCyber' || presetId === 'crimsonArena') {
    const isCrimson = presetId === 'crimsonArena';
    bctx.save();
    bctx.strokeStyle = isCrimson ? 'rgba(244, 63, 94, 0.08)' : 'rgba(34, 211, 238, 0.07)';
    bctx.lineWidth = 1.5;
    const step = 90;
    for (let x = 0; x <= W; x += step) {
      bctx.beginPath();
      bctx.moveTo(x, 0);
      bctx.lineTo(x, H);
      bctx.stroke();
    }
    for (let y = 0; y <= H; y += step) {
      bctx.beginPath();
      bctx.moveTo(0, y);
      bctx.lineTo(W, y);
      bctx.stroke();
    }
    const glow1 = bctx.createRadialGradient(W * 0.2, H * 0.2, 20, W * 0.2, H * 0.2, W * 0.45);
    glow1.addColorStop(0, isCrimson ? 'rgba(244, 63, 94, 0.22)' : 'rgba(34, 211, 238, 0.18)');
    glow1.addColorStop(1, 'rgba(0, 0, 0, 0)');
    bctx.fillStyle = glow1;
    bctx.fillRect(0, 0, W, H);

    const glow2 = bctx.createRadialGradient(W * 0.82, H * 0.78, 20, W * 0.82, H * 0.78, W * 0.45);
    glow2.addColorStop(0, isCrimson ? 'rgba(251, 146, 60, 0.16)' : 'rgba(236, 72, 153, 0.16)');
    glow2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    bctx.fillStyle = glow2;
    bctx.fillRect(0, 0, W, H);
    bctx.restore();
  } else if (presetId === 'arcticCyan') {
    bctx.save();
    const aurora = bctx.createLinearGradient(0, 0, W, H * 0.65);
    aurora.addColorStop(0, 'rgba(56, 189, 248, 0.18)');
    aurora.addColorStop(0.5, 'rgba(186, 230, 253, 0.08)');
    aurora.addColorStop(1, 'rgba(14, 165, 233, 0)');
    bctx.fillStyle = aurora;
    bctx.fillRect(0, 0, W, H);
    bctx.strokeStyle = 'rgba(186, 230, 253, 0.12)';
    bctx.lineWidth = 2;
    for (const r of [W * 0.28, W * 0.46]) {
      bctx.beginPath();
      bctx.arc(W * 0.5, H * 0.28, r, 0, Math.PI * 2);
      bctx.stroke();
    }
    bctx.restore();
  } else if (presetId === 'sunsetCinema') {
    bctx.save();
    const sunGlow = bctx.createRadialGradient(W * 0.5, H * 0.26, 20, W * 0.5, H * 0.26, W * 0.56);
    sunGlow.addColorStop(0, 'rgba(251, 146, 60, 0.26)');
    sunGlow.addColorStop(0.55, 'rgba(244, 63, 94, 0.12)');
    sunGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    bctx.fillStyle = sunGlow;
    bctx.fillRect(0, 0, W, H);
    bctx.restore();
  } else if (presetId === 'ramadanLantern') {
    bctx.save();
    bctx.strokeStyle = 'rgba(234, 179, 8, 0.28)';
    bctx.lineWidth = 3;
    bctx.strokeRect(26, 26, W - 52, H - 52);
    bctx.strokeStyle = 'rgba(234, 179, 8, 0.14)';
    bctx.lineWidth = 1.5;
    bctx.strokeRect(42, 42, W - 84, H - 84);
    // Subtle eight-point stars in corners
    const stars = [
      [88, 88],
      [W - 88, 88],
      [88, H - 88],
      [W - 88, H - 88],
    ];
    bctx.fillStyle = 'rgba(253, 230, 138, 0.16)';
    for (const [sx, sy] of stars) {
      bctx.save();
      bctx.translate(sx, sy);
      bctx.fillRect(-16, -16, 32, 32);
      bctx.rotate(Math.PI / 4);
      bctx.fillRect(-16, -16, 32, 32);
      bctx.restore();
    }
    bctx.restore();
  } else if (presetId === 'mintEditorial') {
    bctx.save();
    bctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
    bctx.beginPath();
    bctx.arc(W * 0.14, H * 0.16, W * 0.22, 0, Math.PI * 2);
    bctx.fill();
    bctx.beginPath();
    bctx.arc(W * 0.88, H * 0.84, W * 0.26, 0, Math.PI * 2);
    bctx.fill();
    bctx.restore();
  } else if (presetId === 'parchmentGold') {
    bctx.save();
    bctx.strokeStyle = 'rgba(181, 132, 40, 0.35)';
    bctx.lineWidth = 4;
    bctx.strokeRect(28, 28, W - 56, H - 56);
    bctx.strokeStyle = 'rgba(181, 132, 40, 0.22)';
    bctx.lineWidth = 2;
    bctx.strokeRect(42, 42, W - 84, H - 84);
    bctx.restore();
  } else if (presetId === 'playfulKids') {
    bctx.save();
    const bubbles = [
      { x: 0.16, y: 0.18, r: 120, c: 'rgba(255,255,255,0.08)' },
      { x: 0.85, y: 0.24, r: 90, c: 'rgba(250,204,21,0.1)' },
      { x: 0.18, y: 0.82, r: 140, c: 'rgba(56,189,248,0.1)' },
      { x: 0.82, y: 0.74, r: 105, c: 'rgba(255,255,255,0.08)' },
    ];
    for (const b of bubbles) {
      bctx.beginPath();
      bctx.arc(W * b.x, H * b.y, b.r, 0, Math.PI * 2);
      bctx.fillStyle = b.c;
      bctx.fill();
    }
    bctx.restore();
  }
}

function drawCachedBackdrop(
  ctx: CanvasRenderingContext2D,
  template: TemplateSettings,
  globalTime: number,
  W: number,
  H: number
): void {
  const bgImg = template.backgroundType !== 'color' ? getLoadedBackgroundImage(template) : null;
  const imgSrc = bgImg ? getTemplateBgSrc(template) : '';
  const nextKey = [
    W,
    H,
    template.backgroundType,
    template.presetId,
    template.solidBgColor,
    template.bgDimOpacity.toFixed(3),
    imgSrc,
    bgImg ? '1' : '0',
  ].join('|');

  if (typeof document !== 'undefined') {
    if (!bgCacheCanvas) {
      bgCacheCanvas = document.createElement('canvas');
    }
    if (bgCacheCanvas.width !== W || bgCacheCanvas.height !== H) {
      bgCacheCanvas.width = W;
      bgCacheCanvas.height = H;
      bgCacheKey = '';
    }

    if (bgCacheKey !== nextKey) {
      const bctx = bgCacheCanvas.getContext('2d', { alpha: false });
      if (bctx) {
        bctx.imageSmoothingEnabled = true;
        bctx.imageSmoothingQuality = 'high';
        bctx.fillStyle = template.solidBgColor || '#0c0c0c';
        bctx.fillRect(0, 0, W, H);

        if (template.backgroundType === 'preset') {
          const preset = PRESET_BACKDROPS.find((p) => p.id === template.presetId);
          if (preset?.gradientInner && preset?.gradientOuter) {
            const cx = W * 0.5;
            const cy = H * 0.35;
            const radius = Math.max(W, H) * (preset.gradientStop ?? 0.7);
            const grad = bctx.createRadialGradient(cx, cy, 40, cx, cy, radius);
            grad.addColorStop(0, preset.gradientInner);
            grad.addColorStop(1, preset.gradientOuter);
            bctx.fillStyle = grad;
            bctx.fillRect(0, 0, W, H);
          }
          drawProceduralPresetDecor(bctx, template.presetId, W, H);
        }

        if (bgImg) {
          const imgAspect = bgImg.naturalWidth / bgImg.naturalHeight;
          const canvasAspect = W / H;
          let drawW = W;
          let drawH = H;
          let offsetX = 0;
          let offsetY = 0;

          if (imgAspect > canvasAspect) {
            drawH = H;
            drawW = drawH * imgAspect;
            offsetX = (W - drawW) / 2;
          } else {
            drawW = W;
            drawH = drawW / imgAspect;
            offsetY = (H - drawH) / 2;
          }
          bctx.drawImage(bgImg, offsetX, offsetY, drawW, drawH);
        }

        if (template.bgDimOpacity > 0) {
          bctx.fillStyle = `rgba(0, 0, 0, ${clamp01(template.bgDimOpacity)})`;
          bctx.fillRect(0, 0, W, H);
        }

        bgCacheKey = nextKey;
      }
    }

    const motion = template.bgMotion || 'none';
    if (motion === 'slowZoom' || motion === 'zoomAndParticles') {
      const zoom = 1 + 0.06 * (0.5 + 0.5 * Math.sin(globalTime * 0.42 - Math.PI / 2));
      const panX = Math.sin(globalTime * 0.25) * 14;
      const panY = Math.cos(globalTime * 0.22) * 10;
      ctx.save();
      ctx.translate(W / 2 + panX, H / 2 + panY);
      ctx.scale(zoom, zoom);
      ctx.drawImage(bgCacheCanvas, -W / 2, -H / 2);
      ctx.restore();
    } else {
      ctx.drawImage(bgCacheCanvas, 0, 0);
    }

    if (motion === 'particles' || motion === 'zoomAndParticles') {
      drawAmbientParticles(ctx, template, globalTime, W, H);
    }
    return;
  }

  ctx.fillStyle = template.solidBgColor || '#0c0c0c';
  ctx.fillRect(0, 0, W, H);
}

function drawAmbientParticles(
  ctx: CanvasRenderingContext2D,
  template: TemplateSettings,
  globalTime: number,
  W: number,
  H: number
): void {
  const isNeon =
    template.presetId === 'neonCyber' ||
    template.presetId === 'cosmicSpace' ||
    template.borderStyle === 'gradientNeon';
  const isSpace = template.presetId === 'cosmicSpace';
  const isStadium = template.presetId === 'stadiumArena';
  const isCyan = template.presetId === 'arcticCyan';
  const isSunset = template.presetId === 'sunsetCinema' || template.presetId === 'crimsonArena';
  const isGold =
    template.presetId === 'millionaire' ||
    template.presetId === 'tvShowGold' ||
    template.presetId === 'channelSand' ||
    template.presetId === 'parchmentGold' ||
    template.presetId === 'royalPurple' ||
    template.presetId === 'ramadanLantern' ||
    template.presetId === 'islamicAndalusian' ||
    template.presetId === 'ancientHistory' ||
    template.borderStyle === 'gradientGold';

  ctx.save();
  const count = isSpace || isStadium ? 32 : 24;
  for (let i = 0; i < count; i++) {
    const seedX = ((i * 197 + 43) % 100) / 100;
    const seedY = ((i * 313 + 71) % 100) / 100;
    const speedY = isStadium ? 0.045 + (i % 5) * 0.01 : 0.025 + (i % 5) * 0.008;
    const sway = Math.sin(globalTime * (0.6 + (i % 4) * 0.2) + i) * 26;
    const x = seedX * W + sway;
    const y = (((seedY - globalTime * speedY) % 1) + 1) % 1 * H;
    const radius = 3 + (i % 4) * 2.5;
    const alpha = 0.18 + 0.26 * (0.5 + 0.5 * Math.sin(globalTime * 2.1 + i * 1.3));

    const color = isStadium
      ? i % 2 === 0
        ? `rgba(74, 222, 128, ${alpha.toFixed(3)})`
        : `rgba(255, 255, 255, ${(alpha * 0.9).toFixed(3)})`
      : isNeon
        ? i % 2 === 0
          ? `rgba(56, 189, 248, ${alpha.toFixed(3)})`
          : `rgba(192, 132, 252, ${alpha.toFixed(3)})`
        : isCyan
          ? `rgba(186, 230, 253, ${alpha.toFixed(3)})`
          : isSunset
            ? i % 2 === 0
              ? `rgba(251, 146, 60, ${alpha.toFixed(3)})`
              : `rgba(244, 63, 94, ${alpha.toFixed(3)})`
            : isGold
              ? `rgba(251, 211, 141, ${alpha.toFixed(3)})`
              : `rgba(255, 255, 255, ${alpha.toFixed(3)})`;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Subtle crisp 4-point star glint on space/islamic/stadium hero motes
    if ((isSpace || isStadium || template.presetId === 'islamicAndalusian') && i % 5 === 0) {
      const glintLen = radius * 2.8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x - glintLen, y);
      ctx.lineTo(x + glintLen, y);
      ctx.moveTo(x, y - glintLen);
      ctx.lineTo(x, y + glintLen);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function resolveBrandAnchor(
  template: TemplateSettings,
  W: number,
  H: number
): { anchorX: number; anchorY: number; size: number; handleHeight: number; handleEstW: number } {
  const handle = (template.brandHandleText || '').trim();
  const isWide = template.aspectRatio === '16:9';
  const baseSize = Math.max(48, Math.min(240, template.brandLogoSize || 108));
  const size = isWide ? Math.round(baseSize * 0.92) : baseSize;
  const pos = template.brandLogoPosition || 'topRight';

  const padX = isWide ? 48 : 36;
  const padY = isWide ? 38 : 66;
  const handleHeight = handle ? 32 : 0;
  const handleEstW = handle ? Math.min(260, Math.round(handle.length * (isWide ? 14 : 15)) + 28) : 0;
  const halfSpan = Math.max(size, handleEstW) / 2;

  let anchorX = W - padX - halfSpan;
  let anchorY = padY + size / 2;

  if (pos === 'custom') {
    anchorX = ((template.brandLogoX ?? 88) / 100) * W;
    anchorY = ((template.brandLogoY ?? 10) / 100) * H;
  } else if (pos === 'topLeft') {
    anchorX = padX + halfSpan;
    anchorY = padY + size / 2;
  } else if (pos === 'bottomRight') {
    anchorX = W - padX - halfSpan;
    anchorY = H - padY - handleHeight - size / 2 - (isWide ? 0 : 120);
  } else if (pos === 'bottomLeft') {
    anchorX = padX + halfSpan;
    anchorY = H - padY - handleHeight - size / 2 - (isWide ? 0 : 120);
  }

  const safeEdgeX = Math.min(padX, 24);
  anchorX = Math.max(safeEdgeX + halfSpan, Math.min(W - safeEdgeX - halfSpan, anchorX));
  anchorY = Math.max(16 + size / 2, Math.min(H - 16 - size / 2 - handleHeight, anchorY));

  return { anchorX, anchorY, size, handleHeight, handleEstW };
}

function drawBrandWatermark(
  ctx: CanvasRenderingContext2D,
  template: TemplateSettings,
  globalTime: number,
  W: number,
  H: number,
  fontStack: string
): void {
  const logoSrc = template.brandLogoDataUrl;
  const handle = (template.brandHandleText || '').trim();
  if (!logoSrc && !handle) return;

  const logoImg = logoSrc ? getCachedImage(logoSrc) : null;
  if (logoSrc && !logoImg && !handle) return;

  const isWide = template.aspectRatio === '16:9';
  const opacity = clamp01(template.brandOpacity ?? 0.92);
  const anim = template.brandLogoAnim || 'pulse';
  const { anchorX, anchorY, size } = resolveBrandAnchor(template, W, H);

  let scale = 1;
  let offsetY = 0;
  let rotation = 0;
  let glowAlpha = 0;

  if (anim === 'pulse') {
    scale = 1 + 0.065 * Math.sin(globalTime * 3.5);
  } else if (anim === 'float') {
    offsetY = Math.sin(globalTime * 2.5) * 9;
  } else if (anim === 'glow') {
    glowAlpha = 0.25 + 0.28 * (0.5 + 0.5 * Math.sin(globalTime * 3.2));
    scale = 1 + 0.03 * Math.sin(globalTime * 3.2);
  } else if (anim === 'spin') {
    rotation = (globalTime * 0.9) % (Math.PI * 2);
  }

  ctx.save();
  ctx.globalAlpha = opacity;

  if (logoImg) {
    ctx.save();
    ctx.translate(anchorX, anchorY + offsetY);

    if (glowAlpha > 0) {
      const rg = ctx.createRadialGradient(0, 0, size * 0.2, 0, 0, size * 0.78);
      rg.addColorStop(0, `rgba(237, 214, 162, ${glowAlpha.toFixed(3)})`);
      rg.addColorStop(1, 'rgba(237, 214, 162, 0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.78, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.scale(scale, scale);
    if (rotation !== 0) {
      ctx.rotate(rotation);
    }

    // Clip into smooth rounded medallion so square or transparent logos both look clean
    const imgRatio = logoImg.naturalWidth / Math.max(1, logoImg.naturalHeight);
    let drawW = size;
    let drawH = size;
    if (imgRatio > 1) {
      drawH = size / imgRatio;
    } else if (imgRatio < 1) {
      drawW = size * imgRatio;
    }

    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.drawImage(logoImg, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }

  if (handle) {
    const labelY = logoImg ? anchorY + size / 2 + 20 + offsetY : anchorY + offsetY;
    ctx.font = `700 ${isWide ? 24 : 26}px ${fontStack}`;
    ctx.direction = 'ltr';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textW = ctx.measureText(handle).width;
    const pillW = Math.min(260, textW + 24);
    const pillH = 34;
    const pillCX = Math.max(16 + pillW / 2, Math.min(W - 16 - pillW / 2, anchorX));

    drawRoundedRect(ctx, pillCX - pillW / 2, labelY - pillH / 2, pillW, pillH, 10);
    ctx.fillStyle = 'rgba(11, 15, 23, 0.68)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(237, 214, 162, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#EDD6A2';
    ctx.fillText(handle, pillCX, labelY + 1);
  }

  ctx.restore();
}

function drawRevealConfetti(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  revealElapsed: number
): void {
  if (revealElapsed < 0 || revealElapsed > 2.4) return;
  const palette = ['#00B050', '#EDD6A2', '#38BDF8', '#F43F5E', '#FACC15', '#FFFFFF'];
  const fade = revealElapsed > 1.5 ? clamp01(1 - (revealElapsed - 1.5) / 0.9) : 1;

  ctx.save();
  ctx.globalAlpha *= fade;
  const count = 34;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.17;
    const speed = 260 + (i % 7) * 95;
    const dist = speed * revealElapsed * (1 - 0.18 * Math.min(1, revealElapsed));
    const px = originX + Math.cos(angle) * dist;
    const py = originY + Math.sin(angle) * dist * 0.72 + 240 * revealElapsed * revealElapsed;
    const rot = i * 0.7 + revealElapsed * (4 + (i % 4));
    const w = 12 + (i % 4) * 4;
    const h = 7 + (i % 3) * 2;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rot);
    ctx.fillStyle = palette[i % palette.length];
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.restore();
}

function getPrizeLadderMetrics(
  template: TemplateSettings,
  slideCount: number,
  W: number,
  H: number,
  hasDiffPill: boolean
): {
  mode: 'sideColumn' | 'topStrip';
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  if (!template.showPrizeLadder || slideCount <= 0) return null;
  const isWide = template.aspectRatio === '16:9';
  const style = template.prizeLadderStyle || 'topStrip';

  if (style === 'sideColumn' && isWide) {
    const panelTop = hasDiffPill ? 84 : 68;
    const panelBottom = H - 64;
    return {
      mode: 'sideColumn',
      x: 34,
      y: panelTop,
      w: 248,
      h: panelBottom - panelTop,
    };
  }

  const hasCornerBrandTop =
    Boolean(template.brandLogoDataUrl || (template.brandHandleText || '').trim()) &&
    (template.brandLogoPosition === 'topRight' ||
      template.brandLogoPosition === 'topLeft' ||
      !template.brandLogoPosition);

  let topOffset =
    template.showProgressCounter && slideCount > 1
      ? isWide
        ? 92
        : 126
      : isWide
        ? 36
        : hasDiffPill
          ? 112
          : 76;

  // Compute safe horizontal corridor between corner brand & diffPill if strip shares top row
  const stripH = style === 'sideColumn' ? 92 : 74;
  let maxAvailableStripW = isWide ? 780 : 820;
  if (hasCornerBrandTop) {
    const bAnchor = resolveBrandAnchor(template, W, H);
    const brandHandleW = (template.brandHandleText || '').trim() ? 260 : 0;
    const brandSpanW = Math.max(bAnchor.size, brandHandleW);
    const brandEdgeDist = (isWide ? 48 : 36) + brandSpanW + 18;
    const clearBetweenCorners = W - Math.max(brandEdgeDist * 2, (hasDiffPill ? 196 : 0) + brandEdgeDist);
    if (clearBetweenCorners < 460) {
      // Drop topStrip cleanly below the corner brand so it NEVER overlaps logo or handle
      const brandBottom = bAnchor.anchorY + bAnchor.size / 2 + (bAnchor.handleHeight > 0 ? 40 : 8);
      topOffset = Math.max(topOffset, brandBottom + 14);
      maxAvailableStripW = isWide ? 780 : W - 72;
    } else {
      maxAvailableStripW = Math.min(maxAvailableStripW, clearBetweenCorners);
    }
  } else if (hasDiffPill && topOffset < 104) {
    maxAvailableStripW = Math.min(maxAvailableStripW, W - 400);
  }

  const stripW = Math.max(440, Math.min(isWide ? 780 : 860, maxAvailableStripW));
  return {
    mode: 'topStrip',
    x: (W - stripW) / 2,
    y: topOffset,
    w: stripW,
    h: stripH,
  };
}

function drawPrizeLadder(
  ctx: CanvasRenderingContext2D,
  template: TemplateSettings,
  slideCount: number,
  activeSlideIndex: number,
  isRevealed: boolean,
  revealElapsed: number,
  W: number,
  H: number,
  fontStack: string,
  hasDiffPill: boolean
): void {
  const metrics = getPrizeLadderMetrics(template, slideCount, W, H, hasDiffPill);
  if (!metrics) return;

  const tiers = getSlidePrizeTiers(slideCount, template.prizeLadderAmounts);
  const currentAmount = tiers[Math.min(activeSlideIndex, tiers.length - 1)] || '';
  const isWide = template.aspectRatio === '16:9';
  const title = (template.prizeLadderTitle || 'الجائزة').trim();

  if (metrics.mode === 'sideColumn') {
    const { x: panelX, y: panelTop, w: panelW, h: panelH } = metrics;
    const maxVisible = Math.min(15, tiers.length);

    let startIdx = 0;
    if (tiers.length > maxVisible) {
      startIdx = Math.max(0, Math.min(tiers.length - maxVisible, activeSlideIndex - Math.floor(maxVisible / 2)));
    }
    const visibleTiers = tiers.slice(startIdx, startIdx + maxVisible);
    const rowH = Math.min(54, (panelH - 54) / Math.max(1, visibleTiers.length));
    const actualH = 54 + visibleTiers.length * rowH + 14;
    const startY = panelTop + (panelH - actualH) / 2;

    ctx.save();
    drawRoundedRect(ctx, panelX, startY, panelW, actualH, 22);
    ctx.fillStyle = 'rgba(6, 14, 42, 0.88)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(229, 184, 75, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.font = `800 22px ${fontStack}`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#EDD6A2';
    ctx.fillText(title || 'سلم الجوائز', panelX + panelW / 2, startY + 28);

    // Draw top-to-bottom descending (highest prize at top, lowest at bottom)
    for (let v = 0; v < visibleTiers.length; v++) {
      const tierIdx = startIdx + (visibleTiers.length - 1 - v);
      const amount = tiers[tierIdx];
      const ry = startY + 52 + v * rowH;
      const isCurrent = tierIdx === activeSlideIndex;
      const isWon = tierIdx < activeSlideIndex || (isCurrent && isRevealed);
      const isMilestone = tierIdx === tiers.length - 1 || tierIdx === 4 || tierIdx === 9;

      if (isCurrent) {
        traceBoxPath(ctx, panelX + 10, ry + 2, panelW - 20, rowH - 6, 12, 'millionaireHex');
        ctx.fillStyle = isRevealed
          ? '#00B050'
          : 'rgba(245, 158, 11, 0.92)';
        ctx.fill();
        ctx.strokeStyle = '#FFF3B0';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.font = `${isCurrent ? 900 : 700} ${isCurrent ? 22 : 19}px ${fontStack}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = isCurrent ? '#FFFFFF' : isWon ? '#6ee7b7' : isMilestone ? '#FFF3B0' : '#d4a73a';
      ctx.fillText(`${tierIdx + 1}`, panelX + panelW - 22, ry + rowH / 2 - 1);

      ctx.textAlign = 'left';
      ctx.direction = 'ltr';
      ctx.fillText(amount, panelX + 22, ry + rowH / 2 - 1);
      ctx.direction = 'rtl';
    }
    ctx.restore();
    return;
  }

  // Compact Top Strip (9:16 & 16:9 friendly)
  ctx.save();
  const { x: stripX, y: stripY, w: stripW, h: stripH } = metrics;

  traceBoxPath(ctx, stripX, stripY, stripW, stripH, 24, template.boxStyle || 'millionaireHex');
  ctx.fillStyle = 'rgba(7, 17, 52, 0.88)';
  ctx.fill();
  ctx.strokeStyle = resolveBoxStrokeStyle(
    ctx,
    stripX,
    stripY,
    stripW,
    stripH,
    '#d4a73a',
    'gradientGold'
  );
  ctx.lineWidth = 3;
  ctx.stroke();

  // Current tier badge on right (scales proportionally when narrow corner corridors exist)
  const badgeW = Math.min(240, Math.max(145, Math.round(stripW * 0.34)));
  const badgeX = stripX + stripW - badgeW - 18;
  const badgeY = stripY + 10;
  const badgeH = stripH - 20;
  const pulse = isRevealed && revealElapsed < 0.6 ? 1 + 0.06 * Math.sin((revealElapsed / 0.6) * Math.PI) : 1;

  ctx.save();
  ctx.translate(badgeX + badgeW / 2, badgeY + badgeH / 2);
  ctx.scale(pulse, pulse);
  traceBoxPath(ctx, -badgeW / 2, -badgeH / 2, badgeW, badgeH, 16, 'millionaireHex');
  ctx.fillStyle = isRevealed ? '#00B050' : '#d97706';
  ctx.fill();
  ctx.strokeStyle = '#FFF3B0';
  ctx.lineWidth = 2;
  ctx.stroke();

  let tierFont = badgeW < 190 ? 22 : isWide ? 28 : 30;
  ctx.font = `900 ${tierFont}px ${fontStack}`;
  while (tierFont > 16 && ctx.measureText(currentAmount).width > badgeW - 32) {
    tierFont -= 2;
    ctx.font = `900 ${tierFont}px ${fontStack}`;
  }
  ctx.direction = 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(currentAmount, 0, 1);
  ctx.restore();

  // Mini step ladder on left side of the strip
  const maxSteps = Math.min(6, tiers.length);
  let start = Math.max(0, activeSlideIndex - 2);
  if (start + maxSteps > tiers.length) {
    start = Math.max(0, tiers.length - maxSteps);
  }
  const visibleCount = Math.min(maxSteps, tiers.length - start);
  const stepsAreaW = stripW - badgeW - 56;
  const cellW = Math.min(92, (stepsAreaW - (visibleCount - 1) * 8) / Math.max(1, visibleCount));
  const totalRowW = visibleCount * cellW + Math.max(0, visibleCount - 1) * 8;
  const rowStartX = stripX + 24 + (stepsAreaW - totalRowW) / 2;

  for (let k = 0; k < visibleCount; k++) {
    // RTL progression: step 0 at right, higher steps toward left
    const idx = start + k;
    const visualCol = visibleCount - 1 - k;
    const cx = rowStartX + visualCol * (cellW + 8);
    const cy = stripY + (stripH - 42) / 2;
    const isCur = idx === activeSlideIndex;
    const isDone = idx < activeSlideIndex || (isCur && isRevealed);

    drawRoundedRect(ctx, cx, cy, cellW, 42, 10);
    ctx.fillStyle = isCur
      ? isRevealed
        ? 'rgba(0, 176, 80, 0.35)'
        : 'rgba(245, 158, 11, 0.32)'
      : isDone
        ? 'rgba(0, 176, 80, 0.18)'
        : 'rgba(255, 255, 255, 0.06)';
    ctx.fill();
    ctx.strokeStyle = isCur ? '#FACC15' : isDone ? '#34D399' : 'rgba(237, 214, 162, 0.25)';
    ctx.lineWidth = isCur ? 2 : 1;
    ctx.stroke();

    ctx.font = `${isCur ? 800 : 700} ${tiers[idx].length > 7 ? 15 : 17}px ${fontStack}`;
    ctx.direction = 'ltr';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isCur ? '#FFF3B0' : isDone ? '#6EE7B7' : 'rgba(255,255,255,0.65)';
    ctx.fillText(tiers[idx], cx + cellW / 2, cy + 22);
  }

  ctx.restore();
}

export interface StageLayerRect {
  x: number;
  y: number;
  w: number;
  h: number;
  outerX: number;
  outerY: number;
  outerW: number;
  outerH: number;
}

export interface StageLayerLayout {
  W: number;
  H: number;
  isWide: boolean;
  isFreeLayout: boolean;
  wideLeftBound: number;
  wideRightBound: number;
  wideAvailW: number;
  wideCenterX: number;
  shiftForWideLadder: number;
  topSafeFloor: number;
  bottomMargin: number;
  bottomSafeLimit: number;
  protrusions: {
    qTop: number;
    qBottom: number;
    qSide: number;
    optTop: number;
    optBottom: number;
    optSide: number;
  };
  header: {
    progress?: StageLayerRect;
    diffPill?: StageLayerRect;
    prizeLadder?: StageLayerRect;
    brand?: StageLayerRect;
  };
  badge?: StageLayerRect & {
    centerX: number;
    centerY: number;
    boxW: number;
    boxH: number;
    font: number;
    scale: number;
    text: string;
  };
  image?: StageLayerRect & {
    centerX: number;
    centerY: number;
    frameW: number;
    frameH: number;
    placement: QuestionImagePlacement;
  };
  question: StageLayerRect & {
    centerX: number;
    centerY: number;
    w: number;
    h: number;
    fontSize: number;
    lines: string[];
    lineHeight: number;
    hasMath: boolean;
    padX: number;
    padY: number;
    rawText: string;
    insideImage?: {
      x: number;
      y: number;
      w: number;
      h: number;
      layout: QuestionImageInsideLayout;
      textCenterX: number;
      textCenterY: number;
      textMaxW: number;
    };
  };
  options: {
    areaCenterX: number;
    startPx: number;
    bottomPx: number;
    totalH: number;
    totalW: number;
    optH: number;
    rowGap: number;
    colGap: number;
    customColGap: number;
    vertCenterGap: number;
    isCenteredVerticalSplit: boolean;
    verticalSplitIdx: number;
    extImgTopPad: number;
    extImgBottomPad: number;
    extImgHeight: number;
    items: (StageLayerRect & { centerX: number; centerY: number; boxW: number; boxH: number })[];
  };
  timer: StageLayerRect & {
    enabled: boolean;
    placement: TimerPlacement;
    centerX: number;
    centerY: number;
    boxW: number;
    boxH: number;
    effectiveScale: number;
    gapTop: number;
    gapBottom: number;
  };
  explanation?: StageLayerRect & {
    centerX: number;
    centerY: number;
    boxW: number;
    boxH: number;
    lines: string[];
    hasMath: boolean;
    fontSize: number;
    text: string;
  };
}

function makeLayerRect(
  x: number,
  y: number,
  w: number,
  h: number,
  padTop = 0,
  padBottom = 0,
  padLeft = 0,
  padRight = 0
): StageLayerRect {
  return {
    x,
    y,
    w,
    h,
    outerX: x - padLeft,
    outerY: y - padTop,
    outerW: w + padLeft + padRight,
    outerH: h + padTop + padBottom,
  };
}

export function rectsIntersect(a: StageLayerRect, b: StageLayerRect, minGap = 2): boolean {
  return (
    a.outerX < b.outerX + b.outerW + minGap &&
    a.outerX + a.outerW + minGap > b.outerX &&
    a.outerY < b.outerY + b.outerH + minGap &&
    a.outerY + a.outerH + minGap > b.outerY
  );
}

export function computeStageLayerLayout(
  ctx: CanvasRenderingContext2D,
  slide: QuestionSlide,
  slideCount: number,
  template: TemplateSettings,
  timing: TimingSettings,
  slideImgDimensions?: { width: number; height: number } | null
): StageLayerLayout {
  const { width: W, height: H } = getCanvasDimensions(template);
  const isWide = template.aspectRatio === '16:9';
  const isFreeLayout = Boolean(template.freeLayoutMode);
  const fontStack = `'${template.fontFamily}', 'Cairo', 'Tajawal', sans-serif`;
  const isChannelLayout = template.optionsLayout === 'channel2x2';
  const isTrueFalse = slide.slideType === 'trueFalse';
  const isVersus = slide.slideType === 'versus';
  const isClues = slide.slideType === 'clues';
  const isMultiple3 = slide.slideType === 'multiple3';
  const isTwoOptionSideBySide = isTrueFalse || isVersus;
  const boxStyle: BoxShapeStyle = template.boxStyle || 'flat';
  const borderStyle: BoxBorderStyle = template.borderStyle || 'solid';
  const timerScale = Math.max(0.5, Math.min(1.8, template.timerScale ?? 1));
  const badgeScale = Math.max(0.6, Math.min(1.8, template.badgeScale ?? 1));

  // Real visual protrusion envelopes (lips, stacked cards, brackets, reveal scale/glow, wings)
  const bevelLip = boxStyle === 'bevel3d' ? 12 : boxStyle === 'pill3d' ? 10 : boxStyle === 'layeredCard' ? 11 : 0;
  const layeredSide = boxStyle === 'layeredCard' ? 10 : 0;
  const bracketPad = borderStyle === 'cornerBrackets' ? 5 : 0;
  const haloPad = (template.glowIntensity ?? 0) > 0.05 ? 6 : 3;

  const qTop = Math.max(haloPad, bracketPad);
  const qBottom = Math.max(bevelLip, haloPad, bracketPad) + 3;
  const qSide = Math.max(layeredSide, haloPad, bracketPad);
  const optTop = Math.max(haloPad, bracketPad) + 4;
  const optBottom = Math.max(bevelLip, haloPad, bracketPad) + 5;
  const optSide = Math.max(layeredSide, haloPad, bracketPad) + 4;

  // === Layer 1: Header Chrome ===
  const diffMode = slide.difficulty || 'none';
  const hasDiffPill = diffMode !== 'none';
  const hasProgress = Boolean(template.showProgressCounter && slideCount > 1);
  const hasBrand = Boolean(template.brandLogoDataUrl || (template.brandHandleText || '').trim());
  const brandPos = template.brandLogoPosition || 'topRight';
  const hasTopCornerBrand = hasBrand && (brandPos === 'topRight' || brandPos === 'topLeft');
  const hasBottomCornerBrand = hasBrand && (brandPos === 'bottomRight' || brandPos === 'bottomLeft');

  let brandRect: StageLayerRect | undefined;
  if (hasBrand) {
    const bAnchor = resolveBrandAnchor(template, W, H);
    const visW = Math.max(bAnchor.size, bAnchor.handleEstW);
    const topEdge = bAnchor.anchorY - bAnchor.size / 2;
    const totalH = bAnchor.size + (bAnchor.handleHeight > 0 ? 38 : 0);
    brandRect = makeLayerRect(bAnchor.anchorX - visW / 2, topEdge, visW, totalH, 4, 4, 4, 4);
  }

  let diffPillRect: StageLayerRect | undefined;
  if (hasDiffPill) {
    const placeRightSide = hasTopCornerBrand && brandPos === 'topLeft';
    const pillW = isWide ? 148 : 138;
    const pillH = 40;
    const marginX = isWide ? 48 : 36;
    const pillX = placeRightSide ? W - marginX - pillW : marginX;
    const pillY = (isWide ? 42 : 76) - pillH / 2;
    diffPillRect = makeLayerRect(pillX, pillY, pillW, pillH, 2, 2, 2, 2);
  }

  let progressRect: StageLayerRect | undefined;
  if (hasProgress) {
    let progW = isWide ? 320 : 280;
    const progY = isWide ? 42 : 76;
    if (brandRect && hasTopCornerBrand) {
      const corridorHalf = Math.min(
        Math.abs(W / 2 - brandRect.outerX),
        Math.abs(brandRect.outerX + brandRect.outerW - W / 2)
      );
      if (brandRect.outerX < W / 2 + progW / 2 && brandRect.outerX + brandRect.outerW > W / 2 - progW / 2) {
        progW = Math.max(170, Math.min(progW, corridorHalf * 2 - 20));
      }
    }
    progressRect = makeLayerRect(W / 2 - progW / 2, progY - 18, progW, 38, 2, 2, 2, 2);
  }

  const ladderMetrics = getPrizeLadderMetrics(template, slideCount, W, H, hasDiffPill);
  const prizeLadderRect = ladderMetrics
    ? makeLayerRect(ladderMetrics.x, ladderMetrics.y, ladderMetrics.w, ladderMetrics.h, 3, 3, 3, 3)
    : undefined;

  const shiftForWideLadder = ladderMetrics?.mode === 'sideColumn' ? 126 : 0;
  const wideLeftBound = ladderMetrics?.mode === 'sideColumn' ? ladderMetrics.x + ladderMetrics.w + 26 : 48;
  const wideRightBound = W - 48;
  const wideAvailW = wideRightBound - wideLeftBound;
  const wideCenterX = (wideLeftBound + wideRightBound) / 2;

  let topSafeFloor = isWide ? 24 : 44;
  if (progressRect) {
    topSafeFloor = Math.max(topSafeFloor, progressRect.outerY + progressRect.outerH + 14);
  }
  if (diffPillRect) {
    topSafeFloor = Math.max(topSafeFloor, diffPillRect.outerY + diffPillRect.outerH + 14);
  }
  if (prizeLadderRect && ladderMetrics?.mode === 'topStrip') {
    topSafeFloor = Math.max(topSafeFloor, prizeLadderRect.outerY + prizeLadderRect.outerH + 16);
  }
  if (brandRect && hasTopCornerBrand && !isFreeLayout) {
    topSafeFloor = Math.max(topSafeFloor, brandRect.outerY + brandRect.outerH + 14);
  }

  // === Layer 2: Top Badge ===
  const safeBadge = (slide.badgeText ?? '').trim();
  const hasTopBadge = Boolean(template.showBadge && safeBadge);
  let badgeData: StageLayerLayout['badge'];
  let contentTopFloor = topSafeFloor;
  if (hasTopBadge) {
    let badgeFont = isWide ? 34 : 32;
    ctx.font = `700 ${badgeFont}px ${fontStack}`;
    ctx.direction = 'rtl';
    let textW = ctx.measureText(safeBadge).width;
    const padX = 46;
    const maxBadgeBoxW = isWide ? Math.min(wideAvailW - 40, 760) : W - 140;
    while (badgeFont > 20 && textW + padX * 2 > maxBadgeBoxW) {
      badgeFont -= 2;
      ctx.font = `700 ${badgeFont}px ${fontStack}`;
      textW = ctx.measureText(safeBadge).width;
    }
    const boxW = Math.min(maxBadgeBoxW, textW + padX * 2);
    const boxH = 66;
    const visW = boxW * badgeScale;
    const visH = boxH * badgeScale;
    const rawBadgeCenterX =
      isWide && !isFreeLayout && (template.badgeX ?? 50) === 50
        ? wideCenterX
        : ((template.badgeX ?? 50) / 100) * W + shiftForWideLadder;
    const centerX = isFreeLayout
      ? rawBadgeCenterX
      : Math.max(
          (isWide ? wideLeftBound : 24) + visW / 2,
          Math.min((isWide ? wideRightBound : W - 24) - visW / 2, rawBadgeCenterX)
        );
    const desiredBadgeY =
      isWide && !isFreeLayout
        ? Math.min(H * 0.16, (template.badgeY / 100) * H)
        : (template.badgeY / 100) * H;
    const centerY = isFreeLayout
      ? desiredBadgeY
      : Math.max(topSafeFloor + visH / 2 + 6, desiredBadgeY);

    badgeData = {
      ...makeLayerRect(centerX - visW / 2, centerY - visH / 2, visW, visH, 2, 2, 2, 2),
      centerX,
      centerY,
      boxW,
      boxH,
      font: badgeFont,
      scale: badgeScale,
      text: safeBadge,
    };
    if (!isFreeLayout) {
      contentTopFloor = centerY + visH / 2 + 16;
    }
  }

  // === Layer 3 & 4: Slide Image & Question Box Measurements ===
  const hasSlideImg = Boolean(slideImgDimensions && slideImgDimensions.width > 0 && slideImgDimensions.height > 0);
  const imgPlacement: QuestionImagePlacement = slide.imagePlacement || 'aboveBox';
  const imgInsideLayout: QuestionImageInsideLayout = slide.imageInsideLayout || 'belowText';
  const imgUserScale = Math.max(0.4, Math.min(1.8, (slide.imageScale ?? 100) / 100));
  const imgOffsetX = Math.max(-220, Math.min(220, slide.imageOffsetX ?? 0));
  const imgOffsetY = Math.max(-220, Math.min(220, slide.imageOffsetY ?? 0));
  const isExternalAboveImg = hasSlideImg && imgPlacement === 'aboveBox';
  const isExternalBelowImg = hasSlideImg && imgPlacement === 'belowBox';
  const isInsideBoxImg = hasSlideImg && imgPlacement === 'insideBox';
  const isInsideSideImg =
    isInsideBoxImg && (imgInsideLayout === 'sideRight' || imgInsideLayout === 'sideLeft');
  const isInsideVertImg =
    isInsideBoxImg && (imgInsideLayout === 'belowText' || imgInsideLayout === 'aboveText');

  const imgAspect = hasSlideImg
    ? slideImgDimensions!.width / Math.max(1, slideImgDimensions!.height)
    : 1;
  let estWideImgW = 0;
  if (isExternalAboveImg && isWide && !isFreeLayout) {
    estWideImgW = Math.min(440, (imgAspect >= 1 ? 350 : 270 * imgAspect) * Math.min(1.35, imgUserScale));
  }

  const userQW = (Math.max(30, Math.min(98, template.questionWidth || 78)) / 100) * W;
  const wingReserve = boxStyle === 'millionaireHex' && !isWide ? 88 : 0;
  const wideMaxQW = isExternalAboveImg ? Math.max(400, wideAvailW - estWideImgW - 56) : wideAvailW;
  const qW =
    isWide && !isFreeLayout
      ? Math.min(wideMaxQW, userQW)
      : isFreeLayout
        ? userQW
        : Math.min(W - 24 - qSide * 2 - wingReserve, userQW);

  const qPadX = isWide ? 48 : 28;
  let qPadY = isWide ? 26 : 22;
  const qRawText = slide.question || 'اكتب نص السؤال هنا';
  const qHasMath = hasMathSyntax(qRawText);

  const insideSideImgW = isInsideSideImg
    ? Math.min(qW * 0.44, Math.max(88, (isWide ? 185 : 175) * imgUserScale))
    : 0;
  const insideSideGap = isInsideSideImg ? 20 : 0;
  const qTextMaxW = Math.max(150, qW - qPadX * 2 - insideSideImgW - insideSideGap);

  let qFontSize =
    isWide && !isFreeLayout
      ? Math.min(68, Math.max(42, Math.round(template.questionFontSize * 0.88)))
      : template.questionFontSize;

  if (isChannelLayout && !isWide && !isFreeLayout) {
    if (qRawText.length > 65) qFontSize = Math.round(qFontSize * 0.62);
    else if (qRawText.length > 38) qFontSize = Math.round(qFontSize * 0.78);
  } else if (isWide && !isFreeLayout && qRawText.length > 75) {
    qFontSize = Math.round(qFontSize * 0.8);
  }

  ctx.font = `800 ${qFontSize}px ${fontStack}`;
  ctx.direction = 'rtl';
  let qLines = qHasMath ? [qRawText] : wrapArabicText(ctx, qRawText, qTextMaxW);
  if (!isFreeLayout && !qHasMath && qLines.length > 3 && qFontSize > 34) {
    qFontSize = Math.max(34, Math.round(qFontSize * 0.82));
    ctx.font = `800 ${qFontSize}px ${fontStack}`;
    qLines = wrapArabicText(ctx, qRawText, qTextMaxW);
  }

  let minChannelQH =
    (template.questionHeightPct ?? 0) > 0
      ? isWide && !isFreeLayout && template.questionHeightPct === 16
        ? Math.round(H * 0.2)
        : (template.questionHeightPct / 100) * H
      : 0;

  let insideImgW = 0;
  let insideImgH = 0;
  const insideVertGap = isInsideVertImg ? 18 : 0;
  const sizeInsideImg = (scaleOverride?: number) => {
    if (!isInsideBoxImg || imgInsideLayout === 'backdrop') {
      insideImgW = 0;
      insideImgH = 0;
      return;
    }
    const sc = scaleOverride ?? imgUserScale;
    if (isInsideSideImg) {
      insideImgW = Math.min(qW * 0.44, Math.max(84, (isWide ? 185 : 175) * sc));
      insideImgH = Math.min(
        isWide ? 240 : 300,
        Math.max(82, insideImgW / Math.max(0.55, Math.min(1.85, imgAspect)))
      );
    } else {
      const maxInnerW = Math.max(120, qW - qPadX * 2);
      const baseH = isWide ? 148 : 190;
      insideImgH = Math.min(isWide ? 260 : 420, Math.max(68, baseH * sc));
      insideImgW =
        slide.imageFit === 'contain'
          ? Math.min(maxInnerW, insideImgH * imgAspect)
          : Math.min(maxInnerW, Math.max(insideImgH * Math.max(0.85, imgAspect), maxInnerW * Math.min(1, 0.72 * sc)));
    }
  };
  sizeInsideImg();

  if (template.autoFitText && !qHasMath) {
    const targetMaxH =
      minChannelQH > 0 ? minChannelQH - qPadY * 2 - (isInsideVertImg ? insideImgH + insideVertGap : 0) : Infinity;
    while (
      qFontSize > 28 &&
      (qLines.length > 3 || qLines.length * (qFontSize * 1.28) > targetMaxH)
    ) {
      qFontSize -= 2;
      ctx.font = `800 ${qFontSize}px ${fontStack}`;
      qLines = wrapArabicText(ctx, qRawText, qTextMaxW);
    }
  }

  const measureQuestionBlock = (fSize: number, padY: number, minH: number) => {
    const lH = fSize * (qHasMath ? 1.45 : 1.28);
    let lines = qLines;
    if (!qHasMath) {
      ctx.font = `800 ${fSize}px ${fontStack}`;
      ctx.direction = 'rtl';
      lines = wrapArabicText(ctx, qRawText, qTextMaxW);
    }
    const textH = qHasMath
      ? Math.max(lH, measureSmartQuizTextHeight(ctx, qRawText, qTextMaxW, fSize, fontStack, 800, 3))
      : Math.max(lH, lines.length * lH);
    const contentH = isInsideVertImg
      ? textH + insideVertGap + insideImgH
      : isInsideSideImg
        ? Math.max(textH, insideImgH)
        : textH;
    const totalH = Math.max(minH, contentH + padY * 2);
    return { lH, lines, textH, totalH };
  };

  let qMetrics = measureQuestionBlock(qFontSize, qPadY, minChannelQH);
  let qLineHeight = qMetrics.lH;
  qLines = qMetrics.lines;
  let qH = qMetrics.totalH;

  let imgFrameW = 0;
  let imgFrameH = 0;
  const sizeImgFrame = (maxBoxH: number) => {
    if (!hasSlideImg || isInsideBoxImg) {
      imgFrameW = 0;
      imgFrameH = 0;
      return;
    }
    if (isWide && isExternalAboveImg) {
      const maxW = Math.min(460, 360 * Math.max(0.5, Math.min(1.4, imgUserScale)));
      const clampedH = Math.min(maxBoxH, Math.max(120, Math.min(340, (qH + 12) * Math.max(0.75, Math.min(1.3, imgUserScale)))));
      const effectiveClampH = maxBoxH < 140 ? Math.max(95, maxBoxH) : clampedH;
      imgFrameW = imgAspect >= 1 ? maxW : Math.min(maxW, effectiveClampH * imgAspect);
      imgFrameH = imgFrameW / imgAspect;
      if (imgFrameH > effectiveClampH) {
        imgFrameH = effectiveClampH;
        imgFrameW = imgFrameH * imgAspect;
      }
    } else {
      const maxW = Math.min(W - 64, (isWide ? 480 : 540) * Math.max(0.5, Math.min(1.65, imgUserScale)));
      imgFrameH = Math.max(70, maxBoxH);
      imgFrameW = Math.min(maxW, imgFrameH * imgAspect);
      if (imgFrameW / imgAspect > imgFrameH) {
        imgFrameH = imgFrameW / imgAspect;
      }
    }
  };
  sizeImgFrame((isWide ? (isExternalBelowImg ? 240 : 300) : 235) * imgUserScale);

  const imgOuterPad = 12;
  const minImgToQGap = imgOuterPad + (isExternalBelowImg ? qBottom : qTop) + 8;
  let imgToQGap =
    (isExternalAboveImg && !isWide) || isExternalBelowImg ? Math.max(24, minImgToQGap) : 0;
  const computeMinQCenterY = () =>
    contentTopFloor +
    (isExternalAboveImg && !isWide ? imgFrameH + imgOuterPad * 2 + imgToQGap : 4) +
    (isWide && isExternalAboveImg
      ? Math.max(qH + qTop + qBottom, imgFrameH + imgOuterPad * 2) / 2
      : qH / 2 + qTop);

  let minQCenterY = computeMinQCenterY();
  const desiredQCenterY =
    isWide && !isFreeLayout
      ? Math.max(142, Math.min(H * 0.34, (template.questionY / 100) * H * 0.78))
      : (template.questionY / 100) * H;
  let resolvedQCenterY = isFreeLayout ? desiredQCenterY : Math.max(minQCenterY, desiredQCenterY);

  // === Layer 5 & 6: Options + Timer + Explanation Sizing ===
  const optionCount = isTwoOptionSideBySide ? 2 : isClues || isMultiple3 ? 3 : 4;
  const is2x2Layout =
    !isClues && (template.optionsLayout === 'channel2x2' || template.optionsLayout === 'grid2x2');
  const rowsCount = isClues
    ? 3
    : !is2x2Layout
      ? isTwoOptionSideBySide
        ? 2
        : isMultiple3
          ? 3
          : 4
      : isTwoOptionSideBySide
        ? 1
        : 2;
  const userOptAreaW = (Math.max(35, Math.min(100, template.optionsWidth ?? 94)) / 100) * W;
  const maxStageOptW = isWide && !isFreeLayout ? wideAvailW : W - 24 - optSide * 2;
  let totalOptionsW = isWide && !isFreeLayout ? Math.min(wideAvailW, userOptAreaW) : Math.min(maxStageOptW, userOptAreaW);

  const hasAnyOptionImg = Array.from({ length: optionCount }, (_, idx) =>
    Boolean(slide.optionImages?.[idx]?.dataUrl)
  ).some(Boolean);
  const optImgPlacement: OptionImagePlacement = slide.optionImagePlacement || 'insideRight';
  const optImgScale = Math.max(0.4, Math.min(1.8, (slide.optionImageScale ?? 100) / 100));
  const extOptImgH =
    hasAnyOptionImg && (optImgPlacement === 'aboveBox' || optImgPlacement === 'belowBox')
      ? Math.round((isWide ? 74 : 102) * optImgScale)
      : 0;
  const extOptTopPad = optImgPlacement === 'aboveBox' && extOptImgH > 0 ? extOptImgH + 10 : 0;
  const extOptBottomPad = optImgPlacement === 'belowBox' && extOptImgH > 0 ? extOptImgH + 10 : 0;

  let baseOptH =
    isWide && !isFreeLayout
      ? !is2x2Layout
        ? Math.min(112, Math.max(72, Math.round(template.optionHeight * 0.72)))
        : Math.min(156, Math.max(92, template.optionHeight))
      : isClues && !isWide
        ? Math.min(136, Math.max(108, template.optionHeight))
        : template.optionHeight;
  if (hasAnyOptionImg && optImgPlacement === 'insideTop') {
    baseOptH = Math.max(
      baseOptH,
      Math.round((isWide ? 160 : 206) * Math.max(0.82, Math.min(1.3, optImgScale)))
    );
  }
  let effectiveOptH =
    isTwoOptionSideBySide && is2x2Layout && !isFreeLayout
      ? Math.max(baseOptH, isWide ? 168 : isVersus ? 210 : 178)
      : baseOptH;

  const userGap = Math.max(0, template.optionsGap ?? 26);
  const customColGap = template.optionsColGap ?? 0;
  const minVisualRowGap = optTop + optBottom + 4 + extOptTopPad + extOptBottomPad;
  const minVisualColGap = optSide * 2 + (isVersus && is2x2Layout ? 82 : 6);
  let effectiveRowGap = isFreeLayout
    ? Math.max(userGap, extOptTopPad + extOptBottomPad)
    : Math.max(minVisualRowGap, isWide ? Math.min(40, Math.max(14, userGap)) : userGap);
  let effectiveColGap = isFreeLayout
    ? customColGap > 0
      ? customColGap
      : userGap
    : Math.max(minVisualColGap, customColGap > 0 ? customColGap : Math.max(14, userGap));

  const hasTimerEnabled = template.timerStyle !== 'none' && timing.thinkingDuration > 0;
  const timerPlacement: TimerPlacement = template.timerPlacement || 'aboveOptions';
  let extraQGap = Math.max(0, Math.min(240, template.questionToOptionsGap ?? 0));
  const extraCenterSpread = Math.max(0, Math.min(200, template.optionsCenterGap ?? 24));

  const rawTimerBoxW =
    template.timerStyle === 'bar'
      ? timerPlacement === 'centerOfOptions'
        ? Math.min(260, totalOptionsW * 0.44)
        : totalOptionsW * 0.72
      : template.timerStyle === 'pillCountdown'
        ? (isWide ? 210 : 236) * timerScale
        : template.timerStyle === 'channelBox' || template.timerStyle === 'hexBadge'
          ? (isWide ? 128 : 144) * timerScale
          : (isWide ? 106 : 120) * timerScale;
  const rawTimerBoxH = !hasTimerEnabled
    ? 0
    : template.timerStyle === 'channelBox' || template.timerStyle === 'hexBadge'
      ? (isWide ? 100 : 116) * timerScale
      : template.timerStyle === 'circle' || template.timerStyle === 'neonRing'
        ? (isWide ? 102 : 116) * timerScale
        : template.timerStyle === 'pillCountdown'
          ? (isWide ? 74 : 84) * timerScale
          : template.timerStyle === 'bar'
            ? 74 * timerScale
            : (isWide ? 80 : 92) * timerScale;

  let timerFitScale = 1;
  let timerBoxW = rawTimerBoxW;
  let timerBoxH = rawTimerBoxH;

  let verticalCenterGap = effectiveRowGap;
  const isCenteredVerticalSplit =
    hasTimerEnabled &&
    timerPlacement === 'centerOfOptions' &&
    !is2x2Layout &&
    optionCount >= 2;
  const verticalSplitIdx = isTwoOptionSideBySide || isClues ? 0 : 1;

  if (hasTimerEnabled && timerPlacement === 'centerOfOptions') {
    if (!is2x2Layout) {
      verticalCenterGap = Math.max(effectiveRowGap, timerBoxH + optTop + optBottom + 18 + extraCenterSpread * 0.4);
    } else {
      // Ensure centered timer fits strictly inside horizontal column corridor without clipping option cards
      const minNeededColGap = timerBoxW + optSide * 2 + 22 + extraCenterSpread * 0.4;
      if (!isFreeLayout && totalOptionsW - minNeededColGap < 2 * 145) {
        totalOptionsW = Math.min(maxStageOptW, Math.max(totalOptionsW, 2 * 145 + minNeededColGap));
        const maxPossibleGap = Math.max(40, totalOptionsW - 2 * 145);
        if (minNeededColGap > maxPossibleGap) {
          timerFitScale = Math.max(
            0.58,
            (maxPossibleGap - optSide * 2 - 20) / Math.max(1, rawTimerBoxW)
          );
          timerBoxW = rawTimerBoxW * timerFitScale;
          timerBoxH = rawTimerBoxH * timerFitScale;
        }
      }
      const reqGap = timerBoxW + optSide * 2 + 20 + extraCenterSpread * 0.4;
      effectiveColGap = isFreeLayout
        ? Math.min(Math.max(40, totalOptionsW - 2 * 140), Math.max(customColGap > 0 ? customColGap : userGap, reqGap))
        : Math.min(Math.max(40, totalOptionsW - 2 * 145), Math.max(effectiveColGap, reqGap));

      if (!isTwoOptionSideBySide) {
        effectiveRowGap = Math.max(
          effectiveRowGap,
          timerBoxH + optTop + optBottom + 18 + extraCenterSpread * 0.4
        );
      }
    }
  }

  // Measure Explanation Note
  const expTextTrimmed = (slide.explanationText || '').trim();
  const hasExplanation = Boolean(template.showExplanationOnReveal && expTextTrimmed);
  let expBoxW = Math.min(W - 120, Math.max(720, (template.optionsWidth / 100) * W));
  let expFontSize = 30;
  let expBoxH = 0;
  let expLines: string[] = [];
  const expHasMath = hasExplanation && hasMathSyntax(expTextTrimmed);
  const measureExplanation = (fSz: number) => {
    if (!hasExplanation) return;
    if (isWide && !isFreeLayout) {
      expBoxW = Math.min(wideAvailW, expBoxW);
    } else if (!isFreeLayout) {
      expBoxW = Math.min(W - 72, expBoxW);
    }
    const maxW = expBoxW - 48;
    if (expHasMath) {
      const mH = measureSmartQuizTextHeight(ctx, expTextTrimmed, maxW, fSz, fontStack, 700, 2);
      expBoxH = Math.max(72, mH + 30);
    } else {
      ctx.font = `700 ${fSz}px ${fontStack}`;
      ctx.direction = 'rtl';
      expLines = wrapArabicText(ctx, expTextTrimmed, maxW).slice(0, 2);
      expBoxH = expLines.length * (fSz + 10) + 28;
    }
  };
  measureExplanation(expFontSize);

  let timerGapTop = hasTimerEnabled && timerPlacement === 'aboveOptions' ? 16 : 0;
  let timerGapBottom = hasTimerEnabled && timerPlacement === 'aboveOptions' ? 16 : 0;
  let reserveFreeTimerSlot = false;
  const getQAndImgBottomOuter = () => {
    const qBaseBottom = resolvedQCenterY + qH / 2 + qBottom;
    if (isExternalBelowImg) {
      return Math.max(qBaseBottom, resolvedQCenterY + qH / 2 + imgToQGap + imgFrameH + imgOuterPad);
    }
    if (isExternalAboveImg && isWide) {
      return Math.max(qBaseBottom, resolvedQCenterY + imgFrameH / 2 + imgOuterPad);
    }
    return qBaseBottom;
  };
  const computeMinGapQToOptions = () =>
    ((hasTimerEnabled && (timerPlacement === 'aboveOptions' || reserveFreeTimerSlot))
      ? timerGapTop + timerBoxH + timerGapBottom + optTop + extOptTopPad
      : Math.max(20, optTop + 14) + extOptTopPad) + extraQGap;

  let bottomMargin = isWide ? 24 : 88;
  if (brandRect && hasBottomCornerBrand && !isFreeLayout) {
    const widestBottomSpan = Math.max(totalOptionsW, hasExplanation ? expBoxW : 0);
    const leftEdge = W / 2 - widestBottomSpan / 2;
    const rightEdge = W / 2 + widestBottomSpan / 2;
    if (leftEdge < brandRect.outerX + brandRect.outerW + 10 && rightEdge > brandRect.outerX - 10) {
      bottomMargin = Math.max(bottomMargin, H - brandRect.outerY + 16);
    }
  }

  let expReserveGap = 16;
  let belowTimerGap = 16;
  const computeBottomSafeLimit = () => {
    const expReserve = hasExplanation ? expBoxH + expReserveGap + 8 : 0;
    const belowReserve =
      hasTimerEnabled && timerPlacement === 'belowOptions'
        ? optBottom + extOptBottomPad + belowTimerGap + timerBoxH + 14
        : optBottom + extOptBottomPad + 8;
    return H - bottomMargin - expReserve - belowReserve;
  };

  let bottomSafeLimit = computeBottomSafeLimit();
  const calcOptionsTotalH = (optH: number, rGap: number, vCenterGap: number) =>
    isCenteredVerticalSplit
      ? rowsCount * optH + Math.max(0, rowsCount - 2) * rGap + vCenterGap
      : rowsCount * optH + Math.max(0, rowsCount - 1) * rGap;

  let optionsTotalH = calcOptionsTotalH(effectiveOptH, effectiveRowGap, verticalCenterGap);
  const desiredOptionsStartPx =
    isWide && !isFreeLayout
      ? Math.max(H * 0.42, Math.min(H * 0.65, (template.optionsStartY / 100) * H * 0.98))
      : (template.optionsStartY / 100) * H;

  let qBottomPx = getQAndImgBottomOuter();
  let minOptionsStartPx = qBottomPx + computeMinGapQToOptions();

  // === Strict Progressive Fit Cascade (guarantees ZERO layer overlap across extreme settings) ===
  const runFitCascade = () => {
    if (isFreeLayout) return;
    const syncTopAndOptions = () => {
      qBottomPx = getQAndImgBottomOuter();
      minOptionsStartPx = qBottomPx + computeMinGapQToOptions();
      bottomSafeLimit = computeBottomSafeLimit();
      optionsTotalH = calcOptionsTotalH(effectiveOptH, effectiveRowGap, verticalCenterGap);
    };
    syncTopAndOptions();

    // Pass 1: Pull Question up toward contentTopFloor + Image
    if (minOptionsStartPx + optionsTotalH > bottomSafeLimit) {
      const excess = minOptionsStartPx + optionsTotalH - bottomSafeLimit;
      const pullQUp = Math.min(excess, Math.max(0, resolvedQCenterY - minQCenterY));
      resolvedQCenterY -= pullQUp;
      syncTopAndOptions();
    }

    // Pass 2: Trim extra user padding & inter-layer gaps cleanly
    if (minOptionsStartPx + optionsTotalH > bottomSafeLimit) {
      extraQGap = 0;
      timerGapTop = hasTimerEnabled && (timerPlacement === 'aboveOptions' || reserveFreeTimerSlot) ? 10 : 0;
      timerGapBottom = hasTimerEnabled && (timerPlacement === 'aboveOptions' || reserveFreeTimerSlot) ? 10 : 0;
      imgToQGap = (isExternalAboveImg && !isWide) || isExternalBelowImg ? minImgToQGap : 0;
      if (badgeData) {
        contentTopFloor = badgeData.centerY + (badgeData.boxH * badgeData.scale) / 2 + 10;
      }
      minQCenterY = computeMinQCenterY();
      resolvedQCenterY = Math.max(minQCenterY, Math.min(resolvedQCenterY, minQCenterY));
      syncTopAndOptions();
    }

    // Pass 3: Shrink Slide Image frame (or insideBox image) cleanly if present
    if (minOptionsStartPx + optionsTotalH > bottomSafeLimit && hasSlideImg) {
      const excess = minOptionsStartPx + optionsTotalH - bottomSafeLimit;
      if (isInsideBoxImg && imgInsideLayout !== 'backdrop' && insideImgH > 86) {
        const shrinkScale = Math.max(0.45, imgUserScale * ((insideImgH - Math.min(insideImgH - 72, excess * 0.65)) / Math.max(1, insideImgH)));
        sizeInsideImg(shrinkScale);
        qMetrics = measureQuestionBlock(qFontSize, qPadY, minChannelQH);
        qLineHeight = qMetrics.lH;
        qLines = qMetrics.lines;
        qH = qMetrics.totalH;
        minQCenterY = computeMinQCenterY();
        resolvedQCenterY = Math.max(minQCenterY, resolvedQCenterY);
        syncTopAndOptions();
      } else if (!isInsideBoxImg && imgFrameH > 110) {
        const targetImgH = Math.max(96, imgFrameH - (isWide && isExternalAboveImg ? excess * 1.4 : excess));
        sizeImgFrame(targetImgH);
        minQCenterY = computeMinQCenterY();
        resolvedQCenterY = Math.max(minQCenterY, resolvedQCenterY - (isWide && isExternalAboveImg ? excess * 0.5 : 0));
        syncTopAndOptions();
      }
    }

    // Pass 4: Compact Question box height & font size cleanly if Question still hogs height
    if (minOptionsStartPx + optionsTotalH > bottomSafeLimit) {
      minChannelQH = 0;
      qPadY = isWide ? 16 : 14;
      qMetrics = measureQuestionBlock(qFontSize, qPadY, 0);
      while (
        qFontSize > 26 &&
        qMetrics.totalH + qBottom + computeMinGapQToOptions() + optionsTotalH >
          bottomSafeLimit - (minQCenterY - qMetrics.totalH / 2)
      ) {
        qFontSize -= 3;
        qMetrics = measureQuestionBlock(qFontSize, qPadY, 0);
      }
      qLineHeight = qMetrics.lH;
      qLines = qMetrics.lines;
      qH = qMetrics.totalH;
      minQCenterY = computeMinQCenterY();
      resolvedQCenterY = minQCenterY;
      syncTopAndOptions();
    }

    // Pass 5: Compact non-center row gaps, explanation padding & option heights so optionsBottomPx <= bottomSafeLimit ALWAYS
    if (minOptionsStartPx + optionsTotalH > bottomSafeLimit) {
      if (hasExplanation && expFontSize > 24) {
        expFontSize = 24;
        expReserveGap = 10;
        measureExplanation(24);
      }
      const minNeededCenterRowGap =
        hasTimerEnabled && timerPlacement === 'centerOfOptions' && !isCenteredVerticalSplit && !isTrueFalse
          ? timerBoxH + optTop + optBottom + 20 + extOptTopPad + extOptBottomPad
          : minVisualRowGap;
      effectiveRowGap = Math.max(minNeededCenterRowGap, Math.min(effectiveRowGap, (isWide ? 14 : 20) + extOptTopPad + extOptBottomPad));
      verticalCenterGap = isCenteredVerticalSplit
        ? Math.max(timerBoxH + optTop + optBottom + 20, Math.min(verticalCenterGap, timerBoxH + optTop + optBottom + 26))
        : effectiveRowGap;

      const computeGapTotal = () =>
        isCenteredVerticalSplit
          ? Math.max(0, rowsCount - 2) * effectiveRowGap + verticalCenterGap
          : Math.max(0, rowsCount - 1) * effectiveRowGap;

      syncTopAndOptions();
      let availH = bottomSafeLimit - minOptionsStartPx;
      let gapTotalH = computeGapTotal();
      if (availH - gapTotalH < rowsCount * 46 && hasTimerEnabled && timerFitScale > 0.56) {
        timerFitScale = Math.max(0.55, timerFitScale * 0.72);
        timerBoxW = rawTimerBoxW * timerFitScale;
        timerBoxH = rawTimerBoxH * timerFitScale;
        if (hasTimerEnabled && timerPlacement === 'centerOfOptions') {
          if (isCenteredVerticalSplit) {
            verticalCenterGap = Math.max(minVisualRowGap, timerBoxH + optTop + optBottom + 20);
          } else if (!isTrueFalse) {
            effectiveRowGap = Math.max(minVisualRowGap, timerBoxH + optTop + optBottom + 20);
          }
        }
        syncTopAndOptions();
        availH = bottomSafeLimit - minOptionsStartPx;
        gapTotalH = computeGapTotal();
      }

      const maxOptH = Math.floor((availH - gapTotalH) / Math.max(1, rowsCount));
      effectiveOptH = Math.max(36, Math.min(effectiveOptH, maxOptH));
      optionsTotalH = calcOptionsTotalH(effectiveOptH, effectiveRowGap, verticalCenterGap);
    }
  };

  runFitCascade();

  let maxAllowedOptionsStart = Math.max(minOptionsStartPx, bottomSafeLimit - optionsTotalH);
  let optionsStartPx = isFreeLayout
    ? desiredOptionsStartPx
    : Math.max(minOptionsStartPx, Math.min(desiredOptionsStartPx, maxAllowedOptionsStart));
  let optionsBottomPx = optionsStartPx + optionsTotalH;

  // === Horizontal Centers ===
  let qCenterX: number;
  if (isWide && !isFreeLayout) {
    if (isExternalAboveImg) {
      const wideImgCenterX = wideLeftBound + imgFrameW / 2 + 12;
      const wideQLeftBound = wideImgCenterX + imgFrameW / 2 + 32;
      qCenterX =
        (template.questionX ?? 50) === 50
          ? (wideQLeftBound + wideRightBound) / 2
          : Math.max(
              wideQLeftBound + qW / 2,
              Math.min(wideRightBound - qW / 2, ((template.questionX ?? 50) / 100) * W + shiftForWideLadder)
            );
    } else {
      qCenterX =
        (template.questionX ?? 50) === 50
          ? wideCenterX
          : Math.max(
              wideLeftBound + qW / 2,
              Math.min(wideRightBound - qW / 2, ((template.questionX ?? 50) / 100) * W + shiftForWideLadder)
            );
    }
  } else {
    const rawQX = ((template.questionX ?? 50) / 100) * W + shiftForWideLadder;
    const minMargin = qSide + wingReserve / 2 + 10;
    qCenterX = isFreeLayout
      ? rawQX
      : Math.max(qW / 2 + minMargin, Math.min(W - qW / 2 - minMargin, rawQX));
  }

  const optionsAreaCenterX =
    isWide && !isFreeLayout
      ? (template.optionsX ?? 50) === 50
        ? wideCenterX
        : Math.max(
            wideLeftBound + totalOptionsW / 2,
            Math.min(wideRightBound - totalOptionsW / 2, ((template.optionsX ?? 50) / 100) * W + shiftForWideLadder)
          )
      : isFreeLayout
        ? ((template.optionsX ?? 50) / 100) * W + shiftForWideLadder
        : Math.max(
            totalOptionsW / 2 + optSide + 10,
            Math.min(W - totalOptionsW / 2 - optSide - 10, ((template.optionsX ?? 50) / 100) * W + shiftForWideLadder)
          );

  // Build Option Item Boxes + Image + Question + Explanation helpers so free-timer scan can also re-pack if stage is 100% full
  const rtlCols = template.optionsRtlColumns !== false;
  let optionItems: StageLayerLayout['options']['items'] = [];
  let questionRect!: StageLayerLayout['question'];
  let imageData: StageLayerLayout['image'];
  let explanationData: StageLayerLayout['explanation'];

  const rebuildStageBoxes = () => {
    optionItems = [];
    for (let i = 0; i < optionCount; i++) {
      let boxW = totalOptionsW;
      const boxH = effectiveOptH;
      let centerX = optionsAreaCenterX;
      let centerY = optionsStartPx + i * (boxH + effectiveRowGap) + boxH / 2;
      if (isCenteredVerticalSplit && i > verticalSplitIdx) {
        centerY += verticalCenterGap - effectiveRowGap;
      }

      if (is2x2Layout) {
        if (isTwoOptionSideBySide) {
          const tfW = Math.min(totalOptionsW, Math.round(W * 0.94));
          const tfGap = Math.max(
            customColGap > 0 || isFreeLayout ? 0 : minVisualColGap,
            effectiveColGap
          );
          boxW = (tfW - tfGap) / 2;
          const areaLeft = optionsAreaCenterX - tfW / 2;
          const isRightCol = rtlCols ? i === 0 : i === 1;
          centerX = isRightCol ? areaLeft + boxW + tfGap + boxW / 2 : areaLeft + boxW / 2;
          centerY = optionsStartPx + boxH / 2;
        } else {
          const colGap = Math.max(customColGap > 0 || isFreeLayout ? 0 : minVisualColGap, effectiveColGap);
          boxW = (totalOptionsW - colGap) / 2;
          const row = Math.floor(i / 2);
          const col = i % 2;
          if (isMultiple3 && i === 2) {
            centerX = optionsAreaCenterX;
          } else {
            const isRightCol = rtlCols ? col === 0 : col === 1;
            const areaLeft = optionsAreaCenterX - totalOptionsW / 2;
            centerX = isRightCol ? areaLeft + boxW + colGap + boxW / 2 : areaLeft + boxW / 2;
          }
          centerY = optionsStartPx + row * (boxH + effectiveRowGap) + boxH / 2;
        }
      }

      optionItems.push({
        ...makeLayerRect(centerX - boxW / 2, centerY - boxH / 2, boxW, boxH, optTop + extOptTopPad, optBottom + extOptBottomPad, optSide, optSide),
        centerX,
        centerY,
        boxW,
        boxH,
      });
    }

    let insideImageInfo: StageLayerLayout['question']['insideImage'];
    if (isInsideBoxImg) {
      if (imgInsideLayout === 'backdrop') {
        insideImageInfo = {
          x: -qW / 2 + imgOffsetX,
          y: -qH / 2 + imgOffsetY,
          w: qW,
          h: qH,
          layout: 'backdrop',
          textCenterX: 0,
          textCenterY: 0,
          textMaxW: qTextMaxW,
        };
      } else if (isInsideSideImg) {
        const isRightSide = imgInsideLayout === 'sideRight';
        const imgX = isRightSide
          ? qW / 2 - qPadX - insideImgW + imgOffsetX
          : -qW / 2 + qPadX + imgOffsetX;
        const imgY = -insideImgH / 2 + imgOffsetY;
        const textCenterX = isRightSide
          ? (-qW / 2 + qPadX + (qW / 2 - qPadX - insideImgW - insideSideGap)) / 2
          : (-qW / 2 + qPadX + insideImgW + insideSideGap + (qW / 2 - qPadX)) / 2;
        insideImageInfo = {
          x: imgX,
          y: imgY,
          w: insideImgW,
          h: insideImgH,
          layout: imgInsideLayout,
          textCenterX,
          textCenterY: 0,
          textMaxW: qTextMaxW,
        };
      } else {
        const totalInnerH = qMetrics.textH + insideVertGap + insideImgH;
        const topStart = -totalInnerH / 2;
        if (imgInsideLayout === 'aboveText') {
          insideImageInfo = {
            x: -insideImgW / 2 + imgOffsetX,
            y: topStart + imgOffsetY,
            w: insideImgW,
            h: insideImgH,
            layout: 'aboveText',
            textCenterX: 0,
            textCenterY: topStart + insideImgH + insideVertGap + qMetrics.textH / 2,
            textMaxW: qTextMaxW,
          };
        } else {
          insideImageInfo = {
            x: -insideImgW / 2 + imgOffsetX,
            y: topStart + qMetrics.textH + insideVertGap + imgOffsetY,
            w: insideImgW,
            h: insideImgH,
            layout: 'belowText',
            textCenterX: 0,
            textCenterY: topStart + qMetrics.textH / 2,
            textMaxW: qTextMaxW,
          };
        }
      }
    }

    questionRect = {
      ...makeLayerRect(
        qCenterX - qW / 2,
        resolvedQCenterY - qH / 2,
        qW,
        qH,
        qTop,
        qBottom,
        qSide + wingReserve / 2,
        qSide + wingReserve / 2
      ),
      centerX: qCenterX,
      centerY: resolvedQCenterY,
      w: qW,
      h: qH,
      fontSize: qFontSize,
      lines: qLines,
      lineHeight: qLineHeight,
      hasMath: qHasMath,
      padX: qPadX,
      padY: qPadY,
      rawText: qRawText,
      insideImage: insideImageInfo,
    };

    imageData = undefined;
    if (hasSlideImg && !isInsideBoxImg && imgFrameW > 0 && imgFrameH > 0) {
      const imgCX =
        (isWide && isExternalAboveImg ? wideLeftBound + imgFrameW / 2 + 12 : qCenterX) + imgOffsetX;
      const imgCY =
        (isExternalBelowImg
          ? resolvedQCenterY + qH / 2 + Math.max(minImgToQGap, imgToQGap) + imgFrameH / 2
          : isWide
            ? resolvedQCenterY
            : resolvedQCenterY - qH / 2 - Math.max(minImgToQGap, imgToQGap) - imgFrameH / 2) +
        imgOffsetY;
      imageData = {
        ...makeLayerRect(
          imgCX - imgFrameW / 2,
          imgCY - imgFrameH / 2,
          imgFrameW,
          imgFrameH,
          imgOuterPad,
          imgOuterPad,
          imgOuterPad,
          imgOuterPad
        ),
        centerX: imgCX,
        centerY: imgCY,
        frameW: imgFrameW,
        frameH: imgFrameH,
        placement: imgPlacement,
      };
    }
  };
  rebuildStageBoxes();

  // === Timer Layer Position ===
  let resolvedTimerCenterX = optionsAreaCenterX;
  let resolvedTimerCenterY = (qBottomPx + optionsStartPx) / 2;

  const computeFixedTimerPos = () => {
    if (timerPlacement === 'aboveOptions') {
      const timerZoneTop = questionRect.outerY + questionRect.outerH + timerGapTop + timerBoxH / 2;
      const timerZoneBottom = optionsStartPx - optTop - timerGapBottom - timerBoxH / 2;
      const timerMidpoint = (questionRect.outerY + questionRect.outerH + optionsStartPx - optTop) / 2;
      const desiredTimerY = (template.timerY / 100) * H;
      resolvedTimerCenterX =
        isWide && !isFreeLayout && (template.timerX ?? 50) === 50
          ? wideCenterX
          : ((template.timerX ?? 50) / 100) * W + shiftForWideLadder;
      resolvedTimerCenterY = isFreeLayout
        ? desiredTimerY
        : timerZoneBottom >= timerZoneTop
          ? Math.max(timerZoneTop, Math.min(timerZoneBottom, desiredTimerY))
          : timerMidpoint;
    } else if (timerPlacement === 'centerOfOptions') {
      resolvedTimerCenterX = optionsAreaCenterX;
      if (isCenteredVerticalSplit) {
        const topGroupRows = verticalSplitIdx + 1;
        const topGroupEnd =
          optionsStartPx + topGroupRows * effectiveOptH + (topGroupRows - 1) * effectiveRowGap;
        resolvedTimerCenterY = topGroupEnd + verticalCenterGap / 2;
      } else if (isTwoOptionSideBySide) {
        resolvedTimerCenterY = optionsStartPx + effectiveOptH / 2;
      } else {
        resolvedTimerCenterY = optionsStartPx + effectiveOptH + effectiveRowGap / 2;
      }
    } else if (timerPlacement === 'belowOptions') {
      resolvedTimerCenterX = optionsAreaCenterX;
      resolvedTimerCenterY = optionsBottomPx + optBottom + belowTimerGap + timerBoxH / 2;
    } else if (timerPlacement === 'free') {
      const rawX = ((template.timerX ?? 50) / 100) * W;
      const rawY = (template.timerY / 100) * H;
      resolvedTimerCenterX = isFreeLayout
        ? rawX
        : Math.max(
            (isWide ? wideLeftBound : 24) + timerBoxW / 2,
            Math.min((isWide ? wideRightBound : W - 24) - timerBoxW / 2, rawX)
          );
      resolvedTimerCenterY = isFreeLayout
        ? rawY
        : Math.max(
            topSafeFloor + timerBoxH / 2 + 6,
            Math.min(H - bottomMargin - timerBoxH / 2 - 6, rawY)
          );
    }
  };
  computeFixedTimerPos();

  const rebuildExplanation = () => {
    explanationData = undefined;
    if (!hasExplanation) return;
    const expOffsetY = template.explanationOffsetY ?? 0;
    const expMinTop =
      hasTimerEnabled && timerPlacement === 'belowOptions'
        ? resolvedTimerCenterY + timerBoxH / 2 + expReserveGap
        : optionsBottomPx + optBottom + expReserveGap;
    const maxExpBottom = H - bottomMargin;
    const rawExpTop = expMinTop + expOffsetY;
    const expTop = isFreeLayout
      ? rawExpTop
      : Math.max(expMinTop, Math.min(maxExpBottom - expBoxH, rawExpTop));
    const expCX = optionsAreaCenterX;
    const expCY = expTop + expBoxH / 2;

    explanationData = {
      ...makeLayerRect(expCX - expBoxW / 2, expTop, expBoxW, expBoxH, 4, 4, 4, 4),
      centerX: expCX,
      centerY: expCY,
      boxW: expBoxW,
      boxH: expBoxH,
      lines: expLines,
      hasMath: expHasMath,
      fontSize: expFontSize,
      text: expTextTrimmed,
    };
  };
  rebuildExplanation();

  // If timerPlacement === 'free' and Layer Protection is ON (!isFreeLayout), scan for a 100% collision-free pocket
  if (hasTimerEnabled && timerPlacement === 'free' && !isFreeLayout) {
    const collectBlockers = (): StageLayerRect[] => [
      ...(progressRect ? [progressRect] : []),
      ...(diffPillRect ? [diffPillRect] : []),
      ...(prizeLadderRect ? [prizeLadderRect] : []),
      ...(brandRect ? [brandRect] : []),
      ...(badgeData ? [badgeData] : []),
      ...(imageData ? [imageData] : []),
      questionRect,
      ...optionItems,
      ...(explanationData ? [explanationData] : []),
    ];
    const mkTimerRect = (cx: number, cy: number, bw: number, bh: number) =>
      makeLayerRect(cx - bw / 2, cy - bh / 2, bw, bh, 4, 4, 4, 4);

    const findBestPocket = (scaleTry: number): { x: number; y: number } | null => {
      const bw = rawTimerBoxW * scaleTry;
      const bh = rawTimerBoxH * scaleTry;
      const blockers = collectBlockers();
      const minX = (isWide ? wideLeftBound : 20) + bw / 2;
      const maxX = (isWide ? wideRightBound : W - 20) - bw / 2;
      const minY = topSafeFloor + bh / 2 + 4;
      const maxY = H - bottomMargin - bh / 2 - 4;
      if (maxX < minX || maxY < minY) return null;

      const xGrid = [
        Math.max(minX, Math.min(maxX, resolvedTimerCenterX)),
        optionsAreaCenterX,
        minX + 12,
        maxX - 12,
        (minX + optionsAreaCenterX) / 2,
        (maxX + optionsAreaCenterX) / 2,
      ];
      const yAnchorList = [
        resolvedTimerCenterY,
        (questionRect.outerY + questionRect.outerH + optionsStartPx - optTop) / 2,
        questionRect.outerY - bh / 2 - 12,
        optionsBottomPx + optBottom + bh / 2 + 12,
        ...(imageData ? [imageData.centerY] : []),
      ];
      for (let y = minY; y <= maxY; y += 28) {
        yAnchorList.push(y);
      }

      let best: { x: number; y: number } | null = null;
      let bestDist = Infinity;
      for (const cy of yAnchorList) {
        if (cy < minY || cy > maxY) continue;
        for (const cx of xGrid) {
          if (cx < minX || cx > maxX) continue;
          const r = mkTimerRect(cx, cy, bw, bh);
          if (!blockers.some((b) => rectsIntersect(r, b, 2))) {
            const d = Math.hypot(cx - resolvedTimerCenterX, cy - resolvedTimerCenterY);
            if (d < bestDist) {
              bestDist = d;
              best = { x: cx, y: cy };
            }
          }
        }
      }
      return best;
    };

    const currRect = mkTimerRect(resolvedTimerCenterX, resolvedTimerCenterY, timerBoxW, timerBoxH);
    const initialBlockers = collectBlockers();
    if (
      currRect.outerX < 0 ||
      currRect.outerY < 0 ||
      currRect.outerX + currRect.outerW > W ||
      currRect.outerY + currRect.outerH > H ||
      initialBlockers.some((b) => rectsIntersect(currRect, b, 2))
    ) {
      let chosen: { x: number; y: number } | null = null;
      for (const sTry of [timerFitScale, timerFitScale * 0.85, timerFitScale * 0.7]) {
        const cand = findBestPocket(sTry);
        if (cand) {
          timerFitScale = sTry;
          timerBoxW = rawTimerBoxW * timerFitScale;
          timerBoxH = rawTimerBoxH * timerFitScale;
          chosen = cand;
          break;
        }
      }
      if (!chosen) {
        // Canvas is completely packed: reserve an aboveOptions slot via the Progressive Fit Cascade so Timer has its own isolated band
        timerFitScale = Math.min(timerFitScale, 0.75);
        timerBoxW = rawTimerBoxW * timerFitScale;
        timerBoxH = rawTimerBoxH * timerFitScale;
        reserveFreeTimerSlot = true;
        timerGapTop = 10;
        timerGapBottom = 10;
        runFitCascade();
        maxAllowedOptionsStart = Math.max(minOptionsStartPx, bottomSafeLimit - optionsTotalH);
        optionsStartPx = Math.max(minOptionsStartPx, Math.min(desiredOptionsStartPx, maxAllowedOptionsStart));
        optionsBottomPx = optionsStartPx + optionsTotalH;
        rebuildStageBoxes();
        rebuildExplanation();
        chosen = findBestPocket(timerFitScale) || {
          x: optionsAreaCenterX,
          y: (questionRect.outerY + questionRect.outerH + optionsStartPx - optTop) / 2,
        };
      }
      resolvedTimerCenterX = chosen.x;
      resolvedTimerCenterY = chosen.y;
    }
  }

  const timerRect: StageLayerLayout['timer'] = {
    ...makeLayerRect(
      resolvedTimerCenterX - timerBoxW / 2,
      resolvedTimerCenterY - timerBoxH / 2,
      timerBoxW,
      timerBoxH,
      4,
      4,
      4,
      4
    ),
    enabled: hasTimerEnabled,
    placement: timerPlacement,
    centerX: resolvedTimerCenterX,
    centerY: resolvedTimerCenterY,
    boxW: timerBoxW,
    boxH: timerBoxH,
    effectiveScale: timerScale * timerFitScale,
    gapTop: timerGapTop,
    gapBottom: timerGapBottom,
  };

  return {
    W,
    H,
    isWide,
    isFreeLayout,
    wideLeftBound,
    wideRightBound,
    wideAvailW,
    wideCenterX,
    shiftForWideLadder,
    topSafeFloor,
    bottomMargin,
    bottomSafeLimit,
    protrusions: {
      qTop,
      qBottom,
      qSide,
      optTop,
      optBottom,
      optSide,
    },
    header: {
      progress: progressRect,
      diffPill: diffPillRect,
      prizeLadder: prizeLadderRect,
      brand: brandRect,
    },
    badge: badgeData,
    image: imageData,
    question: questionRect,
    options: {
      areaCenterX: optionsAreaCenterX,
      startPx: optionsStartPx,
      bottomPx: optionsBottomPx,
      totalH: optionsTotalH,
      totalW: totalOptionsW,
      optH: effectiveOptH,
      rowGap: effectiveRowGap,
      colGap: effectiveColGap,
      customColGap,
      vertCenterGap: verticalCenterGap,
      isCenteredVerticalSplit,
      verticalSplitIdx,
      extImgTopPad: extOptTopPad,
      extImgBottomPad: extOptBottomPad,
      extImgHeight: extOptImgH,
      items: optionItems,
    },
    timer: timerRect,
    explanation: explanationData,
  };
}

export function renderQuizFrame(
  ctx: CanvasRenderingContext2D,
  globalTime: number,
  slides: QuestionSlide[],
  template: TemplateSettings,
  timing: TimingSettings,
  audio: AudioSettings,
  isPreview = false,
  interactiveState?: InteractiveStageState,
  outHitboxes?: StageElementHitbox[]
): void {
  const { width: W, height: H } = getCanvasDimensions(template);
  const isWide = template.aspectRatio === '16:9';
  const isFreeLayout = Boolean(template.freeLayoutMode);
  const fontStack = `'${template.fontFamily}', 'Cairo', 'Tajawal', sans-serif`;

  const boxStyle: BoxShapeStyle = template.boxStyle || 'flat';
  const borderStyle: BoxBorderStyle = template.borderStyle || 'solid';
  const shadowIntensity = template.shadowIntensity ?? 1;
  const glowIntensity = template.glowIntensity ?? 0;
  const globalScale = Math.max(0.75, Math.min(1.25, template.globalScale ?? 1));
  const timerScale = Math.max(0.5, Math.min(1.8, template.timerScale ?? 1));
  const badgeScale = Math.max(0.6, Math.min(1.8, template.badgeScale ?? 1));

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 1. Cached Background Layer + Optional Motion & Particles
  drawCachedBackdrop(ctx, template, globalTime, W, H);

  const introDur = getIntroHookDuration(template, timing);
  if (introDur > 0 && slides.length > 0 && globalTime < introDur) {
    // Anti-Swipe First-Second Flash Teaser (optional quick 0.52s dramatic teaser peek of final hardest slide)
    const showFlashTeaser = Boolean(template.introFlashTeaser) && introDur >= 0.9 && globalTime < 0.54;
    if (showFlashTeaser) {
      const lastSlide = slides[slides.length - 1];
      const teaserAlpha =
        globalTime < 0.08
          ? clamp01(globalTime / 0.08)
          : globalTime > 0.42
            ? clamp01((0.54 - globalTime) / 0.12)
            : 1;
      const lastImg = getCachedImage(lastSlide?.imageDataUrl);
      ctx.save();
      ctx.globalAlpha = teaserAlpha;
      ctx.fillStyle = 'rgba(6, 10, 22, 0.86)';
      ctx.fillRect(0, 0, W, H);

      if (lastImg) {
        const pulseScale = 1.08 + (globalTime / 0.54) * 0.08;
        ctx.save();
        ctx.globalAlpha *= 0.35;
        ctx.translate(W / 2, H / 2);
        ctx.scale(pulseScale, pulseScale);
        drawBlurredChallengeImage(ctx, lastImg, -W * 0.4, -H * 0.25, W * 0.8, H * 0.5, 22, 0.5, fontStack, 'cover');
        ctx.restore();
      }

      const warnText = (template.introFlashHookText || '92% يغلطون في السؤال الأخير! ⚠️').trim();
      const previewQ = lastSlide?.question || '';
      const fW = isWide ? Math.min(W - 240, 1180) : W - 96;
      const fH = previewQ ? (isWide ? 360 : 440) : 240;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      drawStyledBoxContainer(ctx, {
        x: -fW / 2,
        y: -fH / 2,
        w: fW,
        h: fH,
        radius: 34,
        fillColorHex: '#7f1d1d',
        fillRgba: 'rgba(127, 29, 29, 0.94)',
        opacity: 0.94,
        borderColor: '#facc15',
        borderWidth: 5,
        boxStyle: 'bevel3d',
        borderStyle: 'gradientGold',
        boxGloss: true,
        enhanced: true,
        shadowIntensity: 1.2,
        glowIntensity: 0.45,
      });
      ctx.font = `900 ${isWide ? 62 : 58}px ${fontStack}`;
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fef08a';
      const wLines = wrapArabicText(ctx, warnText, fW - 84).slice(0, 2);
      wLines.forEach((ln, idx) => {
        ctx.fillText(ln, 0, (previewQ ? -78 : 0) + (idx - (wLines.length - 1) / 2) * 74);
      });

      if (previewQ) {
        ctx.font = `700 ${isWide ? 36 : 38}px ${fontStack}`;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        const teaserSnippet = previewQ.length > 52 ? `${previewQ.slice(0, 49)}...` : previewQ;
        ctx.fillText(`«${teaserSnippet}»`, 0, 95);
      }
      ctx.restore();
      ctx.restore();
      drawBrandWatermark(ctx, template, globalTime, W, H, fontStack);
      ctx.restore();
      return;
    }

    const hookTime = template.introFlashTeaser && introDur >= 0.9 ? Math.max(0, globalTime - 0.54) : globalTime;
    const enterProg = clamp01(hookTime / 0.3);
    const exitProg = globalTime > introDur - 0.22 ? clamp01((introDur - globalTime) / 0.22) : 1;
    const alpha = easeOutCubic(enterProg) * exitProg;
    const popScale = (0.84 + 0.16 * easeOutBack(enterProg)) * globalScale;
    const hookText = (template.introHookText || 'اختبر معلوماتك الآن!').trim();
    const aiIntroTiming = computeAiPresenterFrameTiming(globalTime, slides, template, timing, audio);
    const useAiIntroHero = Boolean(aiIntroTiming && aiIntroTiming.isFullscreenHero && template.aiPresenter?.enabled);
    const usePresenterIntroHero =
      useAiIntroHero ||
      (Boolean(template.presenterEnabled) && template.presenterIntroFullscreen !== false);

    if (usePresenterIntroHero) {
      const choreo = computePresenterChoreography(
        globalTime,
        template,
        'intro',
        globalTime,
        undefined,
        undefined,
        0,
        interactiveState?.demoPresenterPose
          ? {
              forcedPose: interactiveState.demoPresenterPose,
              animClock: interactiveState.demoPresenterAnimClock,
            }
          : undefined
      );
      ctx.save();
      ctx.globalAlpha = alpha;

      // Fullscreen Studio Showcase Backdrop
      ctx.fillStyle = 'rgba(6, 10, 22, 0.52)';
      ctx.fillRect(0, 0, W, H);

      const heroW = isWide ? Math.round(W * 0.34) : Math.round(W * 0.72);
      const heroH = isWide ? Math.round(H * 0.74) : Math.round(H * 0.44);
      const heroX = isWide ? Math.round(W * 0.07) : Math.round((W - heroW) / 2);
      const heroY = isWide ? Math.round((H - heroH) / 2) : Math.round(H - heroH - H * 0.055);

      if (useAiIntroHero && template.aiPresenter) {
        drawAiPresenterVideoFrame(
          ctx,
          template,
          template.aiPresenter,
          { x: heroX, y: heroY, w: heroW, h: heroH },
          fontStack,
          {
            isFullscreenHero: true,
            videoTimeSec: aiIntroTiming?.videoTimeSec,
            globalTime,
            isIdleAfterSpeech: aiIntroTiming?.isIdleAfterSpeech,
          }
        );
      } else {
        drawPresenterHostFrame(
          ctx,
          template,
          choreo,
          { x: heroX, y: heroY, w: heroW, h: heroH },
          fontStack,
          { isFullscreenHero: true }
        );
      }

      // Hook Caption Card beside (16:9) or above (9:16) bottom-anchored hero presenter
      const cardW = isWide ? Math.round(W * 0.48) : Math.min(W - 84, 920);
      ctx.font = `900 ${isWide ? 56 : 54}px ${fontStack}`;
      ctx.direction = 'rtl';
      const lines = wrapArabicText(ctx, hookText, cardW - 84);
      const lineH = isWide ? 76 : 74;
      const cardH = Math.max(190, lines.length * lineH + 74);
      const cardCX = isWide ? W * 0.71 : W / 2;
      const cardCY = isWide ? H / 2 : Math.max(cardH / 2 + 120, heroY - 46 - cardH / 2);

      ctx.save();
      ctx.translate(cardCX, cardCY);
      ctx.scale(popScale, popScale);
      drawStyledBoxContainer(ctx, {
        x: -cardW / 2,
        y: -cardH / 2,
        w: cardW,
        h: cardH,
        radius: template.questionBorderRadius,
        fillColorHex: template.questionBoxColor,
        fillRgba: hexToRgba(template.questionBoxColor, Math.max(0.88, template.questionBoxOpacity)),
        opacity: Math.max(0.88, template.questionBoxOpacity),
        borderColor: template.questionBorderColor,
        borderWidth: Math.max(4, template.questionBorderWidth),
        boxStyle,
        borderStyle,
        boxGloss: template.boxGloss,
        enhanced: template.enhanceAppearance ?? true,
        shadowIntensity,
        glowIntensity: Math.max(0.35, glowIntensity),
      });
      ctx.fillStyle = template.questionTextColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const startY = -((lines.length - 1) * lineH) / 2;
      lines.forEach((line, idx) => {
        ctx.fillText(line, 0, startY + idx * lineH);
      });
      ctx.restore();
      ctx.restore();

      drawBrandWatermark(ctx, template, globalTime, W, H, fontStack);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, H / 2);
    ctx.scale(popScale, popScale);

    const cardW = isWide ? Math.min(W - 260, 1180) : Math.min(W - 120, 860);
    ctx.font = `900 ${isWide ? 72 : 66}px ${fontStack}`;
    ctx.direction = 'rtl';
    const lines = wrapArabicText(ctx, hookText, cardW - 100);
    const lineH = isWide ? 94 : 88;
    const cardH = Math.max(220, lines.length * lineH + 96);

    drawStyledBoxContainer(ctx, {
      x: -cardW / 2,
      y: -cardH / 2,
      w: cardW,
      h: cardH,
      radius: template.questionBorderRadius,
      fillColorHex: template.questionBoxColor,
      fillRgba: hexToRgba(template.questionBoxColor, Math.max(0.85, template.questionBoxOpacity)),
      opacity: Math.max(0.85, template.questionBoxOpacity),
      borderColor: template.questionBorderColor,
      borderWidth: Math.max(4, template.questionBorderWidth),
      boxStyle,
      borderStyle,
      boxGloss: template.boxGloss,
      enhanced: template.enhanceAppearance ?? true,
      shadowIntensity,
      glowIntensity: Math.max(0.35, glowIntensity),
      wingExtensions: boxStyle === 'millionaireHex',
    });

    ctx.fillStyle = template.questionTextColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const startY = -((lines.length - 1) * lineH) / 2;
    lines.forEach((line, idx) => {
      ctx.fillText(line, 0, startY + idx * lineH);
    });
    ctx.restore();

    drawBrandWatermark(ctx, template, globalTime, W, H, fontStack);
    if (aiIntroTiming && template.aiPresenter?.enabled && !aiIntroTiming.isFullscreenHero) {
      const pRect = resolveAiPresenterRect(template.aiPresenter, W, H, template.aspectRatio);
      drawAiPresenterVideoFrame(ctx, template, template.aiPresenter, pRect, fontStack, {
        videoTimeSec: aiIntroTiming.videoTimeSec,
        globalTime,
        isIdleAfterSpeech: aiIntroTiming.isIdleAfterSpeech,
      });
    }
    ctx.restore();
    return;
  }

  const contentEnd = getSlidesContentDuration(slides, timing, audio, template);

  // Check if currently in End Card window
  if (template.showEndCard && slides.length > 0 && globalTime >= contentEnd) {
    const endElapsed = globalTime - contentEnd;
    const alpha = clamp01(endElapsed / 0.35);
    const popScale = 0.92 + 0.08 * easeOutCubic(alpha);
    const aiOutroTiming = computeAiPresenterFrameTiming(globalTime, slides, template, timing, audio);
    const useAiOutroHero = Boolean(aiOutroTiming && aiOutroTiming.isFullscreenHero && template.aiPresenter?.enabled);
    const usePresenterOutroHero =
      useAiOutroHero ||
      (Boolean(template.presenterEnabled) && template.presenterOutroFullscreen !== false);
    const endText = (template.endCardText || 'شكراً لمشاهدتكم').trim();
    const defaultScoreCta =
      slides.length > 1
        ? `إذا جبت ${slides.length}/${slides.length} اكتب نتيجتك واشترك 🔔`
        : 'اشترك في القناة · فعّل الجرس واكتب إجابتك';
    const ctaLabel = (template.endCtaText || '').trim() || defaultScoreCta;

    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${0.78 * alpha})`;
    ctx.fillRect(0, 0, W, H);

    if (usePresenterOutroHero) {
      const choreo = computePresenterChoreography(
        globalTime,
        template,
        'outro',
        endElapsed,
        undefined,
        undefined,
        0,
        interactiveState?.demoPresenterPose
          ? {
              forcedPose: interactiveState.demoPresenterPose,
              animClock: interactiveState.demoPresenterAnimClock,
            }
          : undefined
      );
      ctx.save();
      ctx.globalAlpha = alpha;

      const heroW = isWide ? Math.round(W * 0.33) : Math.round(W * 0.68);
      const heroH = isWide ? Math.round(H * 0.74) : Math.round(H * 0.43);
      const heroX = isWide ? Math.round(W * 0.07) : Math.round((W - heroW) / 2);
      const heroY = isWide ? Math.round((H - heroH) / 2) : Math.round(H - heroH - H * 0.05);

      const endCardW = isWide ? Math.round(W * 0.49) : Math.min(W - 84, 920);
      const endCardH = isWide ? 470 : 490;
      const cardCX = isWide ? W * 0.71 : W / 2;
      const cardCY = isWide ? H / 2 : Math.max(endCardH / 2 + 120, heroY - 46 - endCardH / 2);

      const ctaRelY = 82;
      const targetBtnX = isWide ? cardCX : W / 2;
      const targetBtnY = isWide ? cardCY + ctaRelY - 58 : cardCY + ctaRelY;

      if (useAiOutroHero && template.aiPresenter) {
        drawAiPresenterVideoFrame(
          ctx,
          template,
          template.aiPresenter,
          { x: heroX, y: heroY, w: heroW, h: heroH },
          fontStack,
          {
            isFullscreenHero: true,
            videoTimeSec: aiOutroTiming?.videoTimeSec,
            globalTime,
            isIdleAfterSpeech: aiOutroTiming?.isIdleAfterSpeech,
          }
        );
      } else {
        drawPresenterHostFrame(
          ctx,
          template,
          choreo,
          { x: heroX, y: heroY, w: heroW, h: heroH },
          fontStack,
          {
            isFullscreenHero: true,
            targetPointX: isWide ? heroX + heroW + 26 : targetBtnX,
            targetPointY: isWide ? H / 2 + 20 : targetBtnY,
          }
        );
      }

      ctx.save();
      ctx.translate(cardCX, cardCY);
      ctx.scale(popScale, popScale);
      drawStyledBoxContainer(ctx, {
        x: -endCardW / 2,
        y: -endCardH / 2,
        w: endCardW,
        h: endCardH,
        radius: 36,
        fillColorHex: template.questionBoxColor,
        fillRgba: hexToRgba(template.questionBoxColor, 0.94),
        opacity: 0.94,
        borderColor: template.questionBorderColor || '#D4A73A',
        borderWidth: 4,
        boxStyle,
        borderStyle,
        boxGloss: template.boxGloss,
        enhanced: template.enhanceAppearance ?? true,
        shadowIntensity: Math.min(1.2, shadowIntensity),
        glowIntensity: Math.max(0.25, glowIntensity),
      });

      ctx.font = `900 ${isWide ? 64 : 62}px ${fontStack}`;
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = wrapArabicText(ctx, endText, endCardW - 84).slice(0, 2);
      const lineH = 78;
      const startY = -92 - ((lines.length - 1) * lineH) / 2;
      ctx.fillStyle = template.questionTextColor || '#FFFFFF';
      lines.forEach((line, idx) => {
        ctx.fillText(line, 0, startY + idx * lineH);
      });

      // Score Challenge Prompt Pill
      if (slides.length > 1) {
        ctx.font = `800 ${isWide ? 28 : 30}px ${fontStack}`;
        ctx.fillStyle = isColorDark(template.questionBoxColor) ? '#EDD6A2' : '#0f172a';
        ctx.fillText(`كم إجابة صح جبت من ${slides.length}؟ 👇`, 0, -6);
      }

      // Red Animated Subscribe & Bell CTA Button (Hero Presenter points toward this!)
      const ctaScale = 1 + 0.04 * Math.sin(endElapsed * 5.5);
      const ctaW = Math.min(endCardW - 64, isWide ? 680 : 760);
      const ctaH = 92;
      ctx.save();
      ctx.translate(0, ctaRelY);
      ctx.scale(ctaScale, ctaScale);
      drawRoundedRect(ctx, -ctaW / 2, -ctaH / 2, ctaW, ctaH, 26);
      const ctaGrad = ctx.createLinearGradient(-ctaW / 2, -ctaH / 2, ctaW / 2, ctaH / 2);
      ctaGrad.addColorStop(0, '#ef4444');
      ctaGrad.addColorStop(1, '#b91c1c');
      ctx.fillStyle = ctaGrad;
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3.5;
      ctx.stroke();

      let ctaFont = isWide ? 29 : 30;
      ctx.font = `900 ${ctaFont}px ${fontStack}`;
      while (ctaFont > 18 && ctx.measureText(ctaLabel).width > ctaW - 80) {
        ctaFont -= 2;
        ctx.font = `900 ${ctaFont}px ${fontStack}`;
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(ctaLabel, 0, 2);
      ctx.restore();

      ctx.restore();
      ctx.restore();
      ctx.restore();

      drawBrandWatermark(ctx, template, globalTime, W, H, fontStack);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, H / 2);
    ctx.scale(popScale, popScale);

    const endCardW = isWide ? Math.min(W - 220, 1220) : Math.min(W - 96, 920);
    const hasCta = Boolean(template.showEndSubscribeCta);
    const endCardH = hasCta ? (isWide ? 470 : 540) : (isWide ? 340 : 380);

    drawStyledBoxContainer(ctx, {
      x: -endCardW / 2,
      y: -endCardH / 2,
      w: endCardW,
      h: endCardH,
      radius: 36,
      fillColorHex: template.questionBoxColor,
      fillRgba: hexToRgba(template.questionBoxColor, 0.92),
      opacity: 0.92,
      borderColor: template.questionBorderColor || '#D4A73A',
      borderWidth: 4,
      boxStyle,
      borderStyle,
      boxGloss: template.boxGloss,
      enhanced: template.enhanceAppearance ?? true,
      shadowIntensity: Math.min(1.2, shadowIntensity),
      glowIntensity: Math.max(0.25, glowIntensity),
    });

    ctx.font = `900 ${isWide ? 80 : 72}px ${fontStack}`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lines = wrapArabicText(ctx, endText, endCardW - 100);
    const lineH = 98;
    const startY = (hasCta ? -70 : 0) - ((lines.length - 1) * lineH) / 2;

    ctx.fillStyle = isColorDark(template.questionBoxColor) ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.35)';
    lines.forEach((line, idx) => {
      ctx.fillText(line, 0, startY + idx * lineH + 3);
    });
    ctx.fillStyle = template.questionTextColor || '#FFFFFF';
    lines.forEach((line, idx) => {
      ctx.fillText(line, 0, startY + idx * lineH);
    });

    if (hasCta) {
      const ctaY = startY + (lines.length - 1) * lineH + 135;
      const ctaScale = 1 + 0.032 * Math.sin(endElapsed * 5);
      const ctaW = Math.min(endCardW - 72, isWide ? 700 : 740);
      const ctaH = 84;

      ctx.save();
      ctx.translate(0, ctaY);
      ctx.scale(ctaScale, ctaScale);
      drawRoundedRect(ctx, -ctaW / 2, -ctaH / 2, ctaW, ctaH, 24);
      const ctaGrad = ctx.createLinearGradient(-ctaW / 2, -ctaH / 2, ctaW / 2, ctaH / 2);
      ctaGrad.addColorStop(0, '#dc2626');
      ctaGrad.addColorStop(1, '#b91c1c');
      ctx.fillStyle = ctaGrad;
      ctx.fill();

      // Animated light sweep across CTA button
      ctx.save();
      drawRoundedRect(ctx, -ctaW / 2, -ctaH / 2, ctaW, ctaH, 24);
      ctx.clip();
      const ctaSweep = ((endElapsed * 0.85) % 1.6) - 0.3;
      const beamX = -ctaW / 2 + ctaW * ctaSweep;
      const shineGrad = ctx.createLinearGradient(beamX - 70, -ctaH / 2, beamX + 70, ctaH / 2);
      shineGrad.addColorStop(0, 'rgba(255,255,255,0)');
      shineGrad.addColorStop(0.5, 'rgba(255,255,255,0.28)');
      shineGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = shineGrad;
      ctx.fillRect(-ctaW / 2, -ctaH / 2, ctaW, ctaH);
      ctx.restore();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Left bell badge & right play triangle icon inside CTA pill
      const iconEdge = ctaW / 2 - 42;
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.arc(iconEdge, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(iconEdge - 5, -9);
      ctx.lineTo(iconEdge + 10, 0);
      ctx.lineTo(iconEdge - 5, 9);
      ctx.closePath();
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      // Crisp bell icon on opposite side with gentle wiggle
      const bellWiggle = Math.sin(endElapsed * 9) * 0.14;
      ctx.save();
      ctx.translate(-iconEdge, 0);
      ctx.rotate(bellWiggle);
      ctx.fillStyle = '#FACC15';
      ctx.beginPath();
      ctx.arc(0, -3, 9, Math.PI, 0);
      ctx.lineTo(12, 8);
      ctx.lineTo(-12, 8);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 11, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      let ctaFont = isWide ? 29 : 30;
      ctx.direction = 'rtl';
      ctx.font = `800 ${ctaFont}px ${fontStack}`;
      while (ctaFont > 18 && ctx.measureText(ctaLabel).width > ctaW - 140) {
        ctaFont -= 2;
        ctx.font = `800 ${ctaFont}px ${fontStack}`;
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ctaLabel, 0, 2);
      ctx.restore();
    }

    ctx.restore();
    ctx.restore();

    drawBrandWatermark(ctx, template, globalTime, W, H, fontStack);
    if (aiOutroTiming && template.aiPresenter?.enabled && !aiOutroTiming.isFullscreenHero) {
      const pRect = resolveAiPresenterRect(template.aiPresenter, W, H, template.aspectRatio);
      drawAiPresenterVideoFrame(ctx, template, template.aiPresenter, pRect, fontStack, {
        videoTimeSec: aiOutroTiming.videoTimeSec,
        globalTime,
        isIdleAfterSpeech: aiOutroTiming.isIdleAfterSpeech,
      });
    }
    ctx.restore();
    return;
  }

  // 2. Active Slide & Audio-Synced Schedule
  const info = getSlideTimeInfo(globalTime, slides, timing, audio, template);
  if (!info) {
    ctx.restore();
    return;
  }

  const { slide, localTime, schedule, slideIndex } = info;
  const {
    tQuestionStart,
    tOptionStarts,
    tThinkingStart,
    tTimerExitStart,
    tSuspenseStart,
    tRevealStart,
  } = schedule;

  const animDuration = 0.35;
  const isChannelLayout = template.optionsLayout === 'channel2x2';
  const isTrueFalse = slide.slideType === 'trueFalse';
  const isVersus = slide.slideType === 'versus';
  const isClues = slide.slideType === 'clues';
  const isTwoOptionSideBySide = isTrueFalse || isVersus;
  const enhanced = template.enhanceAppearance ?? true;
  const slideImg = getCachedImage(slide.imageDataUrl);
  const darkBg = isBackgroundDark(template);
  const isRevealed = localTime >= tRevealStart;
  const revealElapsed = Math.max(0, localTime - tRevealStart);

  // Slide-to-Slide Transition Envelope
  const slideTrans: SlideTransitionStyle = template.slideTransition || 'none';
  const hasNextSlide = slideIndex < slides.length - 1;
  const rawGap = Math.max(0, timing.transitionGap || 0);
  let transOutProg = 0;
  if (slideTrans !== 'none' && hasNextSlide) {
    if (rawGap >= 0.15) {
      if (globalTime >= schedule.endTime) {
        transOutProg = clamp01((globalTime - schedule.endTime) / rawGap);
      }
    } else {
      const nextStart = schedule.endTime + rawGap;
      const outWin = 0.24;
      if (globalTime >= nextStart - outWin) {
        transOutProg = clamp01((globalTime - (nextStart - outWin)) / outWin);
      }
    }
  }
  const transInDur = 0.32;
  const transInProg =
    slideTrans !== 'none' && (slideIndex > 0 || introDur > 0)
      ? clamp01(localTime / transInDur)
      : 1;

  ctx.save();
  if (slideTrans !== 'none' && (transInProg < 1 || transOutProg > 0)) {
    const inEase = easeOutCubic(transInProg);
    const outEase = easeOutCubic(transOutProg);
    const fadeFactor = inEase * (1 - outEase);

    if (slideTrans === 'fade' || slideTrans === 'wipeGold') {
      ctx.globalAlpha *= fadeFactor;
    } else if (slideTrans === 'slideLeft') {
      ctx.globalAlpha *= fadeFactor;
      const offsetX =
        transOutProg > 0 ? W * 0.55 * outEase : -W * 0.55 * (1 - inEase);
      ctx.translate(offsetX, 0);
    } else if (slideTrans === 'slideRight') {
      ctx.globalAlpha *= fadeFactor;
      const offsetX =
        transOutProg > 0 ? -W * 0.55 * outEase : W * 0.55 * (1 - inEase);
      ctx.translate(offsetX, 0);
    } else if (slideTrans === 'zoomFade') {
      ctx.globalAlpha *= fadeFactor;
      const s =
        transOutProg > 0 ? 1 + 0.12 * outEase : 0.86 + 0.14 * inEase;
      ctx.translate(W / 2, H / 2);
      ctx.scale(s, s);
      ctx.translate(-W / 2, -H / 2);
    }
  }

  const layout = computeStageLayerLayout(
    ctx,
    slide,
    slides.length,
    template,
    timing,
    slideImg ? { width: slideImg.naturalWidth, height: slideImg.naturalHeight } : null
  );
  const {
    badge: layoutBadge,
    image: layoutImage,
    question: layoutQuestion,
    options: layoutOptions,
    timer: layoutTimer,
    explanation: layoutExplanation,
  } = layout;

  // 2.5 Optional Slide Progress Counter & Bar (Layer 1A)
  if (layout.header.progress && slides.length > 1) {
    const pRect = layout.header.progress;
    const progW = pRect.w;
    const progX = pRect.x;
    const progY = pRect.y + 18;
    const ratio = clamp01((slideIndex + 1) / slides.length);

    ctx.save();
    drawRoundedRect(ctx, progX, pRect.y, progW, pRect.h, 12);
    ctx.fillStyle = darkBg ? 'rgba(11, 15, 23, 0.65)' : 'rgba(255, 255, 255, 0.85)';
    ctx.fill();
    ctx.strokeStyle = darkBg ? 'rgba(237, 214, 162, 0.35)' : 'rgba(18, 24, 38, 0.16)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = `800 ${progW < 230 ? 19 : isWide ? 22 : 24}px ${fontStack}`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = darkBg ? '#EDD6A2' : '#121826';
    ctx.fillText(`سؤال ${slideIndex + 1} من ${slides.length}`, W / 2, progY - 2);

    const trackW = progW - 32;
    const trackX = W / 2 - trackW / 2;
    const trackY = progY + 13;
    drawRoundedRect(ctx, trackX, trackY, trackW, 5, 2.5);
    ctx.fillStyle = darkBg ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';
    ctx.fill();

    const fillW = Math.max(12, trackW * ratio);
    drawRoundedRect(ctx, trackX + (trackW - fillW), trackY, fillW, 5, 2.5);
    ctx.fillStyle = '#00B050';
    ctx.fill();
    ctx.restore();
  }

  // 2.55 Optional Per-Slide Difficulty Badge (Layer 1B)
  const diffMode = slide.difficulty || 'none';
  if (layout.header.diffPill && diffMode !== 'none') {
    const diffCfg =
      diffMode === 'easy'
        ? { label: 'سهل', dot: '#22C55E', border: 'rgba(34, 197, 94, 0.6)' }
        : diffMode === 'medium'
          ? { label: 'متوسط', dot: '#F59E0B', border: 'rgba(245, 158, 11, 0.6)' }
          : { label: 'صعب', dot: '#EF4444', border: 'rgba(239, 68, 68, 0.65)' };

    const { x: pillX, y: pillY, w: pillW, h: pillH } = layout.header.diffPill;

    ctx.save();
    drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 14);
    ctx.fillStyle = darkBg ? 'rgba(11, 15, 23, 0.72)' : 'rgba(255, 255, 255, 0.9)';
    ctx.fill();
    ctx.strokeStyle = diffCfg.border;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(pillX + pillW - 22, pillY + pillH / 2, 7, 0, Math.PI * 2);
    ctx.fillStyle = diffCfg.dot;
    ctx.fill();

    ctx.font = `800 ${isWide ? 22 : 23}px ${fontStack}`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = darkBg ? '#FFFFFF' : '#0F172A';
    ctx.fillText(diffCfg.label, pillX + (pillW - 26) / 2, pillY + pillH / 2 + 1);
    ctx.restore();
  }

  // 2.6 Optional Millionaire Prize Ladder (Layer 1C)
  if (template.showPrizeLadder) {
    drawPrizeLadder(
      ctx,
      template,
      slides.length,
      slideIndex,
      isRevealed,
      revealElapsed,
      W,
      H,
      fontStack,
      diffMode !== 'none'
    );
  }

  // 2.65 Optional Live Challenge Scoreboard & Escalating Speed HUD
  if (template.showLiveScoreboard) {
    const rankLabel =
      slides.length <= 1
        ? 'جولة التحدي'
        : slideIndex >= slides.length - 1
          ? 'المستوى: خبير 🏆'
          : slideIndex >= Math.floor(slides.length * 0.5)
            ? 'المستوى: متقدّم ⚡'
            : 'المستوى: إحماء ✨';
    const sbTitle = (template.scoreBoardLabel || 'تحدي الذكاء').trim();
    const speedTag =
      timing.escalatingSpeed && schedule.thinkingDuration < timing.thinkingDuration
        ? ` · تسريع ${schedule.thinkingDuration.toFixed(1)}ث`
        : '';
    const sbText = `${sbTitle} · ${rankLabel}${speedTag}`;
    const sbY = layout.header.progress ? layout.header.progress.y + layout.header.progress.h + 10 : isWide ? 22 : 34;

    ctx.save();
    ctx.font = `800 ${isWide ? 20 : 21}px ${fontStack}`;
    ctx.direction = 'rtl';
    const sbW = Math.min(W - 80, ctx.measureText(sbText).width + 44);
    const sbH = 38;
    const sbX = (W - sbW) / 2;
    drawRoundedRect(ctx, sbX, sbY, sbW, sbH, 12);
    ctx.fillStyle = darkBg ? 'rgba(11, 15, 23, 0.78)' : 'rgba(255, 255, 255, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 176, 80, 0.55)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.fillStyle = darkBg ? '#6ee7b7' : '#047857';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sbText, W / 2, sbY + sbH / 2 + 1);
    ctx.restore();
  }

  // Apply Global Scale around stage focal center
  const hasGlobalScale = Math.abs(globalScale - 1) > 0.005;
  ctx.save();
  if (hasGlobalScale) {
    ctx.translate(W / 2, H * 0.52);
    ctx.scale(globalScale, globalScale);
    ctx.translate(-W / 2, -H * 0.52);
  }

  // 3. Layer 2: Optional Top Badge
  if (layoutBadge) {
    const badgeProgress = clamp01((localTime - tQuestionStart) / animDuration);
    if (badgeProgress > 0) {
      const tr = computeAnimTransform(badgeProgress, 'fade');
      ctx.save();
      ctx.globalAlpha *= tr.opacity;
      ctx.translate(layoutBadge.centerX + tr.offsetX, layoutBadge.centerY + tr.offsetY);
      ctx.scale(layoutBadge.scale, layoutBadge.scale);

      drawRoundedRect(
        ctx,
        -layoutBadge.boxW / 2,
        -layoutBadge.boxH / 2,
        layoutBadge.boxW,
        layoutBadge.boxH,
        template.badgeBorderRadius ?? 33
      );
      ctx.fillStyle = template.badgeBgColor;
      ctx.fill();

      ctx.font = `700 ${layoutBadge.font}px ${fontStack}`;
      ctx.direction = 'rtl';
      ctx.fillStyle = template.badgeTextColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(layoutBadge.text, 0, 2);
      ctx.restore();
    }
  }

  // 4. Layer 3 (Image) & Layer 4 (Question Box)
  const qProgress = clamp01((localTime - tQuestionStart) / animDuration);
  if (qProgress > 0) {
    const tr = computeAnimTransform(qProgress, template.questionAnim);

    const imgFit: ImageFitMode = slide.imageFit || 'cover';
    const imgRadius = Math.max(0, Math.min(48, slide.imageBorderRadius ?? 22));
    const imgMode: ImageChallengeMode = slide.imageChallengeMode || 'normal';
    const maxBlur = Math.max(10, Math.min(50, slide.imageBlurStrength ?? 28));
    let activeBlur = 0;
    let mysteryAlpha = 0;
    let challengeRevealProg = 1;
    if (slideImg) {
      if (imgMode === 'blurToClear') {
        if (!isRevealed) {
          activeBlur = maxBlur;
          mysteryAlpha = 1;
          challengeRevealProg = 0;
        } else {
          const clearT = easeOutCubic(clamp01(revealElapsed / 0.45));
          activeBlur = maxBlur * (1 - clearT);
          mysteryAlpha = 1 - clearT;
          challengeRevealProg = clearT;
        }
      } else if (imgMode === 'gradualClear' || imgMode === 'zoomOutReveal' || imgMode === 'tileGridReveal') {
        if (localTime < tThinkingStart) {
          activeBlur = maxBlur;
          mysteryAlpha = 1;
          challengeRevealProg = 0;
        } else if (!isRevealed) {
          const thinkDur = Math.max(0.5, tRevealStart - tThinkingStart);
          const prog = clamp01((localTime - tThinkingStart) / thinkDur);
          activeBlur = maxBlur * (1 - 0.68 * prog);
          mysteryAlpha = 1 - 0.6 * prog;
          challengeRevealProg = 0.85 * prog;
        } else {
          const clearT = easeOutCubic(clamp01(revealElapsed / 0.32));
          activeBlur = maxBlur * 0.32 * (1 - clearT);
          mysteryAlpha = 0.4 * (1 - clearT);
          challengeRevealProg = 0.85 + 0.15 * clearT;
        }
      }
    }

    // Layer 3: Optional External Question Illustration Image (Above or Below Box)
    if (slideImg && layoutImage) {
      const { frameW: imgFrameW, frameH: imgFrameH } = layoutImage;
      ctx.save();
      ctx.globalAlpha *= tr.opacity;
      ctx.translate(layoutImage.centerX + tr.offsetX, layoutImage.centerY + tr.offsetY);
      ctx.scale(tr.scale, tr.scale);
      drawRoundedRect(
        ctx,
        -imgFrameW / 2 - 8,
        -imgFrameH / 2 - 8,
        imgFrameW + 16,
        imgFrameH + 16,
        Math.min(54, imgRadius + 4)
      );
      ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
      ctx.fill();

      ctx.save();
      drawRoundedRect(ctx, -imgFrameW / 2, -imgFrameH / 2, imgFrameW, imgFrameH, imgRadius);
      ctx.clip();

      drawBlurredChallengeImage(
        ctx,
        slideImg,
        -imgFrameW / 2,
        -imgFrameH / 2,
        imgFrameW,
        imgFrameH,
        activeBlur,
        mysteryAlpha,
        fontStack,
        imgFit,
        imgMode,
        challengeRevealProg
      );
      ctx.restore();

      drawRoundedRect(ctx, -imgFrameW / 2, -imgFrameH / 2, imgFrameW, imgFrameH, imgRadius);
      ctx.strokeStyle =
        imgMode !== 'normal' && isRevealed
          ? template.correctColor || '#00B050'
          : template.questionBorderColor || '#FFFFFF';
      ctx.lineWidth = imgMode !== 'normal' && isRevealed ? 5 : 4;
      ctx.stroke();
      ctx.restore();
    }

    // Layer 4: Question Box
    const {
      w: qW,
      h: qH,
      fontSize: qFontSize,
      lines: qLines,
      lineHeight: qLineHeight,
      hasMath: qHasMath,
      padX: qPadX,
      rawText: qRawText,
      insideImage,
    } = layoutQuestion;

    ctx.save();
    ctx.globalAlpha *= tr.opacity;
    ctx.translate(layoutQuestion.centerX + tr.offsetX, layoutQuestion.centerY + tr.offsetY);
    ctx.scale(tr.scale, tr.scale);

    const hasQBody = template.questionBoxOpacity > 0.01;
    if (hasQBody) {
      drawStyledBoxContainer(ctx, {
        x: -qW / 2,
        y: -qH / 2,
        w: qW,
        h: qH,
        radius: template.questionBorderRadius,
        fillColorHex: template.questionBoxColor,
        fillRgba: hexToRgba(template.questionBoxColor, template.questionBoxOpacity),
        opacity: template.questionBoxOpacity,
        borderColor: template.questionBorderColor,
        borderWidth: template.questionBorderWidth,
        boxStyle,
        borderStyle,
        boxGloss: template.boxGloss,
        enhanced,
        shadowIntensity,
        glowIntensity,
        shadowOffsetY: 10,
        drawFill: true,
        drawBorder: template.questionBorderWidth > 0,
        wingExtensions: boxStyle === 'millionaireHex' && !isWide,
      });
    }

    // Inside-Box Question Image (Backdrop or Framed Inside)
    if (slideImg && insideImage) {
      if (insideImage.layout === 'backdrop') {
        ctx.save();
        traceBoxPath(ctx, -qW / 2, -qH / 2, qW, qH, template.questionBorderRadius, boxStyle);
        ctx.clip();
        const bgZoom = Math.max(0.5, Math.min(1.8, (slide.imageScale ?? 100) / 100));
        const zw = qW * bgZoom;
        const zh = qH * bgZoom;
        drawBlurredChallengeImage(
          ctx,
          slideImg,
          -zw / 2 + (slide.imageOffsetX ?? 0),
          -zh / 2 + (slide.imageOffsetY ?? 0),
          zw,
          zh,
          activeBlur,
          mysteryAlpha,
          fontStack,
          imgFit,
          imgMode,
          challengeRevealProg
        );
        ctx.fillStyle = isColorDark(template.questionBoxColor)
          ? 'rgba(8, 12, 22, 0.45)'
          : 'rgba(255, 255, 255, 0.42)';
        ctx.fillRect(-qW / 2, -qH / 2, qW, qH);
        ctx.restore();
      } else {
        ctx.save();
        traceBoxPath(ctx, -qW / 2, -qH / 2, qW, qH, template.questionBorderRadius, boxStyle);
        ctx.clip();

        ctx.save();
        drawRoundedRect(
          ctx,
          insideImage.x,
          insideImage.y,
          insideImage.w,
          insideImage.h,
          Math.min(imgRadius, Math.min(insideImage.w, insideImage.h) / 2)
        );
        ctx.clip();
        drawBlurredChallengeImage(
          ctx,
          slideImg,
          insideImage.x,
          insideImage.y,
          insideImage.w,
          insideImage.h,
          activeBlur,
          mysteryAlpha,
          fontStack,
          imgFit,
          imgMode,
          challengeRevealProg
        );
        ctx.restore();

        drawRoundedRect(
          ctx,
          insideImage.x,
          insideImage.y,
          insideImage.w,
          insideImage.h,
          Math.min(imgRadius, Math.min(insideImage.w, insideImage.h) / 2)
        );
        ctx.strokeStyle =
          imgMode !== 'normal' && isRevealed
            ? template.correctColor || '#00B050'
            : hexToRgba(template.questionBorderColor || '#FFFFFF', 0.72);
        ctx.lineWidth = imgMode !== 'normal' && isRevealed ? 4 : 2.5;
        ctx.stroke();
        ctx.restore();
      }
    }

    const qTxtCX = insideImage ? insideImage.textCenterX : 0;
    const qTxtCY = insideImage ? insideImage.textCenterY : 0;
    const qTxtMaxW = insideImage ? insideImage.textMaxW : qW - qPadX * 2;

    if (qHasMath) {
      if (enhanced) {
        drawSmartQuizText(
          ctx,
          qRawText,
          qTxtCX,
          qTxtCY + 2,
          qTxtMaxW,
          qFontSize,
          fontStack,
          800,
          'rgba(0,0,0,0.22)',
          3
        );
      }
      drawSmartQuizText(
        ctx,
        qRawText,
        qTxtCX,
        qTxtCY,
        qTxtMaxW,
        qFontSize,
        fontStack,
        800,
        template.questionTextColor,
        3
      );
    } else {
      ctx.font = `800 ${qFontSize}px ${fontStack}`;
      ctx.direction = 'rtl';
      const qAlign = template.questionTextAlign || 'center';
      ctx.textAlign = qAlign;
      ctx.textBaseline = 'middle';
      const qTextDrawX =
        qAlign === 'right'
          ? qTxtCX + qTxtMaxW / 2
          : qAlign === 'left'
            ? qTxtCX - qTxtMaxW / 2
            : qTxtCX;
      const startLineY = qTxtCY - ((qLines.length - 1) * qLineHeight) / 2;
      if (enhanced) {
        ctx.fillStyle = isColorDark(template.questionBoxColor)
          ? 'rgba(0,0,0,0.35)'
          : 'rgba(255,255,255,0.3)';
        qLines.forEach((line, idx) => {
          ctx.fillText(line, qTextDrawX, startLineY + idx * qLineHeight + 2);
        });
      }
      ctx.fillStyle = template.questionTextColor;
      qLines.forEach((line, idx) => {
        ctx.fillText(line, qTextDrawX, startLineY + idx * qLineHeight);
      });
    }

    ctx.restore();
  }

  // 5. Layer 5: Options Grid / List
  const optionCount = layoutOptions.items.length;
  const effectiveOptH = layoutOptions.optH;
  const isSuspending =
    localTime >= tSuspenseStart && localTime < tRevealStart && timing.suspenseDuration > 0;
  const revealAnim = isRevealed ? easeOutBack(clamp01(revealElapsed / 0.35)) : 0;
  const revealFade = isRevealed ? clamp01(revealElapsed / 0.25) : 0;

  const wrongColor = template.wrongColor || '#DC2626';
  const isRedWrongMode = template.revealStyle === 'redWrongGreenCorrect';
  let correctOriginX = layoutOptions.areaCenterX;
  let correctOriginY = layoutOptions.startPx + effectiveOptH;

  for (let i = 0; i < optionCount; i++) {
    const optProgress = clamp01((localTime - tOptionStarts[i]) / animDuration);
    if (optProgress <= 0) continue;

    const tr = computeAnimTransform(optProgress, template.optionAnim);
    const isCorrect = !isClues && i === slide.correctIndex;
    const isWrongRed = !isClues && isRevealed && !isCorrect && isRedWrongMode;

    let optWindowEnd = tThinkingStart;
    for (let k = i + 1; k < optionCount; k++) {
      if (tOptionStarts[k] > tOptionStarts[i] + 0.01) {
        optWindowEnd = tOptionStarts[k];
        break;
      }
    }
    const isSpokenHighlight =
      Boolean(template.highlightSpokenOption) &&
      !isRevealed &&
      localTime >= tOptionStarts[i] &&
      localTime < optWindowEnd;

    const { boxW, boxH, centerX, centerY } = layoutOptions.items[i];

    if (isCorrect) {
      correctOriginX = centerX + tr.offsetX;
      correctOriginY = centerY + tr.offsetY;
    }

    let finalScale = tr.scale;
    let finalAlpha = tr.opacity;

    if (isSpokenHighlight) {
      finalScale *= 1.032;
    }

    if (isSuspending) {
      const pulsePhase = Math.sin(((localTime - tSuspenseStart) / 0.5) * Math.PI);
      finalScale *= 1 + 0.03 * Math.abs(pulsePhase);
    }

    if (isRevealed) {
      if (isClues) {
        finalAlpha *= 1 - 0.82 * clamp01(revealElapsed / 0.28);
      } else if (isCorrect) {
        finalScale *= 1 + (isChannelLayout ? 0.06 : 0.05) * clamp01(revealAnim);
      } else if (template.revealStyle === 'dimOthers') {
        finalAlpha *= 1 - 0.7 * clamp01(revealElapsed / 0.28);
      } else if (isRedWrongMode) {
        finalScale *= 1 - 0.025 * revealFade;
      }
    }

    ctx.save();
    ctx.globalAlpha *= finalAlpha;
    ctx.translate(centerX + tr.offsetX, centerY + tr.offsetY);
    ctx.scale(finalScale, finalScale);

    const effectiveFillHex =
      isRevealed && isCorrect
        ? template.correctColor
        : isWrongRed
          ? wrongColor
          : template.optionBoxColor;

    const effectiveFillOpacity =
      isRevealed && isCorrect
        ? 1
        : isWrongRed
          ? 0.94
          : template.optionBoxOpacity;

    const boxFill = hexToRgba(effectiveFillHex, effectiveFillOpacity);

    const borderCol =
      isRevealed && isCorrect
        ? '#FFFFFF'
        : isWrongRed
          ? '#FECACA'
          : isSpokenHighlight
            ? '#FFF3B0'
            : isVersus
              ? i === 0
                ? '#F59E0B'
                : '#38BDF8'
              : template.optionBorderColor;

    const shouldDrawBody =
      template.optionBoxOpacity > 0.01 || (isRevealed && (isCorrect || isWrongRed));

    if (shouldDrawBody) {
      if (isRevealed && isCorrect) {
        traceBoxPath(
          ctx,
          -boxW / 2 - 6,
          -boxH / 2 - 6,
          boxW + 12,
          boxH + 12,
          template.optionBorderRadius + 4,
          boxStyle
        );
        ctx.fillStyle = hexToRgba(template.correctColor, 0.34);
        ctx.fill();
      } else if (isWrongRed) {
        traceBoxPath(
          ctx,
          -boxW / 2 - 3,
          -boxH / 2 - 3,
          boxW + 6,
          boxH + 6,
          template.optionBorderRadius + 2,
          boxStyle
        );
        ctx.fillStyle = hexToRgba(wrongColor, 0.22);
        ctx.fill();
      }

      drawStyledBoxContainer(ctx, {
        x: -boxW / 2,
        y: -boxH / 2,
        w: boxW,
        h: boxH,
        radius: template.optionBorderRadius,
        fillColorHex: effectiveFillHex,
        fillRgba: boxFill,
        opacity: effectiveFillOpacity,
        borderColor: borderCol,
        borderWidth:
          isRevealed && (isCorrect || isWrongRed)
            ? Math.max(4, template.optionBorderWidth)
            : isSpokenHighlight
              ? Math.max(5, template.optionBorderWidth + 1)
              : template.optionBorderWidth,
        boxStyle,
        borderStyle: isRevealed && (isCorrect || isWrongRed) ? 'solid' : borderStyle,
        boxGloss: template.boxGloss && !(isRevealed && (isCorrect || isWrongRed)),
        enhanced: enhanced && !(isRevealed && (isCorrect || isWrongRed)),
        shadowIntensity: isRevealed && (isCorrect || isWrongRed) ? 0.5 : shadowIntensity,
        glowIntensity: isSpokenHighlight ? Math.max(0.55, glowIntensity) : glowIntensity,
        isHighlighted: isSpokenHighlight,
        shadowOffsetY: 8,
        drawFill: true,
        drawBorder: template.optionBorderWidth > 0 || isSpokenHighlight || isVersus || boxStyle === 'minimalOutline',
      });

      // Enhanced VS duel inner contrast gradient (warm gold side vs cool sky blue side)
      if (isVersus && !isRevealed) {
        ctx.save();
        traceBoxPath(ctx, -boxW / 2, -boxH / 2, boxW, boxH, template.optionBorderRadius, boxStyle);
        ctx.clip();
        const duelTint = ctx.createLinearGradient(-boxW / 2, -boxH / 2, boxW / 2, boxH / 2);
        duelTint.addColorStop(0, i === 0 ? 'rgba(245, 158, 11, 0.24)' : 'rgba(56, 189, 248, 0.24)');
        duelTint.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = duelTint;
        ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
        ctx.restore();
      }

      // Broadcast Shimmer Sweep across revealed correct box
      if (isRevealed && isCorrect && revealElapsed >= 0 && revealElapsed < 1.25) {
        ctx.save();
        traceBoxPath(ctx, -boxW / 2, -boxH / 2, boxW, boxH, template.optionBorderRadius, boxStyle);
        ctx.clip();
        const sweepT = clamp01(revealElapsed / 0.85);
        const shimmerCenterX = -boxW / 2 - 120 + (boxW + 240) * easeOutCubic(sweepT);
        const shimmerGrad = ctx.createLinearGradient(
          shimmerCenterX - 95,
          -boxH / 2,
          shimmerCenterX + 95,
          boxH / 2
        );
        shimmerGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        shimmerGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.42)');
        shimmerGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = shimmerGrad;
        ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
        ctx.restore();
      }
    }

    const optImgCfg = slide.optionImages?.[i];
    const optImg = optImgCfg?.dataUrl ? getCachedImage(optImgCfg.dataUrl) : null;
    const optImgPlace: OptionImagePlacement = slide.optionImagePlacement || 'insideRight';
    const optImgFit: ImageFitMode = slide.optionImageFit || 'cover';
    const optImgRad = Math.max(0, Math.min(36, slide.optionImageRadius ?? 14));
    const optImgItemScale = optImgCfg?.scale ? Math.max(0.5, Math.min(1.6, optImgCfg.scale / 100)) : 1;
    const optImgScaleTotal = Math.max(0.4, Math.min(1.9, ((slide.optionImageScale ?? 100) / 100) * optImgItemScale));
    const optImgOffX = Math.max(-120, Math.min(120, slide.optionImageOffsetX ?? 0));
    const optImgOffY = Math.max(-120, Math.min(120, slide.optionImageOffsetY ?? 0));

    // CoverFill option image inside box behind text/badges
    if (optImg && optImgPlace === 'coverFill') {
      ctx.save();
      traceBoxPath(ctx, -boxW / 2, -boxH / 2, boxW, boxH, template.optionBorderRadius, boxStyle);
      ctx.clip();
      const zw = boxW * optImgScaleTotal;
      const zh = boxH * optImgScaleTotal;
      drawImageWithFit(
        ctx,
        optImg,
        optImg.naturalWidth || optImg.width || 1,
        optImg.naturalHeight || optImg.height || 1,
        -zw / 2 + optImgOffX,
        -zh / 2 + optImgOffY,
        zw,
        zh,
        optImgFit
      );
      ctx.fillStyle =
        isRevealed && isCorrect
          ? hexToRgba(template.correctColor, 0.36)
          : isWrongRed
            ? hexToRgba(wrongColor, 0.42)
            : 'rgba(8, 12, 22, 0.42)';
      ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
      ctx.restore();
    }

    // External Option Image (Above or Below Option Box)
    if (optImg && (optImgPlace === 'aboveBox' || optImgPlace === 'belowBox')) {
      const extH = Math.max(44, (layoutOptions.extImgHeight || 96) * optImgItemScale);
      const imgAspectOpt = (optImg.naturalWidth || 1) / Math.max(1, optImg.naturalHeight || 1);
      const extW = Math.min(boxW - 12, Math.max(extH * 1.15, extH * imgAspectOpt));
      const extX = -extW / 2 + optImgOffX;
      const extY =
        (optImgPlace === 'aboveBox' ? -boxH / 2 - extH - 8 : boxH / 2 + 8) + optImgOffY;
      ctx.save();
      drawRoundedRect(ctx, extX - 3, extY - 3, extW + 6, extH + 6, Math.min(40, optImgRad + 3));
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fill();

      ctx.save();
      drawRoundedRect(ctx, extX, extY, extW, extH, optImgRad);
      ctx.clip();
      drawImageWithFit(
        ctx,
        optImg,
        optImg.naturalWidth || optImg.width || 1,
        optImg.naturalHeight || optImg.height || 1,
        extX,
        extY,
        extW,
        extH,
        optImgFit
      );
      ctx.restore();

      drawRoundedRect(ctx, extX, extY, extW, extH, optImgRad);
      ctx.strokeStyle =
        isRevealed && isCorrect
          ? template.correctColor
          : isWrongRed
            ? wrongColor
            : template.optionBorderColor || '#FFFFFF';
      ctx.lineWidth = isRevealed && (isCorrect || isWrongRed) ? 4 : 2.5;
      ctx.stroke();
      ctx.restore();
    }

    const labelStr = isClues
      ? String(i + 1)
      : isTrueFalse
        ? template.optionLabelStyle === 'none'
          ? i === 0
            ? '✓'
            : '✗'
          : getOptionBadgeLabel(i, template.optionLabelStyle)
        : isVersus && template.optionLabelStyle === 'none'
          ? ''
          : getOptionBadgeLabel(i, template.optionLabelStyle);
    const hasBadge = labelStr.length > 0;
    const badgeSize = Math.min(boxH - 26, 66);
    const isHexStyle = boxStyle === 'millionaireHex' || boxStyle === 'chamfer';
    const badgeMarginRight = isHexStyle ? 38 : 24;

    if (hasBadge) {
      const badgeCenterX = boxW / 2 - badgeMarginRight - badgeSize / 2;
      const badgeCenterY =
        optImg && optImgPlace === 'insideTop' ? boxH / 2 - badgeSize / 2 - 12 : 0;
      drawRoundedRect(
        ctx,
        badgeCenterX - badgeSize / 2,
        badgeCenterY - badgeSize / 2,
        badgeSize,
        badgeSize,
        Math.min(18, template.optionBorderRadius)
      );
      ctx.fillStyle =
        isRevealed && isCorrect
          ? '#FFFFFF'
          : isWrongRed
            ? '#FEE2E2'
            : isTrueFalse && template.optionLabelStyle === 'none'
              ? i === 0
                ? '#16a34a'
                : '#dc2626'
              : template.optionLabelBgColor;
      ctx.fill();

      ctx.font = `800 ${Math.round(badgeSize * 0.52)}px ${fontStack}`;
      ctx.fillStyle =
        isRevealed && isCorrect
          ? template.correctColor
          : isWrongRed
            ? wrongColor
            : isTrueFalse && template.optionLabelStyle === 'none'
              ? '#FFFFFF'
              : template.optionLabelTextColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelStr, badgeCenterX, badgeCenterY + 2);
    }

    const showCheck =
      isRevealed &&
      isCorrect &&
      (template.revealStyle === 'scaleCheck' || isRedWrongMode || isTwoOptionSideBySide) &&
      (!isChannelLayout || isWide || isRedWrongMode || isTwoOptionSideBySide);

    const showCross = isWrongRed && (!isChannelLayout || isTwoOptionSideBySide);

    const iconReserve = showCheck || showCross ? (isHexStyle ? 86 : 76) : isHexStyle ? 36 : 22;
    const rightReserve = hasBadge ? badgeMarginRight + badgeSize + 24 : isHexStyle ? 36 : 22;

    if (showCheck) {
      const checkX = -boxW / 2 + (isHexStyle ? 54 : 44);
      ctx.beginPath();
      ctx.arc(checkX, 0, 22, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(checkX - 9, 1);
      ctx.lineTo(checkX - 2, 8);
      ctx.lineTo(checkX + 10, -7);
      ctx.strokeStyle = template.correctColor;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    } else if (showCross) {
      const crossX = -boxW / 2 + (isHexStyle ? 54 : 44);
      ctx.beginPath();
      ctx.arc(crossX, 0, 20, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(crossX - 7, -7);
      ctx.lineTo(crossX + 7, 7);
      ctx.moveTo(crossX + 7, -7);
      ctx.lineTo(crossX - 7, 7);
      ctx.strokeStyle = wrongColor;
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Inside-Box Option Image (insideRight, insideLeft, insideTop)
    let insideThumbReserveRight = 0;
    let insideThumbReserveLeft = 0;
    let textZoneCenterY = 0;
    let textZoneAvailH = Math.max(36, boxH - 16);

    if (optImg && (optImgPlace === 'insideRight' || optImgPlace === 'insideLeft' || optImgPlace === 'insideTop')) {
      const natAsp = (optImg.naturalWidth || 1) / Math.max(1, optImg.naturalHeight || 1);
      ctx.save();
      traceBoxPath(ctx, -boxW / 2, -boxH / 2, boxW, boxH, template.optionBorderRadius, boxStyle);
      ctx.clip();

      if (optImgPlace === 'insideTop') {
        const topH = Math.max(46, Math.min(boxH * 0.64, boxH * 0.48 * optImgScaleTotal));
        const topW = Math.min(boxW - 24, Math.max(topH * 1.15, topH * natAsp));
        const ix = -topW / 2 + optImgOffX;
        const iy = -boxH / 2 + 10 + optImgOffY;
        ctx.save();
        drawRoundedRect(ctx, ix, iy, topW, topH, Math.min(optImgRad, topH / 2));
        ctx.clip();
        drawImageWithFit(
          ctx,
          optImg,
          optImg.naturalWidth || optImg.width || 1,
          optImg.naturalHeight || optImg.height || 1,
          ix,
          iy,
          topW,
          topH,
          optImgFit
        );
        ctx.restore();
        drawRoundedRect(ctx, ix, iy, topW, topH, Math.min(optImgRad, topH / 2));
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 2;
        ctx.stroke();

        const remTop = -boxH / 2 + 10 + topH + 6;
        textZoneCenterY = (remTop + boxH / 2 - 6) / 2;
        textZoneAvailH = Math.max(32, boxH / 2 - 6 - remTop);
      } else {
        const thumbH = Math.max(36, Math.min(boxH - 14, (boxH - 22) * optImgScaleTotal));
        const thumbW = Math.min(boxW * 0.45, Math.max(thumbH * 0.9, thumbH * Math.min(1.5, natAsp)));
        const padEdge = isHexStyle ? 34 : 16;
        const ix =
          (optImgPlace === 'insideRight'
            ? boxW / 2 - (hasBadge ? badgeMarginRight + badgeSize + 12 : padEdge) - thumbW
            : -boxW / 2 + (showCheck || showCross ? iconReserve - 6 : padEdge)) + optImgOffX;
        const iy = -thumbH / 2 + optImgOffY;

        ctx.save();
        drawRoundedRect(ctx, ix, iy, thumbW, thumbH, Math.min(optImgRad, thumbH / 2));
        ctx.clip();
        drawImageWithFit(
          ctx,
          optImg,
          optImg.naturalWidth || optImg.width || 1,
          optImg.naturalHeight || optImg.height || 1,
          ix,
          iy,
          thumbW,
          thumbH,
          optImgFit
        );
        ctx.restore();
        drawRoundedRect(ctx, ix, iy, thumbW, thumbH, Math.min(optImgRad, thumbH / 2));
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 2;
        ctx.stroke();

        if (optImgPlace === 'insideRight') {
          insideThumbReserveRight = thumbW + 14;
        } else {
          insideThumbReserveLeft = thumbW + 14;
        }
      }
      ctx.restore();
    }

    const optText =
      slide.options[i] ||
      (isTrueFalse
        ? i === 0
          ? 'صح'
          : 'خطأ'
        : isClues
          ? `تلميح ${i + 1}`
          : isVersus
            ? `الطرف ${i + 1}`
            : `الخيار ${i + 1}`);
    const optHasMath = hasMathSyntax(optText);

    let optFontSize = isWide
      ? Math.min(50, Math.max(34, template.optionFontSize))
      : template.optionFontSize;

    if (effectiveOptH < 105) {
      optFontSize = Math.min(optFontSize, Math.round(effectiveOptH * 0.42));
    }
    if (optImg && optImgPlace === 'insideTop') {
      optFontSize = Math.min(optFontSize, Math.max(24, Math.round(textZoneAvailH * 0.56)));
    }

    if (isTrueFalse) {
      optFontSize = Math.round(optFontSize * 1.15);
    } else if (isVersus) {
      optFontSize = Math.round(optFontSize * (optText.length > 18 ? 0.94 : 1.08));
    } else if (isClues) {
      optFontSize = Math.round(optFontSize * (optText.length > 42 ? 0.8 : 0.92));
    } else if (isChannelLayout) {
      if (optText.length > 60) optFontSize = Math.round(optFontSize * 0.62);
      else if (optText.length > 35) optFontSize = Math.round(optFontSize * 0.78);
    }

    const leftPad = (showCheck || showCross ? iconReserve : isHexStyle ? 38 : 22) + insideThumbReserveLeft;
    const rightPad = (hasBadge ? rightReserve : isHexStyle ? 38 : 22) + insideThumbReserveRight;
    const textMaxW = Math.max(84, boxW - leftPad - rightPad);
    const centerTextX = (leftPad - rightPad) / 2;
    const optColor =
      optImg && optImgPlace === 'coverFill'
        ? '#FFFFFF'
        : isRevealed && (isCorrect || isWrongRed)
          ? '#FFFFFF'
          : template.optionTextColor;

    if (optHasMath) {
      drawSmartQuizText(
        ctx,
        optText,
        centerTextX,
        textZoneCenterY,
        textMaxW,
        optFontSize,
        fontStack,
        700,
        optColor,
        2
      );
    } else {
      ctx.font = `${isTrueFalse || isVersus ? 800 : 700} ${optFontSize}px ${fontStack}`;
      ctx.direction = 'rtl';
      ctx.fillStyle = optColor;

      const safeTextMaxW = textMaxW;
      let optLines = wrapArabicText(ctx, optText, safeTextMaxW);
      const maxVisibleLines =
        optImg && optImgPlace === 'insideTop'
          ? 2
          : template.autoFitText && boxH >= 130
            ? 3
            : 2;
      if (template.autoFitText || (optImg && (insideThumbReserveLeft > 0 || insideThumbReserveRight > 0 || optImgPlace === 'insideTop'))) {
        const availOptH = textZoneAvailH;
        while (
          optFontSize > 20 &&
          (optLines.length > maxVisibleLines ||
            optLines.length * (optFontSize * 1.25) > availOptH)
        ) {
          optFontSize -= 2;
          ctx.font = `${isTrueFalse || isVersus ? 800 : 700} ${optFontSize}px ${fontStack}`;
          optLines = wrapArabicText(ctx, optText, safeTextMaxW);
        }
      }
      const renderedOptLines = optLines.slice(0, maxVisibleLines);
      const optLineH = optFontSize * 1.25;
      const optStartY = textZoneCenterY - ((renderedOptLines.length - 1) * optLineH) / 2;

      const alignMode = template.optionTextAlign || 'auto';
      const resolvedAlign: 'center' | 'right' | 'left' =
        alignMode === 'center'
          ? 'center'
          : alignMode === 'right'
            ? 'right'
            : alignMode === 'left'
              ? 'left'
              : isClues
                ? 'right'
                : ((isChannelLayout || template.optionsLayout === 'grid2x2') && !hasBadge) ||
                    isTwoOptionSideBySide ||
                    (optImg && optImgPlace === 'insideTop')
                  ? 'center'
                  : 'right';

      if (resolvedAlign === 'center') {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (enhanced) {
          ctx.fillStyle =
            isRevealed || isColorDark(template.optionBoxColor) || (optImg && optImgPlace === 'coverFill')
              ? 'rgba(0,0,0,0.45)'
              : 'rgba(255,255,255,0.28)';
          renderedOptLines.forEach((line, lIdx) => {
            ctx.fillText(line, centerTextX, optStartY + lIdx * optLineH + 2);
          });
        }
        ctx.fillStyle = optColor;
        renderedOptLines.forEach((line, lIdx) => {
          ctx.fillText(line, centerTextX, optStartY + lIdx * optLineH);
        });
      } else if (resolvedAlign === 'left') {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const textLeftX = -boxW / 2 + leftPad;
        renderedOptLines.forEach((line, lIdx) => {
          ctx.fillText(line, textLeftX, optStartY + lIdx * optLineH);
        });
      } else {
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const textRightX = boxW / 2 - rightPad;
        renderedOptLines.forEach((line, lIdx) => {
          ctx.fillText(line, textRightX, optStartY + lIdx * optLineH);
        });
      }
    }

    ctx.restore();
  }

  // 5.2 Versus Mode Center "VS" Medallion
  if (isVersus && layoutOptions.items.length >= 2) {
    const opt2Prog = clamp01((localTime - tOptionStarts[1]) / animDuration);
    if (opt2Prog > 0) {
      const vsX = (layoutOptions.items[0].centerX + layoutOptions.items[1].centerX) / 2;
      const vsY = (layoutOptions.items[0].centerY + layoutOptions.items[1].centerY) / 2;
      const vsScale = easeOutBack(opt2Prog) * (isSuspending ? 1 + 0.06 * Math.abs(Math.sin(((localTime - tSuspenseStart) / 0.4) * Math.PI)) : 1);
      ctx.save();
      ctx.globalAlpha *= opt2Prog;
      ctx.translate(vsX, vsY);
      ctx.scale(vsScale, vsScale);
      const vsRadius = isWide ? 38 : 42;
      ctx.beginPath();
      ctx.arc(0, 0, vsRadius + 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fill();

      const vsGrad = ctx.createLinearGradient(-vsRadius, -vsRadius, vsRadius, vsRadius);
      vsGrad.addColorStop(0, '#F59E0B');
      vsGrad.addColorStop(1, '#DC2626');
      ctx.beginPath();
      ctx.arc(0, 0, vsRadius, 0, Math.PI * 2);
      ctx.fillStyle = vsGrad;
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.direction = 'ltr';
      ctx.font = `900 ${isWide ? 30 : 32}px 'JetBrains Mono', ${fontStack}`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('VS', 0, 2);
      ctx.restore();
    }
  }

  // 5.3 Clues Mode Final Answer Reveal Card (centered cleanly inside options area)
  if (isClues && isRevealed) {
    const cardPop = easeOutBack(clamp01(revealElapsed / 0.38));
    const cardAlpha = clamp01(revealElapsed / 0.22);
    const ansX = layoutOptions.areaCenterX;
    const ansY = layoutOptions.startPx + layoutOptions.totalH / 2;
    const ansW = Math.min(layoutOptions.totalW, isWide ? 980 : 920);
    const ansH = Math.min(layoutOptions.totalH - 12, Math.max(175, isWide ? 190 : 230));
    correctOriginX = ansX;
    correctOriginY = ansY;

    ctx.save();
    ctx.globalAlpha *= cardAlpha;
    ctx.translate(ansX, ansY);
    ctx.scale(0.84 + 0.16 * cardPop, 0.84 + 0.16 * cardPop);

    drawRoundedRect(ctx, -ansW / 2 - 8, -ansH / 2 - 8, ansW + 16, ansH + 16, 34);
    ctx.fillStyle = hexToRgba(template.correctColor, 0.34);
    ctx.fill();

    drawStyledBoxContainer(ctx, {
      x: -ansW / 2,
      y: -ansH / 2,
      w: ansW,
      h: ansH,
      radius: 28,
      fillColorHex: template.correctColor,
      fillRgba: hexToRgba(template.correctColor, 0.98),
      opacity: 0.98,
      borderColor: '#FFFFFF',
      borderWidth: 5,
      boxStyle,
      borderStyle: 'solid',
      boxGloss: true,
      enhanced: true,
      shadowIntensity: 1.1,
      glowIntensity: 0.45,
      drawFill: true,
      drawBorder: true,
    });

    ctx.font = `800 ${isWide ? 28 : 30}px ${fontStack}`;
    ctx.direction = 'rtl';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✓ الإجابة الصحيحة', 0, -ansH * 0.25);

    const clueAnswer = (slide.options[3] || slide.explanationText || 'الإجابة').trim();
    if (hasMathSyntax(clueAnswer)) {
      drawSmartQuizText(
        ctx,
        clueAnswer,
        0,
        ansH * 0.12,
        ansW - 72,
        isWide ? 52 : 58,
        fontStack,
        900,
        '#FFFFFF',
        2
      );
    } else {
      let aFont = isWide ? 52 : 58;
      ctx.font = `900 ${aFont}px ${fontStack}`;
      let aLines = wrapArabicText(ctx, clueAnswer, ansW - 72);
      while (aFont > 28 && (aLines.length > 2 || aLines.length * aFont * 1.25 > ansH * 0.54)) {
        aFont -= 2;
        ctx.font = `900 ${aFont}px ${fontStack}`;
        aLines = wrapArabicText(ctx, clueAnswer, ansW - 72);
      }
      const lineH = aFont * 1.22;
      const startY = ansH * 0.1 - ((aLines.length - 1) * lineH) / 2;
      ctx.fillStyle = '#FFFFFF';
      aLines.slice(0, 2).forEach((ln, lIdx) => {
        ctx.fillText(ln, 0, startY + lIdx * lineH);
      });
    }
    ctx.restore();
  }

  // 6. Countdown Timer (#tm) — Enters after options (default), supports flexible placement & disappears cleanly before answer reveal
  const timerVisMode: TimerVisibilityMode =
    template.timerVisibilityMode || 'afterOptionsBeforeAnswer';
  const enterStart =
    timerVisMode === 'fromQuestion' ? tQuestionStart + 0.55 : tThinkingStart;
  const susWindow = Math.max(0, tRevealStart - tTimerExitStart);

  let timerExitStart = tRevealStart;
  let timerExitEnd = tRevealStart;
  if (timerVisMode !== 'untilReveal') {
    if (susWindow >= 0.22) {
      timerExitStart = tTimerExitStart;
      timerExitEnd = Math.min(tRevealStart - 0.03, tTimerExitStart + 0.22);
    } else {
      timerExitStart = Math.max(enterStart + 0.1, tRevealStart - 0.2);
      timerExitEnd = Math.max(timerExitStart + 0.05, tRevealStart - 0.02);
    }
  }

  const showTimer =
    layoutTimer.enabled && localTime >= enterStart && localTime < timerExitEnd;

  if (showTimer) {
    const isThinking = localTime >= tThinkingStart && localTime < tTimerExitStart;
    const enterProg = clamp01((localTime - enterStart) / 0.22);
    const exitProg =
      timerVisMode === 'untilReveal' || localTime <= timerExitStart
        ? 0
        : clamp01((localTime - timerExitStart) / Math.max(0.05, timerExitEnd - timerExitStart));
    const visAlpha = easeOutCubic(enterProg) * (1 - easeOutCubic(exitProg));

    const slideThinkingDur = schedule.thinkingDuration;
    const elapsedThink = isThinking
      ? Math.min(slideThinkingDur, localTime - tThinkingStart)
      : localTime < tThinkingStart
        ? 0
        : slideThinkingDur;
    const remaining = Math.max(0, slideThinkingDur - elapsedThink);
    const ratio = clamp01(remaining / Math.max(0.01, slideThinkingDur));
    const urgentThreshold = Math.max(1, Math.min(10, template.timerUrgentThreshold ?? 3));
    const urgentColor = template.timerUrgentColor?.trim() || '#EF4444';
    const isUrgent =
      isThinking && remaining <= urgentThreshold && template.timerUrgentPulse !== false;
    const urgentPulse = isUrgent
      ? 1 + 0.055 * Math.pow(Math.max(0, Math.sin(elapsedThink * Math.PI * 2)), 2)
      : 1;

    const timerOpacity = clamp01(template.timerOpacity ?? 1);
    ctx.save();
    ctx.globalAlpha *= visAlpha * timerOpacity;
    ctx.translate(layoutTimer.centerX, layoutTimer.centerY);
    const s =
      (0.84 + 0.16 * easeOutBack(enterProg)) *
      (1 - 0.22 * exitProg) *
      layoutTimer.effectiveScale *
      urgentPulse;
    ctx.scale(s, s);

    const matchBg = template.timerMatchBackground !== false;
    const timerBoxHex = matchBg
      ? template.questionBoxColor || template.timerBgColor || '#F2E3BA'
      : template.timerBgColor || '#F2E3BA';
    const rawTimerColor = (template.timerColor || '#000000').trim();
    const effectiveTimerColor = matchBg
      ? isColorDark(timerBoxHex) &&
        (rawTimerColor.toLowerCase() === '#000000' || rawTimerColor === '#000')
        ? '#FFFFFF'
        : !isColorDark(timerBoxHex) &&
            (rawTimerColor.toLowerCase() === '#ffffff' || rawTimerColor === '#fff')
          ? '#0f172a'
          : rawTimerColor
      : rawTimerColor;
    const activeAccentColor = isUrgent ? urgentColor : effectiveTimerColor;
    const customBorderColor = template.timerBorderColor?.trim();
    const timerStrokeColor = isUrgent
      ? urgentColor
      : customBorderColor || template.questionBorderColor || '#FFFFFF';
    const customBorderW = template.timerBorderWidth ?? -1;
    const timerStrokeWidth =
      customBorderW >= 0
        ? customBorderW
        : Math.max(3, Math.min(5, template.questionBorderWidth || 4));
    const unitSuffix = template.timerUnitSuffix ?? '';

    const secDisplay = isThinking
      ? Math.max(1, Math.ceil(remaining))
      : localTime < tThinkingStart
        ? Math.max(1, Math.ceil(slideThinkingDur))
        : 0;
    const secLabel = `${secDisplay}${unitSuffix}`;
    const secFrac = isThinking ? elapsedThink - Math.floor(elapsedThink) : 1;
    const popScale = isThinking
      ? 1 + 0.14 * (1 - easeOutCubic(Math.min(1, secFrac / 0.24)))
      : 1;

    if (template.timerStyle === 'channelBox') {
      const boxW = isWide ? 124 : 142;
      const boxH = isWide ? 98 : 114;

      drawStyledBoxContainer(ctx, {
        x: -boxW / 2,
        y: -boxH / 2,
        w: boxW,
        h: boxH,
        radius: 26,
        fillColorHex: timerBoxHex,
        fillRgba: hexToRgba(timerBoxHex, matchBg ? 0.92 : 0.98),
        opacity: matchBg ? 0.92 : 0.98,
        borderColor: timerStrokeColor,
        borderWidth: timerStrokeWidth,
        boxStyle: boxStyle === 'millionaireHex' || boxStyle === 'ticket' ? 'bevel3d' : boxStyle,
        borderStyle: isUrgent ? 'solid' : borderStyle,
        boxGloss: template.boxGloss,
        enhanced,
        shadowIntensity: Math.min(1, shadowIntensity),
        glowIntensity: isUrgent ? Math.max(0.45, glowIntensity) : glowIntensity,
        isHighlighted: isUrgent,
        shadowOffsetY: 6,
        drawFill: true,
        drawBorder: timerStrokeWidth > 0,
      });

      ctx.save();
      if (!isThinking && localTime < tThinkingStart) {
        ctx.globalAlpha *= 0.65;
      }
      ctx.scale(popScale, popScale);
      ctx.direction = 'ltr';
      ctx.font = `900 ${(unitSuffix ? (isWide ? 50 : 58) : isWide ? 64 : 74)}px ${fontStack}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isColorDark(timerBoxHex) ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.12)';
      ctx.fillText(secLabel, 0, 6);
      ctx.fillStyle = isUrgent ? urgentColor : effectiveTimerColor;
      ctx.fillText(secLabel, 0, 2);
      ctx.restore();
    } else if (template.timerStyle === 'hexBadge') {
      const boxW = isWide ? 128 : 144;
      const boxH = isWide ? 100 : 116;

      drawStyledBoxContainer(ctx, {
        x: -boxW / 2,
        y: -boxH / 2,
        w: boxW,
        h: boxH,
        radius: 24,
        fillColorHex: timerBoxHex,
        fillRgba: hexToRgba(timerBoxHex, 0.96),
        opacity: 0.96,
        borderColor: isUrgent ? urgentColor : customBorderColor || '#FACC15',
        borderWidth: customBorderW >= 0 ? customBorderW : 4,
        boxStyle: 'millionaireHex',
        borderStyle: isUrgent ? 'solid' : 'gradientGold',
        boxGloss: true,
        enhanced: true,
        shadowIntensity: Math.min(1.2, shadowIntensity),
        glowIntensity: isUrgent ? 0.55 : Math.max(0.25, glowIntensity),
        isHighlighted: isUrgent,
        shadowOffsetY: 6,
        drawFill: true,
        drawBorder: (customBorderW >= 0 ? customBorderW : 4) > 0,
      });

      ctx.save();
      ctx.scale(popScale, popScale);
      ctx.direction = 'ltr';
      ctx.font = `900 ${unitSuffix ? (isWide ? 44 : 52) : isWide ? 56 : 64}px 'JetBrains Mono', ${fontStack}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isColorDark(timerBoxHex) ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.14)';
      ctx.fillText(secLabel, 0, 5);
      ctx.fillStyle = isUrgent ? urgentColor : effectiveTimerColor;
      ctx.fillText(secLabel, 0, 2);
      ctx.restore();
    } else if (template.timerStyle === 'neonRing') {
      const radius = isWide ? 47 : 54;
      const ringColor = isUrgent ? urgentColor : customBorderColor || '#22D3EE';

      ctx.save();
      ctx.shadowColor = ringColor;
      ctx.shadowBlur = isUrgent ? 26 : 18;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = matchBg ? 'rgba(7, 11, 24, 0.88)' : hexToRgba(timerBoxHex, 0.92);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 9;
      ctx.stroke();

      if (ratio > 0.01) {
        ctx.beginPath();
        ctx.arc(0, 0, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 9;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.scale(popScale, popScale);
      ctx.direction = 'ltr';
      ctx.font = `900 ${unitSuffix ? (isWide ? 34 : 40) : isWide ? 42 : 48}px 'JetBrains Mono', ${fontStack}`;
      ctx.fillStyle = isUrgent ? urgentColor : matchBg ? '#FFFFFF' : effectiveTimerColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(secLabel, 0, 2);
      ctx.restore();
    } else if (template.timerStyle === 'pillCountdown') {
      const pillW = isWide ? 210 : 236;
      const pillH = isWide ? 74 : 84;
      drawStyledBoxContainer(ctx, {
        x: -pillW / 2,
        y: -pillH / 2,
        w: pillW,
        h: pillH,
        radius: pillH / 2,
        fillColorHex: timerBoxHex,
        fillRgba: hexToRgba(timerBoxHex, 0.94),
        opacity: 0.94,
        borderColor: timerStrokeColor,
        borderWidth: customBorderW >= 0 ? customBorderW : 3.5,
        boxStyle: 'pill3d',
        borderStyle: isUrgent ? 'solid' : borderStyle,
        boxGloss: true,
        enhanced: true,
        shadowIntensity: Math.min(1, shadowIntensity),
        glowIntensity: isUrgent ? 0.4 : glowIntensity,
        drawFill: true,
        drawBorder: (customBorderW >= 0 ? customBorderW : 3.5) > 0,
      });

      const trackW = pillW - 56;
      const trackX = -trackW / 2;
      const trackY = pillH / 2 - 17;
      drawRoundedRect(ctx, trackX, trackY, trackW, 7, 3.5);
      ctx.fillStyle = isColorDark(timerBoxHex) ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';
      ctx.fill();

      const fillW = Math.max(8, trackW * ratio);
      drawRoundedRect(ctx, trackX + (trackW - fillW), trackY, fillW, 7, 3.5);
      ctx.fillStyle = isUrgent ? urgentColor : template.correctColor || '#00B050';
      ctx.fill();

      ctx.save();
      ctx.scale(popScale, popScale);
      ctx.direction = 'ltr';
      ctx.font = `900 ${isWide ? 38 : 42}px 'JetBrains Mono', ${fontStack}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = activeAccentColor;
      ctx.fillText(unitSuffix ? secLabel : `${secDisplay}s`, 0, -6);
      ctx.restore();
    } else if (template.timerStyle === 'bar') {
      const barW = layoutTimer.boxW / Math.max(0.01, layoutTimer.effectiveScale);
      const barH = 22;
      const barX = -barW / 2;
      const barY = -barH / 2 + 16;

      drawRoundedRect(ctx, barX, barY, barW, barH, 11);
      ctx.fillStyle = darkBg ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.14)';
      ctx.fill();

      const fillW = Math.max(20, barW * ratio);
      drawRoundedRect(ctx, barX + (barW - fillW), barY, fillW, barH, 11);
      ctx.fillStyle = activeAccentColor;
      ctx.fill();

      ctx.direction = 'ltr';
      ctx.font = `800 34px ${fontStack}`;
      ctx.fillStyle = activeAccentColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(secLabel, 0, barY - 6);
    } else if (template.timerStyle === 'circle') {
      const radius = isWide ? 44 : 50;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(timerBoxHex, matchBg ? 0.85 : 0.96);
      ctx.fill();
      ctx.strokeStyle = isColorDark(timerBoxHex) ? 'rgba(255, 255, 255, 0.24)' : 'rgba(0, 0, 0, 0.16)';
      ctx.lineWidth = 9;
      ctx.stroke();

      if (ratio > 0.01) {
        ctx.beginPath();
        ctx.arc(0, 0, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
        ctx.strokeStyle = isUrgent ? urgentColor : customBorderColor || effectiveTimerColor;
        ctx.lineWidth = 9;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      ctx.save();
      ctx.scale(popScale, popScale);
      ctx.direction = 'ltr';
      ctx.font = `800 ${unitSuffix ? (isWide ? 30 : 35) : isWide ? 36 : 42}px 'JetBrains Mono', ${fontStack}`;
      ctx.fillStyle = activeAccentColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(secLabel, 0, 2);
      ctx.restore();
    } else if (template.timerStyle === 'digits') {
      const pillColor = activeAccentColor;
      ctx.save();
      ctx.scale(popScale, popScale);
      ctx.direction = 'ltr';
      ctx.font = `900 ${isWide ? 68 : 78}px 'JetBrains Mono', ${fontStack}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = darkBg ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.14)';
      ctx.fillText(secLabel, 0, 4);
      ctx.fillStyle = pillColor;
      ctx.fillText(secLabel, 0, 0);
      ctx.restore();
    }

    ctx.restore();
  }

  // 7. Layer 7: Optional Explanation Note on Reveal (isolated below Options & belowOptions Timer)
  if (isRevealed && layoutExplanation) {
    const expAlpha = clamp01(revealElapsed / 0.35);
    const expBg = template.explanationBgColor?.trim() || template.correctColor;
    const expFg = template.explanationTextColor?.trim() || '#FFFFFF';
    const {
      x: boxX,
      y: boxY,
      boxW: expBoxW,
      boxH: expBoxH,
      centerX: expCenterX,
      centerY: textCenterY,
      lines: expLines,
      hasMath: expHasMath,
      fontSize: expFontSize,
      text: expTextTrimmed,
    } = layoutExplanation;

    ctx.save();
    ctx.globalAlpha *= expAlpha;
    const maxW = expBoxW - 48;
    const lineH = expFontSize + 10;

    drawRoundedRect(ctx, boxX, boxY, expBoxW, expBoxH, 24);
    ctx.fillStyle = hexToRgba(expBg, 0.94);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.stroke();

    if (expHasMath) {
      drawSmartQuizText(
        ctx,
        expTextTrimmed,
        expCenterX,
        textCenterY,
        maxW,
        expFontSize,
        fontStack,
        700,
        expFg,
        2
      );
    } else {
      ctx.font = `700 ${expFontSize}px ${fontStack}`;
      ctx.direction = 'rtl';
      ctx.fillStyle = expFg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const startLineY = textCenterY - ((expLines.length - 1) * lineH) / 2;
      expLines.forEach((line, idx) => {
        ctx.fillText(line, expCenterX, startLineY + idx * lineH);
      });
    }
    ctx.restore();
  }

  // 7.2 Optional Celebration Confetti Burst on Answer Reveal
  if (isRevealed && template.revealConfetti) {
    drawRevealConfetti(ctx, correctOriginX, correctOriginY, revealElapsed);
  }

  // Close Global Scale Transform Scope
  ctx.restore();

  // Close Slide-to-Slide Transition Scope
  ctx.restore();

  // Optional Golden Light Wipe Sweep between slides
  if (slideTrans === 'wipeGold' && (transInProg < 1 || transOutProg > 0)) {
    const sweepProg = transOutProg > 0 ? transOutProg * 0.5 : 0.5 + transInProg * 0.5;
    const beamX = -W * 0.25 + W * 1.5 * sweepProg;
    const beamAlpha = Math.sin(sweepProg * Math.PI) * 0.55;
    if (beamAlpha > 0.02) {
      ctx.save();
      const beamGrad = ctx.createLinearGradient(beamX - 180, 0, beamX + 180, H * 0.25);
      beamGrad.addColorStop(0, 'rgba(237, 214, 162, 0)');
      beamGrad.addColorStop(0.5, `rgba(255, 243, 176, ${beamAlpha.toFixed(3)})`);
      beamGrad.addColorStop(1, 'rgba(237, 214, 162, 0)');
      ctx.fillStyle = beamGrad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  // 7.5 Channel Brand Logo / Animated Watermark & Handle
  drawBrandWatermark(ctx, template, globalTime, W, H, fontStack);

  // 7.8 Interactive Studio Presenter / Real Human AI Video Presenter Overlay
  let presenterRectForHitbox: { x: number; y: number; w: number; h: number } | null = null;
  const aiSlideTiming = computeAiPresenterFrameTiming(globalTime, slides, template, timing, audio);
  if (aiSlideTiming && template.aiPresenter?.enabled) {
    const pRect = resolveAiPresenterRect(template.aiPresenter, W, H, template.aspectRatio);
    presenterRectForHitbox = pRect;
    drawAiPresenterVideoFrame(ctx, template, template.aiPresenter, pRect, fontStack, {
      videoTimeSec: aiSlideTiming.videoTimeSec,
      globalTime,
      isIdleAfterSpeech: aiSlideTiming.isIdleAfterSpeech,
    });
  } else if (template.presenterEnabled) {
    let pPhase: PresenterPhase = 'readingQuestion';
    let phaseElapsed = Math.max(0, localTime - tQuestionStart);
    if (isRevealed) {
      pPhase = 'reveal';
      phaseElapsed = revealElapsed;
    } else if (localTime >= tSuspenseStart && localTime < tRevealStart) {
      pPhase = 'suspense';
      phaseElapsed = Math.max(0, localTime - tSuspenseStart);
    } else if (localTime >= tThinkingStart) {
      pPhase = 'thinking';
      phaseElapsed = Math.max(0, localTime - tThinkingStart);
    } else if (localTime >= tOptionStarts[0]) {
      pPhase = 'readingOptions';
      phaseElapsed = Math.max(0, localTime - tOptionStarts[0]);
    }
    const choreo = computePresenterChoreography(
      globalTime,
      template,
      pPhase,
      phaseElapsed,
      slide,
      schedule,
      localTime,
      interactiveState?.demoPresenterPose
        ? {
            forcedPose: interactiveState.demoPresenterPose,
            animClock: interactiveState.demoPresenterAnimClock,
          }
        : undefined
    );
    const pRect = resolveSlidePresenterRect(template, W, H);
    presenterRectForHitbox = pRect;
    drawPresenterHostFrame(ctx, template, choreo, pRect, fontStack);
  }

  if (template.showDynamicCaptions) {
    const captionState = computeActiveCaptionState(slide, localTime, schedule);
    drawDynamicCaptionsOverlay(ctx, captionState, template, W, H, fontStack);
  }

  // Collect exact stage hitboxes for interactive preview dragging (account for globalScale around H*0.52)
  const mapScaledBox = (cx: number, cy: number, bw: number, bh: number) => {
    const scCx = W / 2 + (cx - W / 2) * globalScale;
    const scCy = H * 0.52 + (cy - H * 0.52) * globalScale;
    const scW = bw * globalScale;
    const scH = bh * globalScale;
    return { x: scCx - scW / 2, y: scCy - scH / 2, w: scW, h: scH };
  };

  const collectedHitboxes: StageElementHitbox[] = [];
  if (layoutBadge) {
    collectedHitboxes.push({
      id: 'badge',
      ...mapScaledBox(
        layoutBadge.centerX,
        layoutBadge.centerY,
        layoutBadge.boxW * layoutBadge.scale,
        layoutBadge.boxH * layoutBadge.scale
      ),
      label: 'الشارة',
    });
  }
  collectedHitboxes.push({
    id: 'question',
    ...mapScaledBox(layoutQuestion.centerX, layoutQuestion.centerY, layoutQuestion.w, layoutQuestion.h),
    label: 'السؤال',
  });
  collectedHitboxes.push({
    id: 'options',
    ...mapScaledBox(
      layoutOptions.areaCenterX,
      layoutOptions.startPx + layoutOptions.totalH / 2,
      layoutOptions.totalW,
      layoutOptions.totalH
    ),
    label: 'الخيارات',
  });
  if (layoutTimer.enabled) {
    collectedHitboxes.push({
      id: 'timer',
      ...mapScaledBox(
        layoutTimer.centerX,
        layoutTimer.centerY,
        Math.max(96, layoutTimer.boxW),
        Math.max(84, layoutTimer.boxH)
      ),
      label: 'المؤقت',
    });
  }
  if (presenterRectForHitbox) {
    collectedHitboxes.push({
      id: 'presenter',
      x: presenterRectForHitbox.x,
      y: presenterRectForHitbox.y,
      w: presenterRectForHitbox.w,
      h: presenterRectForHitbox.h,
      label: 'المذيع',
    });
  }
  if (template.brandLogoDataUrl || (template.brandHandleText || '').trim()) {
    const bAnchor = resolveBrandAnchor(template, W, H);
    collectedHitboxes.push({
      id: 'brand',
      x: bAnchor.anchorX - bAnchor.size / 2,
      y: bAnchor.anchorY - bAnchor.size / 2,
      w: bAnchor.size,
      h: bAnchor.size + bAnchor.handleHeight,
      label: 'الشعار',
    });
  }
  if (outHitboxes) {
    outHitboxes.push(...collectedHitboxes);
  }

  // Interactive Canvas Drag Outlines (Preview drag mode ONLY, never exported)
  if (isPreview && interactiveState?.dragMode) {
    ctx.save();
    for (const hb of collectedHitboxes) {
      const isSelected = interactiveState.activeTarget === hb.id;
      ctx.strokeStyle = isSelected ? '#00B050' : 'rgba(237, 214, 162, 0.85)';
      ctx.lineWidth = isSelected ? 4 : 2.5;
      ctx.setLineDash(isSelected ? [] : [10, 8]);
      ctx.strokeRect(hb.x - 6, hb.y - 6, hb.w + 12, hb.h + 12);

      ctx.setLineDash([]);
      ctx.font = `700 22px 'Cairo', sans-serif`;
      ctx.direction = 'rtl';
      const labelW = ctx.measureText(hb.label).width + 20;
      const tagX = Math.max(8, Math.min(W - labelW - 8, hb.x + hb.w - labelW));
      const tagY = Math.max(8, hb.y - 38);
      drawRoundedRect(ctx, tagX, tagY, labelW, 30, 8);
      ctx.fillStyle = isSelected ? '#00B050' : 'rgba(11, 15, 23, 0.88)';
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hb.label, tagX + labelW / 2, tagY + 16);
    }
    ctx.restore();
  }

  // 8. YouTube Safe Zone Guide (Preview ONLY, never exported)
  if (isPreview && template.showSafeGuides) {
    ctx.save();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
    ctx.fillStyle = 'rgba(245, 158, 11, 0.1)';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);

    if (isWide) {
      ctx.fillRect(0, H - 110, W, 110);
      ctx.strokeRect(64, 48, W - 128, H - 158);
      ctx.setLineDash([]);
      ctx.font = `700 26px 'Cairo', sans-serif`;
      ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.textAlign = 'center';
      ctx.fillText('منطقة الأمان لفيديو يوتيوب 16:9 (لا تظهر في التصدير)', W / 2, H - 45);
    } else {
      ctx.fillRect(0, 0, W, 160);
      ctx.fillRect(0, H - 300, W, 300);
      ctx.fillRect(W - 150, H - 860, 150, 560);
      ctx.strokeRect(48, 160, W - 198, H - 460);
      ctx.setLineDash([]);
      ctx.font = `700 24px 'Cairo', sans-serif`;
      ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.textAlign = 'center';
      ctx.fillText('منطقة الأمان ليوتيوب شورتس (لا تظهر في التصدير)', W / 2, 85);
    }
    ctx.restore();
  }

  ctx.restore();
}

export async function exportThumbnailJpg(
  slides: QuestionSlide[],
  template: TemplateSettings,
  timing: TimingSettings,
  audio: AudioSettings,
  globalTime: number
): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const { width, height } = getCanvasDimensions(template);

  await ensureQuizFontsLoaded(template.fontFamily);
  await preloadTemplateBackground(template, slides);
  clearRendererCaches();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;

  renderQuizFrame(ctx, globalTime, slides, template, timing, audio, false);

  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.94);
  });
}
