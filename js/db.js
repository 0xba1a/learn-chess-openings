// db.js — IndexedDB wrapper (ES module)
//
// Database: "chess-opening-trainer", version 3
// Stores:   nodes, edges, lines, settings, names

const DB_NAME = 'chess-opening-trainer';
const DB_VERSION = 3;

/** @type {IDBDatabase|null} */
let db = null;

/**
 * Open (or create) the IndexedDB database.
 * Must be called once at app startup before any other db function.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      const oldVersion = event.oldVersion;

      // --- Version 0→1: Create all stores ---
      if (oldVersion < 1) {
        // --- nodes ---
        const nodeStore = database.createObjectStore('nodes', { keyPath: 'fen' });
        nodeStore.createIndex('byName', 'name', { unique: false });

        // --- edges ---
        const edgeStore = database.createObjectStore('edges', {
          keyPath: 'id',
          autoIncrement: true,
        });
        edgeStore.createIndex('byParent', 'parentFen', { unique: false });
        edgeStore.createIndex('byChild', 'childFen', { unique: false });
        edgeStore.createIndex('byParentMove', ['parentFen', 'moveSan'], {
          unique: true,
        });

        // --- lines ---
        const lineStore = database.createObjectStore('lines', {
          keyPath: 'id',
          autoIncrement: true,
        });
        lineStore.createIndex('byLeafFen', 'leafFen', { unique: false });
        lineStore.createIndex('byNextReview', 'nextReviewDate', {
          unique: false,
        });
        lineStore.createIndex('byColor', 'color', { unique: false });
        lineStore.createIndex('byRootFen', 'rootFen', { unique: false });
        lineStore.createIndex('byTag', 'tags', { unique: false, multiEntry: true });

        // --- settings ---
        database.createObjectStore('settings', { keyPath: 'key' });

        // --- names ---
        const nameStore = database.createObjectStore('names', {
          keyPath: 'id',
          autoIncrement: true,
        });
        nameStore.createIndex('byLineId', 'lineId', { unique: true });
        nameStore.createIndex('byPart1', 'part1', { unique: false });
        nameStore.createIndex('byPart1Part2', ['part1', 'part2'], {
          unique: false,
        });
        nameStore.createIndex('byPart1Part2Part3', ['part1', 'part2', 'part3'], {
          unique: false,
        });
        nameStore.createIndex('bySourceFen', 'sourceFen', { unique: false });
      }

      // --- Version 1→2: Add studyTag index to lines ---
      if (oldVersion >= 1 && oldVersion < 2) {
        const lineStore = event.target.transaction.objectStore('lines');
        if (!lineStore.indexNames.contains('byStudyTag')) {
          lineStore.createIndex('byStudyTag', 'studyTag', { unique: false });
        }
      }

      // --- Version 2→3: Migrate studyTag string to tags array ---
      if (oldVersion >= 1 && oldVersion < 3) {
        const lineStore = event.target.transaction.objectStore('lines');
        // Remove old index if present
        if (lineStore.indexNames.contains('byStudyTag')) {
          lineStore.deleteIndex('byStudyTag');
        }
        // Add new multiEntry index for tags array
        if (!lineStore.indexNames.contains('byTag')) {
          lineStore.createIndex('byTag', 'tags', { unique: false, multiEntry: true });
        }
        // Migrate data: studyTag → tags
        const cursorReq = lineStore.openCursor();
        cursorReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const record = cursor.value;
            if (!Array.isArray(record.tags)) {
              record.tags = record.studyTag ? [record.studyTag] : [];
              delete record.studyTag;
              cursor.update(record);
            }
            cursor.continue();
          }
        };
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = (event) => {
      reject(new Error(`IndexedDB open failed: ${event.target.error}`));
    };
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Get the cached database connection, throwing if not yet opened.
 * @returns {IDBDatabase}
 */
function getDB() {
  if (!db) {
    throw new Error('Database not opened. Call openDB() first.');
  }
  return db;
}

