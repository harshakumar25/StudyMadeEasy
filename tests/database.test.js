import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { backfillQuestionClassifications, getAll, getRecord, openDatabase, putRecord, saveSourceExtraction, sourceContentHash, updateQuestionMetadata } from '../src/db.js';
import { deriveQuestionClassification, withRuleClassification } from '../src/classification.js';

function payload(sourceQuestionId, text, assignmentId = 'assignment-A') {
  const courseId = 'vedam-course:22';
  const sessionId = 'vedam-session:1061';
  return {
    course: { id: courseId, sourceCourseId: '22', name: 'Analysis and Design of Algorithms B1', sourceUrl: 'https://student.vedam.org/sessions?courseOfferingId=22' },
    session: { id: sessionId, courseId, sourceSessionId: '1061', title: 'LEC 24', type: 'LECTURE', sourceUrl: 'https://student.vedam.org/sessions/1061?courseOfferingId=22' },
    assignment: { id: `vedam-assignment:${assignmentId}`, courseId, sessionId, sourceAssignmentId: assignmentId, sourceUrl: 'https://student.vedam.org/sessions/1061' },
    question: {
      id: `vedam-question:22:${assignmentId}:${sourceQuestionId}`,
      courseId, sessionId, assignmentId: `vedam-assignment:${assignmentId}`,
      original: { text, htmlSnapshot: null, contentBlocks: [{ type: 'pre', text }], contentHash: null, preservationStatus: 'REVIEW_REQUIRED' },
      source: { url: `https://student.vedam.org/sessions/1061/${assignmentId}?courseOfferingId=22&questionId=${sourceQuestionId}`, sourceQuestionId, extractionMethod: 'DOM_DESCRIPTION_PANEL' },
      metadata: { topic: { value: null, source: 'UNKNOWN' }, difficulty: { value: 'UNKNOWN', source: 'UNKNOWN' } },
    },
  };
}

test('preserves source characters, code indentation, examples, and option order', async () => {
  const original = 'Given an aray A, count 0s & 1s.\n\n```java\n  if (a[i] <= 1) {\n    x++;\n  }\n```\n\nA) 0\nB) 1\nInput: 0 1\nOutput: 1';
  const source = payload('703', original);
  const result = await saveSourceExtraction(source);
  assert.equal(result.questionChange, 'NEW');
  const stored = await getRecord('questions', source.question.id);
  assert.equal(stored.original.text, original);
  assert.equal(stored.original.contentHash, await sourceContentHash(source.question.original));
  assert.equal(stored.original.preservationStatus, 'REVIEW_REQUIRED');
  assert.equal(stored.metadata.difficulty.value, 'UNKNOWN');
});

test('repeat sync preserves original and metadata; metadata edit cannot change source', async () => {
  const original = 'Q?\nInput: 1\nOutput: 1';
  const source = payload('704', original);
  await saveSourceExtraction(source);
  await updateQuestionMetadata(source.question.id, { difficulty: { value: 'MEDIUM', source: 'USER' } });
  const second = payload('704', original);
  second.question.metadata.difficulty = { value: 'HARD', source: 'LOCAL_MODEL' };
  const result = await saveSourceExtraction(second);
  assert.equal(result.questionChange, 'UNCHANGED');
  const stored = await getRecord('questions', source.question.id);
  assert.equal(stored.original.text, original);
  assert.equal(stored.original.contentHash, await sourceContentHash(source.question.original));
  assert.deepEqual(stored.metadata.difficulty, { value: 'MEDIUM', source: 'USER' });
  await assert.rejects(updateQuestionMetadata(source.question.id, { original: { text: 'rewritten' } }), /not editable/);
});

test('changed source creates a new version and archives the prior content', async () => {
  const source = payload('705', 'Original punctuation?!');
  await saveSourceExtraction(source);
  const changed = payload('705', 'Original punctuation?!\nNew constraint: n ≤ 10^6');
  const result = await saveSourceExtraction(changed);
  assert.equal(result.questionChange, 'SOURCE_CHANGED');
  const stored = await getRecord('questions', source.question.id);
  assert.equal(stored.original.contentVersion, 2);
  assert.equal(stored.original.text, changed.question.original.text);
  const versions = await getAll('contentVersions');
  const previous = versions.find(version => version.questionId === source.question.id);
  assert.equal(previous.original.text, source.question.original.text);
});

test('identical text in separate assignments remains separate', async () => {
  const first = payload('706', 'Find the count.', 'assignment-B');
  const second = payload('706', 'Find the count.', 'assignment-C');
  await saveSourceExtraction(first);
  await saveSourceExtraction(second);
  const questions = await getAll('questions');
  const matches = questions.filter(question => question.original.text === 'Find the count.');
  assert.equal(matches.length, 2);
  assert.notEqual(matches[0].assignmentId, matches[1].assignmentId);
});

