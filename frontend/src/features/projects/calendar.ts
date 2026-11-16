// Purpose: Display calendar deadlines without timezone or DST drift.
// Pattern: Native PlainDate when available, numeric Gregorian ordinals otherwise.
// Usage: Project cards and URL filter validation; dates remain YYYY-MM-DD strings.
// Related: project-card.tsx, backend/src/modules/projects/dates.rs.
import { useEffect, useState } from 'react';
type PlainDate = { until: (other: string) => { days: number }; toString: () => string };
const temporal = (
  globalThis as unknown as {
    Temporal?: {
      PlainDate: { from: (date: string) => PlainDate };
      Now: { plainDateISO: () => PlainDate };
    };
  }
).Temporal;
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  if (year < 1900 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
function ordinal(value: string) {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}
export function deadline(value: string | null, today: string) {
  if (!value || !validDate(value)) return { label: '마감일 미정', urgent: false };
  const days = temporal
    ? temporal.PlainDate.from(today).until(value).days
    : ordinal(value) - ordinal(today);
  return { label: days === 0 ? 'D-Day' : days > 0 ? `D-${days}` : `D+${-days}`, urgent: days <= 7 };
}
function localToday() {
  if (temporal) return temporal.Now.plainDateISO().toString();
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function useToday() {
  const [today, setToday] = useState(localToday);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      setToday(localToday());
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(update, next.getTime() - now.getTime() + 50);
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return today;
}
