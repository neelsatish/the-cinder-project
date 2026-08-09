const DATABASE = "cinder-student-cache";
const VERSION = 1;

export type OutboxEntry = {
  key: string;
  kind: "note" | "submission";
  payload: unknown;
  queuedAt: string;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("cache"))
        database.createObjectStore("cache");
      if (!database.objectStoreNames.contains("outbox"))
        database.createObjectStore("outbox");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  const database = await openDatabase();
  await transactionDone(database, "cache", "readwrite", (store) =>
    store.put(value, key),
  );
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("cache", "readonly");
    const request = transaction.objectStore("cache").get(key);
    request.onsuccess = () =>
      resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function queueOffline(
  entry: Omit<OutboxEntry, "queuedAt">,
): Promise<void> {
  const database = await openDatabase();
  const value: OutboxEntry = { ...entry, queuedAt: new Date().toISOString() };
  await transactionDone(database, "outbox", "readwrite", (store) =>
    store.put(value, entry.key),
  );
}

export async function outboxEntries(): Promise<OutboxEntry[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("outbox", "readonly");
    const request = transaction.objectStore("outbox").getAll();
    request.onsuccess = () => resolve((request.result as OutboxEntry[]) ?? []);
    request.onerror = () => reject(request.error);
  });
}

export async function removeOutbox(key: string): Promise<void> {
  const database = await openDatabase();
  await transactionDone(database, "outbox", "readwrite", (store) =>
    store.delete(key),
  );
}

export async function clearStudentCache(): Promise<void> {
  const database = await openDatabase();
  await Promise.all([
    transactionDone(database, "cache", "readwrite", (store) => store.clear()),
    transactionDone(database, "outbox", "readwrite", (store) => store.clear()),
  ]);
}

function transactionDone(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    operation(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
