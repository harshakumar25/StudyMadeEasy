import { getAll, putRecord, deleteRecord, updateQuestionMetadata, backfillQuestionClassifications, importBackupStores } from '../src/db.js';
import { calendarWeekFromDate } from '../src/calendar-week.js';

const $ = (id) => document.getElementById(id);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const filterKeys = ['week', 'sessionType', 'session', 'topic', 'subtopic', 'difficulty', 'questionType', 'assignment', 'extractionStatus', 'classificationSource'];
const state = {
  courses: [], sessions: [], assignments: [], questions: [], plans: [],
  courseById: new Map(), sessionById: new Map(), assignmentById: new Map(), questionById: new Map(), subjects: [],
  subject: 'all', view: 'overview', selectedQuestionId: null,
  filters: Object.fromEntries(filterKeys.map((key) => [key, ''])), search: '', sort: 'source',
  plannerMode: 'week', weekStart: startOfWeek(new Date()), editingPlanId: null,
};
let toastTimer;

function field(value) {
  if (typeof value === 'boolean') return '';
  if (value && typeof value === 'object' && !Array.isArray(value)) return field(value.value ?? value.label ?? value.name ?? '');
  if (Array.isArray(value)) return value.map(field).filter(Boolean).join(', ');
  return value === null || value === undefined ? '' : String(value).trim();
}
function first(...values) { return values.map(field).find(Boolean) || ''; }
function idOf(value) { return value === null || value === undefined ? '' : String(value); }
function node(tag, className, value) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (value !== undefined && value !== null) item.textContent = String(value);
  return item;
}
function fmtCount(number, singular, plural = `${singular}s`) { return `${number} ${number === 1 ? singular : plural}`; }
function truncate(value, length = 130) {
  const text = field(value).replace(/\s+/g, ' ');
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}
function dateKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfWeek(input) {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return date;
}
function addDays(input, days) { const date = new Date(input); date.setDate(date.getDate() + days); return date; }
function asDate(value) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; }
function localInputValue(value) {
  const date = asDate(value);
  if (!date) return '';
  return `${dateKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function humanDate(value, options = { month: 'short', day: 'numeric' }) {
  const date = asDate(value);
  return date ? new Intl.DateTimeFormat(undefined, options).format(date) : '';
}
function humanTime(value) { return humanDate(value, { hour: 'numeric', minute: '2-digit' }); }
function isCompleted(plan) { return ['completed', 'done', 'complete'].includes(field(plan.status).toLowerCase()); }
function isOverdue(plan) { const due = asDate(plan.dueAt); return !isCompleted(plan) && !!due && due.getTime() < Date.now(); }
function planSubjectId(plan) {
  if (plan.subjectId !== null && plan.subjectId !== undefined && String(plan.subjectId)) return String(plan.subjectId);
  const question = state.questionById.get(idOf(plan.questionId));
  return question ? questionSubjectId(question) : '';
}
function planSubjectName(plan) { const id = planSubjectId(plan); return id ? subjectName(id) : 'No subject'; }
function subjectNameFromCourse(course) { return first(course?.name, course?.title, course?.subject, course?.code) || 'UNKNOWN'; }
function questionSubjectId(question) { return idOf(question.courseId) || first(question.metadata?.subject); }
function subjectName(id, fallback = '') {
  if (!id) return fallback || 'UNKNOWN';
  return state.subjects.find((subject) => subject.id === id)?.name || fallback || 'UNKNOWN';
}
function questionSubjectName(question) {
  return subjectName(questionSubjectId(question), first(question.metadata?.subject) || 'UNKNOWN');
}
function sessionOf(question) { return state.sessionById.get(idOf(question.sessionId)); }
function assignmentOf(question) { return state.assignmentById.get(idOf(question.assignmentId)); }
function sessionLabel(session) { return first(session?.title, session?.name, session?.label, session?.sessionName, session?.sessionNumber && `Session ${field(session.sessionNumber)}`, session?.number && `Session ${field(session.number)}`) || 'Unknown session'; }
function assignmentLabel(assignment) { return first(assignment?.title, assignment?.name, assignment?.label) || 'Unknown assignment'; }
function originalText(question) {
  const original = question.original || {};
  if (typeof original.text === 'string' && original.text) return original.text;
  if (Array.isArray(original.contentBlocks)) {
    const texts = [];
    const walk = (block) => {
      if (typeof block === 'string') { texts.push(block); return; }
      if (!block || typeof block !== 'object') return;
      if (typeof block.text === 'string') texts.push(block.text);
      else if (typeof block.content === 'string') texts.push(block.content);
      if (Array.isArray(block.children)) block.children.forEach(walk);
    };
    original.contentBlocks.forEach(walk);
    if (texts.length) return texts.join('\n');
  }
  return '';
}
function questionLabel(question) {
  const order = question.order ?? question.sourceOrder ?? question.questionNumber;
  return order !== null && order !== undefined && String(order) ? `Question ${order}` : 'Question';
}
function classificationSource(question) {
  const metadata = question.metadata || {};
  return first(metadata.classificationSource, metadata.topic?.source, metadata.subtopic?.source, metadata.difficulty?.source, question.classificationSource);
}
function weekInfo(question) {
  const metadata = question.metadata || {};
  const session = sessionOf(question);
  for (const [entry, source] of [
    [metadata.week, field(metadata.week?.source)],
    [session?.week, field(session?.weekSource)],
    [question.week, field(question.weekSource)],
  ]) {
    const value = field(entry);
    if (!unknown(value)) return { value, source };
  }
  return calendarWeekFromDate(session?.date) || calendarWeekFromDate(session?.dateText) || { value: '', source: 'UNKNOWN' };
}
function filterValue(question, key) {
  const metadata = question.metadata || {};
  const session = sessionOf(question);
  const assignment = assignmentOf(question);
  switch (key) {
    case 'week': return weekInfo(question).value;
    case 'sessionType': return first(metadata.sessionType, session?.sessionType, session?.type, session?.kind);
    case 'session': return session || question.sessionId ? sessionLabel(session) : '';
    case 'topic': return first(metadata.topic);
    case 'subtopic': return first(metadata.subtopic);
    case 'difficulty': return first(metadata.difficulty);
    case 'questionType': return first(metadata.questionType);
    case 'assignment': return assignment || question.assignmentId ? assignmentLabel(assignment) : '';
    case 'extractionStatus': return first(question.original?.preservationStatus, question.extractionStatus) || 'Not recorded';
    case 'classificationSource': return classificationSource(question) || 'Not recorded';
    default: return '';
  }
}
function safeSourceUrl(value, base = '') {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = base ? new URL(value, base) : new URL(value);
    return url.protocol === 'https:' && url.hostname === 'student.vedam.org' && !url.port && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function questionLmsUrl(question) {
  if (!question) return '';
  const direct = safeSourceUrl(question.source?.url);
  if (direct) return direct;
  const qid = idOf(question.id);
  const parts = qid.split(':');
  if (parts.length >= 4) {
    const courseId = parts[1];
    const assignmentId = parts[2];
    const questionId = parts[3];
    const sessionId = idOf(question.sessionId).replace(/^vedam-session:/, '');
    if (sessionId && assignmentId && questionId) {
      return `https://student.vedam.org/sessions/${encodeURIComponent(sessionId)}/${encodeURIComponent(assignmentId)}?courseOfferingId=${encodeURIComponent(courseId)}&questionId=${encodeURIComponent(questionId)}`;
    }
  }
  return '';
}
function safeRichContent(question) {
  const fragment = document.createDocumentFragment();
  const blocks = Array.isArray(question.original?.contentBlocks) ? [...question.original.contentBlocks] : [];
  blocks.sort((a, b) => compareKnownNumber(a?.order, b?.order));
  const allowed = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'blockquote']);
  let priorPreText = '';
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const tag = field(block.type).toLowerCase();
    if (tag === 'img') {
      const placeholder = node('span', 'image-placeholder');
      placeholder.append(node('span', '', `Image${block.alt ? `: ${field(block.alt)}` : ''}`));
      const url = safeSourceUrl(block.sourceUrl, question.source?.url);
      if (url) {
        const link = node('a', '', 'Open image source ↗');
        link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        placeholder.append(link);
      }
      fragment.append(placeholder);
      priorPreText = '';
      continue;
    }
    const text = typeof block.text === 'string' ? block.text : '';
    if (!text) continue;
    if (tag === 'code' && priorPreText.includes(text)) continue;
    const displayTag = tag === 'table' ? 'pre' : tag === 'li' || tag === 'math' ? 'p' : allowed.has(tag) ? tag : 'p';
    const element = node(displayTag, tag === 'table' ? 'table-fallback' : tag === 'li' ? 'list-item-fallback' : '', text);
    fragment.append(element);
    priorPreText = tag === 'pre' ? text : '';
  }
  return fragment;
}
function scopedQuestions() { return state.questions.filter((question) => state.subject === 'all' || questionSubjectId(question) === state.subject); }
function scopedPlans() { return state.plans.filter((plan) => state.subject === 'all' || planSubjectId(plan) === state.subject); }
function populateSelect(select, choices, placeholder, selected = '') {
  select.replaceChildren();
  select.add(new Option(placeholder, ''));
  for (const item of choices) select.add(new Option(item.label, item.value));
  select.value = selected;
  if (select.value !== selected) select.value = '';
}
function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}
function emptyState(title, description, icon = '▤', buttonLabel = '', onClick = null) {
  const box = node('div', 'empty-state');
  box.append(node('span', 'empty-icon', icon), node('strong', '', title), node('p', '', description));
  if (buttonLabel) {
    const button = node('button', 'secondary-button', buttonLabel);
    button.type = 'button';
    if (onClick) button.addEventListener('click', onClick);
    box.append(button);
  }
  return box;
}
async function loadAll(checkAutoRestore = true) {
  try {
    await backfillQuestionClassifications();
    const [courses, sessions, assignments, questions, plans] = await Promise.all([
      getAll('courses'), getAll('sessions'), getAll('assignments'), getAll('questions'), getAll('plans'),
    ]);
    state.courses = Array.isArray(courses) ? courses : [];
    state.sessions = Array.isArray(sessions) ? sessions : [];
    state.assignments = Array.isArray(assignments) ? assignments : [];
    state.questions = Array.isArray(questions) ? questions : [];
    state.plans = Array.isArray(plans) ? plans : [];
    state.courseById = new Map(state.courses.map((course) => [idOf(course.id), course]));
    state.sessionById = new Map(state.sessions.map((session) => [idOf(session.id), session]));
    state.assignmentById = new Map(state.assignments.map((assignment) => [idOf(assignment.id), assignment]));
    state.questionById = new Map(state.questions.map((question) => [idOf(question.id), question]));
    buildSubjects();
    render();
    if (checkAutoRestore && state.questions.length === 0) {
      await autoRestoreIfEmpty();
    }
  } catch (error) {
    console.error('Could not load study data', error);
    showToast('Could not load saved records. Try refreshing.');
  }
}
function buildSubjects() {
  const found = new Map();
  for (const course of state.courses) {
    const id = idOf(course.id);
    if (id) found.set(id, subjectNameFromCourse(course));
  }
  for (const question of state.questions) {
    const id = questionSubjectId(question);
    const metadataName = first(question.metadata?.subject);
    if (id && (!found.has(id) || found.get(id) === 'UNKNOWN') && metadataName) found.set(id, metadataName);
    else if (id && !found.has(id)) found.set(id, 'UNKNOWN');
  }
  state.subjects = [...found].map(([id, name]) => ({ id, name })).sort((a, b) => collator.compare(a.name, b.name));
  if (state.subject !== 'all' && !found.has(state.subject)) state.subject = 'all';
  const select = $('subject-select');
  select.replaceChildren(new Option('All subjects', 'all'));
  for (const subject of state.subjects) select.add(new Option(subject.name, subject.id));
  select.value = state.subject;
}
function setView(view) {
  if (!['overview', 'questions', 'planner'].includes(view)) return;
  state.view = view;
  for (const section of document.querySelectorAll('.view')) {
    const selected = section.id === `${view}-view`;
    section.hidden = !selected;
    section.classList.toggle('is-visible', selected);
  }
  for (const button of document.querySelectorAll('[data-view]')) {
    if (!button.closest('.main-nav, .mobile-nav, .topbar-nav')) continue;
    const selected = button.dataset.view === view;
    button.classList.toggle('is-active', selected);
    if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  closeSidebar();
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function openSidebar() {
  $('sidebar')?.classList.add('is-open');
  $('sidebar-backdrop')?.classList.add('is-visible');
}

function closeSidebar() {
  $('sidebar')?.classList.remove('is-open');
  $('sidebar-backdrop')?.classList.remove('is-visible');
}

function toggleSidebar() {
  const isOpen = $('sidebar')?.classList.contains('is-open');
  if (isOpen) closeSidebar(); else openSidebar();
}

function render() {
  $('today-label').textContent = humanDate(new Date(), { weekday: 'long', month: 'short', day: 'numeric' });
  const questionCount = scopedQuestions().length;
  const taskCount = scopedPlans().filter((plan) => !isCompleted(plan)).length;
  for (const [id, count] of [
    ['nav-question-count', questionCount],
    ['nav-task-count', taskCount],
    ['top-nav-question-count', questionCount],
    ['top-nav-task-count', taskCount],
  ]) {
    const el = $(id);
    if (el) {
      el.textContent = String(count);
      el.hidden = !count;
    }
  }
  if (state.view === 'overview') renderOverview();
  if (state.view === 'questions') renderQuestions();
  if (state.view === 'planner') renderPlanner();
}

function bentoStatCard(icon, count, label, onClick) {
  const card = node('button', 'bento-stat-pill');
  card.type = 'button';
  card.innerHTML = `
    <span class="stat-icon-mini">${icon}</span>
    <div class="stat-copy-mini">
      <strong class="stat-num">${count}</strong>
      <span class="stat-txt">${label}</span>
    </div>
  `;
  if (onClick) card.addEventListener('click', onClick);
  return card;
}

function renderOverview() {
  const questions = scopedQuestions();
  const plans = scopedPlans();
  const now = new Date();
  const today = dateKey(now);
  const weekStart = startOfWeek(now);
  const weekEnd = addDays(weekStart, 7);
  const dueToday = plans.filter((plan) => !isCompleted(plan) && dateKey(plan.dueAt) === today);
  const overdue = plans.filter(isOverdue);
  const completedThisWeek = plans.filter((plan) => isCompleted(plan) && asDate(plan.updatedAt)?.getTime() >= weekStart.getTime() && asDate(plan.updatedAt)?.getTime() < weekEnd.getTime());

  const countBadge = $('bento-question-count');
  if (countBadge) countBadge.textContent = String(questions.length);

  const statsContainer = $('overview-stats');
  if (statsContainer) {
    statsContainer.replaceChildren(
      bentoStatCard('📦', questions.length, 'Questions saved', () => setView('questions')),
      bentoStatCard('⏰', dueToday.length, 'Due today', () => setView('planner')),
      bentoStatCard('⚠️', overdue.length, 'Overdue tasks', () => setView('planner')),
      bentoStatCard('✅', completedThisWeek.length, 'Completed this week', () => setView('planner')),
    );
  }

  const banner = $('reminder-banner');
  if (banner) {
    const reminders = plans.filter((plan) => !isCompleted(plan) && asDate(plan.remindAt) && asDate(plan.remindAt).getTime() <= Date.now());
    banner.hidden = reminders.length === 0;
    if (reminders.length) banner.textContent = `${fmtCount(reminders.length, 'planned task')} reached reminder time.`;
  }

  renderTodayTasks(plans, today);
  renderSubjects();
}

function renderTodayTasks(plans, today) {
  const container = $('today-task-list');
  if (!container) return;
  container.replaceChildren();
  const tasks = plans.filter((plan) => !isCompleted(plan) && (isOverdue(plan) || dateKey(plan.dueAt) === today)).sort(compareDue).slice(0, 5);
  if (!tasks.length) {
    container.append(emptyState('No tasks due right now', 'All clear! Add a task in your planner to stay ahead.', '✓', 'Add a task', () => openTaskDialog()));
    return;
  }
  for (const plan of tasks) {
    const row = node('div', 'compact-task');
    const check = node('button', 'check-control', '');
    check.type = 'button'; check.title = 'Mark complete';
    check.addEventListener('click', () => toggleComplete(plan));
    const info = node('div', 'task-info');
    info.append(node('strong', '', first(plan.title, 'Untitled task')), node('small', '', `${planSubjectName(plan)} · ${humanTime(plan.dueAt)}`));
    const tag = node('span', `due-tag ${isOverdue(plan) ? 'overdue' : 'today'}`, isOverdue(plan) ? 'Overdue' : 'Today');
    row.append(check, info, tag);
    container.append(row);
  }
}

function renderSubjects() {
  const container = $('subject-grid');
  if (!container) return;
  container.replaceChildren();
  const subjects = state.subjects;
  if (!subjects.length) {
    container.append(emptyState('No subjects saved yet', 'Subjects appear here after saving LMS material.', '▥'));
    return;
  }
  for (const subject of subjects) {
    const subjectQuestions = state.questions.filter((question) => questionSubjectId(question) === subject.id);
    const count = subjectQuestions.length;
    const lmsUrl = subjectQuestions.map(questionLmsUrl).find(Boolean) || 'https://student.vedam.org';
    const isActive = state.subject === subject.id;

    const card = node('div', `bento-subject-card ${isActive ? 'is-active' : ''}`);
    
    const mainBtn = node('button', 'bento-subject-main');
    mainBtn.type = 'button';
    mainBtn.append(node('span', 'subject-mark', subject.name.slice(0, 1).toUpperCase()));
    
    const body = node('div', 'bento-subject-body');
    body.append(
      node('strong', '', subject.name),
      node('span', 'bento-subject-count', fmtCount(count, 'question'))
    );
    mainBtn.append(body);
    mainBtn.addEventListener('click', () => {
      state.subject = subject.id;
      $('subject-select').value = subject.id;
      setView('questions');
    });

    const actions = node('div', 'bento-subject-actions');
    if (lmsUrl) {
      const lmsLink = node('a', 'card-lms-pill-link', 'LMS ↗');
      lmsLink.href = lmsUrl;
      lmsLink.target = '_blank';
      lmsLink.rel = 'noopener noreferrer';
      lmsLink.title = `Open ${subject.name} in LMS`;
      actions.append(lmsLink);
    }
    const browseBtn = node('button', 'card-browse-pill-btn', 'Browse →');
    browseBtn.type = 'button';
    browseBtn.title = `View questions`;
    browseBtn.addEventListener('click', () => {
      state.subject = subject.id;
      $('subject-select').value = subject.id;
      setView('questions');
    });
    actions.append(browseBtn);

    card.append(mainBtn, actions);
    container.append(card);
  }
}
function updateFilterChoices() {
  const questions = scopedQuestions();
  for (const key of filterKeys) {
    const values = [...new Set(questions.map((question) => filterValue(question, key)).filter(Boolean))].sort(compareKnownText);
    const choices = values.map((value) => ({ value, label: value }));
    populateSelect($(`filter-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`), choices, `Any ${key === 'sessionType' ? 'type' : key === 'questionType' ? 'question type' : key === 'classificationSource' ? 'source' : key === 'extractionStatus' ? 'status' : key}`, state.filters[key]);
    if (!values.includes(state.filters[key])) state.filters[key] = '';
  }
}
function filteredQuestions() {
  const search = state.search.toLocaleLowerCase();
  const result = scopedQuestions().filter((question) => {
    if (search) {
      const haystack = [originalText(question), questionSubjectName(question), filterValue(question, 'topic'), filterValue(question, 'subtopic')].join(' ').toLocaleLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return filterKeys.every((key) => !state.filters[key] || filterValue(question, key) === state.filters[key]);
  });
  result.sort(compareQuestions);
  return result;
}
function unknown(value) { return !field(value) || /^(unknown|not recorded|n\/a)$/i.test(field(value)); }
function compareKnownText(a, b) {
  if (unknown(a) && unknown(b)) return 0;
  if (unknown(a)) return 1;
  if (unknown(b)) return -1;
  return collator.compare(field(a), field(b));
}
function compareKnownNumber(a, b) {
  const left = a === null || a === undefined || a === '' ? NaN : Number(a);
  const right = b === null || b === undefined || b === '' ? NaN : Number(b);
  if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
  if (!Number.isFinite(left)) return 1;
  if (!Number.isFinite(right)) return -1;
  return left - right;
}
function compareKnownDate(a, b, descending = false) {
  const left = asDate(a)?.getTime();
  const right = asDate(b)?.getTime();
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return descending ? right - left : left - right;
}
function difficultyRank(value) {
  if (unknown(value)) return null;
  const text = field(value).toLocaleLowerCase();
  return { easy: 0, medium: 1, hard: 2 }[text] ?? 3;
}
function compareDifficulty(a, b) {
  const left = difficultyRank(a);
  const right = difficultyRank(b);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right || compareKnownText(a, b);
}
function compareSource(a, b) {
  return compareKnownText(questionSubjectName(a), questionSubjectName(b)) ||
    compareKnownText(filterValue(a, 'week'), filterValue(b, 'week')) ||
    compareKnownDate(sessionOf(a)?.date, sessionOf(b)?.date) ||
    compareKnownNumber(sessionOf(a)?.order ?? sessionOf(a)?.sessionNumber, sessionOf(b)?.order ?? sessionOf(b)?.sessionNumber) ||
    compareKnownNumber(assignmentOf(a)?.order, assignmentOf(b)?.order) ||
    compareKnownNumber(a.order, b.order) ||
    collator.compare(idOf(a.id), idOf(b.id));
}
function compareQuestions(a, b) {
  let primary = 0;
  if (state.sort === 'sessionDate') primary = compareKnownDate(sessionOf(a)?.date, sessionOf(b)?.date);
  else if (state.sort === 'week') primary = compareKnownText(filterValue(a, 'week'), filterValue(b, 'week'));
  else if (state.sort === 'topic') primary = compareKnownText(filterValue(a, 'topic'), filterValue(b, 'topic'));
  else if (state.sort === 'difficulty') primary = compareDifficulty(filterValue(a, 'difficulty'), filterValue(b, 'difficulty'));
  else if (state.sort === 'newest') primary = compareKnownDate(a.source?.extractedAt || a.createdAt || a.updatedAt, b.source?.extractedAt || b.createdAt || b.updatedAt, true);
  return primary || compareSource(a, b);
}
function groupedQuestions(questions) {
  const subjects = new Map();
  for (const question of questions) {
    const subjectId = questionSubjectId(question) || 'UNKNOWN';
    const weekValue = filterValue(question, 'week');
    const topicValue = filterValue(question, 'topic');
    const weekKey = unknown(weekValue) ? 'UNKNOWN' : weekValue;
    const topicKey = unknown(topicValue) ? 'UNKNOWN' : topicValue;
    if (!subjects.has(subjectId)) subjects.set(subjectId, { label: questionSubjectName(question), count: 0, weeks: new Map() });
    const subject = subjects.get(subjectId);
    subject.count++;
    if (!subject.weeks.has(weekKey)) subject.weeks.set(weekKey, { count: 0, topics: new Map() });
    const week = subject.weeks.get(weekKey);
    week.count++;
    if (!week.topics.has(topicKey)) week.topics.set(topicKey, []);
    week.topics.get(topicKey).push(question);
  }
  return subjects;
}
function questionTitle(question) {
  const text = originalText(question);
  if (text) {
    const firstLine = text.split('\n')[0].trim();
    if (firstLine && firstLine.length < 90 && !/^(Input|Output|Example|Note|Constraints)\b/i.test(firstLine)) {
      return firstLine;
    }
  }
  return questionLabel(question);
}

function questionBody(question) {
  const text = originalText(question);
  if (text) {
    const lines = text.split('\n');
    if (lines.length > 1) {
      const rest = lines.slice(1).join('\n').trim();
      if (rest) return rest;
    }
    return text;
  }
  return '';
}

function difficultyPill(diff) {
  const d = String(diff || '').toUpperCase();
  if (d === 'EASY') return node('span', 'pill diff-easy', '🎗️ Easy');
  if (d === 'MEDIUM') return node('span', 'pill diff-medium', '🎗️ Medium');
  if (d === 'HARD') return node('span', 'pill diff-hard', '🎗️ Hard');
  if (diff && !unknown(diff)) return node('span', 'pill', diff);
  return null;
}

function renderQuestionGroups(questions) {
  const fragment = document.createDocumentFragment();
  for (const [, subject] of groupedQuestions(questions)) {
    const subjectSection = node('section', 'subject-group');
    subjectSection.setAttribute('aria-label', `Subject ${subject.label}`);
    const subjectHead = node('div', 'subject-group-heading');
    const subjectTitle = node('div');
    subjectTitle.append(node('span', 'group-kicker', 'SUBJECT'), node('h2', '', subject.label));
    subjectHead.append(subjectTitle, node('span', 'group-count', fmtCount(subject.count, 'question')));
    subjectSection.append(subjectHead);
    for (const [weekKey, week] of subject.weeks) {
      const weekSection = node('section', 'week-group');
      const weekLabel = weekKey === 'UNKNOWN' ? 'Week UNKNOWN' : /^week\b/i.test(weekKey) ? weekKey : `Week ${weekKey}`;
      weekSection.setAttribute('aria-label', weekLabel);
      const weekHead = node('div', 'week-group-heading');
      weekHead.append(node('h3', '', weekLabel), node('span', 'group-count', fmtCount(week.count, 'question')));
      weekSection.append(weekHead);
      for (const [topicKey, topicQuestions] of week.topics) {
        const topicSection = node('section', 'topic-group');
        topicSection.setAttribute('aria-label', `Topic ${topicKey}`);
        const topicHead = node('div', 'topic-group-heading');
        topicHead.append(node('h4', '', topicKey), node('span', 'topic-chevron', '⌄'));
        topicSection.append(topicHead);
        const cards = node('div', 'topic-questions');
        for (const question of topicQuestions) cards.append(renderQuestionCard(question));
        topicSection.append(cards);
        weekSection.append(topicSection);
      }
      subjectSection.append(weekSection);
    }
    fragment.append(subjectSection);
  }
  return fragment;
}
function renderQuestions() {
  updateFilterChoices();
  const questions = filteredQuestions();
  if (!questions.some((question) => idOf(question.id) === state.selectedQuestionId)) state.selectedQuestionId = questions[0] ? idOf(questions[0].id) : null;
  $('result-count').textContent = fmtCount(questions.length, 'question');
  $('result-context').textContent = questions.length === scopedQuestions().length ? 'All saved questions in this subject view' : `Showing ${questions.length} of ${scopedQuestions().length} saved`;
  $('question-subtitle').textContent = state.subject === 'all' ? 'Find the exact question you want to work on.' : `Questions saved for ${subjectName(state.subject)}.`;
  const list = $('question-list');
  list.replaceChildren();
  if (!state.questions.length) {
    list.append(emptyState('Your question bank is empty', 'Save course questions from your LMS to browse them here.', '▤'));
  } else if (!scopedQuestions().length) {
    list.append(emptyState('No questions for this subject yet', 'Choose another subject or save questions from this LMS course.', '▤'));
  } else if (!questions.length) {
    list.append(emptyState('No questions match these filters', 'Try a broader search or clear one or more filters.', '⌕', 'Clear filters', clearFilters));
  } else {
    list.append(renderQuestionGroups(questions));
  }
  renderQuestionDetail();
}
function renderQuestionCard(question) {
  const id = idOf(question.id);
  const isSelected = state.selectedQuestionId === id;
  const card = node('button', `question-card ${isSelected ? 'is-selected' : ''}`);
  card.type = 'button'; card.dataset.questionId = id; card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  
  const top = node('div', 'question-card-top');
  const indexEl = node('span', 'question-index', questionLabel(question).toUpperCase());
  top.append(indexEl);
  if (isSelected) {
    const checkmark = node('span', 'selected-check-icon');
    checkmark.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#4f46e5"><circle cx="12" cy="12" r="10" fill="#4f46e5"/><path d="m9 12 2 2 4-4" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    top.append(checkmark);
  } else {
    const subLabel = questionSubjectName(question);
    top.append(node('span', 'question-subject', subLabel));
  }
  
  const titleText = questionTitle(question);
  card.append(top, node('h4', 'question-card-title', titleText));
  
  const snippet = questionBody(question) || originalText(question) || (question.original?.htmlSnapshot ? 'Original HTML captured; open details to inspect the source.' : 'Question text was not captured.');
  card.append(node('p', 'question-preview', snippet));
  
  const bottom = node('div', 'question-card-bottom');
  const badges = node('div', 'question-meta');
  const weekVal = filterValue(question, 'week');
  if (weekVal) badges.append(node('span', 'pill accent', !/^week\b/i.test(weekVal) ? `Week ${weekVal}` : weekVal));
  const topicVal = filterValue(question, 'topic');
  if (topicVal) badges.append(node('span', 'pill', topicVal));
  const diffPill = difficultyPill(filterValue(question, 'difficulty'));
  if (diffPill) badges.append(diffPill);
  bottom.append(badges);
  
  const lmsUrl = questionLmsUrl(question);
  if (lmsUrl) {
    const lmsLink = node('a', 'card-lms-link', 'Open in LMS ↗');
    lmsLink.href = lmsUrl;
    lmsLink.target = '_blank';
    lmsLink.rel = 'noopener noreferrer';
    lmsLink.addEventListener('click', (e) => e.stopPropagation());
    bottom.append(lmsLink);
  } else if (!isSelected) {
    const arrow = node('span', 'card-arrow', '›');
    bottom.append(arrow);
  }
  card.append(bottom);
  card.addEventListener('click', () => { state.selectedQuestionId = id; renderQuestions(); });
  return card;
}
function renderQuestionDetail() {
  const container = $('question-detail');
  container.replaceChildren();
  const question = state.questionById.get(state.selectedQuestionId);
  if (!question) {
    const empty = node('div', 'detail-empty');
    empty.append(node('span', 'empty-icon', '▤'), node('strong', '', 'Select a question'), node('p', '', 'The source question and its saved details will appear here.'));
    container.append(empty);
    return;
  }
  state.detailTab = state.detailTab || 'original';

  // Detail top bar
  const topBar = node('div', 'detail-top-bar');
  const statusPill = node('span', 'pill accent', filterValue(question, 'topic') || questionSubjectName(question) || 'UNKNOWN');
  const moreBtn = node('button', 'more-btn', '⋮');
  moreBtn.type = 'button';
  moreBtn.title = 'More options';
  moreBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(questionLmsUrl(question) || originalText(question));
    showToast('Copied to clipboard.');
  });
  topBar.append(statusPill, moreBtn);
  container.append(topBar);

  // Big bold title
  const titleText = questionTitle(question);
  const titleEl = node('h2', 'detail-title', titleText);
  container.append(titleEl);

  // Badges row
  const badgesRow = node('div', 'detail-badges');
  const weekVal = filterValue(question, 'week');
  if (weekVal) badgesRow.append(node('span', 'pill accent', !/^week\b/i.test(weekVal) ? `Week ${weekVal}` : weekVal));
  const topicVal = filterValue(question, 'topic');
  if (topicVal) badgesRow.append(node('span', 'pill', topicVal));
  const diffPill = difficultyPill(filterValue(question, 'difficulty'));
  if (diffPill) badgesRow.append(diffPill);
  container.append(badgesRow);

  // Action buttons
  const toolbar = node('div', 'detail-toolbar');
  const lmsUrl = questionLmsUrl(question);
  if (lmsUrl) {
    const openLms = node('a', 'primary-button detail-action-btn', '');
    openLms.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg> Open in LMS ↗';
    openLms.href = lmsUrl;
    openLms.target = '_blank';
    openLms.rel = 'noopener noreferrer';
    toolbar.append(openLms);
  }
  const plan = node('button', 'secondary-button detail-action-btn', '');
  plan.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg> Plan question';
  plan.type = 'button'; plan.addEventListener('click', () => openTaskDialog(null, question));
  
  const copy = node('button', 'secondary-button detail-action-btn', '');
  copy.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> Copy text';
  copy.type = 'button'; copy.disabled = !originalText(question);
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(originalText(question)); showToast('Question text copied.'); }
    catch { showToast('Could not copy question text.'); }
  });

  const editMetadata = node('button', 'secondary-button detail-action-btn', '');
  editMetadata.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg> Edit metadata';
  editMetadata.type = 'button';
  const metadataEditor = renderMetadataEditor(question, editMetadata);
  metadataEditor.id = 'question-metadata-editor';
  editMetadata.setAttribute('aria-controls', metadataEditor.id);
  editMetadata.addEventListener('click', () => {
    metadataEditor.hidden = !metadataEditor.hidden;
    editMetadata.setAttribute('aria-expanded', metadataEditor.hidden ? 'false' : 'true');
    if (!metadataEditor.hidden) metadataEditor.querySelector('input')?.focus();
  });
  editMetadata.setAttribute('aria-expanded', 'false');
  toolbar.append(plan, copy, editMetadata);
  container.append(toolbar, metadataEditor);

  // Segmented Tabs: Original vs Preview
  const tabContainer = node('div', 'detail-tabs');
  const origTab = node('button', `detail-tab ${state.detailTab === 'original' ? 'is-active' : ''}`, 'Original');
  origTab.type = 'button';
  origTab.addEventListener('click', () => { state.detailTab = 'original'; renderQuestionDetail(); });
  const prevTab = node('button', `detail-tab ${state.detailTab === 'preview' ? 'is-active' : ''}`, 'Preview');
  prevTab.type = 'button';
  prevTab.addEventListener('click', () => { state.detailTab = 'preview'; renderQuestionDetail(); });
  tabContainer.append(origTab, prevTab);
  container.append(tabContainer);

  if (state.detailTab === 'original') {
    container.append(node('span', 'verbatim-label', 'Original question text'));
    const text = originalText(question);
    container.append(node('div', 'reading-pane', text || 'No plain text was captured for this question.'));
    container.append(node('p', 'detail-note', 'Displayed as saved, with original whitespace retained.'));
  } else {
    if (Array.isArray(question.original?.contentBlocks) && question.original.contentBlocks.length) {
      const preview = node('div', 'rich-preview');
      preview.append(node('span', 'verbatim-label', 'Formatting preview'));
      const rich = node('div', 'rich-content');
      rich.append(safeRichContent(question));
      preview.append(rich);
      container.append(preview);
    } else if (typeof question.original?.htmlSnapshot === 'string' && question.original.htmlSnapshot) {
      container.append(node('span', 'verbatim-label', 'HTML Snapshot'));
      container.append(node('pre', 'verbatim-text', question.original.htmlSnapshot));
    } else {
      container.append(node('p', 'detail-note', 'No rich preview available for this question.'));
    }
  }

  const meta = node('dl', 'detail-metadata');
  const rows = [
    ['Subject', questionSubjectName(question), field(question.metadata?.subject?.source)],
    ['Week', filterValue(question, 'week') || 'UNKNOWN', weekInfo(question).source],
    ['Session type', filterValue(question, 'sessionType')],
    ['Session', filterValue(question, 'session')],
    ['Session date', first(sessionOf(question)?.dateText, sessionOf(question)?.date), field(sessionOf(question)?.dateSource)],
    ['Assignment', filterValue(question, 'assignment')],
    ['Topic', filterValue(question, 'topic') || 'UNKNOWN', field(question.metadata?.topic?.source)],
    ['Subtopic', filterValue(question, 'subtopic') || 'UNKNOWN', field(question.metadata?.subtopic?.source)],
    ['Difficulty', filterValue(question, 'difficulty') || 'UNKNOWN', field(question.metadata?.difficulty?.source)],
    ['Question type', filterValue(question, 'questionType') || 'UNKNOWN', field(question.metadata?.questionType?.source)],
    ['Extraction status', filterValue(question, 'extractionStatus')],
    ['Classification source', filterValue(question, 'classificationSource')],
  ];
  for (const [label, value, source] of rows) {
    if (!value) continue;
    const row = node('div');
    const valueNode = node('dd', '', value);
    if (source) {
      const provenance = node('span', `provenance-badge ${source.toUpperCase() === 'USER' ? 'user' : ''}`, source.replaceAll('_', ' '));
      provenance.title = `${label} source: ${source}`;
      valueNode.append(provenance);
    }
    row.append(node('dt', '', label), valueNode);
    meta.append(row);
  }
  container.append(meta);
  const url = safeSourceUrl(question.source?.url);
  if (url) {
    const link = node('a', 'source-link', 'Open LMS source ↗');
    link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    container.append(link);
  }
}

