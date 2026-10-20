// The extension origin owns this database. Content scripts send source records to
// the service worker; they never create a second database on the LMS origin.
import { withRuleClassification } from './classification.js';

const DB_NAME = 'lms-question-intelligence';
const DB_VERSION = 1;

const STORE_DEFINITIONS = {
  courses: [['sourceCourseId', 'sourceCourseId']],
  sessions: [['courseId', 'courseId'], ['sourceSessionId', 'sourceSessionId']],
  assignments: [['courseId', 'courseId'], ['sessionId', 'sessionId']],
  questions: [
    ['courseId', 'courseId'], ['sessionId', 'sessionId'],
    ['assignmentId', 'assignmentId'], ['contentHash', 'original.contentHash'],
  ],
  contentVersions: [['questionId', 'questionId']],
  plans: [['weekStart', 'weekStart'], ['subjectId', 'subjectId'], ['dueAt', 'dueAt']],
  syncRuns: [['startedAt', 'startedAt']],
  settings: [],
};

let databasePromise;

export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, indexes] of Object.entries(STORE_DEFINITIONS)) {
        const store = db.objectStoreNames.contains(name)
          ? request.transaction.objectStore(name)
          : db.createObjectStore(name, { keyPath: 'id' });
        for (const [indexName, keyPath] of indexes) {
          if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      databasePromise = undefined;
      reject(new Error('Question bank database upgrade is blocked by another open tab.'));
    };
  });
  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionResult(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('Database transaction aborted.'));
    transaction.onerror = () => reject(transaction.error || new Error('Database transaction failed.'));
  });
}

function assertStore(storeName) {
  if (!Object.hasOwn(STORE_DEFINITIONS, storeName)) throw new Error(`Unknown store: ${storeName}`);
}

export async function getAll(storeName) {
  assertStore(storeName);
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  return requestResult(tx.objectStore(storeName).getAll());
}

export async function getRecord(storeName, id) {
  assertStore(storeName);
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  return requestResult(tx.objectStore(storeName).get(id));
}

export async function putRecord(storeName, record) {
  assertStore(storeName);
  if (storeName === 'questions' || storeName === 'contentVersions') {
    throw new Error('Source content must be saved through saveSourceExtraction.');
  }
  if (!record || typeof record.id !== 'string' || !record.id) throw new Error('Record id is required.');
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  const done = transactionResult(tx);
  tx.objectStore(storeName).put(record);
  await done;
  return record;
}

export async function deleteRecord(storeName, id) {
  assertStore(storeName);
  if (storeName === 'questions' || storeName === 'contentVersions') {
    throw new Error('Source content cannot be deleted through the generic record API.');
  }
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  const done = transactionResult(tx);
  tx.objectStore(storeName).delete(id);
  await done;
}

export async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function sourceContentHash(original) {
  const semanticBlocks = Array.isArray(original.contentBlocks)
    ? original.contentBlocks.map(block => ({
        type: block?.type || null,
        text: block?.text ?? null,
        sourceUrl: block?.sourceUrl || null,
        alt: block?.alt || null,
      }))
    : [];
  return sha256(JSON.stringify({
    text: original.text,
    htmlSnapshot: original.htmlSnapshot ?? null,
    semanticBlocks,
  }));
}

function mergeKnown(existing, incoming) {
  if (!existing) return incoming;
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined && value !== '') merged[key] = value;
  }
  return merged;
}

function validateSourcePayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('No extraction payload supplied.');
  for (const name of ['course', 'session', 'assignment', 'question']) {
    const record = payload[name];
    if (record != null && (typeof record !== 'object' || typeof record.id !== 'string' || !record.id)) {
      throw new Error(`Invalid ${name} record.`);
    }
  }
  if (!payload.course && !payload.session && !payload.assignment && !payload.question) {
    throw new Error('Extraction payload is empty.');
  }
  if (payload.question) {
    const { original, source } = payload.question;
    if (!original || typeof original.text !== 'string' || !original.text.trim()) {
      throw new Error('Question source text is empty.');
    }
    let sourceUrl;
    try { sourceUrl = new URL(source?.url); } catch { /* Invalid or absent URL. */ }
    if (sourceUrl?.protocol !== 'https:' || sourceUrl.hostname !== 'student.vedam.org') {
      throw new Error('Question source URL is invalid.');
    }
  }
}

