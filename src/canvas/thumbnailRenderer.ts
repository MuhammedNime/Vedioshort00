import {
  PRESET_BACKDROPS,
  QuestionSlide,
  TemplateSettings,
} from '../types/quiz';
import { ensureQuizFontsLoaded, wrapArabicText } from './quizRenderer';

export interface ThumbnailRenderConfig {
  aspectRatio: '16:9' | '9:16';
  headline: string;
  subline: string;
  badgeText: string;
  badgeBgColor: string;
  headlineColor: string;
  includeSlideImage: boolean;
  blurSlideImage: boolean;
}

const thumbImageCache = new Map<string, HTMLImageElement>();

function loadImageOnce(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  const cached = thumbImageCache.get(src);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      thumbImageCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawRoundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  const imgAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
  const boxAspect = dw / Math.max(1, dh);
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (imgAspect > boxAspect) {
    sw = img.naturalHeight * boxAspect;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / boxAspect;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

export async function renderQuizThumbnailCanvas(
  canvas: HTMLCanvasElement,
  template: TemplateSettings,
  activeSlide: QuestionSlide | undefined,
  config: ThumbnailRenderConfig
): Promise<void> {
  const isWide = config.aspectRatio === '16:9';
  const W = isWide ? 1280 : 1080;
  const H = isWide ? 720 : 1920;
  canvas.width = W;
  canvas.height = H;

  await ensureQuizFontsLoaded(template.fontFamily);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  const fontStack = `'${template.fontFamily || 'Cairo'}', 'Cairo', 'Tajawal', sans-serif`;

  // 1. Backdrop Fill + Preset Image
  ctx.fillStyle = template.solidBgColor || '#0c0c0c';
  ctx.fillRect(0, 0, W, H);

  const preset = PRESET_BACKDROPS.find((p) => p.id === template.presetId);
  if (preset?.gradientInner && preset?.gradientOuter && template.backgroundType === 'preset') {
    const grad = ctx.createRadialGradient(W * 0.5, H * 0.4, 40, W * 0.5, H * 0.4, Math.max(W, H) * 0.78);
    grad.addColorStop(0, preset.gradientInner);
    grad.addColorStop(1, preset.gradientOuter);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  let bgSrc: string | undefined;
  if (template.backgroundType === 'custom' && template.customBgDataUrl) {
    bgSrc = template.customBgDataUrl;
  } else if (template.backgroundType === 'preset' && preset) {
    bgSrc = isWide ? preset.wideSrc || preset.src : preset.src;
  }

  if (bgSrc) {
    const bgImg = await loadImageOnce(bgSrc);
    if (bgImg) {
      drawCoverImage(ctx, bgImg, 0, 0, W, H);
    }
  }

  // Dramatic vignette & spotlight for high-CTR contrast
  const vig = ctx.createRadialGradient(W * 0.5, H * 0.45, W * 0.14, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
  vig.addColorStop(0, 'rgba(0, 0, 0, 0.25)');
  vig.addColorStop(1, 'rgba(0, 0, 0, 0.78)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // Studio outer accent frame
  ctx.strokeStyle = config.badgeBgColor || '#F59E0B';
  ctx.lineWidth = isWide ? 10 : 12;
  ctx.strokeRect(18, 18, W - 36, H - 36);

  // Optional slide puzzle photo card
  const hasPhoto = Boolean(config.includeSlideImage && activeSlide?.imageDataUrl);
  const slideImg = hasPhoto && activeSlide?.imageDataUrl ? await loadImageOnce(activeSlide.imageDataUrl) : null;

  if (slideImg) {
    const cardW = isWide ? 360 : 540;
    const cardH = isWide ? 360 : 420;
    const cardX = isWide ? 72 : (W - cardW) / 2;
    const cardY = isWide ? (H - cardH) / 2 + 24 : 840;

    ctx.save();
    drawRoundedPath(ctx, cardX - 6, cardY - 6, cardW + 12, cardH + 12, 30);
    ctx.fillStyle = config.badgeBgColor || '#F59E0B';
    ctx.fill();

    drawRoundedPath(ctx, cardX, cardY, cardW, cardH, 26);
    ctx.clip();
    if (config.blurSlideImage) {
      ctx.filter = 'blur(18px)';
    }
    drawCoverImage(ctx, slideImg, cardX - 18, cardY - 18, cardW + 36, cardH + 36);
    ctx.filter = 'none';

    if (config.blurSlideImage) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(cardX, cardY, cardW, cardH);
      ctx.font = `900 ${isWide ? 120 : 140}px ${fontStack}`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('؟', cardX + cardW / 2, cardY + cardH / 2 + 6);
    }
    ctx.restore();
  }

  // Center of text block (shifts right when image card sits on left in 16:9)
  const textAreaX = isWide && slideImg ? W * 0.65 : W * 0.5;
  const textMaxW = isWide && slideImg ? W * 0.54 : W * 0.84;

  // Top viral hook badge
  const badgeText = (config.badgeText || '').trim();
  let nextTopY = isWide ? 120 : 340;
  if (badgeText) {
    ctx.save();
    const badgeFontSize = isWide ? 44 : 52;
    ctx.font = `900 ${badgeFontSize}px ${fontStack}`;
    ctx.direction = 'rtl';
    const textW = ctx.measureText(badgeText).width;
    const bw = Math.min(textMaxW, textW + 76);
    const bh = isWide ? 76 : 92;
    const bx = textAreaX - bw / 2;
    const by = isWide ? 82 : 250;

    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    drawRoundedPath(ctx, bx, by, bw, bh, 22);
    ctx.fillStyle = config.badgeBgColor || '#F59E0B';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();

    ctx.fillStyle = '#111827';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, textAreaX, by + bh / 2 + 2);
    nextTopY = by + bh + (isWide ? 48 : 80);
    ctx.restore();
  }

  // Headline text (bold & ultra legible)
  const headline = (config.headline || activeSlide?.question || 'اختبر ذكاءك الآن!').trim();
  ctx.save();
  ctx.direction = 'rtl';
  let headFont = isWide ? (slideImg ? 64 : 74) : 76;
  ctx.font = `900 ${headFont}px ${fontStack}`;
  let lines = wrapArabicText(ctx, headline, textMaxW);
  while (headFont > 38 && lines.length > 3) {
    headFont -= 4;
    ctx.font = `900 ${headFont}px ${fontStack}`;
    lines = wrapArabicText(ctx, headline, textMaxW);
  }
  const visibleLines = lines.slice(0, 3);
  const lineH = headFont * 1.32;
  const blockTopY = isWide
    ? Math.max(nextTopY, H * 0.5 - (visibleLines.length * lineH) / 2 - 20)
    : slideImg
      ? Math.max(nextTopY, 440)
      : H * 0.48 - (visibleLines.length * lineH) / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  visibleLines.forEach((line: string, idx: number) => {
    const ly = blockTopY + idx * lineH + lineH / 2;
    ctx.lineWidth = isWide ? 14 : 16;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.strokeText(line, textAreaX, ly);
    ctx.fillStyle = config.headlineColor || '#FFFFFF';
    ctx.fillText(line, textAreaX, ly);
  });

  // Bottom subline / CTA pill
  const subline = (config.subline || '').trim();
  if (subline) {
    const subY = blockTopY + visibleLines.length * lineH + (isWide ? 54 : 84);
    const subFont = isWide ? 32 : 38;
    ctx.font = `800 ${subFont}px ${fontStack}`;
    const subW = Math.min(textMaxW, ctx.measureText(subline).width + 64);
    const subH = isWide ? 60 : 72;
    drawRoundedPath(ctx, textAreaX - subW / 2, subY - subH / 2, subW, subH, 18);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#FDE68A';
    ctx.fillText(subline, textAreaX, subY + 2);
  }
  ctx.restore();

  // Channel logo / handle corner stamp
  if (template.brandLogoDataUrl || (template.brandHandleText || '').trim()) {
    ctx.save();
    const pad = 42;
    let logoRight = W - pad;
    if (template.brandLogoDataUrl) {
      const logoImg = await loadImageOnce(template.brandLogoDataUrl);
      if (logoImg) {
        const lSize = isWide ? 82 : 104;
        drawRoundedPath(ctx, W - pad - lSize, H - pad - lSize, lSize, lSize, 20);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fill();
        ctx.drawImage(logoImg, W - pad - lSize + 6, H - pad - lSize + 6, lSize - 12, lSize - 12);
        logoRight = W - pad - lSize - 16;
      }
    }
    const handle = (template.brandHandleText || '').trim();
    if (handle) {
      ctx.direction = 'ltr';
      ctx.font = `800 ${isWide ? 28 : 34}px ${fontStack}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(handle, logoRight, H - pad - (isWide ? 40 : 52));
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(handle, logoRight, H - pad - (isWide ? 40 : 52));
    }
    ctx.restore();
  }
}

export async function exportCustomThumbnailBlob(
  template: TemplateSettings,
  activeSlide: QuestionSlide | undefined,
  config: ThumbnailRenderConfig,
  mimeType: 'image/png' | 'image/jpeg' = 'image/jpeg'
): Promise<{ blob: Blob; dataUrl: string } | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  await renderQuizThumbnailCanvas(canvas, template, activeSlide, config);
  const dataUrl = canvas.toDataURL(mimeType, 0.94);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), mimeType, 0.94);
  });
  if (!blob) return null;
  return { blob, dataUrl };
}