function renderMetadataEditor(question, toggleButton) {
  const form = node('form', 'metadata-editor');
  form.hidden = true;
  form.noValidate = true;
  form.append(node('strong', '', 'Edit study metadata'), node('p', '', 'These labels help with search and filters. The captured question stays unchanged.'));
  const grid = node('div', 'metadata-editor-grid');
  const fields = [
    ['week', 'Week', 40], ['topic', 'Topic', 120], ['subtopic', 'Subtopic', 120],
    ['difficulty', 'Difficulty', 60], ['questionType', 'Question type', 80],
  ];
  const inputs = new Map();
  for (const [key, label, maxLength] of fields) {
    const labelNode = node('label', '', label);
    const input = node('input');
    input.type = 'text'; input.maxLength = maxLength;
    input.name = key;
    input.placeholder = 'UNKNOWN';
    const saved = field(question.metadata?.[key]);
    input.value = unknown(saved) ? '' : saved;
    labelNode.append(input);
    grid.append(labelNode);
    inputs.set(key, input);
  }
  form.append(grid, node('p', 'metadata-editor-help', 'Leave a field blank to mark it UNKNOWN.'));
  const error = node('p', 'form-error');
  error.hidden = true;
  error.setAttribute('role', 'alert');
  form.append(error);
  const actions = node('div', 'metadata-editor-actions');
  const cancel = node('button', 'secondary-button', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => { form.hidden = true; toggleButton.setAttribute('aria-expanded', 'false'); });
  const save = node('button', 'primary-button', 'Save metadata');
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const patch = {};
    for (const [key] of fields) {
      const entered = inputs.get(key).value.trim();
      const next = unknown(entered) ? 'UNKNOWN' : entered;
      const saved = field(question.metadata?.[key]);
      const current = unknown(saved) ? 'UNKNOWN' : saved;
      if (next !== current) patch[key] = { value: next, source: 'USER' };
    }
    if (!Object.keys(patch).length) {
      form.hidden = true;
      toggleButton.setAttribute('aria-expanded', 'false');
      showToast('No metadata changes to save.');
      return;
    }
    patch.classificationSource = 'USER';
    save.disabled = true;
    try {
      await updateQuestionMetadata(question.id, patch);
      await loadAll();
      showToast('Question metadata updated.');
    } catch (cause) {
      console.error('Could not update question metadata', cause);
      error.textContent = 'Could not save these edits. Please try again.';
      error.hidden = false;
      save.disabled = false;
    }
  });
  return form;
}
function clearFilters() {
  state.filters = Object.fromEntries(filterKeys.map((key) => [key, '']));
  state.search = '';
  $('filter-search').value = '';
  renderQuestions();
}
async function exportBackup() {
  const button = $('export-json');
  button.disabled = true;
  button.textContent = 'Preparing…';
  try {
    const storeNames = ['courses', 'sessions', 'assignments', 'questions', 'contentVersions', 'plans', 'syncRuns', 'settings'];
    const records = await Promise.all(storeNames.map((name) => getAll(name)));
    const stores = Object.fromEntries(storeNames.map((name, index) => [name, records[index]]));
    const backup = { format: 'StudyMadeEasy full-fidelity JSON backup', formatVersion: 1, exportedAt: new Date().toISOString(), stores };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = node('a');
    link.href = url;
    link.download = `studymadeeasy-backup-${dateKey(new Date())}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    showToast('JSON backup downloaded.');
  } catch (error) {
    console.error('Could not export JSON backup', error);
    showToast('Could not export the backup. Please try again.');
  } finally {
    button.disabled = false;
    button.textContent = 'Export JSON';
  }
}

async function importBackupFile(file) {
  if (!file) return;
  const button = $('import-json');
  button.disabled = true;
  button.textContent = 'Importing…';
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    if (!backup.stores || typeof backup.stores !== 'object') {
      throw new Error('Invalid backup file format.');
    }
    const count = await importBackupStores(backup.stores);
    await loadAll(false);
    showToast(`Imported ${count} items. Question bank updated!`);
  } catch (error) {
    console.error('Could not import backup', error);
    showToast(`Could not import backup: ${error.message || 'unknown error'}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Import JSON';
    $('import-json-file').value = '';
  }
}