/** Atomically saves discovered source records. A changed question creates a version. */
export async function saveSourceExtraction(payload) {
  validateSourcePayload(payload);
  const now = new Date().toISOString();
  const question = payload.question
    ? structuredClone(payload.question)
    : null;
  if (question) {
    question.original.contentHash = await sourceContentHash(question.original);
    question.original.contentVersion ||= 1;
    question.original.preservationStatus ||= 'REVIEW_REQUIRED';
    question.source.extractedAt ||= now;
  }
  const db = await openDatabase();
  const names = ['courses', 'sessions', 'assignments', 'questions', 'contentVersions', 'syncRuns'];
  const tx = db.transaction(names, 'readwrite');
  const done = transactionResult(tx);
  const result = { courses: 0, sessions: 0, assignments: 0, questions: 0, questionChange: null };
  let savedCourse = null;

  for (const [field, storeName, counter] of [
    ['course', 'courses', 'courses'],
    ['session', 'sessions', 'sessions'],
    ['assignment', 'assignments', 'assignments'],
  ]) {
    const incoming = payload[field];
    if (!incoming) continue;
    const store = tx.objectStore(storeName);
    const old = await requestResult(store.get(incoming.id));
    const merged = mergeKnown(old, incoming);
    store.put(merged);
    if (field === 'course') savedCourse = merged;
    result[counter] = 1;
  }

  if (question) {
    if (!question.metadata?.subject?.value && savedCourse?.name) {
      question.metadata ||= {};
      question.metadata.subject = { value: savedCourse.name, source: 'LMS' };
    }
    question.metadata = withRuleClassification(question.metadata, question.original.text);
    const store = tx.objectStore('questions');
    const old = await requestResult(store.get(question.id));
    if (!old) {
      store.put(question);
      result.questionChange = 'NEW';
    } else if (old.original.contentHash === question.original.contentHash) {
      // Keep the first source capture and user metadata. A subject learned from
      // a later course-page sync can fill a previously unknown subject field.
      let metadata = { ...old.metadata };
      if (!metadata.subject?.value && savedCourse?.name) {
        metadata.subject = { value: savedCourse.name, source: 'LMS' };
      }
      metadata = withRuleClassification(metadata, old.original.text);
      store.put({ ...old, metadata, source: { ...old.source, lastSeenAt: now } });
      result.questionChange = 'UNCHANGED';
    } else {
      const previousVersion = old.original.contentVersion || 1;
      tx.objectStore('contentVersions').put({
        id: `${old.id}:${previousVersion}`,
        questionId: old.id,
        version: previousVersion,
        original: old.original,
        source: old.source,
        archivedAt: now,
      });
      question.original.contentVersion = previousVersion + 1;
      question.source.previousContentHash = old.original.contentHash;
      question.original.preservationStatus = 'REVIEW_REQUIRED';
      question.metadata = withRuleClassification(old.metadata || question.metadata, question.original.text);
      store.put(question);
      result.questionChange = 'SOURCE_CHANGED';
    }
    result.questions = 1;
  }

  tx.objectStore('syncRuns').put({
    id: crypto.randomUUID(),
    startedAt: now,
    completedAt: now,
    status: 'COMPLETED',
    sourceUrl: payload.question?.source?.url || payload.session?.sourceUrl || payload.course?.sourceUrl || null,
    result,
  });
  await done;
  return result;
}

/** Add rule labels to previously captured questions without touching source. */
export async function backfillQuestionClassifications() {
  const db = await openDatabase();
  const tx = db.transaction('questions', 'readwrite');
  const done = transactionResult(tx);
  const store = tx.objectStore('questions');
  const questions = await requestResult(store.getAll());
  let updated = 0;
  for (const question of questions) {
    const metadata = withRuleClassification(question.metadata, question.original?.text);
    if (JSON.stringify(metadata) === JSON.stringify(question.metadata || {})) continue;
    store.put({ ...question, metadata });
    updated++;
  }
  await done;
  return updated;
}

/** Metadata edits have no path to replace the protected original/source fields. */
export async function updateQuestionMetadata(questionId, metadataPatch) {
  if (!metadataPatch || typeof metadataPatch !== 'object' || Array.isArray(metadataPatch)) {
    throw new Error('Invalid metadata update.');
  }
  const allowed = new Set(['subject', 'week', 'topic', 'subtopic', 'difficulty', 'questionType', 'classificationSource', 'tags']);
  for (const key of Object.keys(metadataPatch)) {
    if (!allowed.has(key)) throw new Error(`Metadata field is not editable: ${key}`);
  }
  const db = await openDatabase();
  const tx = db.transaction('questions', 'readwrite');
  const done = transactionResult(tx);
  const store = tx.objectStore('questions');
  const existing = await requestResult(store.get(questionId));
  if (!existing) throw new Error('Question not found.');
  store.put({ ...existing, metadata: { ...existing.metadata, ...metadataPatch } });
  await done;
}
