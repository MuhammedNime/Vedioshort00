import { DEFAULT_TEMPLATE, TemplateSettings, TimingSettings } from '../types/quiz';
import { idbGet, idbSet } from './projectStore';

const CUSTOM_PRESETS_KEY = 'shorts_quiz_custom_presets_v1';
const CUSTOM_PRESETS_IDB_KEY = 'custom_styles_vault_v2';
const DEFAULT_STYLE_ID_KEY = 'shorts_quiz_default_custom_style_id_v1';

export interface CustomTemplatePreset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
  includesMedia?: boolean;
  template: Partial<TemplateSettings>;
  timing?: TimingSettings;
}

export interface SaveStyleOptions {
  includeBrandAndBg?: boolean;
  timing?: TimingSettings;
}

function buildStyleSnapshot(
  template: TemplateSettings,
  options?: SaveStyleOptions
): { snapshot: Partial<TemplateSettings>; includesMedia: boolean } {
  const includeMedia = options?.includeBrandAndBg ?? true;
  const snapshot: Partial<TemplateSettings> = { ...template };

  // Strip intro audio blob if huge? Keep under 2MB or keep as-is in IndexedDB
  if (!includeMedia) {
    delete snapshot.brandLogoDataUrl;
    delete snapshot.brandLogoName;
    delete snapshot.customBgDataUrl;
    delete snapshot.customBgName;
    if (snapshot.backgroundType === 'custom') {
      snapshot.backgroundType = 'preset';
    }
  }

  return {
    snapshot,
    includesMedia: Boolean(
      includeMedia && (snapshot.customBgDataUrl || snapshot.brandLogoDataUrl)
    ),
  };
}

function sanitizePresetItem(raw: unknown): CustomTemplatePreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<CustomTemplatePreset>;
  if (typeof item.id !== 'string' || !item.id) return null;
  if (typeof item.name !== 'string' || !item.name.trim()) return null;
  if (!item.template || typeof item.template !== 'object') return null;
  return {
    id: item.id,
    name: item.name.trim(),
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : item.createdAt || Date.now(),
    includesMedia: Boolean(
      item.includesMedia ?? (item.template.customBgDataUrl || item.template.brandLogoDataUrl)
    ),
    template: { ...item.template },
    timing: item.timing ? { ...item.timing } : undefined,
  };
}

function mirrorLightListToLocalStorage(list: CustomTemplatePreset[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const serialized = JSON.stringify(list);
    if (serialized.length <= 1_200_000) {
      localStorage.setItem(CUSTOM_PRESETS_KEY, serialized);
      return;
    }
    // Strip heavy base64 images only from localStorage mirror; IndexedDB holds full copy
    const lightList = list.map((p) => {
      const tpl = { ...p.template };
      if (tpl.customBgDataUrl && tpl.customBgDataUrl.length > 120_000) {
        delete tpl.customBgDataUrl;
      }
      if (tpl.brandLogoDataUrl && tpl.brandLogoDataUrl.length > 120_000) {
        delete tpl.brandLogoDataUrl;
      }
      return { ...p, template: tpl };
    });
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(lightList));
  } catch {
    // ignore localStorage quota errors
  }
}

async function persistPresetsVault(list: CustomTemplatePreset[]): Promise<CustomTemplatePreset[]> {
  const capped = list.slice(0, 40);
  try {
    await idbSet(CUSTOM_PRESETS_IDB_KEY, capped);
  } catch {
    // ignore IDB write error
  }
  mirrorLightListToLocalStorage(capped);
  return capped;
}

export function loadCustomPresets(): CustomTemplatePreset[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizePresetItem).filter((x): x is CustomTemplatePreset => x !== null);
  } catch {
    return [];
  }
}

export async function loadCustomPresetsAsync(): Promise<CustomTemplatePreset[]> {
  const localItems = loadCustomPresets();
  try {
    const idbList = await idbGet<unknown[]>(CUSTOM_PRESETS_IDB_KEY);
    if (Array.isArray(idbList) && idbList.length > 0) {
      const clean = idbList
        .map(sanitizePresetItem)
        .filter((x): x is CustomTemplatePreset => x !== null);
      if (clean.length > 0) {
        mirrorLightListToLocalStorage(clean);
        return clean;
      }
    }
    if (localItems.length > 0) {
      await persistPresetsVault(localItems);
    }
  } catch {
    // fallback to localStorage items
  }
  return localItems;
}

