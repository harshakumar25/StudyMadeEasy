import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { putRecord } from '../src/db.js';

test('a plan reminder is scheduled, moved, and cancelled on completion', async () => {
  const alarms = new Map();
  const listeners = {};
  globalThis.chrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      onInstalled: { addListener: (handler) => { listeners.installed = handler; } },
      onStartup: { addListener: (handler) => { listeners.startup = handler; } },
      onMessage: { addListener: (handler) => { listeners.message = handler; } },
    },
    alarms: {
      getAll: async () => [...alarms].map(([name, scheduledTime]) => ({ name, scheduledTime })),
      create: async (name, info) => { alarms.set(name, info.when); },
      clear: async (name) => alarms.delete(name),
      onAlarm: { addListener: (handler) => { listeners.alarm = handler; } },
    },
    notifications: {
      create: async () => {}, clear: async () => {},
      onClicked: { addListener: (handler) => { listeners.clicked = handler; } },
    },
    tabs: { create: async () => {} },
  };
  await import('../src/background.js');
  const reschedule = () => new Promise((resolve) => {
    listeners.message({ type: 'RESCHEDULE_PLANS' }, {}, resolve);
  });
  const now = Date.now();
  const plan = {
    id: 'reminder-plan', title: 'Complete lab practice', status: 'pending',
    weekStart: '2026-10-12', dueAt: new Date(now + 3_600_000).toISOString(),
    remindAt: new Date(now + 1_800_000).toISOString(),
  };
  await putRecord('plans', plan);
  assert.equal((await reschedule()).ok, true);
  assert.equal(alarms.size, 1);
  assert.equal([...alarms.values()][0], Date.parse(plan.remindAt));

  const moved = { ...plan, remindAt: new Date(now + 2_400_000).toISOString() };
  await putRecord('plans', moved);
  assert.equal((await reschedule()).ok, true);
  assert.equal(alarms.size, 1);
  assert.equal([...alarms.values()][0], Date.parse(moved.remindAt));

  await putRecord('plans', { ...moved, status: 'completed' });
  assert.equal((await reschedule()).ok, true);
  assert.equal(alarms.size, 0);
});
