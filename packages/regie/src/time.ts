/** The time zone every displayed time uses. It follows the browser for now; a setting can replace this later. */
export const systemTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatter = (timeZone: string) => {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-CA", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(timeZone, found);
  }
  return found;
};

const parts = (time: number, timeZone: string) => {
  const result: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(time))) result[part.type] = part.value;
  return result;
};

/** "YYYY-MM-DD HH:MM" (or with ":SS") in the system time zone. Invalid times give "". */
export const formatTime = (time: number, options: { seconds?: boolean; timeZone?: string } = {}): string => {
  if (!Number.isFinite(time)) return "";
  const p = parts(time, options.timeZone ?? systemTimeZone());
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}${options.seconds ? `:${p.second}` : ""}`;
};

/** "YYYY/M/D" in the system time zone. */
export const formatDate = (time: number, timeZone: string = systemTimeZone()): string => {
  if (!Number.isFinite(time)) return "";
  const p = parts(time, timeZone);
  return `${Number(p.year)}/${Number(p.month)}/${Number(p.day)}`;
};
