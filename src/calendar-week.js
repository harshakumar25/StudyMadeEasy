// Calendar buckets are derived from the LMS session date. They are not the
// course's academic week number. All arithmetic uses UTC date components so
// the same session stays in the same Monday–Sunday bucket in every timezone.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dateParts(value) {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const english = value.trim().match(/^(?:(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (!english) return null;
  return {
    weekday: english[1] ? DAYS.findIndex((day) => day.toLowerCase() === english[1].toLowerCase()) : null,
    year: Number(english[4]), month: MONTHS.findIndex((month) => month.toLowerCase() === english[2].toLowerCase()) + 1,
    day: Number(english[3]),
  };
}

export function calendarWeekFromDate(value) {
  if (typeof value !== 'string') return null;
  const parts = dateParts(value);
  if (!parts) return null;
  const { year, month, day } = parts;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (parts.weekday !== null && parts.weekday !== undefined && date.getUTCDay() !== parts.weekday) return null;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const start = monday.toISOString().slice(0, 10);
  const end = sunday.toISOString().slice(0, 10);
  return { value: `${start} – ${end}`, start, end, source: 'RULE' };
}
