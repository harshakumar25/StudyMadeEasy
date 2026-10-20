import { getAll } from '../src/db.js';

const elements = {
  lmsStatus: document.getElementById('lms-status'),
  subject: document.getElementById('subject'),
  pageHint: document.getElementById('page-hint'),
  questionCount: document.getElementById('question-count'),
  sessionCount: document.getElementById('session-count'),
  lastSync: document.getElementById('last-sync'),
  feedback: document.getElementById('feedback'),
  syncButton: document.getElementById('sync-button'),
  syncButtonLabel: document.getElementById('sync-button-label'),
  bankButton: document.getElementById('bank-button'),
  plannerButton: document.getElementById('planner-button'),
};

let activeTabId = null;
let supportedPage = false;
let syncablePage = false;
let syncing = false;
let syncLabel = 'Sync Current Course';

function setFeedback(message, kind = '') {
  elements.feedback.textContent = message;
  elements.feedback.className = `feedback ${kind}`.trim();
  elements.feedback.hidden = !message;
}

function setPageState({ supported, courseTitle, pageType } = {}) {
  supportedPage = supported === true;
  syncablePage = supportedPage && ['COURSE', 'SESSION', 'QUESTION'].includes(pageType);
  syncLabel = pageType === 'QUESTION' ? 'Sync This Question' : pageType === 'SESSION' ? 'Sync This Session' : 'Sync Current Course';
  if (!syncing) elements.syncButtonLabel.textContent = syncLabel;
  elements.lmsStatus.textContent = supportedPage ? 'LMS detected' : 'Not detected';
  elements.lmsStatus.className = `status ${supportedPage ? 'status-detected' : 'status-missing'}`;
  elements.subject.textContent = supportedPage
    ? (courseTitle?.trim() || 'Subject not identified')
    : 'No LMS course on this tab';
  elements.pageHint.textContent = supportedPage
    ? (pageType === 'COURSE' ? 'Ready to save this course.' : pageType === 'QUESTION' ? 'Ready to save the question shown on this page.' : pageType === 'SESSION' ? 'Ready to save this session.' : 'Open a course to sync it.')
    : 'Open a supported LMS course in this tab to sync it.';
  elements.syncButton.disabled = !syncablePage || syncing;
}

function parseTime(value) {
  if (!value) return NaN;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

async function loadStoredSummary() {
  try {
    const [questions, sessions, courses, syncRuns] = await Promise.all([
      getAll('questions'),
      getAll('sessions'),
      getAll('courses'),
      getAll('syncRuns').catch(() => []),
    ]);
    elements.questionCount.textContent = (questions?.length || 0).toLocaleString();
    elements.sessionCount.textContent = (sessions?.length || 0).toLocaleString();

    const completedSyncTimes = (syncRuns || [])
      .filter((run) => !run.status || /^(completed|complete|success)$/i.test(run.status))
      .flatMap((run) => [run.completedAt, run.finishedAt, run.syncedAt]);
    const courseSyncTimes = (courses || []).flatMap((course) => [course.lastSyncedAt, course.syncedAt]);
    const lastSync = Math.max(...[...completedSyncTimes, ...courseSyncTimes].map(parseTime).filter(Number.isFinite));
    elements.lastSync.textContent = Number.isFinite(lastSync) ? formatDate(lastSync) : 'Not synced';

    if (!questions?.length && !sessions?.length && !syncing) {
      setFeedback('Your question bank is empty. Open a course on the LMS and sync its visible content.');
    } else if (!syncing && elements.feedback.className !== 'feedback success') {
      setFeedback('');
    }
  } catch (error) {
    elements.questionCount.textContent = '—';
    elements.sessionCount.textContent = '—';
    elements.lastSync.textContent = 'Unavailable';
    setFeedback(`Could not read saved data: ${error?.message || 'unknown error'}`, 'error');
  }
}

async function detectPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id ?? null;
    if (activeTabId === null) {
      setPageState();
      return;
    }
    const context = await chrome.tabs.sendMessage(activeTabId, { type: 'GET_PAGE_CONTEXT' });
    setPageState(context);
  } catch {
    setPageState();
  }
}

async function syncCurrentPage() {
  if (!syncablePage || activeTabId === null || syncing) return;
  syncing = true;
  elements.syncButton.disabled = true;
  elements.syncButtonLabel.textContent = 'Syncing…';
  setFeedback('Reading the content available on this LMS page.');
  try {
    const response = await chrome.tabs.sendMessage(activeTabId, { type: 'SYNC_CURRENT_PAGE' });
    if (!response?.ok) throw new Error(response?.error || 'The page could not be synced.');
    const summary = response.summary || {};
    const count = Number(summary.questionsExtracted ?? summary.questions ?? summary.questionCount);
    setFeedback(Number.isFinite(count)
      ? `Sync complete. ${count} question${count === 1 ? '' : 's'} found on this page.`
      : 'Sync complete. Review the saved content in your question bank.', 'success');
    await loadStoredSummary();
  } catch (error) {
    setFeedback(`Sync failed: ${error?.message || 'unknown error'}`, 'error');
  } finally {
    syncing = false;
    elements.syncButtonLabel.textContent = syncLabel;
    elements.syncButton.disabled = !syncablePage;
  }
}

function openDashboard(hash = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard/index.html${hash}`) });
}

elements.syncButton.addEventListener('click', syncCurrentPage);
elements.bankButton.addEventListener('click', () => openDashboard());
elements.plannerButton.addEventListener('click', () => openDashboard('#planner'));

await Promise.all([detectPage(), loadStoredSummary()]);
