import { TemplateSettings, TimingSettings } from '../types/quiz';
import { idbGet, idbSet } from './projectStore';

const BRAND_KITS_LOCAL_KEY = 'shorts_studio_brand_kits_v1';
const BRAND_KITS_IDB_KEY = 'channel_brand_kits_v1';

export interface ChannelBrandKit {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  brandLogoDataUrl?: string;
  brandLogoName?: string;
  brandHandleText: string;
  brandLogoPosition: TemplateSettings['brandLogoPosition'];
  brandLogoX?: number;
  brandLogoY?: number;
  brandLogoSize: number;
  brandLogoAnim: TemplateSettings['brandLogoAnim'];
  brandOpacity: number;
  showProgressCounter: boolean;
  presetId: TemplateSettings['presetId'];
  backgroundType: TemplateSettings['backgroundType'];
  solidBgColor: string;
  fontFamily: TemplateSettings['fontFamily'];
  boxStyle: TemplateSettings['boxStyle'];
  borderStyle: TemplateSettings['borderStyle'];
  questionBoxColor: string;
  questionTextColor: string;
  questionBorderColor: string;
  optionBoxColor: string;
  optionTextColor: string;
  optionBorderColor: string;
  optionLabelBgColor: string;
  optionLabelTextColor: string;
  correctColor: string;
  wrongColor: string;
  timerBgColor: string;
  timerColor: string;
  timerStyle: TemplateSettings['timerStyle'];
  showEndSubscribeCta?: boolean;
  endCardText: string;
  endCtaText?: string;
  thinkingDuration?: number;
}

export function extractBrandKitFromTemplate(
  name: string,
  template: TemplateSettings,
  timing?: TimingSettings
): Omit<ChannelBrandKit, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: name.trim() || 'هوية قناة',
    brandLogoDataUrl: template.brandLogoDataUrl,
    brandLogoName: template.brandLogoName,
    brandHandleText: template.brandHandleText || '',
    brandLogoPosition: template.brandLogoPosition || 'topRight',
    brandLogoX: template.brandLogoX,
    brandLogoY: template.brandLogoY,
    brandLogoSize: template.brandLogoSize ?? 108,
    brandLogoAnim: template.brandLogoAnim || 'pulse',
    brandOpacity: template.brandOpacity ?? 0.92,
    showProgressCounter: Boolean(template.showProgressCounter),
    presetId: template.presetId,
    backgroundType: template.backgroundType,
    solidBgColor: template.solidBgColor,
    fontFamily: template.fontFamily,
    boxStyle: template.boxStyle,
    borderStyle: template.borderStyle,
    questionBoxColor: template.questionBoxColor,
    questionTextColor: template.questionTextColor,
    questionBorderColor: template.questionBorderColor,
    optionBoxColor: template.optionBoxColor,
    optionTextColor: template.optionTextColor,
    optionBorderColor: template.optionBorderColor,
    optionLabelBgColor: template.optionLabelBgColor,
    optionLabelTextColor: template.optionLabelTextColor,
    correctColor: template.correctColor,
    wrongColor: template.wrongColor,
    timerBgColor: template.timerBgColor,
    timerColor: template.timerColor,
    timerStyle: template.timerStyle,
    showEndSubscribeCta: template.showEndSubscribeCta,
    endCardText: template.endCardText,
    endCtaText: template.endCtaText,
    thinkingDuration: timing?.thinkingDuration,
  };
}

export function applyBrandKitToTemplate(
  current: TemplateSettings,
  kit: ChannelBrandKit
): TemplateSettings {
  return {
    ...current,
    brandLogoDataUrl: kit.brandLogoDataUrl ?? current.brandLogoDataUrl,
    brandLogoName: kit.brandLogoName ?? current.brandLogoName,
    brandHandleText: kit.brandHandleText,
    brandLogoPosition: kit.brandLogoPosition,
    brandLogoX: kit.brandLogoX,
    brandLogoY: kit.brandLogoY,
    brandLogoSize: kit.brandLogoSize,
    brandLogoAnim: kit.brandLogoAnim,
    brandOpacity: kit.brandOpacity,
    showProgressCounter: kit.showProgressCounter,
    presetId: kit.presetId,
    backgroundType: kit.backgroundType === 'custom' && !current.customBgDataUrl ? 'preset' : kit.backgroundType,
    solidBgColor: kit.solidBgColor,
    fontFamily: kit.fontFamily,
    boxStyle: kit.boxStyle,
    borderStyle: kit.borderStyle,
    questionBoxColor: kit.questionBoxColor,
    questionTextColor: kit.questionTextColor,
    questionBorderColor: kit.questionBorderColor,
    optionBoxColor: kit.optionBoxColor,
    optionTextColor: kit.optionTextColor,
    optionBorderColor: kit.optionBorderColor,
    optionLabelBgColor: kit.optionLabelBgColor,
    optionLabelTextColor: kit.optionLabelTextColor,
    correctColor: kit.correctColor,
    wrongColor: kit.wrongColor,
    timerBgColor: kit.timerBgColor,
    timerColor: kit.timerColor,
    timerStyle: kit.timerStyle,
    showEndSubscribeCta: kit.showEndSubscribeCta ?? current.showEndSubscribeCta,
    endCardText: kit.endCardText || current.endCardText,
    endCtaText: kit.endCtaText ?? current.endCtaText,
  };
}

function mirrorToLocal(list: ChannelBrandKit[]) {
  try {
    // Strip heavy base64 logo on localStorage fallback if huge; IndexedDB stores full kit
    const lite = list.map((k) => {
      if (k.brandLogoDataUrl && k.brandLogoDataUrl.length > 180_000) {
        return { ...k, brandLogoDataUrl: undefined };
      }
      return k;
    });
    localStorage.setItem(BRAND_KITS_LOCAL_KEY, JSON.stringify(lite));
  } catch {
    // ignore storage quota
  }
}

export function loadBrandKits(): ChannelBrandKit[] {
  try {
    const raw = localStorage.getItem(BRAND_KITS_LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChannelBrandKit[]) : [];
  } catch {
    return [];
  }
}

export async function loadBrandKitsAsync(): Promise<ChannelBrandKit[]> {
  try {
    const fromIdb = await idbGet<ChannelBrandKit[]>(BRAND_KITS_IDB_KEY);
    if (Array.isArray(fromIdb) && fromIdb.length > 0) {
      mirrorToLocal(fromIdb);
      return fromIdb;
    }
  } catch {
    // fallthrough to local
  }
  return loadBrandKits();
}

export async function saveBrandKitAsync(
  name: string,
  template: TemplateSettings,
  timing?: TimingSettings
): Promise<{ list: ChannelBrandKit[]; created: ChannelBrandKit }> {
  const existing = await loadBrandKitsAsync();
  const now = Date.now();
  const created: ChannelBrandKit = {
    id: `brand-${now}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: now,
    updatedAt: now,
    ...extractBrandKitFromTemplate(name, template, timing),
  };
  const next = [created, ...existing].slice(0, 20);
  await idbSet(BRAND_KITS_IDB_KEY, next);
  mirrorToLocal(next);
  return { list: next, created };
}

export async function deleteBrandKitAsync(id: string): Promise<ChannelBrandKit[]> {
  const existing = await loadBrandKitsAsync();
  const next = existing.filter((k) => k.id !== id);
  await idbSet(BRAND_KITS_IDB_KEY, next);
  mirrorToLocal(next);
  return next;
}