export async function saveCustomPresetAsync(
  name: string,
  template: TemplateSettings,
  options?: SaveStyleOptions
): Promise<{ list: CustomTemplatePreset[]; created: CustomTemplatePreset }> {
  const cleanName =
    name.trim() || `ستايلي الخاص ${new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`;
  const { snapshot, includesMedia } = buildStyleSnapshot(template, options);

  const created: CustomTemplatePreset = {
    id: `style-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    includesMedia,
    template: snapshot,
    timing: options?.timing ? { ...options.timing } : undefined,
  };

  const existing = await loadCustomPresetsAsync();
  const list = await persistPresetsVault([created, ...existing]);
  return { list, created };
}

export async function updateCustomPresetAsync(
  id: string,
  template: TemplateSettings,
  options?: SaveStyleOptions & { name?: string }
): Promise<CustomTemplatePreset[]> {
  const existing = await loadCustomPresetsAsync();
  const { snapshot, includesMedia } = buildStyleSnapshot(template, options);
  const nextList = existing.map((item) => {
    if (item.id !== id) return item;
    return {
      ...item,
      name: options?.name?.trim() || item.name,
      updatedAt: Date.now(),
      includesMedia,
      template: snapshot,
      timing: options?.timing !== undefined ? { ...options.timing } : item.timing,
    };
  });
  return await persistPresetsVault(nextList);
}

export async function renameCustomPresetAsync(
  id: string,
  newName: string
): Promise<CustomTemplatePreset[]> {
  const clean = newName.trim();
  if (!clean) return await loadCustomPresetsAsync();
  const existing = await loadCustomPresetsAsync();
  const nextList = existing.map((item) =>
    item.id === id ? { ...item, name: clean, updatedAt: Date.now() } : item
  );
  return await persistPresetsVault(nextList);
}

export async function deleteCustomPresetAsync(id: string): Promise<CustomTemplatePreset[]> {
  const existing = await loadCustomPresetsAsync();
  const nextList = existing.filter((p) => p.id !== id);
  if (getDefaultCustomStyleId() === id) {
    setDefaultCustomStyleId(null);
  }
  return await persistPresetsVault(nextList);
}

export function getDefaultCustomStyleId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(DEFAULT_STYLE_ID_KEY) || null;
  } catch {
    return null;
  }
}

export function setDefaultCustomStyleId(id: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (id) {
      localStorage.setItem(DEFAULT_STYLE_ID_KEY, id);
    } else {
      localStorage.removeItem(DEFAULT_STYLE_ID_KEY);
    }
  } catch {
    // ignore
  }
}

export async function getDefaultCustomPreset(): Promise<CustomTemplatePreset | null> {
  const defaultId = getDefaultCustomStyleId();
  if (!defaultId) return null;
  const list = await loadCustomPresetsAsync();
  return list.find((item) => item.id === defaultId) ?? null;
}

export function serializeStylePreset(preset: CustomTemplatePreset): string {
  return JSON.stringify(
    {
      format: 'shorts-quiz-style-v1',
      preset,
    },
    null,
    2
  );
}

export async function importCustomStyleFromJson(
  jsonText: string
): Promise<{ list: CustomTemplatePreset[]; imported: CustomTemplatePreset }> {
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  const candidate =
    parsed && typeof parsed === 'object' && 'preset' in parsed ? parsed.preset : parsed;
  const sanitized = sanitizePresetItem(candidate);
  if (!sanitized) {
    throw new Error('ملف الستايل غير صالح أو لا يحتوي على إعدادات تصميم صحيحة.');
  }

  const imported: CustomTemplatePreset = {
    ...sanitized,
    id: `style-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    template: {
      ...DEFAULT_TEMPLATE,
      ...sanitized.template,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const existing = await loadCustomPresetsAsync();
  const list = await persistPresetsVault([imported, ...existing]);
  return { list, imported };
}

export function saveCustomPreset(name: string, template: TemplateSettings): CustomTemplatePreset[] {
  const cleanName = name.trim() || `قالب مخصص ${new Date().toLocaleTimeString('ar-EG')}`;
  const { snapshot, includesMedia } = buildStyleSnapshot(template, { includeBrandAndBg: true });
  const nextItem: CustomTemplatePreset = {
    id: `style-${Date.now()}`,
    name: cleanName,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    includesMedia,
    template: snapshot,
  };
  const existing = loadCustomPresets();
  const nextList = [nextItem, ...existing].slice(0, 40);
  void persistPresetsVault(nextList);
  return nextList;
}

export function deleteCustomPreset(id: string): CustomTemplatePreset[] {
  const existing = loadCustomPresets();
  const nextList = existing.filter((p) => p.id !== id);
  if (getDefaultCustomStyleId() === id) {
    setDefaultCustomStyleId(null);
  }
  void persistPresetsVault(nextList);
  return nextList;
}

export async function mergeCustomPresetsVault(
  incomingRaw: unknown[],
  restoredDefaultStyleId?: string | null
): Promise<CustomTemplatePreset[]> {
  const existing = await loadCustomPresetsAsync();
  const sanitizedIncoming = (Array.isArray(incomingRaw) ? incomingRaw : [])
    .map(sanitizePresetItem)
    .filter((x): x is CustomTemplatePreset => x !== null);

  const byId = new Map<string, CustomTemplatePreset>();
  for (const item of existing) {
    byId.set(item.id, item);
  }
  for (const item of sanitizedIncoming) {
    byId.set(item.id, item);
  }

  const merged = Array.from(byId.values()).sort(
    (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
  );
  const saved = await persistPresetsVault(merged);

  if (restoredDefaultStyleId && byId.has(restoredDefaultStyleId)) {
    setDefaultCustomStyleId(restoredDefaultStyleId);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('shorts-studio-presets-updated'));
  }
  return saved;
}
