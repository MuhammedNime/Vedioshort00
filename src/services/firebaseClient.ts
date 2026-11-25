import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  BankFolder,
  BankQuestionItem,
  getModifiedStarterQuestionIds,
  isBundledStarterQuestionId,
  mergeCloudFoldersIntoVault,
  mergeCloudQuestionsIntoBank,
  normalizeBankQuestionText,
} from '../storage/questionBankVault';
import { QUIZ_CATEGORIES, QuizCategory, SlideType } from '../types/quiz';

const CLOUD_SYNC_META_KEY = 'shorts_quiz_cloud_sync_meta_v1';

export interface CloudSyncMeta {
  lastSyncedAt: number;
  lastSyncedEmail?: string;
  lastPulled: number;
  lastPushed: number;
}

export function getCloudSyncMeta(): CloudSyncMeta | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CLOUD_SYNC_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CloudSyncMeta>;
    if (typeof parsed.lastSyncedAt !== 'number') return null;
    return {
      lastSyncedAt: parsed.lastSyncedAt,
      lastSyncedEmail: typeof parsed.lastSyncedEmail === 'string' ? parsed.lastSyncedEmail : undefined,
      lastPulled: Number(parsed.lastPulled) || 0,
      lastPushed: Number(parsed.lastPushed) || 0,
    };
  } catch {
    return null;
  }
}

function saveCloudSyncMeta(meta: CloudSyncMeta): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CLOUD_SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    // ignore storage quota errors
  }
}