async function autoRestoreIfEmpty() {
  if (state.questions.length === 0) {
    try {
      const url = chrome?.runtime?.getURL ? chrome.runtime.getURL('dashboard/backup_questions.json') : 'backup_questions.json';
      const res = await fetch(url);
      if (res.ok) {
        const backup = await res.json();
        if (backup?.stores?.questions?.length > 0) {
          await importBackupStores(backup.stores);
          await loadAll(false);
          showToast(`Restored ${backup.stores.questions.length} saved questions!`);
        }
      }
    } catch (e) {
      console.log('No local auto-restore backup', e);
    }
  }
}

function compareDue(a, b) { return (asDate(a.dueAt)?.getTime() || Infinity) - (asDate(b.dueAt)?.getTime() || Infinity); }
function weekRangeLabel(start) {
  const end = addDays(start, 6);
  const startMonth = humanDate(start, { month: 'short' });
  const endMonth = humanDate(end, { month: 'short' });
  return startMonth === endMonth ? `${startMonth} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}` : `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
}
function renderPlanner() {
  const plans = scopedPlans();
  const start = state.weekStart;
  const end = addDays(start, 7);
  const today = dateKey(new Date());
  $('week-range').textContent = weekRangeLabel(start);
  $('week-status').textContent = dateKey(start) === dateKey(startOfWeek(new Date())) ? 'Current week' : 'Your selected week';
  for (const mode of ['week', 'today']) {
    const button = $(`planner-${mode}-mode`);
    button.classList.toggle('is-active', mode === state.plannerMode);
    button.setAttribute('aria-pressed', mode === state.plannerMode ? 'true' : 'false');
  }
  const weekPlans = plans.filter((plan) => { const due = asDate(plan.dueAt); return due && due >= start && due < end; });
  const summary = $('planner-summary');
  summary.replaceChildren();
  for (const [count, label, css] of [
    [weekPlans.length, 'planned this week', ''],
    [weekPlans.filter(isCompleted).length, 'completed', ''],
    [plans.filter(isOverdue).length, 'overdue', 'overdue'],
  ]) {
    const chip = node('span', `summary-chip ${css}`);
    chip.append(node('strong', '', count), document.createTextNode(label));
    summary.append(chip);
  }
  const container = $('planner-content');
  container.replaceChildren();
  if (state.plannerMode === 'today') {
    const due = plans.filter((plan) => dateKey(plan.dueAt) === today || isOverdue(plan)).sort(compareDue);
    if (!due.length) {
      container.append(plannerEmpty('Nothing due today', 'Choose a question, topic, or personal task to build your plan.'));
      return;
    }
    container.append(renderDayCard(new Date(), due, true));
    return;
  }
  const earlierOverdue = plans.filter((plan) => isOverdue(plan) && asDate(plan.dueAt)?.getTime() < start.getTime()).sort(compareDue);
  if (earlierOverdue.length) container.append(renderDayCard(null, earlierOverdue, false, 'Overdue from earlier weeks'));
  for (let day = 0; day < 7; day++) {
    const date = addDays(start, day);
    const tasks = plans.filter((plan) => dateKey(plan.dueAt) === dateKey(date)).sort(compareDue);
    container.append(renderDayCard(date, tasks, dateKey(date) === today));
  }
  const unscheduled = plans.filter((plan) => !asDate(plan.dueAt));
  if (unscheduled.length) container.append(renderDayCard(null, unscheduled, false, 'Unscheduled'));
}
function plannerEmpty(title, description) {
  const box = node('div', 'planner-empty');
  box.append(node('span', 'empty-icon', '◷'), node('strong', '', title), node('p', '', description));
  const button = node('button', 'primary-button', '＋  Add a task');
  button.type = 'button'; button.addEventListener('click', () => openTaskDialog());
  box.append(button);
  return box;
}
function renderDayCard(date, tasks, isToday, customLabel = '') {
  const card = node('section', `day-card ${isToday ? 'is-today' : ''}`);
  const head = node('div', 'day-header');
  const title = node('div');
  title.append(node('strong', '', customLabel || humanDate(date, { weekday: 'long' })));
  if (date && !customLabel) title.append(node('small', '', humanDate(date, { month: 'short', day: 'numeric' })));
  head.append(title, node('span', 'day-count', fmtCount(tasks.length, 'task')));
  card.append(head);
  const body = node('div', 'day-body');
  if (!tasks.length) body.append(node('div', 'day-empty', 'Nothing planned yet'));
  else for (const task of tasks) body.append(renderTaskCard(task));
  card.append(body);
  return card;
}
function renderTaskCard(plan) {
  const complete = isCompleted(plan);
  const card = node('div', `task-card ${complete ? 'is-completed' : ''} ${isOverdue(plan) ? 'is-overdue' : ''}`);
  const check = node('button', 'check-control', complete ? '✓' : '');
  check.type = 'button'; check.setAttribute('aria-label', `${complete ? 'Reopen' : 'Complete'} ${first(plan.title, 'task')}`);
  check.title = complete ? 'Reopen task' : 'Mark complete';
  check.addEventListener('click', () => toggleComplete(plan));
  card.append(check);
  const body = node('div', 'task-body');
  body.append(node('span', 'task-title', first(plan.title, 'Untitled task')));
  const details = node('div', 'task-details');
  const kindLabels = { question: 'Question', topic: 'Topic', task: 'Personal task' };
  details.append(node('span', 'pill accent', kindLabels[plan.kind] || 'Task'));
  const subjectId = planSubjectId(plan);
  if (subjectId) details.append(node('span', 'pill', subjectName(subjectId)));
  if (plan.topic) details.append(node('span', 'pill', plan.topic));
  if (plan.dueAt) details.append(node('span', `pill ${isOverdue(plan) ? 'warning' : ''}`, isOverdue(plan) ? `Overdue · ${humanDate(plan.dueAt)} ${humanTime(plan.dueAt)}` : `Due ${humanTime(plan.dueAt)}`));
  if (plan.remindAt && !complete) details.append(node('span', 'pill', `Reminder ${humanDate(plan.remindAt)} ${humanTime(plan.remindAt)}`));
  body.append(details);
  if (plan.questionId && state.questionById.has(idOf(plan.questionId))) {
    const q = state.questionById.get(idOf(plan.questionId));
    const url = questionLmsUrl(q);
    const link = node('button', 'text-button', 'View saved question →');
    link.type = 'button'; link.style.marginTop = '8px';
    link.addEventListener('click', () => { state.selectedQuestionId = idOf(plan.questionId); state.subject = 'all'; $('subject-select').value = 'all'; setView('questions'); });
    body.append(link);
    if (url) {
      const lmsLink = node('a', 'text-button', 'Open in LMS ↗');
      lmsLink.href = url; lmsLink.target = '_blank'; lmsLink.rel = 'noopener noreferrer';
      lmsLink.style.marginTop = '8px'; lmsLink.style.marginLeft = '12px';
      body.append(lmsLink);
    }
  }
  card.append(body);
  const actions = node('div', 'task-actions');
  const edit = node('button', '', 'Edit');
  edit.type = 'button'; edit.title = `Edit ${first(plan.title, 'task')}`;
  edit.addEventListener('click', () => openTaskDialog(plan));
  const remove = node('button', '', 'Delete');
  remove.type = 'button'; remove.dataset.action = 'delete-task'; remove.title = `Delete ${first(plan.title, 'task')}`;
  remove.addEventListener('click', () => deleteTask(plan));
  actions.append(edit, remove);
  card.append(actions);
  return card;
}
function updateQuestionOptions(selected = '') {
  const subject = $('task-subject').value;
  const questions = state.questions.filter((question) => !subject || questionSubjectId(question) === subject).sort(compareSource);
  const choices = questions.map((question) => ({ value: idOf(question.id), label: `${questionLabel(question)} · ${truncate(originalText(question), 70) || questionSubjectName(question)}` }));
  populateSelect($('task-question'), choices, 'Choose a saved question', selected);
}
function updateKindFields() {
  const isQuestion = $('task-kind').value === 'question';
  $('task-question-field').hidden = !isQuestion;
  $('task-question').required = isQuestion;
  $('task-topic').placeholder = $('task-kind').value === 'topic' ? 'What topic will you cover?' : 'Optional topic';
}
function openTaskDialog(plan = null, question = null) {
  state.editingPlanId = plan ? idOf(plan.id) : null;
  const dialog = $('task-dialog');
  $('task-form').reset();
  $('task-form-error').hidden = true;
  $('task-dialog-heading').textContent = plan ? 'Edit task' : 'Add a task';
  $('save-task').textContent = plan ? 'Save changes' : 'Save task';
  const questionOption = $('task-kind').querySelector('option[value="question"]');
  questionOption.disabled = state.questions.length === 0;
  const kind = plan?.kind || (question ? 'question' : state.questions.length ? 'question' : 'topic');
  $('task-kind').value = kind;
  if (!$('task-kind').value) $('task-kind').value = 'topic';
  $('task-title').value = first(plan?.title, question && `Solve ${questionLabel(question).toLowerCase()}`);
  const selectedSubject = idOf(plan?.subjectId) || (question ? questionSubjectId(question) : state.subject === 'all' ? '' : state.subject);
  populateSelect($('task-subject'), state.subjects.map((subject) => ({ value: subject.id, label: subject.name })), 'No subject', selectedSubject);
  $('task-topic').value = first(plan?.topic, question && filterValue(question, 'topic'));
  const defaultDue = new Date();
  if (dateKey(startOfWeek(defaultDue)) !== dateKey(state.weekStart) && state.view === 'planner') defaultDue.setTime(state.weekStart.getTime());
  else if (defaultDue.getHours() >= 18) defaultDue.setDate(defaultDue.getDate() + 1);
  defaultDue.setHours(18, 0, 0, 0);
  $('task-due').value = localInputValue(plan?.dueAt || defaultDue);
  $('task-remind').value = localInputValue(plan?.remindAt);
  updateQuestionOptions(idOf(plan?.questionId || question?.id));
  updateKindFields();
  dialog.showModal();
  $('task-title').focus();
}
function closeTaskDialog() { $('task-dialog').close(); state.editingPlanId = null; }
function formError(message) { const error = $('task-form-error'); error.textContent = message; error.hidden = false; }
async function notifyReminderScheduler() {
  try {
    if (globalThis.chrome?.runtime?.sendMessage) await chrome.runtime.sendMessage({ type: 'RESCHEDULE_PLANS' });
  } catch (error) { console.warn('Reminder scheduling will retry on extension startup', error); }
}
async function saveTask(event) {
  event.preventDefault();
  $('task-form-error').hidden = true;
  const kind = $('task-kind').value;
  const questionId = kind === 'question' ? $('task-question').value : '';
  const title = $('task-title').value.trim();
  const due = asDate($('task-due').value);
  const reminder = asDate($('task-remind').value);
  if (kind === 'question' && !questionId) return formError('Choose a saved question to solve.');
  if (!title) return formError('Enter a task title.');
  if (!due) return formError('Choose a due date and time.');
  if ($('task-remind').value && !reminder) return formError('Choose a valid reminder time.');
  if (reminder && reminder > due) return formError('Set the reminder before the task is due.');
  const existing = state.plans.find((plan) => idOf(plan.id) === state.editingPlanId);
  if (reminder && reminder.getTime() <= Date.now() && reminder.toISOString() !== existing?.remindAt) return formError('Choose a future reminder time.');
  const now = new Date().toISOString();
  const subjectId = $('task-subject').value || (questionId ? questionSubjectId(state.questionById.get(questionId) || {}) : '') || null;
  const record = {
    ...(existing || {}),
    id: existing?.id || crypto.randomUUID(), title, kind, subjectId,
    topic: $('task-topic').value.trim() || null,
    questionId: questionId || null,
    weekStart: dateKey(startOfWeek(due)), dueAt: due.toISOString(),
    remindAt: reminder ? reminder.toISOString() : null,
    status: existing?.status || 'pending', createdAt: existing?.createdAt || now, updatedAt: now,
  };
  try {
    await putRecord('plans', record);
    closeTaskDialog();
    await notifyReminderScheduler();
    await loadAll();
    showToast(existing ? 'Task updated.' : 'Task added to your planner.');
  } catch (error) {
    console.error('Could not save task', error);
    formError('Could not save this task. Please try again.');
  }
}
async function toggleComplete(plan) {
  try {
    await putRecord('plans', { ...plan, status: isCompleted(plan) ? 'pending' : 'completed', updatedAt: new Date().toISOString() });
    await notifyReminderScheduler();
    await loadAll();
    showToast(isCompleted(plan) ? 'Task reopened.' : 'Task completed.');
  } catch (error) { console.error('Could not update task', error); showToast('Could not update this task.'); }
}
async function deleteTask(plan) {
  if (!window.confirm(`Delete “${first(plan.title, 'this task')}” from your planner?`)) return;
  try {
    await deleteRecord('plans', plan.id);
    await notifyReminderScheduler();
    await loadAll();
    showToast('Task deleted.');
  } catch (error) { console.error('Could not delete task', error); showToast('Could not delete this task.'); }
}
function bindEvents() {
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  document.querySelectorAll('[data-action="add-task"]').forEach((button) => button.addEventListener('click', () => openTaskDialog()));
  $('subject-select').addEventListener('change', (event) => { state.subject = event.target.value; render(); });
  $('refresh-button').addEventListener('click', async () => { await loadAll(); showToast('Saved records refreshed.'); });
  $('filter-search').addEventListener('input', (event) => { state.search = event.target.value.trim(); renderQuestions(); });
  document.querySelectorAll('[data-filter]').forEach((select) => select.addEventListener('change', (event) => { state.filters[event.target.dataset.filter] = event.target.value; renderQuestions(); }));
  $('sort-select').addEventListener('change', (event) => { state.sort = event.target.value; renderQuestions(); });
  $('clear-filters').addEventListener('click', clearFilters);
  $('clear-filters-top').addEventListener('click', clearFilters);
  $('export-json').addEventListener('click', exportBackup);
  $('import-json').addEventListener('click', () => $('import-json-file').click());
  $('import-json-file').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) importBackupFile(file);
  });
  $('previous-week').addEventListener('click', () => { state.weekStart = addDays(state.weekStart, -7); renderPlanner(); });
  $('next-week').addEventListener('click', () => { state.weekStart = addDays(state.weekStart, 7); renderPlanner(); });
  $('this-week').addEventListener('click', () => { state.weekStart = startOfWeek(new Date()); renderPlanner(); });
  for (const mode of ['week', 'today']) $(`planner-${mode}-mode`).addEventListener('click', () => { state.plannerMode = mode; renderPlanner(); });
  $('task-kind').addEventListener('change', updateKindFields);
  $('task-subject').addEventListener('change', () => updateQuestionOptions());
  $('task-question').addEventListener('change', () => {
    const question = state.questionById.get($('task-question').value);
    if (!question) return;
    const subjectId = questionSubjectId(question);
    if (subjectId) $('task-subject').value = subjectId;
    if (!$('task-title').value.trim()) $('task-title').value = `Solve ${questionLabel(question).toLowerCase()}`;
    if (!$('task-topic').value.trim()) $('task-topic').value = filterValue(question, 'topic');
  });
  $('task-form').addEventListener('submit', saveTask);
  $('close-dialog').addEventListener('click', closeTaskDialog);
  $('cancel-task').addEventListener('click', closeTaskDialog);
  $('task-dialog').addEventListener('close', () => { state.editingPlanId = null; });
  window.addEventListener('focus', () => { loadAll(); });

  // Sidebar off-canvas drawer toggle via ☰ hamburger (three lines)
  $('menu-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSidebar();
  });
  $('sidebar-close-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSidebar();
  });
  $('sidebar-backdrop')?.addEventListener('click', () => {
    closeSidebar();
  });
  document.querySelectorAll('#sidebar .nav-item').forEach((item) => {
    item.addEventListener('click', () => closeSidebar());
  });

  // Close drawer on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSidebar();
    }
  });
}

bindEvents();
if (location.hash === '#planner') setView('planner');
if (location.hash === '#questions') setView('questions');
loadAll();
