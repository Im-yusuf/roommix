/**
 * Saved recordings live in the browser's IndexedDB: nothing is uploaded, and a
 * recording survives a reload so a test session can be played back later.
 */
export interface SavedRecording {
  id: number;
  name: string;
  createdAt: number;
  durationMs: number;
  bytes: number;
}

export interface StoredRecording extends SavedRecording {
  blob: Blob;
}

const DB_NAME = 'roommix';
const STORE = 'recordings';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
  };
  return request(req);
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await request(run(db.transaction(STORE, mode).objectStore(STORE)));
  } finally {
    db.close();
  }
}

/** Newest first. */
export async function listRecordings(): Promise<StoredRecording[]> {
  const all = await withStore(
    'readonly',
    (store) => store.getAll() as IDBRequest<StoredRecording[]>,
  );
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveRecording(
  recording: Omit<StoredRecording, 'id'>,
): Promise<StoredRecording> {
  const id = await withStore('readwrite', (store) => store.add(recording) as IDBRequest<number>);
  return { ...recording, id };
}

export async function deleteRecording(id: number): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
}