export const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firestoreDb = firebaseConfig.firestoreDatabaseId
  ? getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId)
  : getFirestore(firebaseApp);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: firebaseAuth.currentUser?.uid,
      email: firebaseAuth.currentUser?.email,
      emailVerified: firebaseAuth.currentUser?.emailVerified,
      isAnonymous: firebaseAuth.currentUser?.isAnonymous,
      tenantId: firebaseAuth.currentUser?.tenantId,
      providerInfo:
        firebaseAuth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(firestoreDb, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

const inFlightProfileEnsures = new Map<string, Promise<void>>();
const ensuredProfileUids = new Set<string>();

export function subscribeFirebaseUser(listener: (user: User | null) => void): () => void {
  return onAuthStateChanged(firebaseAuth, (user) => {
    if (!user) {
      ensuredProfileUids.clear();
    }
    listener(user);
  });
}

export async function signInWithGoogleForSync(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(firebaseAuth, provider);
  await ensureFirestoreUserProfile(result.user);
  return result.user;
}

export async function signInFirebaseWithCredentialTokens(
  idToken?: string | null,
  accessToken?: string | null
): Promise<User | null> {
  if (!idToken && !accessToken) return firebaseAuth.currentUser;
  try {
    const cred = GoogleAuthProvider.credential(idToken || null, accessToken || null);
    const result = await signInWithCredential(firebaseAuth, cred);
    await ensureFirestoreUserProfile(result.user);
    return result.user;
  } catch (err) {
    console.warn('Firebase credential sign-in failed:', err);
    return firebaseAuth.currentUser;
  }
}

export async function signOutFirebaseUser(): Promise<void> {
  ensuredProfileUids.clear();
  await signOut(firebaseAuth);
}

export async function ensureFirestoreUserProfile(user: User): Promise<void> {
  if (ensuredProfileUids.has(user.uid)) {
    return;
  }

  const existingPromise = inFlightProfileEnsures.get(user.uid);
  if (existingPromise) {
    return existingPromise;
  }

  const run = (async () => {
    const path = `users/${user.uid}`;
    const ref = doc(firestoreDb, 'users', user.uid);
    const safeEmail = (user.email || `${user.uid}@users.local`).slice(0, 320);
    const safeName = (user.displayName || user.email?.split('@')[0] || 'مستخدم الاستوديو').slice(
      0,
      160
    );

    let snap;
    try {
      snap = await getDoc(ref);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }

    if (!snap.exists()) {
      try {
        await setDoc(ref, {
          uid: user.uid,
          email: safeEmail,
          displayName: safeName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    } else {
      const existingData = snap.data();
      const hasValidShape =
        existingData?.uid === user.uid &&
        Boolean(existingData?.createdAt) &&
        Boolean(existingData?.updatedAt) &&
        typeof existingData?.email === 'string' &&
        typeof existingData?.displayName === 'string';

      if (!hasValidShape) {
        try {
          await deleteDoc(ref);
          await setDoc(ref, {
            uid: user.uid,
            email: safeEmail,
            displayName: safeName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, path);
        }
      } else if (existingData?.email !== safeEmail || existingData?.displayName !== safeName) {
        try {
          await updateDoc(ref, {
            email: safeEmail,
            displayName: safeName,
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, path);
        }
      }
    }

    ensuredProfileUids.add(user.uid);
  })();

  inFlightProfileEnsures.set(user.uid, run);
  try {
    await run;
  } finally {
    inFlightProfileEnsures.delete(user.uid);
  }
}

const VALID_CATEGORY_SET = new Set<string>(QUIZ_CATEGORIES.map((c) => c.id));

function sanitizeFirestoreId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
}

function sanitizeFolderDocForFirestore(
  folder: BankFolder,
  uid: string
): Record<string, unknown> {
  const safeId = sanitizeFirestoreId(folder.id);
  const safeParentId = folder.parentId ? sanitizeFirestoreId(folder.parentId) : '';
  const safeDoc: Record<string, unknown> = {
    id: safeId,
    ownerId: uid,
    name: (folder.name || 'مجلد').trim().slice(0, 80) || 'مجلد',
    parentId: safeParentId,
    createdAt: Math.max(0, Math.floor(Number(folder.createdAt) || Date.now())),
    serverUpdatedAt: serverTimestamp(),
  };
  if (folder.category && VALID_CATEGORY_SET.has(folder.category)) {
    safeDoc.category = folder.category;
  }
  if (folder.emoji && folder.emoji.trim()) {
    safeDoc.emoji = folder.emoji.trim().slice(0, 16);
  }
  return safeDoc;
}

export async function pushBankFoldersToCloud(folders: BankFolder[]): Promise<number> {
  const user = firebaseAuth.currentUser;
  if (!user || folders.length === 0) return 0;

  await ensureFirestoreUserProfile(user);

  const CHUNK = 350;
  let written = 0;
  for (let i = 0; i < folders.length; i += CHUNK) {
    const slice = folders.slice(i, i + CHUNK);
    const batch = writeBatch(firestoreDb);
    for (const folder of slice) {
      const safeId = sanitizeFirestoreId(folder.id);
      const fRef = doc(firestoreDb, 'users', user.uid, 'folders', safeId);
      batch.set(fRef, sanitizeFolderDocForFirestore(folder, user.uid));
    }
    const batchPath = `users/${user.uid}/folders`;
    try {
      await batch.commit();
      written += slice.length;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, batchPath);
    }
  }
  return written;
}

export async function renameCloudBankFolder(folder: BankFolder): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const safeId = sanitizeFirestoreId(folder.id);
  const path = `users/${user.uid}/folders/${safeId}`;
  const ref = doc(firestoreDb, 'users', user.uid, 'folders', safeId);
  try {
    await ensureFirestoreUserProfile(user);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, sanitizeFolderDocForFirestore(folder, user.uid));
      return;
    }
    await updateDoc(ref, {
      name: (folder.name || 'مجلد').trim().slice(0, 80) || 'مجلد',
      emoji: (folder.emoji || '📁').trim().slice(0, 16),
      serverUpdatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCloudBankFolder(folderId: string): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const safeId = sanitizeFirestoreId(folderId);
  const path = `users/${user.uid}/folders/${safeId}`;
  try {
    await deleteDoc(doc(firestoreDb, 'users', user.uid, 'folders', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

function sanitizeQuestionDocForFirestore(
  item: BankQuestionItem,
  uid: string
): Record<string, unknown> {
  const opts: [string, string, string, string] = [
    String(item.options?.[0] ?? '').slice(0, 200),
    String(item.options?.[1] ?? '').slice(0, 200),
    String(item.options?.[2] ?? '').slice(0, 200),
    String(item.options?.[3] ?? '').slice(0, 200),
  ];
  const safeQuestion = (item.question || '').trim().slice(0, 600);
  const safeNorm = (item.normalizedKey || normalizeBankQuestionText(safeQuestion) || item.id).slice(
    0,
    600
  );
  const safeCategory = VALID_CATEGORY_SET.has(item.category) ? item.category : 'general';
  const safeSlideType: SlideType =
    item.slideType === 'multiple3' ||
    item.slideType === 'trueFalse' ||
    item.slideType === 'clues' ||
    item.slideType === 'versus'
      ? item.slideType
      : 'multiple';
  const maxOptIdx =
    safeSlideType === 'trueFalse' || safeSlideType === 'versus'
      ? 1
      : safeSlideType === 'multiple3'
        ? 2
        : 3;
  const safeDoc: Record<string, unknown> = {
    id: sanitizeFirestoreId(item.id),
    ownerId: uid,
    category: safeCategory,
    slideType: safeSlideType,
    badgeText: (item.badgeText || 'سؤال').slice(0, 120),
    question: safeQuestion || 'سؤال',
    options: opts,
    correctIndex: Math.max(0, Math.min(maxOptIdx, Math.round(Number(item.correctIndex) || 0))),
    explanationText: (item.explanationText || '').slice(0, 400),
    topicTag: (item.topicTag || 'عام').slice(0, 160),
    folderId: item.folderId ? sanitizeFirestoreId(item.folderId) : '',
    folderPath: (item.folderPath || '').slice(0, 300),
    usedInVideo: Boolean(item.usedInVideo),
    createdAt: Math.max(0, Math.floor(Number(item.createdAt) || Date.now())),
    normalizedKey: safeNorm,
    serverUpdatedAt: serverTimestamp(),
  };
  if (typeof item.usedAt === 'number' && Number.isFinite(item.usedAt) && item.usedAt >= 0) {
    safeDoc.usedAt = Math.floor(item.usedAt);
  }
  return safeDoc;
}

export async function pushBankQuestionsToCloud(
  items: BankQuestionItem[],
  onProgress?: (written: number, total: number) => void
): Promise<number> {
  const user = firebaseAuth.currentUser;
  if (!user || items.length === 0) return 0;

  await ensureFirestoreUserProfile(user);

  const CHUNK = 350;
  let written = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    const batch = writeBatch(firestoreDb);
    for (const item of slice) {
      const safeId = sanitizeFirestoreId(item.id);
      const qRef = doc(firestoreDb, 'users', user.uid, 'questions', safeId);
      batch.set(qRef, sanitizeQuestionDocForFirestore(item, user.uid));
    }
    const batchPath = `users/${user.uid}/questions`;
    try {
      await batch.commit();
      written += slice.length;
      onProgress?.(written, items.length);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, batchPath);
    }
  }
  return written;
}

export async function updateCloudBankQuestion(item: BankQuestionItem): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const safeId = sanitizeFirestoreId(item.id);
  const path = `users/${user.uid}/questions/${safeId}`;
  const ref = doc(firestoreDb, 'users', user.uid, 'questions', safeId);
  try {
    await ensureFirestoreUserProfile(user);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, sanitizeQuestionDocForFirestore(item, user.uid));
      return;
    }
    const sanitized = sanitizeQuestionDocForFirestore(item, user.uid);
    const {
      id: _id,
      ownerId: _ownerId,
      createdAt: _createdAt,
      ...updatableFields
    } = sanitized;
    await updateDoc(ref, updatableFields);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

async function getExistingCloudQuestionIdSet(uid: string): Promise<Set<string>> {
  const path = `users/${uid}/questions`;
  try {
    const q = query(collection(firestoreDb, 'users', uid, 'questions'), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    return new Set(snap.docs.map((d) => d.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function updateCloudBankQuestionsFolder(
  ids: string[],
  folderId: string | undefined,
  folderPath: string | undefined,
  fullItems?: BankQuestionItem[]
): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user || ids.length === 0) return;

  await ensureFirestoreUserProfile(user);

  const safeFolderId = folderId ? sanitizeFirestoreId(folderId) : '';
  const safeFolderPath = (folderPath || '').slice(0, 300);
  const existingCloudIds = await getExistingCloudQuestionIdSet(user.uid);
  const itemById = new Map((fullItems || []).map((it) => [sanitizeFirestoreId(it.id), it]));

  const CHUNK = 350;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const batch = writeBatch(firestoreDb);
    let ops = 0;
    for (const rawId of slice) {
      const safeId = sanitizeFirestoreId(rawId);
      const ref = doc(firestoreDb, 'users', user.uid, 'questions', safeId);
      if (existingCloudIds.has(safeId)) {
        batch.update(ref, {
          folderId: safeFolderId,
          folderPath: safeFolderPath,
          serverUpdatedAt: serverTimestamp(),
        });
        ops += 1;
      } else {
        const fullItem = itemById.get(safeId);
        if (fullItem) {
          batch.set(
            ref,
            sanitizeQuestionDocForFirestore(
              { ...fullItem, folderId: folderId || undefined, folderPath: folderPath || undefined },
              user.uid
            )
          );
          ops += 1;
        }
      }
    }
    if (ops === 0) continue;
    const batchPath = `users/${user.uid}/questions`;
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, batchPath);
    }
  }
}

export async function updateCloudBankQuestionsUsedBatch(
  ids: string[],
  used: boolean,
  fullItems?: BankQuestionItem[]
): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user || ids.length === 0) return;

  await ensureFirestoreUserProfile(user);

  const existingCloudIds = await getExistingCloudQuestionIdSet(user.uid);
  const itemById = new Map((fullItems || []).map((it) => [sanitizeFirestoreId(it.id), it]));
  const now = Math.floor(Date.now());

  const CHUNK = 350;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const batch = writeBatch(firestoreDb);
    let ops = 0;
    for (const rawId of slice) {
      const safeId = sanitizeFirestoreId(rawId);
      const ref = doc(firestoreDb, 'users', user.uid, 'questions', safeId);
      if (existingCloudIds.has(safeId)) {
        batch.update(ref, {
          usedInVideo: used,
          usedAt: used ? now : 0,
          serverUpdatedAt: serverTimestamp(),
        });
        ops += 1;
      } else if (used) {
        const fullItem = itemById.get(safeId);
        if (fullItem) {
          batch.set(
            ref,
            sanitizeQuestionDocForFirestore(
              { ...fullItem, usedInVideo: true, usedAt: now },
              user.uid
            )
          );
          ops += 1;
        }
      }
    }
    if (ops === 0) continue;
    const batchPath = `users/${user.uid}/questions`;
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, batchPath);
    }
  }
}

