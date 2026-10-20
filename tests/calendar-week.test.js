import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarWeekFromDate } from '../src/calendar-week.js';

test('session dates group into a stable Monday–Sunday calendar week', () => {
  assert.deepEqual(calendarWeekFromDate('2026-10-15'), {
    value: '2026-10-12 – 2026-10-18', start: '2026-10-12', end: '2026-10-18', source: 'RULE',
  });
  assert.equal(calendarWeekFromDate('2026-10-12')?.value, '2026-10-12 – 2026-10-18');
  assert.equal(calendarWeekFromDate('2026-10-18')?.value, '2026-10-12 – 2026-10-18');
  assert.equal(calendarWeekFromDate('2026-10-19')?.value, '2026-10-19 – 2026-10-25');
  assert.equal(calendarWeekFromDate('Thursday, October 15, 2026')?.value, '2026-10-12 – 2026-10-18');
});

test('calendar week remains correct over a year boundary and rejects incomplete dates', () => {
  assert.equal(calendarWeekFromDate('2027-01-01')?.value, '2026-12-28 – 2027-01-03');
  assert.equal(calendarWeekFromDate('2026-02-30'), null);
  assert.equal(calendarWeekFromDate('15, October'), null);
  assert.equal(calendarWeekFromDate('Friday, October 15, 2026'), null);
  assert.equal(calendarWeekFromDate(null), null);
});
