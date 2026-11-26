import {
  DEFAULT_TEMPLATE,
  DEFAULT_TIMING,
  DEFAULT_AUDIO,
  QuestionSlide,
  QuizProject,
  VideoAspectRatio,
  createDefaultProject,
} from '../types/quiz';

const DB_NAME = 'shorts_quiz_studio_db';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const ACTIVE_PROJECT_KEY = 'active_project_v1';
const LIBRARY_INDEX_KEY = 'projects_library_index_v1';
const ACTIVE_PROJECT_ID_KEY = 'active_project_id_v1';
const PROJECT_ITEM_PREFIX = 'project_item_';
const AI_MEDIA_PREFIX = 'ai_presenter_blob_';
const CURRENT_SCHEMA_VERSION = 9;

export interface ProjectSummary {
  id: string;
  name: string;
  slideCount: number;
  aspectRatio: VideoAspectRatio;
  updatedAt: number;
}

const ASSET_BLOB_PREFIX = 'asset_blob_';
const ASSET_POINTER_PREFIX = 'idb-asset://';
const OFFLOAD_THRESHOLD_CHARS = 24_576;

let sharedDbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (sharedDbPromise) return sharedDbPromise;
  sharedDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      sharedDbPromise = null;
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        sharedDbPromise = null;
        reject(new Error('IndexedDB open timeout'));
      }
    }, 2000);

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          db.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        db.onclose = () => {
          sharedDbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          sharedDbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          sharedDbPromise = null;
          reject(request.error);
        }
      };
      request.onblocked = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          sharedDbPromise = null;
          reject(new Error('IndexedDB blocked'));
        }
      };
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        sharedDbPromise = null;
        reject(err);
      }
    }
  });
  return sharedDbPromise;
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(undefined);
    }, 2000);

    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        clearTimeout(timer);
        resolve(req.result as T | undefined);
      };
      req.onerror = () => {
        clearTimeout(timer);
        resolve(undefined);
      };
    } catch {
      clearTimeout(timer);
      sharedDbPromise = null;
      resolve(undefined);
    }
  });
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => {
        resolve();
      };
      req.onerror = () => {
        reject(req.error);
      };
    } catch (err) {
      sharedDbPromise = null;
      reject(err);
    }
  });
}

export async function idbDelete(key: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => {
        resolve();
      };
      req.onerror = () => {
        resolve();
      };
    } catch {
      sharedDbPromise = null;
      resolve();
    }
  });
}

function hashDataString(input: string): string {
  let h1 = 2166136261;
  let h2 = 3735928559;
  const step = Math.max(1, Math.floor(input.length / 4096));
  for (let i = 0; i < input.length; i += step) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 16777619);
    h2 ^= ch + (i & 255);
    h2 = Math.imul(h2, 2246822519);
  }
  return `${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}_${input.length}`;
}