export async function updateCloudBankQuestionUsed(
  id: string,
  used: boolean,
  fullItem?: BankQuestionItem
): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const safeId = sanitizeFirestoreId(id);
  const path = `users/${user.uid}/questions/${safeId}`;
  const ref = doc(firestoreDb, 'users', user.uid, 'questions', safeId);
  const now = Math.floor(Date.now());
  try {
    await ensureFirestoreUserProfile(user);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      if (used && fullItem) {
        await setDoc(
          ref,
          sanitizeQuestionDocForFirestore(
            { ...fullItem, usedInVideo: true, usedAt: now },
            user.uid
          )
        );
      }
      return;
    }
    await updateDoc(ref, {
      usedInVideo: used,
      usedAt: used ? now : 0,
      serverUpdatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCloudBankQuestion(id: string): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const safeId = sanitizeFirestoreId(id);
  const path = `users/${user.uid}/questions/${safeId}`;
  try {
    await deleteDoc(doc(firestoreDb, 'users', user.uid, 'questions', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface SyncQuestionBankResult {
  pulled: number;
  pushed: number;
  foldersPulled: number;
  foldersPushed: number;
  skippedStarterCount: number;
}

const inFlightBankSyncs = new Map<string, Promise<SyncQuestionBankResult>>();

export async function syncQuestionBankWithCloud(options?: {
  includeStarterBank?: boolean;
  onProgress?: (label: string) => void;
}): Promise<SyncQuestionBankResult> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('يرجى تسجيل الدخول بحساب Google أولاً لمزامنة الذاكرة مع السحابة.');
  }

  const syncKey = `${user.uid}:${options?.includeStarterBank ? 'full' : 'smart'}`;
  const existingSync = inFlightBankSyncs.get(syncKey);
  if (existingSync) {
    return existingSync;
  }

  const includeStarterBank = Boolean(options?.includeStarterBank);

  const runSync = (async (): Promise<SyncQuestionBankResult> => {
    options?.onProgress?.('جارٍ التحقق من ملف الحساب السحابي...');
    await ensureFirestoreUserProfile(user);

    // 1. Sync Hierarchical Folders
    options?.onProgress?.('جارٍ مزامنة شجرة المجلدات...');
    const foldersPath = `users/${user.uid}/folders`;
    let cloudFolders: BankFolder[] = [];
    try {
      const fq = query(
        collection(firestoreDb, 'users', user.uid, 'folders'),
        where('ownerId', '==', user.uid)
      );
      const fSnap = await getDocs(fq);
      cloudFolders = fSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          name: String(data.name || 'مجلد'),
          parentId: typeof data.parentId === 'string' && data.parentId ? data.parentId : null,
          category:
            typeof data.category === 'string' && VALID_CATEGORY_SET.has(data.category)
              ? (data.category as QuizCategory)
              : undefined,
          emoji: typeof data.emoji === 'string' && data.emoji ? data.emoji : undefined,
          createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, foldersPath);
    }

    const { insertedFromCloud: foldersPulled, localOnlyFolders } =
      await mergeCloudFoldersIntoVault(cloudFolders);
    const foldersPushed = await pushBankFoldersToCloud(localOnlyFolders);

    // 2. Sync Questions
    options?.onProgress?.('جارٍ استرجاع الأسئلة المحفوظة من السحابة...');
    const listPath = `users/${user.uid}/questions`;
    let cloudItems: BankQuestionItem[] = [];
    try {
      const q = query(
        collection(firestoreDb, 'users', user.uid, 'questions'),
        where('ownerId', '==', user.uid)
      );
      const snap = await getDocs(q);
      cloudItems = snap.docs.map((d) => {
        const data = d.data();
        const opts = Array.isArray(data.options) ? data.options : ['', '', '', ''];
        const rawType = data.slideType;
        const validSlideType: SlideType =
          rawType === 'multiple3' ||
          rawType === 'trueFalse' ||
          rawType === 'clues' ||
          rawType === 'versus'
            ? rawType
            : 'multiple';
        return {
          id: String(data.id || d.id),
          category: (data.category || 'general') as QuizCategory,
          slideType: validSlideType,
          badgeText: String(data.badgeText || 'سؤال'),
          question: String(data.question || ''),
          options: [
            String(opts[0] ?? ''),
            String(opts[1] ?? ''),
            String(opts[2] ?? ''),
            String(opts[3] ?? ''),
          ],
          correctIndex: Math.max(0, Math.min(3, Number(data.correctIndex) || 0)) as 0 | 1 | 2 | 3,
          explanationText: String(data.explanationText || ''),
          topicTag: String(data.topicTag || 'عام'),
          folderId: typeof data.folderId === 'string' && data.folderId ? data.folderId : undefined,
          folderPath:
            typeof data.folderPath === 'string' && data.folderPath ? data.folderPath : undefined,
          usedInVideo: Boolean(data.usedInVideo),
          usedAt: typeof data.usedAt === 'number' && data.usedAt > 0 ? data.usedAt : undefined,
          createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
          normalizedKey: String(
            data.normalizedKey || normalizeBankQuestionText(String(data.question || ''))
          ),
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, listPath);
    }

    const { insertedFromCloud, localOnlyItems } = await mergeCloudQuestionsIntoBank(cloudItems);

    const modifiedStarterIds = getModifiedStarterQuestionIds();
    const itemsToPush = includeStarterBank
      ? localOnlyItems
      : localOnlyItems.filter(
          (item) =>
            !isBundledStarterQuestionId(item.id) ||
            item.usedInVideo ||
            modifiedStarterIds.has(item.id)
        );
    const skippedStarterCount = localOnlyItems.length - itemsToPush.length;

    let pushed = 0;
    if (itemsToPush.length > 0) {
      pushed = await pushBankQuestionsToCloud(itemsToPush, (written, total) => {
        options?.onProgress?.(`جارٍ رفع الأسئلة للسحابة (${written} / ${total})...`);
      });
    }

    saveCloudSyncMeta({
      lastSyncedAt: Date.now(),
      lastSyncedEmail: user.email || undefined,
      lastPulled: insertedFromCloud,
      lastPushed: pushed,
    });

    return {
      pulled: insertedFromCloud,
      pushed,
      foldersPulled,
      foldersPushed,
      skippedStarterCount,
    };
  })();

  inFlightBankSyncs.set(syncKey, runSync);
  try {
    return await runSync;
  } finally {
    inFlightBankSyncs.delete(syncKey);
  }
}
