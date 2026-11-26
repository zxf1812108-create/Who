import type { AppSettingsData, PersonRecord } from '../types/face';

const DB_NAME = 'FaceRosterAndroidDB';
const DB_VERSION = 1;
const STORE_PERSONS = 'persons';
const STORE_HISTORY = 'history';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PERSONS)) {
        const personStore = db.createObjectStore(STORE_PERSONS, { keyPath: 'id' });
        personStore.createIndex('name', 'name', { unique: false });
        personStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        const historyStore = db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
        historyStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('无法打开本地特征数据库'));
    };
  });

  return dbPromise;
}

/**
 * Default sort: if any records have a saved manual sortOrder, respect sortOrder first,
 * falling back to Chinese alphabetical name order.
 */
export function sortPersonsList(list: PersonRecord[]): PersonRecord[] {
  const hasManualOrder = list.some((p) => typeof p.sortOrder === 'number');
  return [...list].sort((a, b) => {
    if (hasManualOrder) {
      const orderA =
        typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER;
      const orderB =
        typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
    }
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

export async function getAllPersons(): Promise<PersonRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PERSONS, 'readonly');
    const store = tx.objectStore(STORE_PERSONS);
    const req = store.getAll();
    req.onsuccess = () => {
      const list = (req.result as PersonRecord[]) || [];
      resolve(sortPersonsList(list));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function putPerson(person: PersonRecord): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PERSONS, 'readwrite');
    tx.objectStore(STORE_PERSONS).put(person);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function putPersonsBatch(persons: PersonRecord[]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PERSONS, 'readwrite');
    const store = tx.objectStore(STORE_PERSONS);
    for (const person of persons) {
      store.put(person);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function replaceAllPersons(persons: PersonRecord[]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PERSONS, 'readwrite');
    const store = tx.objectStore(STORE_PERSONS);
    store.clear();
    for (const person of persons) {
      store.put(person);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deletePersonById(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PERSONS, 'readwrite');
    tx.objectStore(STORE_PERSONS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface FullBackupPayload {
  schema: 'face-roster-backup-v2';
  exportedAt: number;
  settings: AppSettingsData;
  persons: PersonRecord[];
}

export interface ParsedBackupData {
  persons: PersonRecord[];
  settings?: Partial<AppSettingsData>;
  exportedAt?: number;
}

export function serializeFullBackup(
  persons: PersonRecord[],
  settings: AppSettingsData
): string {
  const payload: FullBackupPayload = {
    schema: 'face-roster-backup-v2',
    exportedAt: Date.now(),
    settings,
    persons: persons.map((p) => ({
      ...p,
      samples: p.samples.map((s) => ({
        ...s,
        originalPhoto: s.originalPhoto || s.thumbnail,
      })),
    })),
  };
  return JSON.stringify(payload);
}

export function parseFullBackupJson(rawText: string): ParsedBackupData {
  const parsed = JSON.parse(rawText) as {
    schema?: string;
    exportedAt?: number;
    settings?: Partial<AppSettingsData>;
    persons?: PersonRecord[];
  };

  if (!parsed || !Array.isArray(parsed.persons)) {
    throw new Error('备份文件格式无效，未找到有效备份数据');
  }

  const validPersons: PersonRecord[] = [];
  for (const item of parsed.persons) {
    if (
      item &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      Array.isArray(item.samples)
    ) {
      const validSamples = item.samples
        .filter(
          (s) =>
            s &&
            typeof s.id === 'string' &&
            Array.isArray(s.descriptor) &&
            (s.descriptor.length === 512 || s.descriptor.length === 128) &&
            typeof s.thumbnail === 'string'
        )
        .map((s) => ({
          id: s.id,
          descriptor: s.descriptor,
          thumbnail: s.thumbnail,
          originalPhoto:
            typeof s.originalPhoto === 'string' ? s.originalPhoto : s.thumbnail,
          sourceFilename:
            typeof s.sourceFilename === 'string' ? s.sourceFilename : `${item.name}.jpg`,
          detectionScore:
            typeof s.detectionScore === 'number' ? s.detectionScore : 0.95,
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
        }));

      if (validSamples.length > 0) {
        validPersons.push({
          id: item.id,
          name: item.name.trim() || '未命名人物',
          note: typeof item.note === 'string' ? item.note : '',
          samples: validSamples,
          sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : undefined,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
        });
      }
    }
  }

  const parsedSettings: Partial<AppSettingsData> | undefined =
    parsed.settings && typeof parsed.settings === 'object'
      ? {
          minSimilarity:
            typeof parsed.settings.minSimilarity === 'number'
              ? Math.max(40, Math.min(85, Math.round(parsed.settings.minSimilarity)))
              : undefined,
          mergeIndexedSuffixes:
            typeof parsed.settings.mergeIndexedSuffixes === 'boolean'
              ? parsed.settings.mergeIndexedSuffixes
              : undefined,
        }
      : undefined;

  if (validPersons.length === 0 && !parsedSettings) {
    throw new Error('备份文件中没有有效的人物数据或设置');
  }

  return {
    persons: sortPersonsList(validPersons),
    settings: parsedSettings,
    exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : undefined,
  };
}
