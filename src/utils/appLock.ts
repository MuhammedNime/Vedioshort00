const LOCK_HASH_KEY = 'studio_personal_lock_hash_v1';

async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(`quiz-studio::${text}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Deterministic non-subtle fallback for plain HTTP localhost
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fb_${(h >>> 0).toString(16)}`;
}

export function isAppLockEnabled(): boolean {
  try {
    return Boolean(localStorage.getItem(LOCK_HASH_KEY));
  } catch {
    return false;
  }
}

export async function setAppPasscode(passcode: string): Promise<void> {
  const clean = passcode.trim();
  if (!clean) return;
  const digest = await sha256Hex(clean);
  localStorage.setItem(LOCK_HASH_KEY, digest);
}

export async function verifyAppPasscode(passcode: string): Promise<boolean> {
  try {
    const stored = localStorage.getItem(LOCK_HASH_KEY);
    if (!stored) return true;
    const candidate = await sha256Hex(passcode.trim());
    return candidate === stored;
  } catch {
    return false;
  }
}

export function clearAppPasscode(): void {
  try {
    localStorage.removeItem(LOCK_HASH_KEY);
  } catch {
    // ignore
  }
}
