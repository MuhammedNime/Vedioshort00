import 'dotenv/config';
import express from 'express';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import zlib from 'node:zlib';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const PORT = 3000;

const TTS_FREE_DAILY_LIMIT = 10;
const serverKeyCooldowns = new Map<string, number>();

interface TtsKeyUsageState {
  usedToday: number;
  dailyExhausted: boolean;
  authInvalid: boolean;
  beyondFreeTier: boolean;
  lastUsedAt?: number;
}

let ttsUsageUtcDate = new Date().toISOString().slice(0, 10);
const ttsUsageByKey = new Map<string, TtsKeyUsageState>();

function ensureCurrentUtcDayUsage(): void {
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (todayUtc !== ttsUsageUtcDate) {
    ttsUsageUtcDate = todayUtc;
    ttsUsageByKey.clear();
  }
}

function getOrCreateTtsUsage(apiKey: string): TtsKeyUsageState {
  ensureCurrentUtcDayUsage();
  let state = ttsUsageByKey.get(apiKey);
  if (!state) {
    state = {
      usedToday: 0,
      dailyExhausted: false,
      authInvalid: false,
      beyondFreeTier: false,
    };
    ttsUsageByKey.set(apiKey, state);
  }
  return state;
}

export interface TtsKeyQuotaInfo {
  index: number;
  label: string;
  tail: string;
  limit: number;
  used: number;
  remaining: number;
  status: 'ready' | 'cooldown' | 'exhausted' | 'invalid';
  cooldownRemainingSec: number;
  beyondFreeTier: boolean;
}

export interface TtsQuotaSnapshot {
  utcDate: string;
  perKeyDailyLimit: number;
  totalKeys: number;
  activeKeys: number;
  totalDailyLimit: number;
  usedToday: number;
  remainingToday: number;
  allExhausted: boolean;
  beyondFreeTier: boolean;
  nextResetAtIso: string;
  updatedAtIso: string;
  keys: TtsKeyQuotaInfo[];
}

function getTtsQuotaSnapshot(): TtsQuotaSnapshot {
  ensureCurrentUtcDayUsage();
  const allKeys = getConfiguredServerKeys();
  const now = Date.now();

  let activeKeys = 0;
  let totalDailyLimit = 0;
  let usedToday = 0;
  let remainingToday = 0;
  let anyBeyondFree = false;

  const keys: TtsKeyQuotaInfo[] = allKeys.map((apiKey, idx) => {
    const state = getOrCreateTtsUsage(apiKey);
    const cooldownUntil = serverKeyCooldowns.get(`${apiKey}:tts`) ?? 0;
    const cooldownRemainingSec =
      cooldownUntil > now ? Math.ceil((cooldownUntil - now) / 1000) : 0;

    if (state.beyondFreeTier) {
      anyBeyondFree = true;
    }

    const effectiveLimit = state.beyondFreeTier
      ? Math.max(TTS_FREE_DAILY_LIMIT, state.usedToday + 10)
      : TTS_FREE_DAILY_LIMIT;
    const used = state.dailyExhausted
      ? effectiveLimit
      : Math.min(effectiveLimit, state.usedToday);
    const remaining =
      state.dailyExhausted || state.authInvalid
        ? 0
        : Math.max(0, effectiveLimit - used);

    let status: TtsKeyQuotaInfo['status'] = 'ready';
    if (state.authInvalid) {
      status = 'invalid';
    } else if (state.dailyExhausted || remaining === 0) {
      status = 'exhausted';
    } else if (cooldownUntil > now) {
      status = 'cooldown';
    }

    if (status === 'ready' || (status === 'cooldown' && remaining > 0 && !state.dailyExhausted)) {
      if (status === 'ready') activeKeys += 1;
    }

    totalDailyLimit += effectiveLimit;
    usedToday += used;
    remainingToday += remaining;

    const tail = apiKey.length > 6 ? `••${apiKey.slice(-4)}` : '••••';
    return {
      index: idx + 1,
      label: `مفتاح ${idx + 1}`,
      tail,
      limit: effectiveLimit,
      used,
      remaining,
      status,
      cooldownRemainingSec,
      beyondFreeTier: state.beyondFreeTier,
    };
  });

  return {
    utcDate: ttsUsageUtcDate,
    perKeyDailyLimit: TTS_FREE_DAILY_LIMIT,
    totalKeys: allKeys.length,
    activeKeys,
    totalDailyLimit,
    usedToday,
    remainingToday,
    allExhausted: allKeys.length > 0 && remainingToday === 0 && activeKeys === 0,
    beyondFreeTier: anyBeyondFree,
    nextResetAtIso: new Date(now + getNextUtcResetMs()).toISOString(),
    updatedAtIso: new Date(now).toISOString(),
    keys,
  };
}

type TextAiProviderId = 'gemini' | 'groq' | 'openrouter' | 'openai' | 'anthropic';

const PLACEHOLDER_KEYS = new Set([
  'MY_GEMINI_API_KEY',
  'MY_GROQ_API_KEY',
  'MY_OPENROUTER_API_KEY',
  'MY_OPENAI_API_KEY',
  'MY_ANTHROPIC_API_KEY',
]);

function collectKeysFromEnvNames(names: string[]): string[] {
  const combined = names.map((name) => process.env[name] || '').join('\n');
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const part of combined.split(/[\s,;]+/)) {
    const clean = part.trim();
    if (!clean || PLACEHOLDER_KEYS.has(clean) || seen.has(clean)) continue;
    seen.add(clean);
    keys.push(clean);
  }
  return keys;
}

function getConfiguredServerKeys(): string[] {
  const numbered = Array.from({ length: 10 }, (_, idx) => `GEMINI_API_KEY_${idx + 1}`);
  return collectKeysFromEnvNames(['GEMINI_API_KEY', 'GEMINI_API_KEYS', ...numbered]);
}

function getConfiguredExternalProviderKeys(
  provider: Exclude<TextAiProviderId, 'gemini'>
): string[] {
  const prefixes =
    provider === 'anthropic'
      ? ['ANTHROPIC', 'CLAUDE']
      : provider === 'openai'
        ? ['OPENAI', 'CHATGPT']
        : provider === 'groq'
          ? ['GROQ']
          : ['OPENROUTER'];

  const envNames: string[] = [];
  for (const prefix of prefixes) {
    envNames.push(`${prefix}_API_KEY`, `${prefix}_API_KEYS`);
    for (let i = 1; i <= 10; i++) {
      envNames.push(`${prefix}_API_KEY_${i}`);
    }
  }
  return collectKeysFromEnvNames(envNames);
}

function getConfiguredProvidersSummary(): Record<TextAiProviderId, number> {
  return {
    gemini: getConfiguredServerKeys().length,
    groq: getConfiguredExternalProviderKeys('groq').length,
    openrouter: getConfiguredExternalProviderKeys('openrouter').length,
    openai: getConfiguredExternalProviderKeys('openai').length,
    anthropic: getConfiguredExternalProviderKeys('anthropic').length,
  };
}

function getTextProviderOrder(): TextAiProviderId[] {
  const defaultOrder: TextAiProviderId[] = ['gemini', 'groq', 'openrouter', 'openai', 'anthropic'];
  const rawOrder = (process.env.AI_PROVIDER_ORDER || '').trim().toLowerCase();
  if (!rawOrder) return defaultOrder;
  const parsed: TextAiProviderId[] = [];
  for (const token of rawOrder.split(/[\s,;]+/)) {
    const clean = token.trim() as TextAiProviderId;
    if (defaultOrder.includes(clean) && !parsed.includes(clean)) {
      parsed.push(clean);
    }
  }
  for (const p of defaultOrder) {
    if (!parsed.includes(p)) parsed.push(p);
  }
  return parsed;
}

