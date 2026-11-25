import type { PersonRecord, RecognitionHistoryEntry } from '../types/face';

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

export async function getAllPersons(): Promise<PersonRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PERSONS, 'readonly');
    const store = tx.objectStore(STORE_PERSONS);
    const req = store.getAll();
    req.onsuccess = () => {
      const list = (req.result as PersonRecord[]) || [];
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(list);
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

export async function deletePersonById(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PERSONS, 'readwrite');
    tx.objectStore(STORE_PERSONS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllPersons(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PERSONS, 'readwrite');
    tx.objectStore(STORE_PERSONS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllHistory(): Promise<RecognitionHistoryEntry[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HISTORY, 'readonly');
    const req = tx.objectStore(STORE_HISTORY).getAll();
    req.onsuccess = () => {
      const list = (req.result as RecognitionHistoryEntry[]) || [];
      list.sort((a, b) => b.timestamp - a.timestamp);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function addHistoryEntry(entry: RecognitionHistoryEntry): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HISTORY, 'readwrite');
    tx.objectStore(STORE_HISTORY).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HISTORY, 'readwrite');
    tx.objectStore(STORE_HISTORY).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllHistory(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HISTORY, 'readwrite');
    tx.objectStore(STORE_HISTORY).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface BackupPayload {
  schema: 'face-roster-backup-v1';
  exportedAt: number;
  persons: PersonRecord[];
}

export function serializeBackup(persons: PersonRecord[]): string {
  const payload: BackupPayload = {
    schema: 'face-roster-backup-v1',
    exportedAt: Date.now(),
    persons,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseBackupJson(rawText: string): PersonRecord[] {
  const parsed = JSON.parse(rawText) as Partial<BackupPayload>;
  if (!parsed || !Array.isArray(parsed.persons)) {
    throw new Error('备份文件格式无效，未找到人物特征数据');
  }

  const validPersons: PersonRecord[] = [];
  for (const item of parsed.persons) {
    if (
      item &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      Array.isArray(item.samples)
    ) {
      const validSamples = item.samples.filter(
        (s) =>
          s &&
          typeof s.id === 'string' &&
          Array.isArray(s.descriptor) &&
          s.descriptor.length === 128 &&
          typeof s.thumbnail === 'string'
      );
      if (validSamples.length > 0) {
        validPersons.push({
          id: item.id,
          name: item.name.trim() || '未命名人物',
          note: typeof item.note === 'string' ? item.note : '',
          samples: validSamples,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
        });
      }
    }
  }

  if (validPersons.length === 0) {
    throw new Error('备份文件中没有有效的人脸特征记录');
  }
  return validPersons;
}
