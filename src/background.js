import { getAll, saveSourceExtraction } from './db.js';

const ALARM_PREFIX = 'study-plan-reminder:';
const NOTIFICATION_PREFIX = 'study-plan-notification:';
const DASHBOARD_PATH = 'dashboard/index.html#planner';

function timestamp(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function taskIsComplete(task) {
  return task.completed === true || task.done === true || task.isCompleted === true ||
    Boolean(task.completedAt) || /^(done|complete|completed)$/i.test(String(task.status || ''));
}

function planTasks(plans) {
  const reminders = [];
  for (const [planIndex, plan] of plans.entries()) {
    const tasks = Array.isArray(plan.tasks)
      ? plan.tasks
      : Array.isArray(plan.items)
        ? plan.items
        : plan.remindAt != null
          ? [plan]
          : [];

    for (const [taskIndex, task] of tasks.entries()) {
      if (!task || typeof task !== 'object') continue;
      const planKey = encodeURIComponent(String(plan.id ?? plan.key ?? planIndex));
      const taskKey = encodeURIComponent(String(task.id ?? task.key ?? taskIndex));
      const name = `${ALARM_PREFIX}${planKey}:${taskKey}:${taskIndex}`;
      const when = timestamp(task.remindAt);
      reminders.push({ name, when, task, plan });
    }
  }
  return reminders;
}

async function syncPlanAlarms() {
  const plans = await getAll('plans');
  const now = Date.now();
  const due = new Map(planTasks(plans || [])
    .filter(({ when, task }) => Number.isFinite(when) && when > now && !taskIsComplete(task))
    .map((reminder) => [reminder.name, reminder]));
  const existing = await chrome.alarms.getAll();

  for (const alarm of existing) {
    if (!alarm.name.startsWith(ALARM_PREFIX)) continue;
    const current = due.get(alarm.name);
    if (!current || Math.abs(alarm.scheduledTime - current.when) > 1000) {
      await chrome.alarms.clear(alarm.name);
    }
  }

  const scheduled = new Map(existing
    .filter((alarm) => alarm.name.startsWith(ALARM_PREFIX))
    .map((alarm) => [alarm.name, alarm.scheduledTime]));
  for (const reminder of due.values()) {
    const previousTime = scheduled.get(reminder.name);
    if (previousTime === undefined || Math.abs(previousTime - reminder.when) > 1000) {
      await chrome.alarms.create(reminder.name, { when: reminder.when });
    }
  }
  return { scheduled: due.size };
}

async function showDueReminder(alarm) {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  // Read the task again: an alarm can fire after a plan was edited or completed.
  const plans = await getAll('plans');
  const reminder = planTasks(plans || []).find((item) => item.name === alarm.name);
  if (!reminder || taskIsComplete(reminder.task) || !Number.isFinite(reminder.when)) return;
  if (Math.abs(reminder.when - alarm.scheduledTime) > 1000) return;

  const title = String(reminder.task.title || reminder.task.text || reminder.task.label || reminder.plan.title || 'Study task').trim();
  const courseId = reminder.task.subjectId || reminder.plan.subjectId;
  const course = courseId ? (await getAll('courses')).find((item) => item.id === courseId) : null;
  const subject = String(reminder.task.subject || reminder.plan.subject || course?.name || reminder.plan.courseTitle || '').trim();
  const message = subject ? `${title} · ${subject}` : title;
  await chrome.notifications.create(`${NOTIFICATION_PREFIX}${alarm.name}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('popup/reminder-icon.png'),
    title: 'Study reminder',
    message: message.slice(0, 240),
    priority: 1,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void syncPlanAlarms().catch((error) => console.error('Could not schedule study reminders:', error));
});

chrome.runtime.onStartup.addListener(() => {
  void syncPlanAlarms().catch((error) => console.error('Could not schedule study reminders:', error));
});

// MV3 workers may restart independently of the browser. Reconcile saved tasks
// whenever this worker starts; alarm state is not relied on as durable storage.
void syncPlanAlarms().catch((error) => console.error('Could not restore study reminders:', error));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SAVE_EXTRACTION') {
    (async () => {
      if (!message.payload || typeof message.payload !== 'object') {
        throw new Error('Missing extraction payload.');
      }
      const summary = await saveSourceExtraction(message.payload);
      return { ok: true, summary: summary || {} };
    })().then(sendResponse, (error) => sendResponse({ ok: false, error: error?.message || 'Could not save extraction.' }));
    return true;
  }

  if (message?.type === 'RESCHEDULE_PLANS') {
    syncPlanAlarms()
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Could not schedule reminders.' }));
    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void showDueReminder(alarm).catch((error) => console.error('Could not show study reminder:', error));
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
  void chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD_PATH) });
  void chrome.notifications.clear(notificationId);
});