function dataUrlToBlobSync(dataUrl: string): Blob | null {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx <= 0) return null;
  const header = dataUrl.slice(0, commaIdx);
  const body = dataUrl.slice(commaIdx + 1);
  const mimeMatch = /data:([^;]+)/i.exec(header);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const isBase64 = /;base64/i.test(header);
  try {
    if (!isBase64) {
      return new Blob([decodeURIComponent(body)], { type: mime });
    }
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

function blobToDataUrlAsync(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function offloadDataUrl(val: string | undefined): Promise<string | undefined> {
  if (!val || typeof val !== 'string') return val;
  if (val.startsWith(ASSET_POINTER_PREFIX) || val.length <= OFFLOAD_THRESHOLD_CHARS) return val;
  if (!val.startsWith('data:')) return val;
  const blob = dataUrlToBlobSync(val);
  if (!blob) return val;
  const hash = hashDataString(val);
  try {
    const existing = await idbGet<Blob>(`${ASSET_BLOB_PREFIX}${hash}`);
    if (!(existing instanceof Blob) || existing.size === 0) {
      await idbSet(`${ASSET_BLOB_PREFIX}${hash}`, blob);
    }
    return `${ASSET_POINTER_PREFIX}${hash}`;
  } catch {
    return val;
  }
}

async function hydrateDataUrl(
  val: string | undefined,
  cache: Map<string, string>
): Promise<string | undefined> {
  if (!val || typeof val !== 'string' || !val.startsWith(ASSET_POINTER_PREFIX)) return val;
  const hash = val.slice(ASSET_POINTER_PREFIX.length);
  const cached = cache.get(hash);
  if (cached) return cached;
  try {
    const blob = await idbGet<Blob>(`${ASSET_BLOB_PREFIX}${hash}`);
    if (blob instanceof Blob && blob.size > 0) {
      const dataUrl = await blobToDataUrlAsync(blob);
      cache.set(hash, dataUrl);
      return dataUrl;
    }
  } catch {
    // ignore missing blob gracefully
  }
  return undefined;
}

export async function offloadProjectMediaBlobs(project: QuizProject): Promise<QuizProject> {
  const tpl = { ...project.template };
  tpl.customBgDataUrl = await offloadDataUrl(tpl.customBgDataUrl);
  tpl.brandLogoDataUrl = await offloadDataUrl(tpl.brandLogoDataUrl);
  tpl.presenterPhotoDataUrl = await offloadDataUrl(tpl.presenterPhotoDataUrl);
  if (tpl.introHookAudio?.dataUrl) {
    tpl.introHookAudio = {
      ...tpl.introHookAudio,
      dataUrl: (await offloadDataUrl(tpl.introHookAudio.dataUrl)) || tpl.introHookAudio.dataUrl,
    };
  }
  if (tpl.endCardAudio?.dataUrl) {
    tpl.endCardAudio = {
      ...tpl.endCardAudio,
      dataUrl: (await offloadDataUrl(tpl.endCardAudio.dataUrl)) || tpl.endCardAudio.dataUrl,
    };
  }
  if (tpl.aiPresenter?.customBgDataUrl) {
    tpl.aiPresenter = {
      ...tpl.aiPresenter,
      customBgDataUrl: await offloadDataUrl(tpl.aiPresenter.customBgDataUrl),
    };
  }

  const audioCopy = { ...project.audio };
  (Object.keys(audioCopy) as Array<keyof typeof audioCopy>).forEach(() => {});
  for (const slotKey of Object.keys(audioCopy) as Array<keyof typeof audioCopy>) {
    const slot = audioCopy[slotKey];
    if (slot?.customDataUrl) {
      audioCopy[slotKey] = {
        ...slot,
        customDataUrl: await offloadDataUrl(slot.customDataUrl),
      };
    }
  }

  const slidesCopy = await Promise.all(
    project.slides.map(async (s) => {
      const next = { ...s };
      if (next.imageDataUrl) {
        next.imageDataUrl = await offloadDataUrl(next.imageDataUrl);
      }
      if (Array.isArray(next.optionImages)) {
        const imgs = await Promise.all(
          next.optionImages.map(async (img) =>
            img?.dataUrl
              ? { ...img, dataUrl: (await offloadDataUrl(img.dataUrl)) || img.dataUrl }
              : img
          )
        );
        next.optionImages = imgs as QuestionSlide['optionImages'];
      }
      if (next.voiceover) {
        const vo = { ...next.voiceover };
        if (vo.question?.dataUrl) {
          vo.question = {
            ...vo.question,
            dataUrl: (await offloadDataUrl(vo.question.dataUrl)) || vo.question.dataUrl,
          };
        }
        if (Array.isArray(vo.options)) {
          const voOpts = await Promise.all(
            vo.options.map(async (clip) =>
              clip?.dataUrl
                ? { ...clip, dataUrl: (await offloadDataUrl(clip.dataUrl)) || clip.dataUrl }
                : clip
            )
          );
          vo.options = voOpts as NonNullable<QuestionSlide['voiceover']>['options'];
        }
        if (vo.answer?.dataUrl) {
          vo.answer = {
            ...vo.answer,
            dataUrl: (await offloadDataUrl(vo.answer.dataUrl)) || vo.answer.dataUrl,
          };
        }
        next.voiceover = vo;
      }
      return next;
    })
  );

  return {
    ...project,
    template: tpl,
    audio: audioCopy,
    slides: slidesCopy,
  };
}

export async function hydrateProjectMedia(project: QuizProject): Promise<QuizProject> {
  const cache = new Map<string, string>();
  const tpl = { ...project.template };
  tpl.customBgDataUrl = await hydrateDataUrl(tpl.customBgDataUrl, cache);
  tpl.brandLogoDataUrl = await hydrateDataUrl(tpl.brandLogoDataUrl, cache);
  tpl.presenterPhotoDataUrl = await hydrateDataUrl(tpl.presenterPhotoDataUrl, cache);
  if (tpl.introHookAudio?.dataUrl) {
    const resolved = await hydrateDataUrl(tpl.introHookAudio.dataUrl, cache);
    tpl.introHookAudio = resolved ? { ...tpl.introHookAudio, dataUrl: resolved } : undefined;
  }
  if (tpl.endCardAudio?.dataUrl) {
    const resolved = await hydrateDataUrl(tpl.endCardAudio.dataUrl, cache);
    tpl.endCardAudio = resolved ? { ...tpl.endCardAudio, dataUrl: resolved } : undefined;
  }
  if (tpl.aiPresenter?.customBgDataUrl) {
    tpl.aiPresenter = {
      ...tpl.aiPresenter,
      customBgDataUrl: await hydrateDataUrl(tpl.aiPresenter.customBgDataUrl, cache),
    };
  }

  const audioCopy = { ...project.audio };
  for (const slotKey of Object.keys(audioCopy) as Array<keyof typeof audioCopy>) {
    const slot = audioCopy[slotKey];
    if (slot?.customDataUrl) {
      audioCopy[slotKey] = {
        ...slot,
        customDataUrl: await hydrateDataUrl(slot.customDataUrl, cache),
      };
    }
  }

  const slidesCopy = await Promise.all(
    project.slides.map(async (s) => {
      const next = { ...s };
      if (next.imageDataUrl) {
        next.imageDataUrl = await hydrateDataUrl(next.imageDataUrl, cache);
      }
      if (Array.isArray(next.optionImages)) {
        const imgs = await Promise.all(
          next.optionImages.map(async (img) => {
            if (!img?.dataUrl) return img;
            const resolved = await hydrateDataUrl(img.dataUrl, cache);
            return resolved ? { ...img, dataUrl: resolved } : undefined;
          })
        );
        next.optionImages = imgs as QuestionSlide['optionImages'];
      }
      if (next.voiceover) {
        const vo = { ...next.voiceover };
        if (vo.question?.dataUrl) {
          const resolved = await hydrateDataUrl(vo.question.dataUrl, cache);
          vo.question = resolved ? { ...vo.question, dataUrl: resolved } : undefined;
        }
        if (Array.isArray(vo.options)) {
          const voOpts = await Promise.all(
            vo.options.map(async (clip) => {
              if (!clip?.dataUrl) return clip;
              const resolved = await hydrateDataUrl(clip.dataUrl, cache);
              return resolved ? { ...clip, dataUrl: resolved } : undefined;
            })
          );
          vo.options = voOpts as NonNullable<QuestionSlide['voiceover']>['options'];
        }
        if (vo.answer?.dataUrl) {
          const resolved = await hydrateDataUrl(vo.answer.dataUrl, cache);
          vo.answer = resolved ? { ...vo.answer, dataUrl: resolved } : undefined;
        }
        next.voiceover = vo;
      }
      return next;
    })
  );

  return {
    ...project,
    template: tpl,
    audio: audioCopy,
    slides: slidesCopy,
  };
}

export async function saveAiMediaBlob(mediaKey: string, blob: Blob): Promise<void> {
  if (!mediaKey || !blob || blob.size === 0) return;
  try {
    await idbSet(`${AI_MEDIA_PREFIX}${mediaKey}`, blob);
  } catch {
    // ignore storage quota errors
  }
}

export async function loadAiMediaBlob(mediaKey: string): Promise<Blob | undefined> {
  if (!mediaKey) return undefined;
  try {
    const val = await idbGet<Blob>(`${AI_MEDIA_PREFIX}${mediaKey}`);
    return val instanceof Blob && val.size > 0 ? val : undefined;
  } catch {
    return undefined;
  }
}

export async function deleteAiMediaBlob(mediaKey: string): Promise<void> {
  if (!mediaKey) return;
  try {
    await idbDelete(`${AI_MEDIA_PREFIX}${mediaKey}`);
  } catch {
    // ignore
  }
}

function sanitizeSlide(raw: Partial<QuestionSlide> | null | undefined, idx: number): QuestionSlide {
  const slideType =
    raw?.slideType === 'multiple3' ||
    raw?.slideType === 'trueFalse' ||
    raw?.slideType === 'clues' ||
    raw?.slideType === 'versus'
      ? raw.slideType
      : 'multiple';
  const rawOpts = Array.isArray(raw?.options) ? raw.options : [];
  const options: [string, string, string, string] = [
    typeof rawOpts[0] === 'string'
      ? rawOpts[0]
      : slideType === 'trueFalse'
        ? 'صح'
        : slideType === 'clues'
          ? 'التلميح الأول'
          : slideType === 'versus'
            ? 'الطرف الأول'
            : 'الخيار الأول',
    typeof rawOpts[1] === 'string'
      ? rawOpts[1]
      : slideType === 'trueFalse'
        ? 'خطأ'
        : slideType === 'clues'
          ? 'التلميح الثاني'
          : slideType === 'versus'
            ? 'الطرف الثاني'
            : 'الخيار الثاني',
    typeof rawOpts[2] === 'string'
      ? rawOpts[2]
      : slideType === 'trueFalse' || slideType === 'versus'
        ? ''
        : slideType === 'clues'
          ? 'التلميح الثالث'
          : 'الخيار الثالث',
    typeof rawOpts[3] === 'string'
      ? rawOpts[3]
      : slideType === 'trueFalse' || slideType === 'versus' || slideType === 'multiple3'
        ? ''
        : slideType === 'clues'
          ? 'الإجابة الصحيحة'
          : 'الخيار الرابع',
  ];
  const rawIdx = Number(raw?.correctIndex);
  const maxOptIdx =
    slideType === 'trueFalse' || slideType === 'versus'
      ? 1
      : slideType === 'multiple3'
        ? 2
        : 3;
  const correctIndex =
    slideType === 'clues'
      ? 3
      : (Math.max(0, Math.min(maxOptIdx, Math.round(Number.isFinite(rawIdx) ? rawIdx : 0))) as
          | 0
          | 1
          | 2
          | 3);

  const imageChallengeMode =
    raw?.imageChallengeMode === 'blurToClear' ||
    raw?.imageChallengeMode === 'gradualClear' ||
    raw?.imageChallengeMode === 'zoomOutReveal' ||
    raw?.imageChallengeMode === 'tileGridReveal'
      ? raw.imageChallengeMode
      : 'normal';
  const rawBlur = Number(raw?.imageBlurStrength);
  const imageBlurStrength = Number.isFinite(rawBlur)
    ? Math.max(10, Math.min(50, Math.round(rawBlur)))
    : undefined;

  const imagePlacement =
    raw?.imagePlacement === 'insideBox' || raw?.imagePlacement === 'belowBox'
      ? raw.imagePlacement
      : 'aboveBox';
  const imageInsideLayout =
    raw?.imageInsideLayout === 'aboveText' ||
    raw?.imageInsideLayout === 'sideRight' ||
    raw?.imageInsideLayout === 'sideLeft' ||
    raw?.imageInsideLayout === 'backdrop'
      ? raw.imageInsideLayout
      : 'belowText';
  const rawImgScale = Number(raw?.imageScale);
  const imageScale = Number.isFinite(rawImgScale)
    ? Math.max(40, Math.min(180, Math.round(rawImgScale)))
    : undefined;
  const imageFit = raw?.imageFit === 'contain' ? 'contain' : raw?.imageFit === 'cover' ? 'cover' : undefined;
  const rawImgRad = Number(raw?.imageBorderRadius);
  const imageBorderRadius = Number.isFinite(rawImgRad)
    ? Math.max(0, Math.min(48, Math.round(rawImgRad)))
    : undefined;
  const rawImgOffX = Number(raw?.imageOffsetX);
  const imageOffsetX = Number.isFinite(rawImgOffX)
    ? Math.max(-220, Math.min(220, Math.round(rawImgOffX)))
    : undefined;
  const rawImgOffY = Number(raw?.imageOffsetY);
  const imageOffsetY = Number.isFinite(rawImgOffY)
    ? Math.max(-220, Math.min(220, Math.round(rawImgOffY)))
    : undefined;

  const rawOptImgs = Array.isArray(raw?.optionImages) ? raw.optionImages : undefined;
  const sanitizeOptImg = (entry: unknown) => {
    if (!entry || typeof entry !== 'object') return undefined;
    const rec = entry as { dataUrl?: unknown; name?: unknown; scale?: unknown };
    if (typeof rec.dataUrl !== 'string' || !rec.dataUrl) return undefined;
    const sc = Number(rec.scale);
    return {
      dataUrl: rec.dataUrl,
      name: typeof rec.name === 'string' ? rec.name : undefined,
      scale: Number.isFinite(sc) ? Math.max(50, Math.min(160, Math.round(sc))) : undefined,
    };
  };
  const optionImages = rawOptImgs
    ? ([
        sanitizeOptImg(rawOptImgs[0]),
        sanitizeOptImg(rawOptImgs[1]),
        sanitizeOptImg(rawOptImgs[2]),
        sanitizeOptImg(rawOptImgs[3]),
      ] as QuestionSlide['optionImages'])
    : undefined;

  const optionImagePlacement =
    raw?.optionImagePlacement === 'insideLeft' ||
    raw?.optionImagePlacement === 'insideTop' ||
    raw?.optionImagePlacement === 'coverFill' ||
    raw?.optionImagePlacement === 'aboveBox' ||
    raw?.optionImagePlacement === 'belowBox'
      ? raw.optionImagePlacement
      : raw?.optionImagePlacement === 'insideRight'
        ? 'insideRight'
        : undefined;
  const rawOptScale = Number(raw?.optionImageScale);
  const optionImageScale = Number.isFinite(rawOptScale)
    ? Math.max(40, Math.min(180, Math.round(rawOptScale)))
    : undefined;
  const optionImageFit =
    raw?.optionImageFit === 'contain'
      ? 'contain'
      : raw?.optionImageFit === 'cover'
        ? 'cover'
        : undefined;
  const rawOptRad = Number(raw?.optionImageRadius);
  const optionImageRadius = Number.isFinite(rawOptRad)
    ? Math.max(0, Math.min(36, Math.round(rawOptRad)))
    : undefined;
  const rawOptOffX = Number(raw?.optionImageOffsetX);
  const optionImageOffsetX = Number.isFinite(rawOptOffX)
    ? Math.max(-120, Math.min(120, Math.round(rawOptOffX)))
    : undefined;
  const rawOptOffY = Number(raw?.optionImageOffsetY);
  const optionImageOffsetY = Number.isFinite(rawOptOffY)
    ? Math.max(-120, Math.min(120, Math.round(rawOptOffY)))
    : undefined;

  const difficulty =
    raw?.difficulty === 'easy' || raw?.difficulty === 'medium' || raw?.difficulty === 'hard'
      ? raw.difficulty
      : 'none';

  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : `slide-${Date.now()}-${idx}`,
    slideType,
    difficulty,
    badgeText: typeof raw?.badgeText === 'string' ? raw.badgeText : `السؤال ${idx + 1}`,
    question: typeof raw?.question === 'string' ? raw.question : 'اكتب نص السؤال هنا',
    imageDataUrl: typeof raw?.imageDataUrl === 'string' ? raw.imageDataUrl : undefined,
    imageName: typeof raw?.imageName === 'string' ? raw.imageName : undefined,
    imageChallengeMode,
    imageBlurStrength,
    imagePlacement,
    imageInsideLayout,
    imageScale,
    imageFit,
    imageBorderRadius,
    imageOffsetX,
    imageOffsetY,
    options,
    optionImages,
    optionImagePlacement,
    optionImageScale,
    optionImageFit,
    optionImageRadius,
    optionImageOffsetX,
    optionImageOffsetY,
    correctIndex,
    explanationText: typeof raw?.explanationText === 'string' ? raw.explanationText : '',
    voiceover: raw?.voiceover,
    presenterCues: Array.isArray(raw?.presenterCues) ? raw.presenterCues : undefined,
  };
}

function sanitizeNumber(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeLoadedProject(
  result: Partial<QuizProject> | null | undefined
): QuizProject {
  const base = createDefaultProject();
  if (!result || !Array.isArray(result.slides) || result.slides.length === 0) {
    return base;
  }

  let mergedTemplate = {
    ...DEFAULT_TEMPLATE,
    ...(result.template && typeof result.template === 'object' ? result.template : {}),
  };

  if (!result.schemaVersion || result.schemaVersion < 4) {
    if (result.template?.backgroundType === 'custom' && result.template?.customBgDataUrl) {
      mergedTemplate = {
        ...DEFAULT_TEMPLATE,
        ...result.template,
        backgroundType: 'custom',
        customBgDataUrl: result.template.customBgDataUrl,
        customBgName: result.template.customBgName,
      };
    } else {
      mergedTemplate = { ...DEFAULT_TEMPLATE };
    }
  } else if (result.schemaVersion < 5) {
    mergedTemplate = {
      ...mergedTemplate,
      timerMatchBackground: result.template?.timerMatchBackground ?? true,
    };
    if (
      (mergedTemplate.presetId === 'channelNavy' ||
        mergedTemplate.presetId === 'channelEmerald') &&
      mergedTemplate.timerColor?.toLowerCase() === '#000000'
    ) {
      mergedTemplate.timerColor = '#FFFFFF';
      mergedTemplate.timerBgColor =
        mergedTemplate.presetId === 'channelNavy' ? '#131d42' : '#0e3b2f';
    }
  }

  if ((result.schemaVersion ?? 0) < 8) {
    const looksLikeLegacyChannelDefaults =
      Math.abs((mergedTemplate.questionY ?? 36) - 36) < 0.5 &&
      Math.abs((mergedTemplate.timerY ?? 61) - 61) < 0.5 &&
      Math.abs((mergedTemplate.optionsStartY ?? 51.7) - 51.7) < 0.6;
    if (looksLikeLegacyChannelDefaults) {
      mergedTemplate.questionY = DEFAULT_TEMPLATE.questionY;
      mergedTemplate.questionWidth = DEFAULT_TEMPLATE.questionWidth;
      mergedTemplate.questionHeightPct = DEFAULT_TEMPLATE.questionHeightPct;
      mergedTemplate.questionFontSize = DEFAULT_TEMPLATE.questionFontSize;
      mergedTemplate.questionBorderRadius = DEFAULT_TEMPLATE.questionBorderRadius;
      mergedTemplate.timerY = DEFAULT_TEMPLATE.timerY;
      mergedTemplate.optionsStartY = DEFAULT_TEMPLATE.optionsStartY;
      mergedTemplate.optionsWidth = DEFAULT_TEMPLATE.optionsWidth;
      mergedTemplate.optionHeight = DEFAULT_TEMPLATE.optionHeight;
      mergedTemplate.optionFontSize = DEFAULT_TEMPLATE.optionFontSize;
    } else if ((mergedTemplate.timerY ?? 43) >= (mergedTemplate.optionsStartY ?? 51)) {
      // Ensure timer stays cleanly above option boxes
      mergedTemplate.timerY = Math.max(
        20,
        Math.min(DEFAULT_TEMPLATE.timerY, (mergedTemplate.optionsStartY ?? 51) - 8)
      );
    }
  }

  mergedTemplate = {
    ...DEFAULT_TEMPLATE,
    ...mergedTemplate,
    aspectRatio: mergedTemplate.aspectRatio === '16:9' ? '16:9' : '9:16',
    timerMatchBackground: mergedTemplate.timerMatchBackground ?? true,
    useTimerVideo: mergedTemplate.useTimerVideo ?? true,
    boxGloss: mergedTemplate.boxGloss ?? true,
    enhanceAppearance: mergedTemplate.enhanceAppearance ?? true,
    wrongColor: mergedTemplate.wrongColor || DEFAULT_TEMPLATE.wrongColor,
    showEndCard: mergedTemplate.showEndCard ?? true,
    endCardText: mergedTemplate.endCardText || DEFAULT_TEMPLATE.endCardText,
    endCtaText: mergedTemplate.endCtaText ?? '',
    autoFitText: Boolean(mergedTemplate.autoFitText),
    timerColor: mergedTemplate.timerColor || DEFAULT_TEMPLATE.timerColor,
    timerBgColor: mergedTemplate.timerBgColor || DEFAULT_TEMPLATE.timerBgColor,
    brandLogoAnim: mergedTemplate.brandLogoAnim || 'pulse',
    brandLogoSize: sanitizeNumber(mergedTemplate.brandLogoSize, DEFAULT_TEMPLATE.brandLogoSize),
    brandLogoPosition: mergedTemplate.brandLogoPosition || 'topRight',
    brandHandleText: mergedTemplate.brandHandleText ?? '',
    brandOpacity: sanitizeNumber(mergedTemplate.brandOpacity, DEFAULT_TEMPLATE.brandOpacity),
    showProgressCounter: mergedTemplate.showProgressCounter ?? false,

    boxStyle: mergedTemplate.boxStyle || 'flat',
    borderStyle: mergedTemplate.borderStyle || 'solid',
    freeLayoutMode: Boolean(mergedTemplate.freeLayoutMode),
    themeApplyMode: mergedTemplate.themeApplyMode === 'full' ? 'full' : 'bgOnly',
    badgeX: sanitizeNumber(mergedTemplate.badgeX, DEFAULT_TEMPLATE.badgeX ?? 50),
    badgeBorderRadius: sanitizeNumber(mergedTemplate.badgeBorderRadius, DEFAULT_TEMPLATE.badgeBorderRadius ?? 33),
    questionX: sanitizeNumber(mergedTemplate.questionX, DEFAULT_TEMPLATE.questionX ?? 50),
    questionTextAlign: mergedTemplate.questionTextAlign || 'center',
    optionsX: sanitizeNumber(mergedTemplate.optionsX, DEFAULT_TEMPLATE.optionsX ?? 50),
    optionsColGap: sanitizeNumber(mergedTemplate.optionsColGap, 0),
    timerPlacement: mergedTemplate.timerPlacement || 'aboveOptions',
    timerX: sanitizeNumber(mergedTemplate.timerX, 50),
    timerVisibilityMode: mergedTemplate.timerVisibilityMode || 'afterOptionsBeforeAnswer',
    timerUrgentPulse: mergedTemplate.timerUrgentPulse ?? true,
    timerUrgentThreshold: sanitizeNumber(mergedTemplate.timerUrgentThreshold, 3),
    timerUrgentColor: mergedTemplate.timerUrgentColor || '#EF4444',
    timerUnitSuffix: mergedTemplate.timerUnitSuffix ?? '',
    timerOpacity: sanitizeNumber(mergedTemplate.timerOpacity, 1),
    timerBorderColor: mergedTemplate.timerBorderColor ?? '',
    timerBorderWidth: sanitizeNumber(mergedTemplate.timerBorderWidth, -1),
    questionToOptionsGap: sanitizeNumber(mergedTemplate.questionToOptionsGap, 0),
    optionsCenterGap: sanitizeNumber(mergedTemplate.optionsCenterGap, 24),
    explanationBgColor: mergedTemplate.explanationBgColor ?? '',
    explanationTextColor: mergedTemplate.explanationTextColor || '#FFFFFF',
    explanationOffsetY: sanitizeNumber(mergedTemplate.explanationOffsetY, 0),
    brandLogoX: sanitizeNumber(mergedTemplate.brandLogoX, 88),
    brandLogoY: sanitizeNumber(mergedTemplate.brandLogoY, 10),
    shadowIntensity: sanitizeNumber(mergedTemplate.shadowIntensity, 1),
    glowIntensity: sanitizeNumber(mergedTemplate.glowIntensity, 0),
    globalScale: sanitizeNumber(mergedTemplate.globalScale, 1),
    timerScale: sanitizeNumber(mergedTemplate.timerScale, 1),
    badgeScale: sanitizeNumber(mergedTemplate.badgeScale, 1),
    bgMotion: mergedTemplate.bgMotion || 'none',
    revealConfetti: mergedTemplate.revealConfetti ?? false,
    highlightSpokenOption: mergedTemplate.highlightSpokenOption ?? false,
    showIntroHook: mergedTemplate.showIntroHook ?? false,
    introHookText: mergedTemplate.introHookText ?? DEFAULT_TEMPLATE.introHookText,
    introHookDuration: sanitizeNumber(mergedTemplate.introHookDuration, 1.2),
    introHookAudio: mergedTemplate.introHookAudio?.dataUrl ? mergedTemplate.introHookAudio : undefined,
    introHookSfx: mergedTemplate.introHookSfx || 'whoosh',
    showEndSubscribeCta: mergedTemplate.showEndSubscribeCta ?? false,
    showPrizeLadder: mergedTemplate.showPrizeLadder ?? false,
    prizeLadderStyle: mergedTemplate.prizeLadderStyle || 'topStrip',
    prizeLadderTitle: mergedTemplate.prizeLadderTitle ?? 'الجائزة',
    prizeLadderAmounts:
      Array.isArray(mergedTemplate.prizeLadderAmounts) && mergedTemplate.prizeLadderAmounts.length > 0
        ? mergedTemplate.prizeLadderAmounts
        : DEFAULT_TEMPLATE.prizeLadderAmounts,
    slideTransition: mergedTemplate.slideTransition || 'fade',
    optionsAppearMode: mergedTemplate.optionsAppearMode || 'stagger',
    optionTextAlign: mergedTemplate.optionTextAlign || 'auto',
    optionsRtlColumns: mergedTemplate.optionsRtlColumns ?? true,

    presenterEnabled: Boolean(mergedTemplate.presenterEnabled),
    presenterStyle:
      mergedTemplate.presenterStyle === 'photoMale' ||
      mergedTemplate.presenterStyle === 'photoFemale' ||
      mergedTemplate.presenterStyle === 'stylized3d' ||
      mergedTemplate.presenterStyle === 'customPhoto'
        ? mergedTemplate.presenterStyle
        : 'stylized3d',
    presenterPhotoDataUrl:
      typeof mergedTemplate.presenterPhotoDataUrl === 'string' && mergedTemplate.presenterPhotoDataUrl
        ? mergedTemplate.presenterPhotoDataUrl
        : undefined,
    presenterPhotoName:
      typeof mergedTemplate.presenterPhotoName === 'string'
        ? mergedTemplate.presenterPhotoName
        : undefined,
    presenterPlacement:
      mergedTemplate.presenterPlacement === 'bottomCenter' ||
      mergedTemplate.presenterPlacement === 'cornerBottomLeft' ||
      mergedTemplate.presenterPlacement === 'topRight' ||
      mergedTemplate.presenterPlacement === 'topLeft' ||
      mergedTemplate.presenterPlacement === 'sideStage' ||
      mergedTemplate.presenterPlacement === 'floating'
        ? mergedTemplate.presenterPlacement
        : 'cornerBottomRight',
    presenterScale: Math.max(50, Math.min(180, sanitizeNumber(mergedTemplate.presenterScale, 100))),
    presenterX: Math.max(5, Math.min(95, sanitizeNumber(mergedTemplate.presenterX, 84))),
    presenterY: Math.max(5, Math.min(95, sanitizeNumber(mergedTemplate.presenterY, 79))),
    presenterFrameShape:
      mergedTemplate.presenterFrameShape === 'cutout' ||
      mergedTemplate.presenterFrameShape === 'circleCam'
        ? mergedTemplate.presenterFrameShape
        : 'broadcastCard',
    presenterIntroFullscreen: mergedTemplate.presenterIntroFullscreen ?? true,
    presenterOutroFullscreen: mergedTemplate.presenterOutroFullscreen ?? true,
    presenterStudioMic: mergedTemplate.presenterStudioMic ?? true,
    presenterName:
      typeof mergedTemplate.presenterName === 'string'
        ? mergedTemplate.presenterName
        : DEFAULT_TEMPLATE.presenterName,
    presenterMouthY: Math.max(20, Math.min(48, sanitizeNumber(mergedTemplate.presenterMouthY, 31.2))),
    presenterTalkIntensity: Math.max(
      0,
      Math.min(100, sanitizeNumber(mergedTemplate.presenterTalkIntensity, 70))
    ),
    presenterContinuousTalk: mergedTemplate.presenterContinuousTalk ?? true,
    presenterLipSyncMode:
      mergedTemplate.presenterLipSyncMode === 'audioOnly' ? 'audioOnly' : 'audioAndReading',
    presenterExpressiveness: Math.max(
      20,
      Math.min(150, sanitizeNumber(mergedTemplate.presenterExpressiveness, 100))
    ),
    presenterGender: mergedTemplate.presenterGender === 'female' ? 'female' : 'male',
    presenterSkinTone:
      mergedTemplate.presenterSkinTone === 'fair' ||
      mergedTemplate.presenterSkinTone === 'olive' ||
      mergedTemplate.presenterSkinTone === 'tan' ||
      mergedTemplate.presenterSkinTone === 'deep'
        ? mergedTemplate.presenterSkinTone
        : 'warmWheat',
    presenterHairColor:
      typeof mergedTemplate.presenterHairColor === 'string'
        ? mergedTemplate.presenterHairColor
        : DEFAULT_TEMPLATE.presenterHairColor,
    presenterEyeColor:
      typeof mergedTemplate.presenterEyeColor === 'string'
        ? mergedTemplate.presenterEyeColor
        : DEFAULT_TEMPLATE.presenterEyeColor,
    presenterSuitColor:
      typeof mergedTemplate.presenterSuitColor === 'string'
        ? mergedTemplate.presenterSuitColor
        : DEFAULT_TEMPLATE.presenterSuitColor,
    presenterTieColor:
      typeof mergedTemplate.presenterTieColor === 'string'
        ? mergedTemplate.presenterTieColor
        : DEFAULT_TEMPLATE.presenterTieColor,
    presenterBeard:
      mergedTemplate.presenterBeard === 'none' || mergedTemplate.presenterBeard === 'stubble'
        ? mergedTemplate.presenterBeard
        : 'trimmed',
    presenterGlasses: Boolean(mergedTemplate.presenterGlasses),
    presenterCommands:
      mergedTemplate.presenterCommands && typeof mergedTemplate.presenterCommands === 'object'
        ? mergedTemplate.presenterCommands
        : DEFAULT_TEMPLATE.presenterCommands,

    endCardAudio: mergedTemplate.endCardAudio?.dataUrl ? mergedTemplate.endCardAudio : undefined,
    introFlashTeaser: Boolean(mergedTemplate.introFlashTeaser),
    introFlashHookText:
      typeof mergedTemplate.introFlashHookText === 'string'
        ? mergedTemplate.introFlashHookText
        : DEFAULT_TEMPLATE.introFlashHookText,
    showLiveScoreboard: Boolean(mergedTemplate.showLiveScoreboard),
    scoreBoardLabel:
      typeof mergedTemplate.scoreBoardLabel === 'string'
        ? mergedTemplate.scoreBoardLabel
        : DEFAULT_TEMPLATE.scoreBoardLabel,
    showDynamicCaptions: Boolean(mergedTemplate.showDynamicCaptions),
    dynamicCaptionStyle:
      mergedTemplate.dynamicCaptionStyle === 'boldYellow' ||
      mergedTemplate.dynamicCaptionStyle === 'cleanGlass'
        ? mergedTemplate.dynamicCaptionStyle
        : 'pillKaraoke',
    dynamicCaptionY: Math.max(
      12,
      Math.min(93, sanitizeNumber(mergedTemplate.dynamicCaptionY, 85))
    ),
    aiPresenter:
      mergedTemplate.aiPresenter &&
      typeof mergedTemplate.aiPresenter === 'object' &&
      typeof mergedTemplate.aiPresenter.mediaKey === 'string' &&
      mergedTemplate.aiPresenter.mediaKey
        ? {
            enabled: Boolean(mergedTemplate.aiPresenter.enabled),
            provider: 'tavus',
            videoId: String(mergedTemplate.aiPresenter.videoId || ''),
            replicaId: String(mergedTemplate.aiPresenter.replicaId || ''),
            replicaName: String(mergedTemplate.aiPresenter.replicaName || 'الراوي الذكي'),
            script: String(mergedTemplate.aiPresenter.script || ''),
            voiceSource:
              mergedTemplate.aiPresenter.voiceSource === 'audioUrl' ||
              mergedTemplate.aiPresenter.voiceSource === 'localAudio'
                ? mergedTemplate.aiPresenter.voiceSource
                : 'script',
            transparentRequested: Boolean(mergedTemplate.aiPresenter.transparentRequested),
            fastRequested: Boolean(mergedTemplate.aiPresenter.fastRequested),
            mimeType:
              mergedTemplate.aiPresenter.mimeType === 'video/webm' ? 'video/webm' : 'video/mp4',
            naturalDuration: Math.max(
              0.5,
              sanitizeNumber(mergedTemplate.aiPresenter.naturalDuration, 5)
            ),
            mediaKey: mergedTemplate.aiPresenter.mediaKey,
            scope:
              mergedTemplate.aiPresenter.scope === 'intro' ||
              mergedTemplate.aiPresenter.scope === 'outro' ||
              mergedTemplate.aiPresenter.scope === 'allSlides' ||
              mergedTemplate.aiPresenter.scope === 'slide'
                ? mergedTemplate.aiPresenter.scope
                : 'fullTimeline',
            targetSlideIndex: Math.max(
              0,
              Math.round(sanitizeNumber(mergedTemplate.aiPresenter.targetSlideIndex, 0))
            ),
            placement:
              mergedTemplate.aiPresenter.placement === 'bottomCenter' ||
              mergedTemplate.aiPresenter.placement === 'cornerBottomLeft' ||
              mergedTemplate.aiPresenter.placement === 'topRight' ||
              mergedTemplate.aiPresenter.placement === 'topLeft' ||
              mergedTemplate.aiPresenter.placement === 'sideStage' ||
              mergedTemplate.aiPresenter.placement === 'floating'
                ? mergedTemplate.aiPresenter.placement
                : 'cornerBottomRight',
            x: Math.max(4, Math.min(96, sanitizeNumber(mergedTemplate.aiPresenter.x, 82))),
            y: Math.max(4, Math.min(96, sanitizeNumber(mergedTemplate.aiPresenter.y, 78))),
            scale: Math.max(40, Math.min(220, sanitizeNumber(mergedTemplate.aiPresenter.scale, 100))),
            frameShape:
              mergedTemplate.aiPresenter.frameShape === 'circleCam' ||
              mergedTemplate.aiPresenter.frameShape === 'broadcastCard'
                ? mergedTemplate.aiPresenter.frameShape
                : 'cutout',
            bgMode:
              mergedTemplate.aiPresenter.bgMode === 'transparent' ||
              mergedTemplate.aiPresenter.bgMode === 'white' ||
              mergedTemplate.aiPresenter.bgMode === 'color' ||
              mergedTemplate.aiPresenter.bgMode === 'customImage'
                ? mergedTemplate.aiPresenter.bgMode
                : 'original',
            bgColor:
              typeof mergedTemplate.aiPresenter.bgColor === 'string'
                ? mergedTemplate.aiPresenter.bgColor
                : '#FFFFFF',
            customBgDataUrl:
              typeof mergedTemplate.aiPresenter.customBgDataUrl === 'string'
                ? mergedTemplate.aiPresenter.customBgDataUrl
                : undefined,
            trimStart: Math.max(0, sanitizeNumber(mergedTemplate.aiPresenter.trimStart, 0)),
            trimEnd: Math.max(
              0.2,
              sanitizeNumber(
                mergedTemplate.aiPresenter.trimEnd,
                sanitizeNumber(mergedTemplate.aiPresenter.naturalDuration, 5)
              )
            ),
            startOffset: Math.max(0, sanitizeNumber(mergedTemplate.aiPresenter.startOffset, 0)),
            displayDuration: Math.max(
              0,
              sanitizeNumber(mergedTemplate.aiPresenter.displayDuration, 0)
            ),
            volume: Math.max(0, Math.min(1.5, sanitizeNumber(mergedTemplate.aiPresenter.volume, 1))),
            showNameBadge: Boolean(mergedTemplate.aiPresenter.showNameBadge),
            displayName:
              typeof mergedTemplate.aiPresenter.displayName === 'string'
                ? mergedTemplate.aiPresenter.displayName
                : undefined,
            fullscreenInIntro: mergedTemplate.aiPresenter.fullscreenInIntro ?? false,
            fullscreenInOutro: mergedTemplate.aiPresenter.fullscreenInOutro ?? false,
            muteOtherVoices: mergedTemplate.aiPresenter.muteOtherVoices ?? true,
          }
        : undefined,
  };

  const sanitizedSlides = result.slides.map((s, i) => sanitizeSlide(s, i));
  const rawTiming = result.timing && typeof result.timing === 'object' ? result.timing : undefined;

  const mergedTiming = {
    autoSyncWithAudio: rawTiming?.autoSyncWithAudio ?? DEFAULT_TIMING.autoSyncWithAudio,
    audioEndGap: sanitizeNumber(rawTiming?.audioEndGap, DEFAULT_TIMING.audioEndGap),
    autoDuckMusic: rawTiming?.autoDuckMusic ?? DEFAULT_TIMING.autoDuckMusic,
    bgMusicDuckRatio: sanitizeNumber(rawTiming?.bgMusicDuckRatio, DEFAULT_TIMING.bgMusicDuckRatio),
    introHold: sanitizeNumber(rawTiming?.introHold, DEFAULT_TIMING.introHold),
    questionReadDelay: sanitizeNumber(
      rawTiming?.questionReadDelay,
      DEFAULT_TIMING.questionReadDelay
    ),
    optionStaggerDelay: sanitizeNumber(
      rawTiming?.optionStaggerDelay,
      DEFAULT_TIMING.optionStaggerDelay
    ),
    thinkingDuration: sanitizeNumber(
      rawTiming?.thinkingDuration,
      DEFAULT_TIMING.thinkingDuration
    ),
    suspenseDuration: sanitizeNumber(
      rawTiming?.suspenseDuration,
      DEFAULT_TIMING.suspenseDuration
    ),
    revealHoldDuration: sanitizeNumber(
      rawTiming?.revealHoldDuration,
      DEFAULT_TIMING.revealHoldDuration
    ),
    transitionGap: sanitizeNumber(rawTiming?.transitionGap, DEFAULT_TIMING.transitionGap),
    escalatingSpeed: Boolean(rawTiming?.escalatingSpeed),
    escalatingStepSeconds: Math.max(
      0.25,
      Math.min(3, sanitizeNumber(rawTiming?.escalatingStepSeconds, 0.5))
    ),
    escalatingMinSeconds: Math.max(
      1.0,
      Math.min(10, sanitizeNumber(rawTiming?.escalatingMinSeconds, 2.0))
    ),
  };

  if (!result.schemaVersion || result.schemaVersion < 4) {
    mergedTiming.thinkingDuration = 5;
  }
  if (!result.schemaVersion || result.schemaVersion < 6) {
    if (Math.abs((mergedTiming.introHold ?? 0.25) - 0.25) < 0.01) {
      mergedTiming.introHold = 0;
    }
  }

  const rawAudio = result.audio && typeof result.audio === 'object' ? result.audio : undefined;

  return {
    ...base,
    ...result,
    id: typeof result.id === 'string' && result.id ? result.id : base.id,
    name: typeof result.name === 'string' && result.name ? result.name : base.name,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    preferredAiVoice: result.preferredAiVoice ?? 'Kore',
    slides: sanitizedSlides,
    template: mergedTemplate,
    timing: mergedTiming,
    audio: {
      questionEnter: {
        ...DEFAULT_AUDIO.questionEnter,
        ...(rawAudio?.questionEnter ?? {}),
      },
      optionEnter: {
        ...DEFAULT_AUDIO.optionEnter,
        ...(rawAudio?.optionEnter ?? {}),
      },
      countdownTick: {
        ...DEFAULT_AUDIO.countdownTick,
        ...(rawAudio?.countdownTick ?? {}),
      },
      suspense: {
        ...DEFAULT_AUDIO.suspense,
        ...(rawAudio?.suspense ?? {}),
      },
      correctReveal: {
        ...DEFAULT_AUDIO.correctReveal,
        ...(rawAudio?.correctReveal ?? {}),
      },
      bgMusic: {
        ...DEFAULT_AUDIO.bgMusic,
        ...(rawAudio?.bgMusic ?? {}),
      },
    },
  };
}

function toSummary(project: QuizProject): ProjectSummary {
  return {
    id: project.id,
    name: project.name || 'مشروع بدون اسم',
    slideCount: project.slides.length,
    aspectRatio: project.template.aspectRatio === '16:9' ? '16:9' : '9:16',
    updatedAt: project.updatedAt || Date.now(),
  };
}

export async function listProjectsFromStore(): Promise<ProjectSummary[]> {
  try {
    const index = await idbGet<ProjectSummary[]>(LIBRARY_INDEX_KEY);
    if (Array.isArray(index) && index.length > 0) {
      return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
    }
  } catch {
    // ignore
  }
  return [];
}

export async function loadProjectById(projectId: string): Promise<QuizProject | null> {
  try {
    const raw = await idbGet<Partial<QuizProject>>(`${PROJECT_ITEM_PREFIX}${projectId}`);
    if (!raw) return null;
    const hydrated = await hydrateProjectMedia(normalizeLoadedProject(raw));
    await idbSet(ACTIVE_PROJECT_ID_KEY, hydrated.id);
    const compact = await offloadProjectMediaBlobs(hydrated);
    await idbSet(ACTIVE_PROJECT_KEY, compact);
    return hydrated;
  } catch {
    return null;
  }
}

export async function deleteProjectFromStore(projectId: string): Promise<ProjectSummary[]> {
  try {
    await idbDelete(`${PROJECT_ITEM_PREFIX}${projectId}`);
    const existing = await listProjectsFromStore();
    const filtered = existing.filter((p) => p.id !== projectId);
    await idbSet(LIBRARY_INDEX_KEY, filtered);
    return filtered;
  } catch {
    return [];
  }
}

export async function loadProjectFromStore(): Promise<QuizProject> {
  try {
    const activeId = await idbGet<string>(ACTIVE_PROJECT_ID_KEY);
    if (activeId) {
      const byId = await idbGet<Partial<QuizProject>>(`${PROJECT_ITEM_PREFIX}${activeId}`);
      if (byId) {
        return await hydrateProjectMedia(normalizeLoadedProject(byId));
      }
    }

    const legacy = await idbGet<Partial<QuizProject>>(ACTIVE_PROJECT_KEY);
    const normalized = await hydrateProjectMedia(normalizeLoadedProject(legacy));
    await saveProjectToStore(normalized);
    return normalized;
  } catch {
    return createDefaultProject();
  }
}

export async function saveProjectToStore(project: QuizProject): Promise<void> {
  try {
    const stamped: QuizProject = {
      ...project,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      updatedAt: Date.now(),
    };
    const compact = await offloadProjectMediaBlobs(stamped);
    await idbSet(`${PROJECT_ITEM_PREFIX}${compact.id}`, compact);
    await idbSet(ACTIVE_PROJECT_ID_KEY, compact.id);
    await idbSet(ACTIVE_PROJECT_KEY, compact);

    const existing = (await idbGet<ProjectSummary[]>(LIBRARY_INDEX_KEY)) ?? [];
    const summary = toSummary(compact);
    const nextIndex = [
      summary,
      ...existing.filter((item) => item.id !== compact.id),
    ].slice(0, 50);
    await idbSet(LIBRARY_INDEX_KEY, nextIndex);
  } catch {
    // Ignore storage quota or private browsing errors gracefully
  }
}

export async function saveProjectsToLibraryBatch(projects: QuizProject[]): Promise<void> {
  if (!Array.isArray(projects) || projects.length === 0) return;
  try {
    const existing = (await idbGet<ProjectSummary[]>(LIBRARY_INDEX_KEY)) ?? [];
    const batchSummaries: ProjectSummary[] = [];
    const batchIds = new Set<string>();
    const now = Date.now();

    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      const stamped: QuizProject = {
        ...p,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        updatedAt: now + (projects.length - i),
      };
      const compact = await offloadProjectMediaBlobs(stamped);
      await idbSet(`${PROJECT_ITEM_PREFIX}${compact.id}`, compact);
      batchSummaries.push(toSummary(compact));
      batchIds.add(compact.id);
    }

    const nextIndex = [
      ...batchSummaries,
      ...existing.filter((item) => !batchIds.has(item.id)),
    ].slice(0, 50);
    await idbSet(LIBRARY_INDEX_KEY, nextIndex);
  } catch {
    // Ignore storage errors gracefully
  }
}

export async function clearProjectStore(): Promise<void> {
  try {
    await idbDelete(ACTIVE_PROJECT_KEY);
    await idbDelete(ACTIVE_PROJECT_ID_KEY);
  } catch {
    // ignore
  }
}

function readRawFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  const raw = await readRawFileAsDataUrl(file);
  // Downscale oversized smartphone camera images to protect Android WebView memory
  if (
    typeof document === 'undefined' ||
    !file.type.startsWith('image/') ||
    file.type === 'image/svg+xml' ||
    file.type === 'image/gif' ||
    file.size < 260_000
  ) {
    return raw;
  }

  return await new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1600;
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h || (w <= maxDim && h <= maxDim && file.size < 800_000)) {
        resolve(raw);
        return;
      }
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const targetW = Math.max(1, Math.round(w * scale));
      const targetH = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(raw);
        return;
      }
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const isAlphaType = file.type === 'image/png' || file.type === 'image/webp';
      const out = isAlphaType
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.88);
      resolve(out.length < raw.length ? out : raw);
    };
    img.onerror = () => resolve(raw);
    img.src = raw;
  });
}