test('same words with a changed image source create a source version', async () => {
  const first = payload('708', 'Identify the graph.');
  first.question.original.contentBlocks.push({ type: 'img', text: null, sourceUrl: 'https://student.vedam.org/diagram-a.png', alt: 'Graph' });
  await saveSourceExtraction(first);
  const changed = payload('708', 'Identify the graph.');
  changed.question.original.contentBlocks.push({ type: 'img', text: null, sourceUrl: 'https://student.vedam.org/diagram-b.png', alt: 'Graph' });
  const result = await saveSourceExtraction(changed);
  assert.equal(result.questionChange, 'SOURCE_CHANGED');
});

test('same words with changed source formatting create a source version', async () => {
  const first = payload('709', 'Choose one option.');
  first.question.original.htmlSnapshot = '<p>Choose one option.</p>';
  await saveSourceExtraction(first);
  const changed = payload('709', 'Choose one option.');
  changed.question.original.htmlSnapshot = '<p><strong>Choose</strong> one option.</p>';
  const result = await saveSourceExtraction(changed);
  assert.equal(result.questionChange, 'SOURCE_CHANGED');
  const stored = await getRecord('questions', first.question.id);
  assert.equal(stored.original.htmlSnapshot, changed.question.original.htmlSnapshot);
});

test('empty extraction fails without replacing a valid record', async () => {
  const valid = payload('707', 'Valid original question.');
  await saveSourceExtraction(valid);
  const broken = payload('707', '');
  await assert.rejects(saveSourceExtraction(broken), /empty/);
  const stored = await getRecord('questions', valid.question.id);
  assert.equal(stored.original.text, 'Valid original question.');
});

test('planner records are persisted independently of source questions', async () => {
  const plan = { id: 'plan-1', title: 'Review binary search', kind: 'topic', status: 'pending', weekStart: '2026-10-12', dueAt: '2026-10-16T18:00:00+05:30', remindAt: '2026-10-16T17:30:00+05:30' };
  await putRecord('plans', plan);
  assert.deepEqual(await getRecord('plans', plan.id), plan);
});

test('structured question titles produce a rule topic and final concept subtopic', () => {
  assert.deepEqual(
    deriveQuestionClassification('HashMap_CountSubarraysWithEqualZerosAndOnes\nCount the subarrays.'),
    { topic: 'HashMap CountSubarrays', subtopic: 'Equal Zeros and Ones' },
  );
  assert.deepEqual(
    deriveQuestionClassification('Graph_ShortestPath_InWeightedGraph\nFind a path.'),
    { topic: 'Graph ShortestPath', subtopic: 'Weighted Graph' },
  );
  assert.deepEqual(
    deriveQuestionClassification('Given an array of integers, count the zeros and ones.'),
    { topic: null, subtopic: null },
  );
});

test('rule metadata never replaces user or LMS classifications', () => {
  const text = 'HashMap_CountSubarraysWithEqualZerosAndOnes\nCount the subarrays.';
  const metadata = withRuleClassification({
    topic: { value: 'Hash tables', source: 'USER' },
    subtopic: { value: 'Balance', source: 'LMS' },
    classificationSource: 'USER',
  }, text);
  assert.deepEqual(metadata.topic, { value: 'Hash tables', source: 'USER' });
  assert.deepEqual(metadata.subtopic, { value: 'Balance', source: 'LMS' });
  assert.equal(metadata.classificationSource, 'USER');
});

test('new extraction and changed source update only rule classifications', async () => {
  const initialText = 'HashMap_CountSubarraysWithEqualZerosAndOnes\nCount the subarrays.';
  const source = payload('710', initialText);
  await saveSourceExtraction(source);
  let stored = await getRecord('questions', source.question.id);
  assert.deepEqual(stored.metadata.topic, { value: 'HashMap CountSubarrays', source: 'RULE', rule: 'TITLE_UNITS_V1' });
  assert.equal(stored.metadata.subtopic.value, 'Equal Zeros and Ones');
  assert.equal(stored.original.text, initialText);

  const revised = payload('710', 'Array_FindPairsWithGivenSum\nFind all pairs.');
  await saveSourceExtraction(revised);
  stored = await getRecord('questions', source.question.id);
  assert.equal(stored.metadata.topic.value, 'Array FindPairs');
  assert.equal(stored.metadata.subtopic.value, 'Given Sum');
  assert.equal(stored.original.text, revised.question.original.text);
});

test('backfill classifies a previously saved question without changing its source', async () => {
  const text = 'HashMap_CountSubarraysWithEqualZerosAndOnes\nCount the subarrays.';
  const legacy = payload('711', text).question;
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('questions', 'readwrite');
    tx.objectStore('questions').put(legacy);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  const updated = await backfillQuestionClassifications();
  assert.ok(updated >= 1);
  const stored = await getRecord('questions', legacy.id);
  assert.equal(stored.metadata.topic.value, 'HashMap CountSubarrays');
  assert.equal(stored.metadata.subtopic.value, 'Equal Zeros and Ones');
  assert.deepEqual(stored.original, legacy.original);
});