function createAiClientForKey(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getNextUtcResetMs(): number {
  const now = new Date();
  const nextUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    5,
    0
  );
  return Math.max(60_000, nextUtcMidnight - Date.now());
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientServerError(raw: string): boolean {
  return (
    raw.includes('503') ||
    raw.includes('UNAVAILABLE') ||
    raw.includes('high demand') ||
    raw.includes('overloaded') ||
    raw.includes('500') ||
    raw.includes('INTERNAL') ||
    raw.includes('ECONNRESET') ||
    raw.includes('ETIMEDOUT') ||
    raw.includes('fetch failed')
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`503 UNAVAILABLE: ${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function runServerAiWithRotation<T>(
  bucket: 'text' | 'tts',
  task: (ai: GoogleGenAI) => Promise<T>
): Promise<T> {
  const allKeys = getConfiguredServerKeys();
  if (allKeys.length === 0) {
    throw new Error('مفتاح GEMINI_API_KEY غير مضبوط في إعدادات البيئة.');
  }

  const now = Date.now();
  const cooldownKey = (apiKey: string) => `${apiKey}:${bucket}`;
  const activeKeys = allKeys.filter((k) => (serverKeyCooldowns.get(cooldownKey(k)) ?? 0) <= now);
  let candidates = activeKeys.length > 0 ? [...activeKeys] : [...allKeys];

  if (bucket === 'tts') {
    ensureCurrentUtcDayUsage();
    candidates.sort((a, b) => {
      const ua = getOrCreateTtsUsage(a);
      const ub = getOrCreateTtsUsage(b);
      const aDead = ua.authInvalid || ua.dailyExhausted ? 1 : 0;
      const bDead = ub.authInvalid || ub.dailyExhausted ? 1 : 0;
      if (aDead !== bDead) return aDead - bDead;
      return ua.usedToday - ub.usedToday;
    });
  }

  let lastErr: unknown;
  for (const apiKey of candidates) {
    try {
      const ai = createAiClientForKey(apiKey);
      const result = await withTimeout(task(ai), 15_000, 'Gemini request');
      if (bucket === 'tts') {
        const usage = getOrCreateTtsUsage(apiKey);
        usage.usedToday += 1;
        usage.dailyExhausted = false;
        usage.authInvalid = false;
        usage.lastUsedAt = Date.now();
        if (usage.usedToday > TTS_FREE_DAILY_LIMIT) {
          usage.beyondFreeTier = true;
        }
        serverKeyCooldowns.delete(cooldownKey(apiKey));
      }
      return result;
    } catch (err) {
      lastErr = err;
      const raw = err instanceof Error ? err.message : String(err);
      const isDaily =
        raw.includes('PerDay') || raw.includes('per day') || raw.includes('free_tier_requests');
      const isQuotaOrRate = raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED');
      const isAuth =
        raw.includes('403') ||
        raw.includes('PERMISSION_DENIED') ||
        raw.includes('API_KEY_INVALID') ||
        raw.includes('API key not valid');

      const isTransient = isTransientServerError(raw);

      if (isDaily) {
        if (bucket === 'tts') {
          const usage = getOrCreateTtsUsage(apiKey);
          usage.dailyExhausted = true;
          usage.usedToday = Math.max(usage.usedToday, TTS_FREE_DAILY_LIMIT);
        }
        serverKeyCooldowns.set(cooldownKey(apiKey), Date.now() + getNextUtcResetMs());
        continue;
      }
      if (isQuotaOrRate) {
        serverKeyCooldowns.set(cooldownKey(apiKey), Date.now() + 45_000);
        continue;
      }
      if (isAuth) {
        if (bucket === 'tts') {
          const usage = getOrCreateTtsUsage(apiKey);
          usage.authInvalid = true;
        }
        serverKeyCooldowns.set(cooldownKey(apiKey), Date.now() + 24 * 60 * 60_000);
        continue;
      }
      if (isTransient && candidates.length > 1) {
        serverKeyCooldowns.set(cooldownKey(apiKey), Date.now() + 15_000);
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

async function runWithModelFallback<T>(
  bucket: 'text' | 'tts',
  models: string[],
  task: (ai: GoogleGenAI, model: string) => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      return await runServerAiWithRotation(bucket, (ai) => task(ai, model));
    } catch (err) {
      lastErr = err;
      const raw = err instanceof Error ? err.message : String(err);
      const canFallback =
        i < models.length - 1 &&
        (isTransientServerError(raw) ||
          raw.includes('429') ||
          raw.includes('RESOURCE_EXHAUSTED') ||
          raw.includes('404') ||
          raw.includes('NOT_FOUND'));
      if (canFallback) {
        console.warn(`[AI Fallback] ${model} failed (${raw.slice(0, 140)}), switching to ${models[i + 1]}`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function extractJsonPayload(rawText: string): unknown {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback: locate the first balanced {...} or [...] block in case a model added surrounding text
    const startObj = cleaned.indexOf('{');
    const startArr = cleaned.indexOf('[');
    let start = -1;
    if (startObj !== -1 && startArr !== -1) {
      start = Math.min(startObj, startArr);
    } else {
      start = Math.max(startObj, startArr);
    }
    if (start === -1) {
      throw new Error('لم يُرجع النموذج بيانات JSON صالحة.');
    }

    const openChar = cleaned[start];
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === openChar) {
        depth++;
      } else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          return JSON.parse(cleaned.slice(start, i + 1));
        }
      }
    }
    throw new Error('تعذر استخراج JSON مكتمل من استجابة النموذج.');
  }
}

async function callOpenAiCompatibleJson(
  provider: 'groq' | 'openrouter' | 'openai',
  apiKey: string,
  model: string,
  systemInstruction: string,
  userPrompt: string,
  useJsonObjectFormat: boolean
): Promise<string> {
  const endpoint =
    provider === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = (process.env.APP_URL || '').trim() || 'http://localhost:3000';
    headers['X-Title'] = 'Shorts Quiz Studio';
  }

  const bodyPayload: Record<string, unknown> = {
    model,
    temperature: 0.95,
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: userPrompt },
    ],
  };
  if (useJsonObjectFormat) {
    bodyPayload.response_format = { type: 'json_object' };
  }

  const res = await withTimeout(
    fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
    }),
    15_000,
    `${provider} (${model})`
  );

  const rawBody = await res.text();
  if (!res.ok) {
    throw new Error(`${provider} HTTP ${res.status}: ${rawBody.slice(0, 320)}`);
  }

  const parsed = JSON.parse(rawBody) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = (parsed.choices?.[0]?.message?.content ?? '').trim();
  if (!content) {
    throw new Error(`${provider} returned empty content`);
  }
  return content;
}

async function callAnthropicJson(
  apiKey: string,
  model: string,
  systemInstruction: string,
  userPrompt: string
): Promise<string> {
  const res = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2400,
        temperature: 0.7,
        system: systemInstruction,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    }),
    15_000,
    `anthropic (${model})`
  );

  const rawBody = await res.text();
  if (!res.ok) {
    throw new Error(`anthropic HTTP ${res.status}: ${rawBody.slice(0, 320)}`);
  }

  const parsed = JSON.parse(rawBody) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const content = (parsed.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text!)
    .join('\n')
    .trim();
  if (!content) {
    throw new Error('anthropic returned empty content');
  }
  return content;
}

function classifyProviderErrorCooldownMs(raw: string): number {
  const lower = raw.toLowerCase();
  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('invalid_api_key') ||
    lower.includes('authentication_error') ||
    lower.includes('permission_denied') ||
    lower.includes('api key not valid')
  ) {
    return 24 * 60 * 60_000;
  }
  if (
    lower.includes('insufficient_quota') ||
    lower.includes('credit balance') ||
    lower.includes('billing') ||
    lower.includes('perday') ||
    lower.includes('per day') ||
    lower.includes('free_tier_requests')
  ) {
    return getNextUtcResetMs();
  }
  if (lower.includes('429') || lower.includes('rate_limit') || lower.includes('resource_exhausted')) {
    return 45_000;
  }
  if (
    lower.includes('503') ||
    lower.includes('529') ||
    lower.includes('500') ||
    lower.includes('unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('timed out')
  ) {
    return 20_000;
  }
  return 10_000;
}

async function runTextJsonAcrossProviders<T>(params: {
  geminiTask: (ai: GoogleGenAI, model: string) => Promise<string>;
  externalSystemInstruction: string;
  externalUserPrompt: string;
  parseAndValidate: (payload: unknown) => T;
}): Promise<{ data: T; provider: TextAiProviderId; model: string }> {
  const order = getTextProviderOrder();
  const summary = getConfiguredProvidersSummary();
  const configuredCount = Object.values(summary).reduce((acc, n) => acc + n, 0);

  if (configuredCount === 0) {
    throw new Error(
      'لم يتم العثور على أي مفتاح ذكاء اصطناعي في الخادم. أضف GEMINI_API_KEY أو GROQ_API_KEY (مجاني) أو OPENROUTER_API_KEY أو OPENAI_API_KEY أو ANTHROPIC_API_KEY في Settings > Secrets.'
    );
  }

  let lastErr: unknown;

  for (const provider of order) {
    if (provider === 'gemini') {
      if (summary.gemini === 0) continue;
      const geminiModels = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
      for (const model of geminiModels) {
        try {
          const rawText = await runServerAiWithRotation('text', (ai) =>
            params.geminiTask(ai, model)
          );
          const payload = extractJsonPayload(rawText);
          const data = params.parseAndValidate(payload);
          return { data, provider: 'gemini', model };
        } catch (err) {
          lastErr = err;
          const raw = err instanceof Error ? err.message : String(err);
          console.warn(`[AI Multi-Provider] gemini (${model}) failed: ${raw.slice(0, 160)}`);
        }
      }
      continue;
    }

    const keys = getConfiguredExternalProviderKeys(provider);
    if (keys.length === 0) continue;

    const now = Date.now();
    const activeKeys = keys.filter(
      (k) => (serverKeyCooldowns.get(`${provider}:${k}:text`) ?? 0) <= now
    );
    const candidateKeys = activeKeys.length > 0 ? activeKeys : keys;

    const models =
      provider === 'groq'
        ? ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
        : provider === 'openrouter'
          ? (process.env.OPENROUTER_MODELS || '')
              .split(/[\s,;]+/)
              .map((m) => m.trim())
              .filter(Boolean).length > 0
            ? (process.env.OPENROUTER_MODELS || '')
                .split(/[\s,;]+/)
                .map((m) => m.trim())
                .filter(Boolean)
            : [
                'meta-llama/llama-3.3-70b-instruct:free',
                'google/gemma-3-27b-it:free',
                'openrouter/free',
              ]
          : provider === 'openai'
            ? ['gpt-4o-mini', 'gpt-4.1-mini']
            : ['claude-3-5-haiku-latest', 'claude-sonnet-4-20250514'];

    for (const apiKey of candidateKeys) {
      let keyInvalidOrQuota = false;
      for (const model of models) {
        if (keyInvalidOrQuota) break;
        try {
          let rawText = '';
          if (provider === 'anthropic') {
            rawText = await callAnthropicJson(
              apiKey,
              model,
              params.externalSystemInstruction,
              params.externalUserPrompt
            );
          } else {
            const useJsonObject = provider === 'groq' || provider === 'openai';
            try {
              rawText = await callOpenAiCompatibleJson(
                provider,
                apiKey,
                model,
                params.externalSystemInstruction,
                params.externalUserPrompt,
                useJsonObject
              );
            } catch (fmtErr) {
              const fmtMsg = fmtErr instanceof Error ? fmtErr.message : String(fmtErr);
              if (useJsonObject && fmtMsg.includes('HTTP 400') && fmtMsg.toLowerCase().includes('json')) {
                rawText = await callOpenAiCompatibleJson(
                  provider,
                  apiKey,
                  model,
                  params.externalSystemInstruction,
                  params.externalUserPrompt,
                  false
                );
              } else {
                throw fmtErr;
              }
            }
          }

          const payload = extractJsonPayload(rawText);
          const data = params.parseAndValidate(payload);
          serverKeyCooldowns.delete(`${provider}:${apiKey}:text`);
          console.log(`[AI Multi-Provider] Success via ${provider} (${model})`);
          return { data, provider, model };
        } catch (err) {
          lastErr = err;
          const raw = err instanceof Error ? err.message : String(err);
          console.warn(`[AI Multi-Provider] ${provider} (${model}) failed: ${raw.slice(0, 160)}`);
          const cd = classifyProviderErrorCooldownMs(raw);
          const lower = raw.toLowerCase();
          if (
            lower.includes('401') ||
            lower.includes('403') ||
            lower.includes('429') ||
            lower.includes('insufficient_quota') ||
            lower.includes('credit balance')
          ) {
            serverKeyCooldowns.set(`${provider}:${apiKey}:text`, Date.now() + cd);
            keyInvalidOrQuota = true;
          }
        }
      }
    }
  }

  throw lastErr ?? new Error('تعذر توليد النتيجة من جميع مزودي الذكاء الاصطناعي المتاحين حالياً.');
}

function formatGeminiError(
  err: unknown,
  kind: 'text' | 'tts' = 'text'
): {
  status: number;
  message: string;
  quotaExhausted?: boolean;
} {
  const raw = err instanceof Error ? err.message : String(err);
  const isDailyQuota =
    raw.includes('PerDay') ||
    raw.includes('per day') ||
    raw.includes('free_tier_requests') ||
    raw.toLowerCase().includes('insufficient_quota') ||
    raw.toLowerCase().includes('credit balance');

  if (
    raw.includes('403') ||
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('API_KEY_INVALID') ||
    raw.includes('API key not valid') ||
    raw.toLowerCase().includes('invalid_api_key') ||
    raw.toLowerCase().includes('authentication_error')
  ) {
    console.warn('[AI API Auth]', raw.slice(0, 200));
    return {
      status: 401,
      message:
        'تعذر التحقق من صلاحية مفتاح الذكاء الاصطناعي. يرجى مراجعة المفاتيح في Settings > Secrets.',
    };
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED') || raw.toLowerCase().includes('insufficient_quota')) {
    console.warn(
      `[AI API Quota:${kind}]`,
      isDailyQuota ? `Daily/quota exceeded: ${raw.slice(0, 220)}` : `Rate limited: ${raw.slice(0, 220)}`
    );
    if (isDailyQuota) {
      return {
        status: 429,
        quotaExhausted: true,
        message:
          kind === 'tts'
            ? 'اكتملت الحصة اليومية المجانية لتوليد الصوت (10 طلبات يومياً لكل مفتاح Gemini مجاني). أضف مفاتيح Gemini إضافية في Settings > Secrets لمضاعفة الحصة، أو استخدم الصوت اليدوي.'
            : 'اكتملت الحصة المجانية على جميع المفاتيح والمزودين المضافين حالياً (429). أضف مفتاحاً مجانياً إضافياً (Gemini أو Groq أو OpenRouter) في Settings > Secrets أو استخدم الاستيراد اليدوي.',
      };
    }
    return {
      status: 429,
      quotaExhausted: false,
      message: 'تم تجاوز حد الطلبات مؤقتاً (429). انتظر بضع ثوانٍ ثم أعد المحاولة.',
    };
  }
  if (
    raw.includes('503') ||
    raw.includes('529') ||
    raw.includes('UNAVAILABLE') ||
    raw.includes('high demand') ||
    raw.includes('overloaded')
  ) {
    console.warn('[AI API Busy]', raw.slice(0, 200));
    return {
      status: 500,
      quotaExhausted: false,
      message:
        'خوادم الذكاء الاصطناعي مزدحمة مؤقتاً ولم تستجب (503). يمكنك إضافة مفتاح مجاني بديل مثل GROQ_API_KEY أو OPENROUTER_API_KEY في Secrets للتبديل التلقائي، أو المحاولة بعد ثوانٍ.',
    };
  }
  console.error('[AI API Error]', raw.slice(0, 300));
  return {
    status: 500,
    message: raw || 'حدث خطأ غير متوقع أثناء الاتصال بخدمة الذكاء الاصطناعي.',
  };
}

function normalizeLatexToSpokenArabic(text: string): string {
  let out = text;
  for (let pass = 0; pass < 3; pass++) {
    out = out.replace(/\\(?:d|t)?frac\{([^{}]+)\}\{([^{}]+)\}/g, ' $1 على $2 ');
  }
  out = out.replace(/\\sqrt\{([^{}]+)\}/g, ' الجذر التربيعي لـ $1 ');
  out = out.replace(/\^\{2\}|\^2|²/g, ' تربيع ');
  out = out.replace(/\^\{3\}|\^3|³/g, ' تكعيب ');
  out = out.replace(/\^\{([^{}]+)\}/g, ' أس $1 ');
  out = out.replace(/\^([0-9a-zA-Z])/g, ' أس $1 ');
  out = out.replace(/_\{([^{}]+)\}/g, ' $1 ');

  return out
    .replace(/\\times|×/g, ' ضرب ')
    .replace(/\\cdot/g, ' ضرب ')
    .replace(/\\div|÷/g, ' تقسيم ')
    .replace(/\\pm|±/g, ' زائد أو ناقص ')
    .replace(/\\pi|π/g, ' باي ')
    .replace(/\\theta|θ/g, ' ثيتا ')
    .replace(/\\alpha/g, ' ألفا ')
    .replace(/\\beta/g, ' بيتا ')
    .replace(/\\leq|≤/g, ' أصغر من أو يساوي ')
    .replace(/\\geq|≥/g, ' أكبر من أو يساوي ')
    .replace(/\\neq|≠/g, ' لا يساوي ')
    .replace(/\\approx|≈/g, ' يساوي تقريباً ')
    .replace(/\\infty|∞/g, ' ما لا نهاية ')
    .replace(/\\circ|\\degree|°/g, ' درجة ')
    .replace(/√/g, ' الجذر التربيعي لـ ')
    .replace(/%/g, ' بالمئة ')
    .replace(/−/g, ' ناقص ')
    .replace(/(\d|\s)-(\s|\d)/g, '$1 ناقص $2')
    .replace(/\\left|\\right/g, '')
    .replace(/\$/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\\/g, ' ')
    .replace(/\+/g, ' زائد ')
    .replace(/=/g, ' يساوي ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function startServer() {
  const app = express();
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    const keys = getConfiguredServerKeys();
    const providers = getConfiguredProvidersSummary();
    res.json({
      ok: true,
      hasGeminiKey: keys.length > 0,
      keyCount: keys.length,
      providers,
      providerOrder: getTextProviderOrder(),
      ttsQuota: getTtsQuotaSnapshot(),
    });
  });

  app.get('/api/ai/tts-quota', (_req, res) => {
    res.json(getTtsQuotaSnapshot());
  });

  const normalizeQuestionForDedup = (text: string): string =>
    text
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const isDuplicateQuestion = (candidate: string, existingNormalized: Set<string>): boolean => {
    const norm = normalizeQuestionForDedup(candidate);
    if (!norm) return true;
    if (existingNormalized.has(norm)) return true;

    const candWords = norm.split(' ').filter((w) => w.length > 2);
    if (candWords.length < 3) return false;
    const candSet = new Set(candWords);

    for (const prev of existingNormalized) {
      const prevWords = prev.split(' ').filter((w) => w.length > 2);
      if (prevWords.length < 3) continue;
      let shared = 0;
      for (const w of candSet) {
        if (prevWords.includes(w)) shared += 1;
      }
      const ratio = shared / Math.max(candSet.size, prevWords.length);
      if (ratio >= 0.72) return true;
    }
    return false;
  };

  const CREATIVE_VARIETY_ANGLES = [
    'موقف حياتي شائع يختلف الناس في الحكم عليه',
    'تحدٍّ غير متوقع أو زاوية نفسية واجتماعية عميقة',
    'اختيار صعب بين قيمتين أو خيارين متقاربين',
    'معلومة أو مفارقة نادرة تثير فضول المشاهدين',
    'سؤال يمس التجارب اليومية والشخصية للجمهور',
    'زاوية تاريخية أو مستقبلية أو ثقافية مبتكرة',
    'سؤال ذكي يكسر التوقعات المعتادة ويدفع للتعليق',
    'مقارنة مثيرة بين أسلوبين في الحياة أو التفكير',
  ];

  // Generate Arabic quiz questions for YouTube Shorts
  app.post('/api/ai/generate-quiz', async (req, res) => {
    try {
      const { topic, count, difficulty, contentType, category, categoryHint, avoidQuestions } =
        req.body as {
          topic?: string;
          count?: number;
          difficulty?: string;
          contentType?: 'general' | 'math' | 'multiple3' | 'trueFalse' | 'clues' | 'versus';
          category?: string;
          categoryHint?: string;
          avoidQuestions?: string[];
        };

      const cleanTopic = (topic ?? '').trim();
      if (!cleanTopic) {
        res.status(400).json({ error: 'يرجى كتابة موضوع أو فكرة أو سؤال أولاً.' });
        return;
      }

      const safeCategory = (category ?? 'general').trim() || 'general';
      const safeCategoryHint = (categoryHint ?? '').trim();
      const safeCount = Math.max(1, Math.min(12, Math.round(Number(count) || 3)));
      const requestCount = safeCount <= 3 ? Math.min(5, safeCount + 2) : safeCount;
      const cleanAvoidList = Array.isArray(avoidQuestions)
        ? avoidQuestions
            .map((q) => (typeof q === 'string' ? q.trim() : ''))
            .filter(Boolean)
            .slice(-45)
        : [];
      const avoidNormalizedSet = new Set(
        cleanAvoidList.map((q) => normalizeQuestionForDedup(q)).filter(Boolean)
      );

      const diffLabel = difficulty && difficulty.trim() ? difficulty.trim() : 'متنوع';
      const isTrueFalse = contentType === 'trueFalse';
      const isClues = contentType === 'clues';
      const isVersus = contentType === 'versus';
      const isMultiple3 = contentType === 'multiple3';
      const isMath =
        !isTrueFalse &&
        !isClues &&
        !isVersus &&
        !isMultiple3 &&
        (contentType === 'math' ||
          safeCategory === 'math' ||
          /رياضيات|جبر|معادل|كسر|كسور|جذر|جذور|حساب|هندسة|مثلث|مشتق|تكامل/i.test(cleanTopic));
      const isDiscussion =
        !isMath &&
        !isTrueFalse &&
        !isClues &&
        (safeCategory === 'discussion' ||
          /نقاش|جدل|رأي|رأيك|رايك|لو خي|لو خيروك|تفاعل|تعليقات|تفضل|موقف|اجتماعي/i.test(cleanTopic));

      const categoryDirective = safeCategoryHint
        ? `\nالمجال / التصنيف المطلوب الالتزام به بدقة: ${safeCategoryHint}.`
        : '';

      const mathGuidelines = isMath
        ? `\nملاحظات مهمة لأسئلة الرياضيات:
- ضع التعابير الرياضية والكسور والجذور والأسس بصيغة LaTeX واضحة بين علامتي دولار مثل: $\\frac{3}{4} + \\frac{1}{2}$ أو $\\sqrt{81}$ أو $2x + 5 = 15$ أو $5^{2}$.
- اجعل الخيارات الأربعة قصيرة وواضحة (سواء رقمية أو بصيغة LaTeX بين $...$).
- تأكد رياضياً 100% أن الخيار عند correctIndex هو الحل الصحيح الوحيد.`
        : '';

      const discussionGuidelines = isDiscussion
        ? `\nملاحظات مهمة لأسئلة النقاش والتفاعل في التعليقات:
- المطلوب أسئلة نقاشية / «لو خُيّرت» / «ما رأيك» تحفّز المشاهدين على النقاش وكتابة اختياراتهم في التعليقات، وتجنب تماماً الأسئلة المستهلكة المكررة (مثل المال أم السعادة أو السفر للماضي أم المستقبل).
- نوّع الموضوعات بين: العمل، الصداقة، التقنية، العائلة، اتخاذ القرارات، الطموح، العادات اليومية، والمواقف المحيّرة.
- اجعل الخيارات الأربعة (أو الطرفين في VS) تمثل اختيارات/آراء واضحة ومتقاربة القوة تدفع كل شخص لاختيار موقف والدفاع عنه في التعليقات.
- اجعل explanationText عبارة قصيرة مشوقة تدعو المشاهد لكتابة رأيه وسببه في التعليقات.`
        : '';

      const angleHint =
        CREATIVE_VARIETY_ANGLES[Math.floor(Math.random() * CREATIVE_VARIETY_ANGLES.length)];
      const varietySeed = Math.floor(10000 + Math.random() * 90000);
      const avoidBlock =
        cleanAvoidList.length > 0
          ? `\n\nتنبيه صارم — ممنوع تكرار أو إعادة صياغة أي من الأسئلة التالية التي طُرحت سابقاً:\n${cleanAvoidList
              .map((q, i) => `${i + 1}. ${q}`)
              .join('\n')}\nابتكر أسئلة جديدة ومختلفة كلياً عن القائمة أعلاه.`
          : '';
      const diversityDirective = `${categoryDirective}\nزاوية التنويع المطلوبة لهذا الطلب (#${varietySeed}): ${angleHint}.${avoidBlock}`;

      const promptText = isTrueFalse
        ? `الموضوع أو الفكرة المطلوبة: "${cleanTopic}"
عدد الأسئلة المطلوبة: ${requestCount}
مستوى الصعوبة: ${diffLabel}
${diversityDirective}

أنشئ ${requestCount} سؤالاً مختلفاً بنمط (صح أم خطأ) باللغة العربية الفصحى السلسة والمناسبة لفيديوهات الأسئلة.
أرجع مصفوفة JSON فقط (JSON Array) بدون أي نص إضافي خارج JSON، بحيث يحتوي كل عنصر على:
- badgeText: عنوان قصير للشارة العلوية (مثال: صح أم خطأ · سؤال 1)
- question: جملة خبرية أو سؤال قصير مشوق يحتمل الصواب أو الخطأ (أقل من 16 كلمة)
- options: مصفوفة تحتوي خيارين بالضبط هما ["صح", "خطأ"]
- correctIndex: 0 إذا كانت العبارة صحيحة، أو 1 إذا كانت خاطئة (نوّع بين 0 و 1)
- explanationText: تصحيح أو توضيح قصير جداً (أقل من 12 كلمة)`
        : isClues
          ? `الموضوع أو الفكرة المطلوبة: "${cleanTopic}"
عدد الألغاز المطلوبة: ${requestCount}
مستوى الصعوبة: ${diffLabel}
${diversityDirective}

أنشئ ${requestCount} لغزاً مختلفاً بنمط (3 تلميحات / من أنا؟) باللغة العربية الفصحى المشوقة والمناسبة لفيديوهات يوتيوب شورتس.
أرجع مصفوفة JSON فقط (JSON Array) بدون أي نص إضافي خارج JSON، بحيث يحتوي كل عنصر على:
- badgeText: عنوان قصير للشارة العلوية (مثال: 3 تلميحات · لغز 1)
- question: سؤال قصير ومشوق (مثال: من أنا؟ أو ما هي هذه الدولة؟ أو من هذا العالم؟ - أقل من 10 كلمات)
- options: مصفوفة من 4 عناصر نصية بالضبط بهذا الترتيب:
  * العنصر [0]: التلميح الأول (غريب أو غير مباشر وقصير، أقل من 10 كلمات)
  * العنصر [1]: التلميح الثاني (أقرب قليلاً للحل وقصير، أقل من 10 كلمات)
  * العنصر [2]: التلميح الثالث (تلميح واضح يكاد يكشف الحل، أقل من 10 كلمات)
  * العنصر [3]: الإجابة الصحيحة النهائية (كلمة أو كلمتان فقط، بدون شرح)
- correctIndex: دائماً الرقم 3
- explanationText: حقيقة سريعة ومدهشة عن الإجابة (أقل من 12 كلمة)`
          : isVersus
            ? `الموضوع أو الفكرة المطلوبة: "${cleanTopic}"
عدد المقارنات المطلوبة: ${requestCount}
مستوى الصعوبة: ${diffLabel}
${discussionGuidelines}
${diversityDirective}

أنشئ ${requestCount} تحدياً مختلفاً بنمط (مقارنة VS بين طرفين) باللغة العربية الفصحى السلسة والمناسبة لفيديوهات الشورتس.
أرجع مصفوفة JSON فقط (JSON Array) بدون أي نص إضافي خارج JSON، بحيث يحتوي كل عنصر على:
- badgeText: عنوان قصير للشارة العلوية (مثال: مقارنة VS · تحدي 1)
- question: سؤال مقارنة قصير ومباشر (مثال: أيهما أكبر مساحة؟ أو أيهما أسرع؟ أو أيهما تفضل؟ - أقل من 12 كلمة)
- options: مصفوفة تحتوي اسمَي الطرفين المتنافسين بالضبط (اسمان قصيران واضحان، مثل ["المشتري", "زحل"])
- correctIndex: 0 إذا كان الطرف الأول هو الصحيح/الأقوى/الأكثر اختياراً، أو 1 إذا كان الطرف الثاني (نوّع بين 0 و 1)
- explanationText: معلومة رقمية أو سبب سريع للفوز أو دعوة للنقاش (أقل من 12 كلمة)`
            : isMultiple3
              ? `الموضوع أو الفكرة المطلوبة: "${cleanTopic}"
عدد الأسئلة المطلوبة: ${requestCount}
مستوى الصعوبة: ${diffLabel}
${mathGuidelines}
${discussionGuidelines}
${diversityDirective}

أنشئ ${requestCount} سؤالاً مختلفاً ومتنوعاً بنمط (3 خيارات فقط) باللغة العربية الفصحى السلسة والمناسبة لفيديوهات الأسئلة.
أرجع مصفوفة JSON فقط (JSON Array) بدون أي نص إضافي خارج JSON، بحيث يحتوي كل عنصر على:
- badgeText: عنوان قصير للشارة العلوية (مثال: تحدي المعلومات · سؤال 1)
- question: نص السؤال القصير والمشوق (أقل من 15 كلمة)
- options: مصفوفة من 3 خيارات نصية قصيرة بالضبط
- correctIndex: رقم صحيح من 0 إلى 2 يمثل الإجابة الصحيحة
- explanationText: توضيح قصير جداً للإجابة (أقل من 12 كلمة)`
              : `الموضوع أو الفكرة المطلوبة: "${cleanTopic}"
عدد الأسئلة المطلوبة: ${requestCount}
مستوى الصعوبة: ${diffLabel}
${mathGuidelines}
${discussionGuidelines}
${diversityDirective}

أنشئ ${requestCount} سؤالاً مختلفاً ومتنوعاً باللغة العربية الفصحى السلسة والمناسبة لفيديوهات الأسئلة.
أرجع مصفوفة JSON فقط (JSON Array) بدون أي نص إضافي خارج JSON، بحيث يحتوي كل عنصر على:
- badgeText: عنوان قصير للشارة العلوية (مثال: تحدي المعلومات · سؤال 1)
- question: نص السؤال القصير والمشوق (أقل من 15 كلمة)
- options: مصفوفة من 4 خيارات نصية قصيرة بالضبط
- correctIndex: رقم صحيح من 0 إلى 3 يمثل الإجابة الصحيحة
- explanationText: توضيح قصير جداً للإجابة (أقل من 12 كلمة)`;

      type RawQuizItem = {
        badgeText?: string;
        question?: string;
        options?: string[];
        correctIndex?: number;
        explanationText?: string;
      };

      const quizSystemInstruction =
        'أنت خبير في إعداد أسئلة المسابقات والنقاشات التفاعلية والتحديات والرياضيات لفيديوهات يوتيوب باللغة العربية. التزم بالدقة والابتكار وتجنب تكرار الأسئلة المستهلكة والاختصار الواضح.';

      const externalQuizPrompt = `${promptText}

تنسيق الإرجاع المطلوب (JSON Object فقط بدون أي نص أو شرح إضافي):
{
  "slides": [
    {
      "badgeText": "...",
      "question": "...",
      "options": ["..."],
      "correctIndex": 0,
      "explanationText": "..."
    }
  ]
}`;

      const minOpts = isTrueFalse || isVersus ? 2 : isMultiple3 ? 3 : 4;

      const { data: normalized, provider: usedProvider, model: usedModel } =
        await runTextJsonAcrossProviders({
          geminiTask: async (ai, model) => {
            const response = await ai.models.generateContent({
              model,
              contents: promptText,
              config: {
                temperature: isMath ? 0.85 : 1.05,
                thinkingConfig: {
                  thinkingLevel:
                    model === 'gemini-3.1-flash-lite'
                      ? ThinkingLevel.MINIMAL
                      : ThinkingLevel.LOW,
                },
                systemInstruction: quizSystemInstruction,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      badgeText: {
                        type: Type.STRING,
                        description: 'عنوان قصير للشارة العلوية مثل: تحدي المعلومات · سؤال 1',
                      },
                      question: {
                        type: Type.STRING,
                        description: 'نص السؤال باللغة العربية واضح ومختصر',
                      },
                      options: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'مصفوفة الخيارات أو التلميحات أو طرفي المقارنة',
                      },
                      correctIndex: {
                        type: Type.INTEGER,
                        description: 'رقم فهرس الإجابة الصحيحة',
                      },
                      explanationText: {
                        type: Type.STRING,
                        description: 'توضيح مختصر جداً للإجابة الصحيحة',
                      },
                    },
                    required: ['badgeText', 'question', 'options', 'correctIndex', 'explanationText'],
                  },
                },
              },
            });
            return response.text ?? '[]';
          },
          externalSystemInstruction: quizSystemInstruction,
          externalUserPrompt: externalQuizPrompt,
          parseAndValidate: (payload) => {
            const rawArray: RawQuizItem[] = Array.isArray(payload)
              ? (payload as RawQuizItem[])
              : payload && typeof payload === 'object'
                ? ((
                    (payload as { slides?: unknown; questions?: unknown; items?: unknown })
                      .slides ??
                    (payload as { questions?: unknown }).questions ??
                    (payload as { items?: unknown }).items ??
                    []
                  ) as RawQuizItem[])
                : [];

            const validRaw = rawArray.filter(
              (item) =>
                item &&
                item.question &&
                Array.isArray(item.options) &&
                item.options.length >= minOpts
            );

            const seenInBatch = new Set(avoidNormalizedSet);
            const uniqueCandidates: RawQuizItem[] = [];
            const fallbackCandidates: RawQuizItem[] = [];

            for (const item of validRaw) {
              const qText = String(item.question || '').trim();
              if (!isDuplicateQuestion(qText, seenInBatch)) {
                uniqueCandidates.push(item);
                seenInBatch.add(normalizeQuestionForDedup(qText));
              } else {
                fallbackCandidates.push(item);
              }
            }

            const chosenRaw = [...uniqueCandidates, ...fallbackCandidates].slice(0, safeCount);

            const items = chosenRaw.map((item, idx) => {
                if (isTrueFalse) {
                  const rawIdx = Number(item.correctIndex);
                  const cIdx = (rawIdx === 1 ? 1 : 0) as 0 | 1;
                  const o0 = String(item.options?.[0] ?? 'صح').trim() || 'صح';
                  const o1 = String(item.options?.[1] ?? 'خطأ').trim() || 'خطأ';
                  return {
                    id: `ai-slide-${Date.now()}-${idx}`,
                    slideType: 'trueFalse' as const,
                    category: safeCategory,
                    badgeText: (item.badgeText ?? `صح أم خطأ · ${idx + 1}`).trim(),
                    question: item.question!.trim(),
                    options: [o0, o1, '', ''] as [string, string, string, string],
                    correctIndex: cIdx,
                    explanationText: (item.explanationText ?? '').trim(),
                  };
                }

                if (isVersus) {
                  const rawIdx = Number(item.correctIndex);
                  const cIdx = (rawIdx === 1 ? 1 : 0) as 0 | 1;
                  const o0 = String(item.options?.[0] ?? 'الطرف الأول').trim() || 'الطرف الأول';
                  const o1 = String(item.options?.[1] ?? 'الطرف الثاني').trim() || 'الطرف الثاني';
                  return {
                    id: `ai-slide-${Date.now()}-${idx}`,
                    slideType: 'versus' as const,
                    category: safeCategory,
                    badgeText: (item.badgeText ?? `مقارنة VS · ${idx + 1}`).trim(),
                    question: item.question!.trim(),
                    options: [o0, o1, '', ''] as [string, string, string, string],
                    correctIndex: cIdx,
                    explanationText: (item.explanationText ?? '').trim(),
                  };
                }

                if (isClues) {
                  const opts = item.options!.slice(0, 4).map((o) => String(o).trim()) as [
                    string,
                    string,
                    string,
                    string,
                  ];
                  return {
                    id: `ai-slide-${Date.now()}-${idx}`,
                    slideType: 'clues' as const,
                    category: safeCategory,
                    badgeText: (item.badgeText ?? `3 تلميحات · ${idx + 1}`).trim(),
                    question: item.question!.trim(),
                    options: opts,
                    correctIndex: 3 as const,
                    explanationText: (item.explanationText ?? '').trim(),
                  };
                }

                if (isMultiple3) {
                  const raw3 = item.options!.slice(0, 3).map((o) => String(o).trim());
                  const opts: [string, string, string, string] = [
                    raw3[0] || 'خيار 1',
                    raw3[1] || 'خيار 2',
                    raw3[2] || 'خيار 3',
                    '',
                  ];
                  const numIdx = Number(item.correctIndex);
                  const cIdx = Math.max(
                    0,
                    Math.min(2, Math.round(Number.isFinite(numIdx) ? numIdx : 0))
                  ) as 0 | 1 | 2;
                  return {
                    id: `ai-slide-${Date.now()}-${idx}`,
                    slideType: 'multiple3' as const,
                    category: safeCategory,
                    badgeText: (item.badgeText ?? `السؤال ${idx + 1}`).trim(),
                    question: item.question!.trim(),
                    options: opts,
                    correctIndex: cIdx,
                    explanationText: (item.explanationText ?? '').trim(),
                  };
                }

                const opts = item.options!.slice(0, 4).map((o) => String(o).trim()) as [
                  string,
                  string,
                  string,
                  string,
                ];
                const numIdx = Number(item.correctIndex);
                const cIdx = Math.max(
                  0,
                  Math.min(3, Math.round(Number.isFinite(numIdx) ? numIdx : 0))
                ) as 0 | 1 | 2 | 3;
                return {
                  id: `ai-slide-${Date.now()}-${idx}`,
                  slideType: 'multiple' as const,
                  category: safeCategory,
                  badgeText: (item.badgeText ?? `السؤال ${idx + 1}`).trim(),
                  question: item.question!.trim(),
                  options: opts,
                  correctIndex: cIdx,
                  explanationText: (item.explanationText ?? '').trim(),
                };
              });

            if (items.length === 0) {
              throw new Error(
                'لم يتمكن الذكاء الاصطناعي من توليد أسئلة صالحة، حاول صياغة الفكرة بشكل أوضح.'
              );
            }
            return items;
          },
        });

      res.json({ slides: normalized, provider: usedProvider, model: usedModel });
    } catch (err) {
      const formatted = formatGeminiError(err, 'text');
      res.status(formatted.status).json({
        error: formatted.message,
        quotaExhausted: formatted.quotaExhausted,
      });
    }
  });

  // Consult AI to plan a diverse question bank (e.g., 100 or 200 questions split across subtopics)
  app.post('/api/ai/advise-bank', async (req, res) => {
    try {
      const { categoryLabel, targetCount, userMessage, existingSubtopics } = req.body as {
        categoryLabel?: string;
        targetCount?: number;
        userMessage?: string;
        existingSubtopics?: string[];
      };

      const safeTarget = Math.max(10, Math.min(500, Math.round(Number(targetCount) || 100)));
      const cleanCat = (categoryLabel || 'ثقافة عامة').trim();
      const cleanMsg = (userMessage || '').trim() || `أريد تجهيز ${safeTarget} سؤال متنوع في مجال ${cleanCat}`;
      const prevTopics = Array.isArray(existingSubtopics) ? existingSubtopics.slice(0, 12).join('، ') : '';

      const advisePrompt = `أنت مستشار محتوى لقنوات يوتيوب شورتس العربية.
المستخدم يريد بناء بنك ذاكرة كبير (${safeTarget} سؤال) في مجال: "${cleanCat}".
رسالة المستخدم: "${cleanMsg}"
${prevTopics ? `المحاور المقترحة مسبقاً: ${prevTopics}` : ''}

استشر المستخدم بأسلوب ودي مختصر (3-4 جمل) واقترح عليه خطة عملية تتضمن 6 إلى 8 محاور فرعية متنوعة ومحددة تضمن عدم تكرار الأسئلة عند توليد ${safeTarget} سؤالاً.
أرجع JSON فقط بالشكل التالي:
{
  "reply": "رد استشاري مختصر بالعربية يخاطب المستخدم ويقترح الخطة ويسأله إن كان يوافق أو يحب تعديلها",
  "subtopics": ["محور فرعي 1", "محور فرعي 2", "محور فرعي 3", "محور فرعي 4", "محور فرعي 5", "محور فرعي 6"]
}`;

      const sysInst =
        'أنت مستشار تخطيط محتوى مسابقات عربية على يوتيوب شورتس. ردودك عملية وواضحة ومختصرة.';

      const { data: plan } = await runTextJsonAcrossProviders({
        geminiTask: async (ai, model) => {
          const response = await ai.models.generateContent({
            model,
            contents: advisePrompt,
            config: {
              temperature: 0.9,
              thinkingConfig: {
                thinkingLevel:
                  model === 'gemini-3.1-flash-lite'
                    ? ThinkingLevel.MINIMAL
                    : ThinkingLevel.LOW,
              },
              systemInstruction: sysInst,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  reply: { type: Type.STRING },
                  subtopics: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['reply', 'subtopics'],
              },
            },
          });
          return response.text ?? '{}';
        },
        externalSystemInstruction: sysInst,
        externalUserPrompt: advisePrompt,
        parseAndValidate: (payload) => {
          const obj = (payload && typeof payload === 'object' ? payload : {}) as {
            reply?: unknown;
            subtopics?: unknown;
          };
          const reply =
            typeof obj.reply === 'string' && obj.reply.trim()
              ? obj.reply.trim()
              : `أقترح تقسيم الـ ${safeTarget} سؤالاً في "${cleanCat}" إلى هذه المحاور المتنوعة لضمان عدم التكرار. هل نبدأ التوليد الآن أم تحب تعديل المحاور؟`;
          const subtopics = Array.isArray(obj.subtopics)
            ? obj.subtopics
                .map((s) => (typeof s === 'string' ? s.trim() : ''))
                .filter(Boolean)
                .slice(0, 10)
            : [];
          return { reply, subtopics };
        },
      });

      res.json(plan);
    } catch (err) {
      const formatted = formatGeminiError(err, 'text');
      res.status(formatted.status).json({
        error: formatted.message,
        quotaExhausted: formatted.quotaExhausted,
      });
    }
  });

  // Generate Arabic TTS Voiceover WAV via Gemini 3.8 Flash Lite TTS
  app.post('/api/ai/tts', async (req, res) => {
    try {
      const { text, voiceName, style } = req.body as {
        text?: string;
        voiceName?: string;
        style?: string;
      };

      const rawText = (text ?? '').trim();
      const cleanText = normalizeLatexToSpokenArabic(rawText) || rawText;
      if (!cleanText) {
        res.status(400).json({ error: 'النص المطلوب تحويله إلى صوت فارغ.' });
        return;
      }

      const allowedVoices = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];
      const chosenVoice = allowedVoices.includes(voiceName ?? '') ? voiceName! : 'Kore';

      const response = await runWithModelFallback(
        'tts',
        ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'],
        (ai, model) =>
          ai.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: cleanText,
                    speechMetadata: {
                      style:
                        style ||
                        'Clear, natural, articulate Modern Standard Arabic quiz presenter; read only the exact provided text cleanly without extra words',
                    },
                  },
                ],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: chosenVoice,
                  },
                },
              },
            },
          })
      );

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const audioPart = parts.find((p) => p.inlineData?.data);
      const base64Audio = audioPart?.inlineData?.data;
      const mimeType = audioPart?.inlineData?.mimeType || 'audio/wav';

      if (!base64Audio) {
        res.status(500).json({ error: 'تعذر توليد الصوت من النموذج حالياً.' });
        return;
      }

      // If model returns raw L16 PCM, wrap it in a standard 24kHz mono 16-bit WAV header
      let finalDataUrl = `data:${mimeType};base64,${base64Audio}`;
      if (mimeType.includes('L16') || mimeType.includes('pcm')) {
        const pcmBuf = Buffer.from(base64Audio, 'base64');
        const rateMatch = mimeType.match(/rate=(\d+)/);
        const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
        const wavHeader = Buffer.alloc(44);
        wavHeader.write('RIFF', 0);
        wavHeader.writeUInt32LE(36 + pcmBuf.length, 4);
        wavHeader.write('WAVE', 8);
        wavHeader.write('fmt ', 12);
        wavHeader.writeUInt32LE(16, 16); // PCM chunk size
        wavHeader.writeUInt16LE(1, 20); // PCM format
        wavHeader.writeUInt16LE(1, 22); // Mono
        wavHeader.writeUInt32LE(sampleRate, 24);
        wavHeader.writeUInt32LE(sampleRate * 2, 28); // Byte rate
        wavHeader.writeUInt16LE(2, 32); // Block align
        wavHeader.writeUInt16LE(16, 34); // Bits per sample
        wavHeader.write('data', 36);
        wavHeader.writeUInt32LE(pcmBuf.length, 40);
        const wavBase64 = Buffer.concat([wavHeader, pcmBuf]).toString('base64');
        finalDataUrl = `data:audio/wav;base64,${wavBase64}`;
      }

      res.json({
        dataUrl: finalDataUrl,
        quota: getTtsQuotaSnapshot(),
      });
    } catch (err) {
      const formatted = formatGeminiError(err, 'tts');
      res.status(formatted.status).json({
        error: formatted.message,
        quotaExhausted: formatted.quotaExhausted,
        quota: getTtsQuotaSnapshot(),
      });
    }
  });

  // Generate AI YouTube Publishing Kit (Title, Description, Hashtags, Tags, Pinned Comment)
  app.post('/api/ai/generate-publish-kit', async (req, res) => {
    try {
      const { questions, aspectRatio, hookText } = req.body as {
        questions?: Array<{
          question?: string;
          options?: string[];
          correctIndex?: number;
          explanationText?: string;
        }>;
        aspectRatio?: '9:16' | '16:9';
        hookText?: string;
      };

      const validQuestions = Array.isArray(questions)
        ? questions.filter((q) => (q?.question ?? '').trim().length > 0).slice(0, 15)
        : [];
      if (validQuestions.length === 0) {
        res.status(400).json({ error: 'لا توجد أسئلة لتوليد بيانات النشر لها.' });
        return;
      }

      const isShorts = aspectRatio !== '16:9';
      const summaryLines = validQuestions
        .map((q, i) => {
          const opts = Array.isArray(q.options) ? q.options.filter(Boolean).join(' / ') : '';
          return `${i + 1}) ${String(q.question).trim()}${opts ? ` [${opts}]` : ''}`;
        })
        .join('\n');

      const promptText = `لدينا فيديو مسابقة أسئلة باللغة العربية بصيغة ${isShorts ? 'YouTube Shorts (عمودي 9:16)' : 'YouTube أفقي (16:9)'}.
${hookText?.trim() ? `عبارة البداية (Hook): ${hookText.trim()}\n` : ''}الأسئلة الموجودة في الفيديو:
${summaryLines}

المطلوب إنشاء حزمة نشر احترافية باللغة العربية تزيد نسبة النقر والتعليقات على يوتيوب، بصيغة JSON فقط تحتوي الحقول التالية:
- title: عنوان جذاب ومشوق (أقل من 65 حرفاً${isShorts ? '، مع إضافة #Shorts في نهايته' : ''})
- description: وصف متكامل وجذاب للجمهور يوضح التحدي ويدعو للاشتراك والتفاعل، مع تضمين الهاشتاغات المناسبة في نهايته
- hashtags: مصفوفة من 5 إلى 8 هاشتاغات عربية وإنجليزية مناسبة تبدأ بـ # (مثل #شورتس #أسئلة #تحدي)
- tags: مصفوفة من 8 إلى 12 كلمة مفتاحية قوية للبحث في يوتيوب بدون علامة #
- pinnedComment: تعليق تفاعلي قصير وممتع جاهز للتثبيت تحت الفيديو يدفع المشاهدين لكتابة نتيجتهم في التعليقات`;

      const kitSystemInstruction =
        'أنت خبير سيو يوتيوب وصناعة محتوى شورتس المسابقات باللغة العربية. اكتب عناوين عالية النقر بدون حشو، وأوصافاً طبيعية، وتعليقات تفاعلية ذكية.';

      const { data: kitData, provider: usedProvider } = await runTextJsonAcrossProviders({
        geminiTask: async (ai, model) => {
          const response = await ai.models.generateContent({
            model,
            contents: promptText,
            config: {
              thinkingConfig: {
                thinkingLevel:
                  model === 'gemini-3.1-flash-lite'
                    ? ThinkingLevel.MINIMAL
                    : ThinkingLevel.LOW,
              },
              systemInstruction: kitSystemInstruction,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                  tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                  pinnedComment: { type: Type.STRING },
                },
                required: ['title', 'description', 'hashtags', 'tags', 'pinnedComment'],
              },
            },
          });
          return response.text ?? '{}';
        },
        externalSystemInstruction: kitSystemInstruction,
        externalUserPrompt: `${promptText}\n\nأرجع JSON Object صالح فقط بالحقول: title, description, hashtags, tags, pinnedComment.`,
        parseAndValidate: (payload) => {
          const parsed = (payload && typeof payload === 'object' ? payload : {}) as {
            title?: string;
            description?: string;
            hashtags?: string[];
            tags?: string[];
            pinnedComment?: string;
          };
          if (!parsed.title && !parsed.description) {
            throw new Error('استجابة حزمة النشر غير مكتملة.');
          }
          const hashtags = Array.isArray(parsed.hashtags)
            ? parsed.hashtags
                .map((h) => String(h).trim())
                .filter(Boolean)
                .map((h) => (h.startsWith('#') ? h : `#${h.replace(/\s+/g, '_')}`))
                .slice(0, 10)
            : [];
          const tags = Array.isArray(parsed.tags)
            ? parsed.tags
                .map((t) => String(t).replace(/^#/, '').trim())
                .filter(Boolean)
                .slice(0, 15)
            : [];
          return {
            title: (parsed.title || 'اختبر ذكاءك في هذا التحدي! #Shorts').trim().slice(0, 100),
            description: (parsed.description || '').trim(),
            hashtags,
            tags,
            pinnedComment: (
              parsed.pinnedComment || 'كم إجابة صحيحة جبت؟ اكتب نتيجتك في التعليقات 👇'
            ).trim(),
          };
        },
      });

      res.json({
        ...kitData,
        provider: usedProvider,
      });
    } catch (err) {
      const formatted = formatGeminiError(err, 'text');
      res.status(formatted.status).json({
        error: formatted.message,
        quotaExhausted: formatted.quotaExhausted,
      });
    }
  });

  const sanitizeSvgPayload = (rawSvg: string): string => {
    const cleaned = String(rawSvg || '')
      .replace(/<\?xml[\s\S]*?\?>/gi, '')
      .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(?:xlink:)?href\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '')
      .trim();
    const match = cleaned.match(/<svg[\s\S]*<\/svg>/i);
    return match ? match[0] : '';
  };

  app.post('/api/ai/generate-puzzle-svg', async (req, res) => {
    try {
      const { question, categoryLabel, hint } = req.body as {
        question?: string;
        categoryLabel?: string;
        hint?: string;
      };
      const cleanQuestion = String(question || '').trim();
      if (!cleanQuestion) {
        res.status(400).json({ error: 'يرجى كتابة نص السؤال أولاً لتوليد رسم اللغز.' });
        return;
      }

      const svgSystemInstruction =
        'You are an expert flat-vector geometric illustrator. Output valid JSON with a clean, colorful, recognizable <svg viewBox="0 0 600 450" xmlns="http://www.w3.org/2000/svg"> illustration representing the quiz subject without revealing the answer as written text.';

      const svgUserPrompt = `Quiz Question (Arabic): ${cleanQuestion}
${categoryLabel ? `Category: ${String(categoryLabel).trim()}\n` : ''}${hint ? `Visual clue hint: ${String(hint).trim()}\n` : ''}
Create a vivid, high-contrast vector illustration SVG (viewBox="0 0 600 450") for a blurred-image mystery quiz card:
- Start with a rich multi-stop <defs><linearGradient> background covering the 600x450 canvas.
- Draw 6 to 15 clean geometric shapes (<circle>, <rect>, <path>, <polygon>, <ellipse>) with strong distinct colors, shadows, or metallic highlights depicting the main subject of the question cleanly.
- STRICT RULE: NEVER include any <text> or <tspan> or written words/letters/numbers inside the SVG so the viewer isn't spoiled.
- NEVER include <script>, event attributes, or external URLs.
Return JSON object with fields:
- svg: the complete <svg viewBox="0 0 600 450" xmlns="http://www.w3.org/2000/svg">...</svg> string
- title: brief 2-4 word Arabic description of the artwork`;

      const { data: svgResult, provider: usedProvider } = await runTextJsonAcrossProviders({
        geminiTask: async (ai, model) => {
          const response = await ai.models.generateContent({
            model,
            contents: svgUserPrompt,
            config: {
              thinkingConfig: {
                thinkingLevel:
                  model === 'gemini-3.1-flash-lite'
                    ? ThinkingLevel.MINIMAL
                    : ThinkingLevel.LOW,
              },
              systemInstruction: svgSystemInstruction,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  svg: { type: Type.STRING },
                  title: { type: Type.STRING },
                },
                required: ['svg', 'title'],
              },
            },
          });
          return response.text ?? '{}';
        },
        externalSystemInstruction: svgSystemInstruction,
        externalUserPrompt: `${svgUserPrompt}\n\nReturn ONLY valid JSON: {"svg": "<svg ...>...</svg>", "title": "..."}`,
        parseAndValidate: (payload) => {
          const parsed = (payload && typeof payload === 'object' ? payload : {}) as {
            svg?: string;
            title?: string;
          };
          const safeSvg = sanitizeSvgPayload(parsed.svg || '');
          if (!safeSvg) {
            throw new Error('لم يكتمل رسم الشكل التوضيحي.');
          }
          return {
            svg: safeSvg,
            title: String(parsed.title || 'صورة لغز بالذكاء').trim().slice(0, 60),
          };
        },
      });

      res.json({
        svg: svgResult.svg,
        title: svgResult.title,
        provider: usedProvider,
      });
    } catch (err) {
      const formatted = formatGeminiError(err, 'text');
      res.status(formatted.status).json({
        error: formatted.message,
        quotaExhausted: formatted.quotaExhausted,
      });
    }
  });

  // ============================================================================
  // AI Presenter (Tavus API v2 — Free Developer Plan, Recurring Monthly Quota)
  // ============================================================================
  const getTavusApiKeys = (): string[] =>
    collectKeysFromEnvNames(['TAVUS_API_KEY', 'TAVUS_API_KEYS']).filter(
      (k) => k !== 'MY_TAVUS_API_KEY' && k.length >= 12
    );

  const isPrivateOrLocalHostname = (hostname: string): boolean => {
    const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!h) return true;
    if (
      h === 'localhost' ||
      h.endsWith('.localhost') ||
      h.endsWith('.local') ||
      h.endsWith('.internal') ||
      h === '0.0.0.0' ||
      h === '::' ||
      h === '::1' ||
      h.startsWith('fe80:') ||
      h.startsWith('fc') ||
      h.startsWith('fd')
    ) {
      return true;
    }
    const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a >= 224
      ) {
        return true;
      }
    }
    return false;
  };

  const isAllowedMediaProxyUrl = (rawUrl: string): URL | null => {
    try {
      const parsed = new URL(rawUrl.trim());
      if (parsed.protocol !== 'https:') return null;
      const host = parsed.hostname.toLowerCase();
      if (isPrivateOrLocalHostname(host)) return null;
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return null;

      const allowedSuffixes = [
        'tavus.io',
        'tavusapi.com',
        'cloudfront.net',
        'amazonaws.com',
        'storage.googleapis.com',
      ];
      const ok = allowedSuffixes.some(
        (suffix) => host === suffix || host.endsWith(`.${suffix}`)
      );
      return ok ? parsed : null;
    } catch {
      return null;
    }
  };

  const isPublicHttpsUrl = (rawUrl: string): URL | null => {
    try {
      const parsed = new URL(rawUrl.trim());
      if (parsed.protocol !== 'https:') return null;
      const host = parsed.hostname.toLowerCase();
      if (isPrivateOrLocalHostname(host)) return null;
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const getPublicHttpsAppBase = (): string | null => {
    const raw = (process.env.APP_URL || '').trim().replace(/\/$/, '');
    if (!raw || raw === 'MY_APP_URL') return null;
    const parsed = isPublicHttpsUrl(raw);
    return parsed ? parsed.origin : null;
  };

  let appReachableCache: { base: string; reachable: boolean; checkedAt: number } | null = null;
  const checkAppUrlExternallyReachable = async (publicBase: string | null): Promise<boolean> => {
    if (!publicBase) return false;
    const now = Date.now();
    if (
      appReachableCache &&
      appReachableCache.base === publicBase &&
      now - appReachableCache.checkedAt < 60_000
    ) {
      return appReachableCache.reachable;
    }
    let reachable = false;
    try {
      const probe = await withTimeout(
        fetch(`${publicBase}/api/ai-presenter/public-ping`, {
          method: 'GET',
          redirect: 'manual',
        }),
        2500,
        'public-ping probe'
      );
      const ct = (probe.headers.get('content-type') || '').toLowerCase();
      if (probe.status === 200 && ct.includes('application/json')) {
        const j = (await probe.json().catch(() => null)) as { ok?: boolean } | null;
        reachable = Boolean(j?.ok);
      }
    } catch {
      reachable = false;
    }
    appReachableCache = { base: publicBase, reachable, checkedAt: now };
    return reachable;
  };

  const tempAudioStore = new Map<
    string,
    { buffer: Buffer; mimeType: string; expiresAt: number }
  >();
  const purgeExpiredTempAudio = () => {
    const now = Date.now();
    for (const [k, v] of tempAudioStore.entries()) {
      if (v.expiresAt <= now) tempAudioStore.delete(k);
    }
  };

  const formatTavusHttpError = (status: number, bodyText: string): { status: number; error: string; missingKey?: boolean; quotaExhausted?: boolean } => {
    let detail = '';
    try {
      const parsed = JSON.parse(bodyText) as { message?: string; error?: string; detail?: string };
      detail = parsed.message || parsed.error || parsed.detail || '';
    } catch {
      detail = bodyText.slice(0, 220);
    }

    if (status === 401 || status === 403) {
      return {
        status: 401,
        error: `مفتاح TAVUS_API_KEY غير صالح أو غير مفعّل (${status}). تأكد من نسخه بشكل صحيح من platform.tavus.io في Settings > Secrets.`,
      };
    }
    if (status === 402 || status === 429) {
      return {
        status: 429,
        quotaExhausted: true,
        error:
          'تم استهلاك الرصيد المجاني الشهري أو تجاوز حد الطلبات المؤقت في Tavus. يتجدد الرصيد المجاني شهرياً تلقائياً بدون بطاقة.',
      };
    }
    return {
      status: status >= 400 && status < 500 ? status : 502,
      error: detail
        ? `خطأ من خادم Tavus (${status}): ${detail}`
        : `تعذر إتمام الطلب من خادم Tavus (${status}).`,
    };
  };

  const tempBgStore = new Map<
    string,
    { buffer: Buffer; mimeType: string; expiresAt: number }
  >();
  const purgeExpiredTempBg = () => {
    const now = Date.now();
    for (const [k, v] of tempBgStore.entries()) {
      if (v.expiresAt <= now) tempBgStore.delete(k);
    }
  };

  const buildSolidColorPngBuffer = (hexInput: string): Buffer | null => {
    let hex = hexInput.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    const width = 64;
    const height = 64;
    const stride = 1 + width * 3;
    const raw = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
      const rowStart = y * stride;
      raw[rowStart] = 0; // filter type None
      for (let x = 0; x < width; x++) {
        const px = rowStart + 1 + x * 3;
        raw[px] = r;
        raw[px + 1] = g;
        raw[px + 2] = b;
      }
    }

    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crcTable[n] = c >>> 0;
    }
    const crc32 = (buf: Buffer): number => {
      let c = 0xffffffff;
      for (let i = 0; i < buf.length; i++) {
        c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
      }
      return (c ^ 0xffffffff) >>> 0;
    };
    const makeChunk = (type: string, data: Buffer): Buffer => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length, 0);
      const typeBuf = Buffer.from(type, 'ascii');
      const crcInput = Buffer.concat([typeBuf, data]);
      const crcBuf = Buffer.alloc(4);
      crcBuf.writeUInt32BE(crc32(crcInput), 0);
      return Buffer.concat([len, typeBuf, data, crcBuf]);
    };

    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const idat = zlib.deflateSync(raw);
    return Buffer.concat([
      sig,
      makeChunk('IHDR', ihdr),
      makeChunk('IDAT', idat),
      makeChunk('IEND', Buffer.alloc(0)),
    ]);
  };

  app.get('/api/ai-presenter/public-ping', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, service: 'ai-presenter' });
  });

  app.get('/api/ai-presenter/status', async (_req, res) => {
    const keys = getTavusApiKeys();
    const publicAppUrl = getPublicHttpsAppBase();
    const canHostPublicMedia = await checkAppUrlExternallyReachable(publicAppUrl);
    res.json({
      ok: true,
      provider: 'tavus',
      providerName: 'Tavus Video API v2',
      configured: keys.length > 0,
      keyCount: keys.length,
      canHostTempAudio: canHostPublicMedia,
      canHostTempMedia: canHostPublicMedia,
      freeTierSummary: {
        planName: 'Tavus Free Developer Plan ($0)',
        renews: 'monthly',
        requiresCreditCard: false,
        autoCharge: false,
        monthlyFreeMinutes: 5,
        stockReplicasIncluded: true,
        supportsTransparentWebm: true,
        supportsArabicScript: true,
        supportsExternalAudioUrl: true,
      },
    });
  });

  app.get('/api/ai-presenter/temp-audio/:token', (req, res) => {
    purgeExpiredTempAudio();
    const token = String(req.params.token || '').trim();
    if (!/^[a-f0-9]{24,64}$/i.test(token)) {
      res.status(404).end();
      return;
    }
    const item = tempAudioStore.get(token);
    if (!item || item.expiresAt <= Date.now()) {
      tempAudioStore.delete(token);
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', item.mimeType);
    res.setHeader('Content-Length', String(item.buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.send(item.buffer);
  });

  app.get('/api/ai-presenter/temp-bg/:token', (req, res) => {
    purgeExpiredTempBg();
    const token = String(req.params.token || '').trim();
    if (!/^[a-f0-9]{24,64}$/i.test(token)) {
      res.status(404).end();
      return;
    }
    const item = tempBgStore.get(token);
    if (!item || item.expiresAt <= Date.now()) {
      tempBgStore.delete(token);
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', item.mimeType);
    res.setHeader('Content-Length', String(item.buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.send(item.buffer);
  });

  app.get('/api/ai-presenter/replicas', async (_req, res) => {
    const keys = getTavusApiKeys();
    if (keys.length === 0) {
      res.status(400).json({
        missingKey: true,
        error:
          'مفتاح TAVUS_API_KEY غير مضاف في Secrets بعد. أنشئ حساباً مجانياً بدون بطاقة على platform.tavus.io وأضف المفتاح في Settings > Secrets.',
      });
      return;
    }

    try {
      const apiRes = await withTimeout(
        fetch('https://tavusapi.com/v2/replicas?verbose=true&limit=100', {
          method: 'GET',
          headers: {
            'x-api-key': keys[0],
            'Content-Type': 'application/json',
          },
        }),
        15_000,
        'Tavus replicas'
      );
      const rawText = await apiRes.text();
      if (!apiRes.ok) {
        const formatted = formatTavusHttpError(apiRes.status, rawText);
        res.status(formatted.status).json(formatted);
        return;
      }

      const payload = JSON.parse(rawText) as {
        data?: Array<{
          replica_id?: string;
          replica_name?: string;
          replica_type?: string;
          status?: string;
          thumbnail_video_url?: string;
          created_at?: string;
        }>;
      };

      const replicas = (Array.isArray(payload.data) ? payload.data : [])
        .filter((r) => typeof r.replica_id === 'string' && r.replica_id.trim())
        .map((r) => {
          const thumbUrl = typeof r.thumbnail_video_url === 'string' ? r.thumbnail_video_url.trim() : '';
          const proxiedThumb =
            thumbUrl && isAllowedMediaProxyUrl(thumbUrl)
              ? `/api/ai-presenter/media?url=${encodeURIComponent(thumbUrl)}`
              : undefined;
          return {
            replicaId: r.replica_id!.trim(),
            replicaName: (r.replica_name || r.replica_id || 'مذيع بشري').trim(),
            replicaType: r.replica_type === 'user' ? 'user' : 'system',
            status: (r.status || 'completed').trim(),
            thumbnailVideoUrl: thumbUrl || undefined,
            proxiedThumbnailUrl: proxiedThumb,
            createdAt: r.created_at,
          };
        })
        .filter((r) => !r.status || r.status.toLowerCase() === 'completed' || r.status.toLowerCase() === 'ready');

      res.json({
        provider: 'tavus',
        replicas,
      });
    } catch (err) {
      res.status(502).json({
        error:
          err instanceof Error
            ? `تعذر جلب الشخصيات الحقيقية من Tavus: ${err.message}`
            : 'تعذر جلب الشخصيات من Tavus.',
      });
    }
  });

  app.post('/api/ai-presenter/generate', async (req, res) => {
    const keys = getTavusApiKeys();
    if (keys.length === 0) {
      res.status(400).json({
        missingKey: true,
        error:
          'مفتاح TAVUS_API_KEY غير مضاف في Secrets بعد. أنشئ حساباً مجانياً بدون بطاقة على platform.tavus.io وأضف TAVUS_API_KEY في Settings > Secrets.',
      });
      return;
    }

    try {
      const body = (req.body || {}) as {
        replica_id?: string;
        script?: string;
        audio_url?: string;
        audio_data_url?: string;
        video_name?: string;
        fast?: boolean;
        transparent_background?: boolean;
        background_url?: string;
        background_mode?: string;
        background_color?: string;
        background_data_url?: string;
        background_settings?: {
          mode?: string;
          transparent_background?: boolean;
          bake_into_video?: boolean;
          color?: string;
          background_url?: string;
        };
      };

      const replicaId = String(body.replica_id || '').trim();
      if (!/^[a-zA-Z0-9_-]{3,80}$/.test(replicaId)) {
        res.status(400).json({ error: 'معرّف الشخصية الحقيقية (replica_id) غير صالح.' });
        return;
      }

      const script = String(body.script || '').trim();
      const rawAudioUrl = String(body.audio_url || '').trim();
      const rawAudioDataUrl = String(body.audio_data_url || '').trim();

      const publicBase = getPublicHttpsAppBase();
      const canHostPublicMedia = await checkAppUrlExternallyReachable(publicBase);

      let resolvedAudioUrl: string | undefined;
      if (rawAudioUrl) {
        const parsedAudio = isPublicHttpsUrl(rawAudioUrl);
        if (!parsedAudio) {
          res.status(400).json({
            error: 'رابط الصوت الخارجي يجب أن يكون رابط HTTPS عاماً وصالحاً (.mp3 أو .wav).',
          });
          return;
        }
        resolvedAudioUrl = parsedAudio.toString();
      } else if (rawAudioDataUrl) {
        if (!publicBase || !canHostPublicMedia) {
          res.status(400).json({
            error:
              'استضافة ملف الصوت المحلي مباشرة لـ Tavus تتطلب نشراً عاماً بدون تسجيل دخول. استخدم «نطق النص» أو أدخل رابط HTTPS عاماً للصوت.',
          });
          return;
        }
        const match = rawAudioDataUrl.match(
          /^data:(audio\/(?:wav|mpeg|mp3|ogg|webm|mp4));base64,([A-Za-z0-9+/=]+)$/i
        );
        if (!match) {
          res.status(400).json({ error: 'صيغة الملف الصوتي المرفوع غير مدعومة.' });
          return;
        }
        const buf = Buffer.from(match[2], 'base64');
        if (buf.length === 0 || buf.length > 9 * 1024 * 1024) {
          res.status(400).json({ error: 'حجم الملف الصوتي يتجاوز الحد المسموح (9MB).' });
          return;
        }
        purgeExpiredTempAudio();
        const token = randomBytes(18).toString('hex');
        const mimeType = match[1].toLowerCase() === 'audio/mp3' ? 'audio/mpeg' : match[1].toLowerCase();
        tempAudioStore.set(token, {
          buffer: buf,
          mimeType,
          expiresAt: Date.now() + 15 * 60_000,
        });
        resolvedAudioUrl = `${publicBase}/api/ai-presenter/temp-audio/${token}`;
      }

      if (!script && !resolvedAudioUrl) {
        res.status(400).json({ error: 'يرجى كتابة النص العربي/الأجنبي أو تزويد رابط صوتي صالح.' });
        return;
      }

      if (script.length > 3500) {
        res.status(400).json({ error: 'النص طويل جداً؛ الحد الأقصى للطلب الواحد 3500 حرف.' });
        return;
      }

      const tavusPayload: Record<string, unknown> = {
        replica_id: replicaId,
      };
      if (resolvedAudioUrl) {
        tavusPayload.audio_url = resolvedAudioUrl;
      } else {
        tavusPayload.script = script;
      }
      if (body.video_name && String(body.video_name).trim()) {
        tavusPayload.video_name = String(body.video_name).trim().slice(0, 120);
      }
      if (typeof body.fast === 'boolean') {
        tavusPayload.fast = body.fast;
      }

      const requestedBgMode = String(
        body.background_mode || body.background_settings?.mode || ''
      ).trim();
      const requestedBgColor = String(
        body.background_color ||
          body.background_settings?.color ||
          (requestedBgMode === 'white' ? '#FFFFFF' : '')
      ).trim();
      const requestedBgUrl = String(
        body.background_url || body.background_settings?.background_url || ''
      ).trim();
      const requestedBgDataUrl = String(body.background_data_url || '').trim();
      const wantTransparent =
        typeof body.transparent_background === 'boolean'
          ? body.transparent_background
          : typeof body.background_settings?.transparent_background === 'boolean'
            ? body.background_settings.transparent_background
            : requestedBgMode === 'transparent';

      if (wantTransparent) {
        tavusPayload.transparent_background = true;
        // Tavus API v2 requires fast: true whenever transparent_background: true
        tavusPayload.fast = true;
      } else if (requestedBgUrl) {
        const bgUrl = isPublicHttpsUrl(requestedBgUrl);
        if (!bgUrl) {
          res.status(400).json({ error: 'رابط الخلفية المخصصة يجب أن يكون رابط HTTPS عاماً وصالحاً.' });
          return;
        }
        tavusPayload.background_url = bgUrl.toString();
      } else if (requestedBgDataUrl) {
        if (publicBase && canHostPublicMedia) {
          const imgMatch = requestedBgDataUrl.match(
            /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i
          );
          if (!imgMatch) {
            res.status(400).json({ error: 'صيغة صورة الخلفية المخصصة غير مدعومة (PNG / JPG / WebP فقط).' });
            return;
          }
          const imgBuf = Buffer.from(imgMatch[2], 'base64');
          if (imgBuf.length === 0 || imgBuf.length > 8 * 1024 * 1024) {
            res.status(400).json({ error: 'حجم صورة الخلفية يتجاوز الحد المسموح (8MB).' });
            return;
          }
          purgeExpiredTempBg();
          const bgToken = randomBytes(18).toString('hex');
          const imgMime = imgMatch[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : imgMatch[1].toLowerCase();
          tempBgStore.set(bgToken, {
            buffer: imgBuf,
            mimeType: imgMime,
            expiresAt: Date.now() + 15 * 60_000,
          });
          tavusPayload.background_url = `${publicBase}/api/ai-presenter/temp-bg/${bgToken}`;
        } else {
          // Dev preview is behind auth cookie check; fall back cleanly to transparent WebM so editor composites the image without Tavus fetch error
          tavusPayload.transparent_background = true;
          tavusPayload.fast = true;
        }
      } else if (
        (requestedBgMode === 'white' || requestedBgMode === 'color') &&
        requestedBgColor
      ) {
        if (publicBase && canHostPublicMedia) {
          const pngBuf = buildSolidColorPngBuffer(requestedBgColor);
          if (!pngBuf) {
            res.status(400).json({ error: 'صيغة لون الخلفية الثابت غير صالحة (استخدم #RRGGBB).' });
            return;
          }
          purgeExpiredTempBg();
          const bgToken = randomBytes(18).toString('hex');
          tempBgStore.set(bgToken, {
            buffer: pngBuf,
            mimeType: 'image/png',
            expiresAt: Date.now() + 15 * 60_000,
          });
          tavusPayload.background_url = `${publicBase}/api/ai-presenter/temp-bg/${bgToken}`;
        } else {
          // Fallback to alpha transparency so the editor composites the exact solid color cleanly
          tavusPayload.transparent_background = true;
          tavusPayload.fast = true;
        }
      }

      const apiRes = await withTimeout(
        fetch('https://tavusapi.com/v2/videos', {
          method: 'POST',
          headers: {
            'x-api-key': keys[0],
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(tavusPayload),
        }),
        20_000,
        'Tavus create video'
      );

      const rawText = await apiRes.text();
      if (!apiRes.ok) {
        const formatted = formatTavusHttpError(apiRes.status, rawText);
        res.status(formatted.status).json(formatted);
        return;
      }

      const created = JSON.parse(rawText) as {
        video_id?: string;
        video_name?: string;
        status?: string;
        hosted_url?: string;
        created_at?: string;
      };

      if (!created.video_id) {
        res.status(502).json({ error: 'لم تُرجع خدمة Tavus معرّف الفيديو المُنشأ.' });
        return;
      }

      res.json({
        provider: 'tavus',
        videoId: created.video_id,
        videoName: created.video_name || tavusPayload.video_name || 'AI Presenter Video',
        status: created.status || 'queued',
        hostedUrl: created.hosted_url,
        createdAt: created.created_at,
      });
    } catch (err) {
      res.status(502).json({
        error:
          err instanceof Error
            ? `تعذر إرسال طلب توليد الراوي إلى Tavus: ${err.message}`
            : 'تعذر الاتصال بخدمة Tavus.',
      });
    }
  });

  app.get('/api/ai-presenter/videos', async (_req, res) => {
    const keys = getTavusApiKeys();
    if (keys.length === 0) {
      res.status(400).json({
        missingKey: true,
        error: 'مفتاح TAVUS_API_KEY غير مضبوط في Secrets.',
      });
      return;
    }

    try {
      const apiRes = await withTimeout(
        fetch('https://tavusapi.com/v2/videos?limit=15', {
          method: 'GET',
          headers: {
            'x-api-key': keys[0],
          },
        }),
        15_000,
        'Tavus list videos'
      );
      const rawText = await apiRes.text();
      if (!apiRes.ok) {
        const formatted = formatTavusHttpError(apiRes.status, rawText);
        res.status(formatted.status).json(formatted);
        return;
      }

      const payload = JSON.parse(rawText) as {
        data?: Array<{
          video_id?: string;
          video_name?: string;
          status?: string;
          status_details?: string;
          generation_progress?: string;
          download_url?: string;
          stream_url?: string;
          hosted_url?: string;
          created_at?: string;
        }>;
      };

      const videos = (Array.isArray(payload.data) ? payload.data : [])
        .filter((v) => typeof v.video_id === 'string' && v.video_id.trim())
        .map((v) => {
          const downloadUrl = typeof v.download_url === 'string' ? v.download_url.trim() : '';
          const streamUrl = typeof v.stream_url === 'string' ? v.stream_url.trim() : '';
          return {
            provider: 'tavus' as const,
            videoId: v.video_id!.trim(),
            videoName: (v.video_name || v.video_id || 'فيديو راوي').trim(),
            status: (v.status || 'queued').trim(),
            statusDetails: v.status_details || '',
            generationProgress: v.generation_progress || '',
            downloadUrl: downloadUrl || undefined,
            streamUrl: streamUrl || undefined,
            hostedUrl: v.hosted_url || undefined,
            createdAt: v.created_at,
            proxiedDownloadUrl:
              downloadUrl && isAllowedMediaProxyUrl(downloadUrl)
                ? `/api/ai-presenter/media?url=${encodeURIComponent(downloadUrl)}${
                    downloadUrl.toLowerCase().includes('.webm') ? '' : '&optimize=1'
                  }`
                : undefined,
            proxiedStreamUrl:
              streamUrl && isAllowedMediaProxyUrl(streamUrl)
                ? `/api/ai-presenter/media?url=${encodeURIComponent(streamUrl)}`
                : undefined,
          };
        });

      res.json({
        provider: 'tavus',
        videos,
      });
    } catch (err) {
      res.status(502).json({
        error:
          err instanceof Error
            ? `تعذر جلب سجل الفيديوهات من Tavus: ${err.message}`
            : 'تعذر جلب سجل الفيديوهات.',
      });
    }
  });

  app.get('/api/ai-presenter/videos/:videoId', async (req, res) => {
    const keys = getTavusApiKeys();
    if (keys.length === 0) {
      res.status(400).json({
        missingKey: true,
        error: 'مفتاح TAVUS_API_KEY غير مضبوط في Secrets.',
      });
      return;
    }

    const videoId = String(req.params.videoId || '').trim();
    if (!/^[a-zA-Z0-9_-]{3,80}$/.test(videoId)) {
      res.status(400).json({ error: 'معرّف الفيديو غير صالح.' });
      return;
    }

    try {
      const apiRes = await withTimeout(
        fetch(`https://tavusapi.com/v2/videos/${encodeURIComponent(videoId)}`, {
          method: 'GET',
          headers: {
            'x-api-key': keys[0],
          },
        }),
        15_000,
        'Tavus video status'
      );
      const rawText = await apiRes.text();
      if (!apiRes.ok) {
        const formatted = formatTavusHttpError(apiRes.status, rawText);
        res.status(formatted.status).json(formatted);
        return;
      }

      const data = JSON.parse(rawText) as {
        video_id?: string;
        status?: string;
        status_details?: string;
        generation_progress?: string;
        download_url?: string;
        stream_url?: string;
        hosted_url?: string;
      };

      const downloadUrl = typeof data.download_url === 'string' ? data.download_url.trim() : '';
      const streamUrl = typeof data.stream_url === 'string' ? data.stream_url.trim() : '';

      res.json({
        provider: 'tavus',
        videoId: data.video_id || videoId,
        status: data.status || 'queued',
        statusDetails: data.status_details || '',
        generationProgress: data.generation_progress || '',
        downloadUrl: downloadUrl || undefined,
        streamUrl: streamUrl || undefined,
        hostedUrl: data.hosted_url || undefined,
        proxiedDownloadUrl:
          downloadUrl && isAllowedMediaProxyUrl(downloadUrl)
            ? `/api/ai-presenter/media?url=${encodeURIComponent(downloadUrl)}${
                downloadUrl.toLowerCase().includes('.webm') ? '' : '&optimize=1'
              }`
            : undefined,
        proxiedStreamUrl:
          streamUrl && isAllowedMediaProxyUrl(streamUrl)
            ? `/api/ai-presenter/media?url=${encodeURIComponent(streamUrl)}`
            : undefined,
      });
    } catch (err) {
      res.status(502).json({
        error:
          err instanceof Error
            ? `تعذر متابعة حالة الفيديو في Tavus: ${err.message}`
            : 'تعذر التحقق من حالة الفيديو.',
      });
    }
  });

  const mediaOptCacheDir = path.join(os.tmpdir(), 'sv0_ai_media_cache');
  const inflightMediaOptimize = new Map<string, Promise<{ filePath: string; mimeType: string } | null>>();

  const execFileAsync = (cmd: string, args: string[], timeoutMs = 45_000): Promise<string> =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
          return;
        }
        resolve(stdout);
      });
    });

  const fetchAllowlistedBuffer = async (startUrl: URL, maxBytes: number): Promise<{ buffer: Buffer; mimeType: string } | null> => {
    let curUrl: URL = startUrl;
    let upstream: Response | null = null;
    for (let hop = 0; hop < 3; hop++) {
      const candidate = await withTimeout(
        fetch(curUrl.toString(), { method: 'GET', redirect: 'manual' }),
        35_000,
        'Tavus media download'
      );
      if (candidate.status >= 300 && candidate.status < 400) {
        const loc = candidate.headers.get('location');
        if (!loc) break;
        const nextParsed = isAllowedMediaProxyUrl(new URL(loc, curUrl).toString());
        if (!nextParsed) return null;
        curUrl = nextParsed;
        continue;
      }
      upstream = candidate;
      break;
    }
    if (!upstream || !upstream.ok) return null;
    const len = Number(upstream.headers.get('content-length') || 0);
    if (len > maxBytes) return null;
    const arrBuf = await withTimeout(upstream.arrayBuffer(), 45_000, 'Tavus media body');
    if (arrBuf.byteLength === 0 || arrBuf.byteLength > maxBytes) return null;
    const rawCt = (upstream.headers.get('content-type') || '').toLowerCase();
    const mimeType =
      rawCt.includes('webm') || curUrl.pathname.toLowerCase().endsWith('.webm')
        ? 'video/webm'
        : 'video/mp4';
    return { buffer: Buffer.from(arrBuf), mimeType };
  };

  const getOrOptimizeAiPresenterMp4 = async (
    targetUrl: URL
  ): Promise<{ filePath: string; mimeType: string } | null> => {
    const key = createHash('sha256').update(targetUrl.toString()).digest('hex').slice(0, 32);
    const cachedMp4 = path.join(mediaOptCacheDir, `${key}_opt.mp4`);
    const cachedWebm = path.join(mediaOptCacheDir, `${key}_raw.webm`);
    try {
      if (fs.existsSync(cachedMp4) && fs.statSync(cachedMp4).size > 2048) {
        return { filePath: cachedMp4, mimeType: 'video/mp4' };
      }
      if (fs.existsSync(cachedWebm) && fs.statSync(cachedWebm).size > 2048) {
        return { filePath: cachedWebm, mimeType: 'video/webm' };
      }
    } catch {
      // ignore stat errors
    }

    const existing = inflightMediaOptimize.get(key);
    if (existing) return existing;

    const job = (async (): Promise<{ filePath: string; mimeType: string } | null> => {
      const rawTmp = path.join(mediaOptCacheDir, `${key}_raw_${Date.now()}.tmp`);
      const optTmp = path.join(mediaOptCacheDir, `${key}_opt_${Date.now()}.mp4`);
      try {
        fs.mkdirSync(mediaOptCacheDir, { recursive: true });
        const downloaded = await fetchAllowlistedBuffer(targetUrl, 90 * 1024 * 1024);
        if (!downloaded) return null;
        if (downloaded.mimeType === 'video/webm') {
          fs.writeFileSync(cachedWebm, downloaded.buffer);
          return { filePath: cachedWebm, mimeType: 'video/webm' };
        }
        fs.writeFileSync(rawTmp, downloaded.buffer);

        let needsTranscode = true;
        try {
          const probeJson = await execFileAsync(
            'ffprobe',
            ['-v', 'quiet', '-print_format', 'json', '-show_streams', rawTmp],
            8000
          );
          const parsed = JSON.parse(probeJson) as {
            streams?: Array<{
              codec_type?: string;
              codec_name?: string;
              pix_fmt?: string;
              width?: number;
              has_b_frames?: number;
            }>;
          };
          const vStream = (parsed.streams || []).find((s) => s.codec_type === 'video');
          if (
            vStream &&
            vStream.codec_name === 'h264' &&
            (vStream.width ?? 0) <= 960 &&
            (vStream.has_b_frames ?? 1) === 0 &&
            !String(vStream.pix_fmt || '').includes('yuva')
          ) {
            needsTranscode = false;
          }
        } catch {
          needsTranscode = true;
        }

        if (!needsTranscode) {
          fs.renameSync(rawTmp, cachedMp4);
          return { filePath: cachedMp4, mimeType: 'video/mp4' };
        }

        try {
          // Zero B-frames + tight GOP (15 frames = 0.6s) + <=960p width + faststart ensures instant A/V locked seeking across Android & WebCodecs
          await execFileAsync(
            'ffmpeg',
            [
              '-y',
              '-i',
              rawTmp,
              '-vf',
              "scale='min(960,iw)':-2:flags=lanczos",
              '-c:v',
              'libx264',
              '-profile:v',
              'main',
              '-preset',
              'veryfast',
              '-crf',
              '20',
              '-pix_fmt',
              'yuv420p',
              '-bf',
              '0',
              '-g',
              '15',
              '-keyint_min',
              '15',
              '-sc_threshold',
              '0',
              '-c:a',
              'aac',
              '-b:a',
              '128k',
              '-ac',
              '2',
              '-ar',
              '44100',
              '-movflags',
              '+faststart',
              optTmp,
            ],
            45_000
          );
          if (fs.existsSync(optTmp) && fs.statSync(optTmp).size > 2048) {
            fs.renameSync(optTmp, cachedMp4);
            try {
              fs.unlinkSync(rawTmp);
            } catch {
              // ignore
            }
            return { filePath: cachedMp4, mimeType: 'video/mp4' };
          }
        } catch {
          // Fall back to raw MP4 if ffmpeg transcode fails
        }

        fs.renameSync(rawTmp, cachedMp4);
        return { filePath: cachedMp4, mimeType: 'video/mp4' };
      } catch {
        return null;
      } finally {
        for (const p of [rawTmp, optTmp]) {
          try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch {
            // ignore
          }
        }
        inflightMediaOptimize.delete(key);
      }
    })();

    inflightMediaOptimize.set(key, job);
    return job;
  };

  app.get('/api/ai-presenter/media', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    let currentUrl = isAllowedMediaProxyUrl(rawUrl);
    if (!currentUrl) {
      res.status(400).json({ error: 'رابط الوسائط غير مصرح به أو غير صالح.' });
      return;
    }

    if (req.query.optimize === '1' && !currentUrl.pathname.toLowerCase().endsWith('.webm')) {
      const opt = await getOrOptimizeAiPresenterMp4(currentUrl);
      if (opt && fs.existsSync(opt.filePath)) {
        const stat = fs.statSync(opt.filePath);
        const totalSize = stat.size;
        res.setHeader('Content-Type', opt.mimeType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range.trim() : '';
        const rangeMatch = rangeHeader.match(/^bytes=(\d+)-(\d*)$/i);
        if (rangeMatch) {
          const start = Math.min(totalSize - 1, Math.max(0, parseInt(rangeMatch[1], 10) || 0));
          const end = rangeMatch[2]
            ? Math.min(totalSize - 1, Math.max(start, parseInt(rangeMatch[2], 10) || totalSize - 1))
            : totalSize - 1;
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
          res.setHeader('Content-Length', String(end - start + 1));
          const rs = fs.createReadStream(opt.filePath, { start, end });
          req.on('close', () => rs.destroy());
          rs.pipe(res);
          return;
        }
        res.status(200);
        res.setHeader('Content-Length', String(totalSize));
        const rs = fs.createReadStream(opt.filePath);
        req.on('close', () => rs.destroy());
        rs.pipe(res);
        return;
      }
    }

    try {
      let upstream: Response | null = null;
      const forwardHeaders: Record<string, string> = {};
      if (typeof req.headers.range === 'string' && req.headers.range.trim()) {
        forwardHeaders.Range = req.headers.range.trim();
      }

      // Follow up to 3 redirects while strictly verifying every hop against the allowlist (SSRF safe)
      for (let hop = 0; hop < 3; hop++) {
        const candidate = await withTimeout(
          fetch(currentUrl.toString(), {
            method: 'GET',
            headers: forwardHeaders,
            redirect: 'manual',
          }),
          30_000,
          'Tavus media proxy'
        );
        if (candidate.status >= 300 && candidate.status < 400) {
          const loc = candidate.headers.get('location');
          if (!loc) break;
          const nextParsed = isAllowedMediaProxyUrl(new URL(loc, currentUrl).toString());
          if (!nextParsed) {
            res.status(403).json({ error: 'تم حظر إعادة التوجيه لنطاق غير موثوق.' });
            return;
          }
          currentUrl = nextParsed;
          continue;
        }
        upstream = candidate;
        break;
      }

      if (!upstream) {
        res.status(502).json({ error: 'تعذر جلب ملف الفيديو من الخادم الوسيط.' });
        return;
      }

      const contentLen = Number(upstream.headers.get('content-length') || 0);
      if (contentLen > 90 * 1024 * 1024) {
        res.status(413).json({ error: 'حجم ملف الفيديو يتجاوز الحد الأقصى (90MB).' });
        return;
      }

      const rawCt = (upstream.headers.get('content-type') || '').toLowerCase();
      const isGenericBinary = !rawCt || rawCt.includes('octet-stream');
      const ct = isGenericBinary
        ? currentUrl.pathname.toLowerCase().endsWith('.webm')
          ? 'video/webm'
          : 'video/mp4'
        : upstream.headers.get('content-type') || 'video/mp4';

      res.status(upstream.status);
      res.setHeader('Content-Type', ct);
      const acceptRanges = upstream.headers.get('accept-ranges');
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);
      if (contentLen > 0) res.setHeader('Content-Length', String(contentLen));
      res.setHeader('Cache-Control', 'private, max-age=3600');

      const maxBytes = 90 * 1024 * 1024;
      if (upstream.body) {
        let streamedBytes = 0;
        const limiter = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            streamedBytes += chunk.length;
            if (streamedBytes > maxBytes) {
              cb(new Error('Media exceeded 90MB limit'));
              return;
            }
            cb(null, chunk);
          },
        });
        const nodeStream = Readable.fromWeb(upstream.body as unknown as import('node:stream/web').ReadableStream);
        nodeStream.on('error', () => {
          if (!res.headersSent) res.status(502).end();
          else res.destroy();
        });
        limiter.on('error', () => {
          nodeStream.destroy();
          if (!res.headersSent) res.status(413).end();
          else res.destroy();
        });
        req.on('close', () => {
          nodeStream.destroy();
          limiter.destroy();
        });
        nodeStream.pipe(limiter).pipe(res);
      } else {
        const arrBuf = await upstream.arrayBuffer();
        if (arrBuf.byteLength > maxBytes) {
          res.status(413).end();
          return;
        }
        res.send(Buffer.from(arrBuf));
      }
    } catch (err) {
      if (!res.headersSent) {
        res.status(502).json({
          error: err instanceof Error ? `فشل تحميل الوسائط: ${err.message}` : 'فشل تحميل الوسائط.',
        });
      }
    }
  });

  // YouTube OAuth helpers (Popup Flow -> postMessage)
  const getYouTubeOAuthCredentials = () => {
    const clientId = (
      process.env.GOOGLE_CLIENT_ID ||
      process.env.YOUTUBE_CLIENT_ID ||
      process.env.VITE_GOOGLE_CLIENT_ID ||
      ''
    ).trim();
    const clientSecret = (
      process.env.GOOGLE_CLIENT_SECRET ||
      process.env.YOUTUBE_CLIENT_SECRET ||
      ''
    ).trim();
    return { clientId, clientSecret };
  };

  const resolveYouTubeCallbackUrl = (req: express.Request): string => {
    const envAppUrl = (process.env.APP_URL || '').trim().replace(/\/$/, '');
    if (envAppUrl && envAppUrl !== 'MY_APP_URL' && /^https?:\/\//i.test(envAppUrl)) {
      return `${envAppUrl}/auth/youtube/callback`;
    }
    const queryOrigin = typeof req.query.origin === 'string' ? req.query.origin.trim().replace(/\/$/, '') : '';
    if (queryOrigin && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(queryOrigin)) {
      return `${queryOrigin}/auth/youtube/callback`;
    }
    const protoHeader = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
    const hostHeader = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() || req.headers.host || `localhost:${PORT}`;
    const proto = protoHeader || (hostHeader.includes('localhost') ? 'http' : 'https');
    return `${proto}://${hostHeader}/auth/youtube/callback`;
  };

  app.get('/api/youtube/status', (req, res) => {
    const { clientId, clientSecret } = getYouTubeOAuthCredentials();
    const callbackUrl = resolveYouTubeCallbackUrl(req);
    res.json({
      configured: Boolean(clientId && clientSecret),
      hasClientId: Boolean(clientId),
      callbackUrl,
    });
  });

  app.get('/api/youtube/auth-url', (req, res) => {
    const { clientId, clientSecret } = getYouTubeOAuthCredentials();
    const redirectUri = resolveYouTubeCallbackUrl(req);
    if (!clientId || !clientSecret) {
      res.status(400).json({
        error:
          'إعدادات ربط يوتيوب (GOOGLE_CLIENT_ID و GOOGLE_CLIENT_SECRET) غير مضافة في Secrets بعد.',
        callbackUrl: redirectUri,
      });
      return;
    }

    const rawAppRedirect =
      typeof req.query.appRedirect === 'string' ? req.query.appRedirect.trim() : '';
    const appRedirect = rawAppRedirect.startsWith('com.shortsquiz.studio0://youtube-auth')
      ? rawAppRedirect
      : '';

    const statePayload = Buffer.from(
      JSON.stringify({
        redirectUri,
        appRedirect: appRedirect || undefined,
        ts: Date.now(),
      }),
      'utf8'
    ).toString('base64url');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'select_account consent',
      state: statePayload,
    });

    res.json({
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      redirectUri,
    });
  });

  const handleYouTubeOAuthCallback = async (req: express.Request, res: express.Response) => {
    let appRedirect = '';
    const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
    let redirectUri = resolveYouTubeCallbackUrl(req);
    if (stateParam) {
      try {
        const decoded = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8')) as {
          redirectUri?: string;
          appRedirect?: string;
        };
        if (decoded.redirectUri && /^https?:\/\//i.test(decoded.redirectUri)) {
          redirectUri = decoded.redirectUri;
        }
        if (
          decoded.appRedirect &&
          decoded.appRedirect.startsWith('com.shortsquiz.studio0://youtube-auth')
        ) {
          appRedirect = decoded.appRedirect;
        }
      } catch {
        // keep defaults
      }
    }

    const renderPopupResult = (payload: Record<string, unknown>, message: string) => {
      const jsonStr = JSON.stringify(payload).replace(/</g, '\\u003c');
      const deepLinkUrl = appRedirect
        ? `${appRedirect}#payload=${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`
        : '';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!doctype html>
<html lang="ar" dir="rtl">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ربط قناة YouTube</title></head>
  <body style="font-family:system-ui,-apple-system,sans-serif;background:#0c0c0c;color:#f4ead2;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center;">
    <div>
      <p style="font-size:16px;font-weight:700;margin-bottom:8px;">${message}</p>
      ${
        deepLinkUrl
          ? `<p style="font-size:12px;color:#b8a684;margin-bottom:16px;">جارٍ إعادتك إلى التطبيق...</p>
             <a href="${deepLinkUrl}" style="display:inline-block;padding:10px 20px;border-radius:10px;background:#00B050;color:#fff;font-weight:700;text-decoration:none;font-size:13px;">العودة إلى التطبيق الآن</a>`
          : `<p style="font-size:12px;color:#b8a684;">يمكنك إغلاق هذه النافذة والعودة للتطبيق.</p>`
      }
    </div>
    <script>
      try {
        if (${JSON.stringify(deepLinkUrl)}) {
          window.location.replace(${JSON.stringify(deepLinkUrl)});
        } else if (window.opener) {
          window.opener.postMessage(${jsonStr}, '*');
          setTimeout(function() { window.close(); }, 350);
        }
      } catch (e) {}
    </script>
  </body>
</html>`);
    };

    try {
      const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
      if (oauthError) {
        renderPopupResult(
          { type: 'YOUTUBE_OAUTH_ERROR', error: `تم إلغاء الربط أو رفضه (${oauthError}).` },
          'لم يكتمل ربط قناة YouTube.'
        );
        return;
      }

      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (!code) {
        renderPopupResult(
          { type: 'YOUTUBE_OAUTH_ERROR', error: 'لم يصل رمز التحقق من Google.' },
          'تعذر إتمام الربط.'
        );
        return;
      }

      const { clientId, clientSecret } = getYouTubeOAuthCredentials();
      if (!clientId || !clientSecret) {
        renderPopupResult(
          {
            type: 'YOUTUBE_OAUTH_ERROR',
            error: 'بيانات GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET غير مضبوطة على الخادم.',
          },
          'إعدادات OAuth غير مكتملة.'
        );
        return;
      }

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });

      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };

      if (!tokenRes.ok || !tokenJson.access_token) {
        renderPopupResult(
          {
            type: 'YOUTUBE_OAUTH_ERROR',
            error:
              tokenJson.error_description ||
              tokenJson.error ||
              'فشل الحصول على رمز الوصول من Google.',
          },
          'تعذر إكمال تفويض YouTube.'
        );
        return;
      }

      let channel: { id: string; title: string; thumbnailUrl?: string } | null = null;
      try {
        const chRes = await fetch(
          'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
          {
            headers: { Authorization: `Bearer ${tokenJson.access_token}` },
          }
        );
        if (chRes.ok) {
          const chData = (await chRes.json()) as {
            items?: Array<{
              id?: string;
              snippet?: { title?: string; thumbnails?: { default?: { url?: string } } };
            }>;
          };
          const first = chData.items?.[0];
          if (first?.id) {
            channel = {
              id: first.id,
              title: first.snippet?.title || 'قناتي على YouTube',
              thumbnailUrl: first.snippet?.thumbnails?.default?.url,
            };
          }
        }
      } catch {
        // non-fatal
      }

      renderPopupResult(
        {
          type: 'YOUTUBE_OAUTH_SUCCESS',
          accessToken: tokenJson.access_token,
          expiresIn: tokenJson.expires_in ?? 3500,
          channel,
        },
        'تم ربط قناة YouTube بنجاح!'
      );
    } catch (err) {
      renderPopupResult(
        {
          type: 'YOUTUBE_OAUTH_ERROR',
          error: err instanceof Error ? err.message : 'حدث خطأ أثناء تفويض YouTube.',
        },
        'حدث خطأ غير متوقع.'
      );
    }
  };

  app.get(['/auth/youtube/callback', '/auth/youtube/callback/'], (req, res) => {
    void handleYouTubeOAuthCallback(req, res);
  });

  const httpServer = http.createServer(app);

  // Mount Vite dev middleware or serve static production build
  if (process.env.NODE_ENV !== 'production') {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    if (hmrDisabled) {
      app.get('/@vite/client', (_req, res) => {
        res.type('application/javascript').send(`
const sheetsMap = new Map();
export class ErrorOverlay {}
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    prune() {},
    dispose() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
`);
      });
    }

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distDir, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Shorts Quiz Studio server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
