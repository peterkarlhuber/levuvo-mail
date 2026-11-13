// Quick time choices for "send later", "snooze" and "follow up".
export type WhenPreset = { key: 'later' | 'evening' | 'tomorrow' | 'monday' | 'nextWeek'; date: Date };

export function whenPresets(now = new Date()): WhenPreset[] {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const daysToMonday = (8 - now.getDay()) % 7 || 7;
  const list: WhenPreset[] = [];
  if (now.getHours() < 19)
    list.push({ key: 'later', date: new Date(Math.ceil((now.getTime() + 3 * 3_600_000) / 900_000) * 900_000) });
  if (now.getHours() < 17) list.push({ key: 'evening', date: at(0, 18) });
  list.push({ key: 'tomorrow', date: at(1, 8) });
  if (daysToMonday > 1) list.push({ key: 'monday', date: at(daysToMonday, 8) });
  list.push({ key: 'nextWeek', date: at(7, 8) });
  return list;
}

/** Local value for <input type="datetime-local">. */
export function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const FOLLOW_UP_DAYS = [1, 3, 7] as const;
