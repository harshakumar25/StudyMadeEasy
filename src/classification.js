// Classifications are derived metadata. This module never changes LMS source text.
const RULE = 'TITLE_UNITS_V1';
const PROTECTED_SOURCES = new Set(['USER', 'LMS', 'LOCAL_MODEL']);
const RELATIONS = '(?:With|Without|Using|Between|From|Into|Over|Under|For|In|On|By|Of|To)';
const LOWERCASE_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'without']);

function readableWords(value) {
  return value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => index && LOWERCASE_WORDS.has(word.toLowerCase()) ? word.toLowerCase() : word)
    .join(' ');
}

function titleFromSource(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 4);
  for (const line of lines) {
    if (/^(?:description|problem statement|question\s*\d*|example\s*\d*)\s*:?$/i.test(line)) continue;
    // A separator is required so ordinary question sentences are never guessed
    // to be titles. The LMS example uses two underscore-separated title units.
    if (line.length <= 160 && /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z][A-Za-z0-9]*)+$/.test(line)) return line;
    break;
  }
  return null;
}

/** Return only labels supported by the first structured title line. */
export function deriveQuestionClassification(text) {
  const title = titleFromSource(text);
  if (!title) return { topic: null, subtopic: null };
  const [first, second, ...rest] = title.split('_');
  if (!first || !second) return { topic: null, subtopic: null };

  // A relation inside the second unit starts the last concept described by the
  // title: CountSubarraysWithEqualZerosAndOnes -> CountSubarrays / Equal... .
  const relation = new RegExp(`^(.+?)${RELATIONS}(?=[A-Z0-9])(.+)$`).exec(second);
  const secondTopic = relation?.[1] || second;
  const subtopicUnits = [relation?.[2], ...rest].filter(Boolean);
  const topic = `${first} ${secondTopic}`;
  let subtopic = subtopicUnits.length ? readableWords(subtopicUnits.join('_')) : null;
  if (subtopic) subtopic = subtopic.replace(new RegExp(`^${RELATIONS}(?=\\s|[A-Z])\\s*`), '').trim() || null;
  return { topic, subtopic };
}

/** Fill UNKNOWN/RULE labels; never replace labels supplied by the LMS or user. */
export function withRuleClassification(metadata, originalText) {
  const next = { ...(metadata || {}) };
  const derived = deriveQuestionClassification(originalText);
  let hasRuleField = false;
  for (const key of ['topic', 'subtopic']) {
    const current = next[key];
    if (PROTECTED_SOURCES.has(current?.source)) continue;
    if (current?.source && current.source !== 'UNKNOWN' && current.source !== 'RULE') continue;
    if (current?.value && current.value !== 'UNKNOWN' && current.source !== 'RULE') continue;
    if (derived[key]) {
      next[key] = { value: derived[key], source: 'RULE', rule: RULE };
      hasRuleField = true;
    } else if (current?.source === 'RULE') {
      next[key] = { value: null, source: 'UNKNOWN' };
    }
  }
  hasRuleField ||= ['topic', 'subtopic'].some(key => next[key]?.source === 'RULE');
  if (!next.classificationSource || next.classificationSource === 'UNKNOWN' || next.classificationSource === 'RULE') {
    const sources = [next.topic?.source, next.subtopic?.source];
    next.classificationSource = ['USER', 'LMS', 'LOCAL_MODEL'].find(source => sources.includes(source))
      || (hasRuleField ? 'RULE' : 'UNKNOWN');
  }
  return next;
}
