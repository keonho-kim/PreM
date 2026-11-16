// Purpose: Model project end dates as calendar dates and calculate day-based deadlines.
// Pattern: Native Temporal when available, with a narrow UTC calendar-arithmetic fallback.
// Usage: Shared by project creation, gallery filtering and sample fixtures.
// Related: data.js, forms.js, project-gallery.js.
window.PuPuTyXModules.projectDates = (() => {
  const dayMs = 86_400_000;
  function dayNumber(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1900 || year > 9999) return null;
    const time = Date.UTC(year, month - 1, day),
      date = new Date(time);
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
      ? time / dayMs
      : null;
  }
  function today() {
    if (globalThis.Temporal?.Now) return Temporal.Now.plainDateISO().toString();
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  function difference(end, start = today()) {
    if (dayNumber(end) === null || dayNumber(start) === null) return null;
    if (globalThis.Temporal?.PlainDate)
      return Temporal.PlainDate.from(start).until(Temporal.PlainDate.from(end)).days;
    return dayNumber(end) - dayNumber(start);
  }
  function shift(days, start = today()) {
    if (globalThis.Temporal?.PlainDate)
      return Temporal.PlainDate.from(start).add({ days }).toString();
    return new Date((dayNumber(start) + days) * dayMs).toISOString().slice(0, 10);
  }
  function deadline(end) {
    const days = difference(end);
    return days === null
      ? { text: '종료일 미정', state: 'unknown', label: '종료일 미정' }
      : days === 0
        ? { text: 'D-Day', state: 'today', label: '오늘 종료' }
        : days > 0
          ? {
              text: `D-${days}`,
              state: days <= 7 ? 'soon' : 'upcoming',
              label: `종료까지 ${days}일`,
            }
          : {
              text: `D+${Math.abs(days)}`,
              state: 'overdue',
              label: `종료일이 ${Math.abs(days)}일 지남`,
            };
  }
  return {
    today,
    difference,
    shift,
    deadline,
    valid: (value) => dayNumber(value) !== null,
    label: (value) => (dayNumber(value) === null ? '미정' : value.replaceAll('-', '.')),
  };
})();