/**
 * Wrap an IDBRequest in a Promise.
 * @param {IDBRequest} request
 * @returns {Promise<*>}
 */
function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Wrap an IDBTransaction completion in a Promise.
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function promisifyTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

// ---------------------------------------------------------------------------
// Generic CRUD
// ---------------------------------------------------------------------------

/**
 * Get a single record by its primary key.
 * @param {string} storeName
 * @param {*} key
 * @returns {Promise<*|undefined>}
 */
export async function get(storeName, key) {
  const database = getDB();
  const tx = database.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  return promisifyRequest(store.get(key));
}

/**
 * Get all records from an object store.
 * @param {string} storeName
 * @returns {Promise<Array>}
 */
export async function getAll(storeName) {
  const database = getDB();
  const tx = database.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  return promisifyRequest(store.getAll());
}

/**
 * Put (insert or update) a record. Uses the store's keyPath.
 * @param {string} storeName
 * @param {*} record
 * @returns {Promise<*>} The key of the record.
 */
export async function put(storeName, record) {
  const database = getDB();
  const tx = database.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  const key = await promisifyRequest(store.put(record));
  await promisifyTransaction(tx);
  return key;
}

/**
 * Add a new record. Fails if a record with the same key already exists.
 * For auto-increment stores, returns the generated key.
 * @param {string} storeName
 * @param {*} record
 * @returns {Promise<*>} The key of the new record.
 */
export async function add(storeName, record) {
  const database = getDB();
  const tx = database.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  const key = await promisifyRequest(store.add(record));
  await promisifyTransaction(tx);
  return key;
}

/**
 * Delete a record by its primary key.
 * @param {string} storeName
 * @param {*} key
 * @returns {Promise<void>}
 */
export async function del(storeName, key) {
  const database = getDB();
  const tx = database.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  await promisifyRequest(store.delete(key));
  await promisifyTransaction(tx);
}

// ---------------------------------------------------------------------------
// Index queries
// ---------------------------------------------------------------------------

/**
 * Get all records matching an exact index value.
 * @param {string} storeName
 * @param {string} indexName
 * @param {*} value - The exact value (or array for compound indexes) to match.
 * @returns {Promise<Array>}
 */
export async function getAllByIndex(storeName, indexName, value) {
  const database = getDB();
  const tx = database.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  const index = store.index(indexName);
  return promisifyRequest(index.getAll(value));
}

/**
 * Get all records where the indexed field is ≤ upper.
 * Primarily used for SM2 queries: nextReviewDate <= Date.now().
 * @param {string} storeName
 * @param {string} indexName
 * @param {*} upper - Upper bound (inclusive).
 * @returns {Promise<Array>}
 */
export async function getAllByIndexRange(storeName, indexName, upper) {
  const database = getDB();
  const tx = database.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  const index = store.index(indexName);
  const range = IDBKeyRange.upperBound(upper);
  return promisifyRequest(index.getAll(range));
}

// ---------------------------------------------------------------------------
// Bulk operations (import / export)
// ---------------------------------------------------------------------------

/**
 * Clear all records from an object store.
 * @param {string} storeName
 * @returns {Promise<void>}
 */
export async function clearStore(storeName) {
  const database = getDB();
  const tx = database.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  await promisifyRequest(store.clear());
  await promisifyTransaction(tx);
}

/**
 * Insert/update many records in a single transaction.
 * @param {string} storeName
 * @param {Array} records
 * @returns {Promise<void>}
 */
export async function bulkPut(storeName, records) {
  const database = getDB();
  const tx = database.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const record of records) {
    store.put(record);
  }
  await promisifyTransaction(tx);
}

/**
 * Close the database connection. Mostly useful for testing cleanup.
 */
export function closeDB() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Delete the entire database. Useful for testing cleanup.
 * @returns {Promise<void>}
 */
export function deleteDB() {
  closeDB();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
