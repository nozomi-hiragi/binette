import type { SavedSchedule, SystemStore } from "./store.ts";

/** 曜日の名前 */
export type ScheduleDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** 予定の形（[scheduler.md](../../../docs/spec/scheduler.md#予定の形)）。時刻は端末の時刻帯で解く */
export type ScheduleRule =
  | { every: number }
  | { at: string }
  | { daily: string }
  | { weekly: { days: ScheduleDay[]; time: string } }
  | { monthly: { day: number; time: string } };

/** 前回の実行 */
export interface ScheduleRun {
  /** 実行を始めた時刻（Unix epoch ミリ秒） */
  time: number;
  /** `ok` か `error: …` */
  result: string;
}

/** 一覧に出す予定 */
export interface ScheduleInfo {
  id: string;
  owner: string;
  label?: string;
  rule: ScheduleRule;
  enabled: boolean;
  registered: number;
  last?: ScheduleRun;
  /** 次の実行の時刻。止めている、または `at` を過ぎたときは undefined */
  next?: number;
  running: boolean;
}

/** OS が登録する予定 */
export interface ScheduleJob {
  id: string;
  owner: string;
  label?: string;
  /** 初期値。保存した予定があれば、そちらを使う */
  rule: ScheduleRule;
  run(): Promise<void> | void;
}

/** スケジューラ */
export interface Scheduler {
  /** 予定を登録する。保存した予定があれば、形・止めているか・前回はそちらを使う。返す関数で登録を外す（保存は残す） */
  register(job: ScheduleJob): () => void;
  list(): ScheduleInfo[];
  update(id: string, change: { rule?: ScheduleRule; enabled?: boolean }): Promise<void>;
  /** 止めていても、今すぐ実行する。終わるまで待つ */
  runNow(id: string): Promise<void>;
  /** 予定が変わったら知らせる。返す関数で外す */
  subscribe(listener: () => void): () => void;
  /** 確かめ始める */
  start(): void;
  stop(): void;
}

export interface SchedulerOptions {
  store: Pick<SystemStore, "getSchedules" | "putSchedules">;
  now?: () => number;
  report?: (error: unknown) => void;
  /** 確かめる間隔の上限（ミリ秒）。既定 60 秒 */
  maxWait?: number;
}

/** `every` の下限（秒）。OS の予定とアプリの予定 */
export const SCHEDULE_MIN_EVERY = { os: 60, app: 900 } as const;

const DAYS: readonly ScheduleDay[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const AT = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

const parseTime = (value: unknown, name: string): [number, number] => {
  const match = typeof value === "string" ? TIME.exec(value) : null;
  if (!match) throw new Error(`${name} は "HH:MM" の時刻にしてください。`);
  return [Number(match[1]), Number(match[2])];
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[], name: string) => {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${name} に知らない欄 ${key} があります。`);
};

/** 予定の形を確かめて写しを返す。`minEvery` は `every` の下限（秒） */
export function parseScheduleRule(value: unknown, minEvery: number = SCHEDULE_MIN_EVERY.app): ScheduleRule {
  if (!isObject(value)) throw new Error("予定の形はオブジェクトにしてください。");
  const keys = Object.keys(value);
  if (keys.length !== 1) throw new Error("予定の形は every・at・daily・weekly・monthly のどれか 1 つにしてください。");
  const [key] = keys;
  const body = value[key];
  switch (key) {
    case "every":
      if (typeof body !== "number" || !Number.isSafeInteger(body) || body < minEvery) throw new Error(`every は ${minEvery} 以上の整数（秒）にしてください。`);
      return { every: body };
    case "at": {
      const match = typeof body === "string" ? AT.exec(body) : null;
      if (match) {
        const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return { at: body as string };
      }
      throw new Error('at は "YYYY-MM-DDTHH:MM" の日時にしてください。');
    }
    case "daily":
      parseTime(body, "daily");
      return { daily: body as string };
    case "weekly": {
      if (!isObject(body)) throw new Error("weekly は { days, time } にしてください。");
      onlyKeys(body, ["days", "time"], "weekly");
      const days = body.days;
      if (!Array.isArray(days) || days.length === 0 || !days.every(day => DAYS.includes(day)) || new Set(days).size !== days.length) {
        throw new Error("weekly.days は mon・tue・wed・thu・fri・sat・sun を重ねずに 1 つ以上並べてください。");
      }
      parseTime(body.time, "weekly.time");
      return { weekly: { days: [...days] as ScheduleDay[], time: body.time as string } };
    }
    case "monthly": {
      if (!isObject(body)) throw new Error("monthly は { day, time } にしてください。");
      onlyKeys(body, ["day", "time"], "monthly");
      if (typeof body.day !== "number" || !Number.isInteger(body.day) || body.day < 1 || body.day > 31) throw new Error("monthly.day は 1〜31 の整数にしてください。");
      parseTime(body.time, "monthly.time");
      return { monthly: { day: body.day, time: body.time as string } };
    }
  }
  throw new Error("予定の形は every・at・daily・weekly・monthly のどれか 1 つにしてください。");
}

const at = (date: Date, [hours, minutes]: [number, number]) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes).getTime();

/** `after` のあとで最初に来る予定の時刻。無ければ undefined */
export function nextScheduleTime(rule: ScheduleRule, after: number): number | undefined {
  const base = new Date(after);
  if ("every" in rule) return after + rule.every * 1000;
  if ("at" in rule) {
    const match = AT.exec(rule.at)!;
    const time = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])).getTime();
    return time > after ? time : undefined;
  }
  if ("daily" in rule || "weekly" in rule) {
    const time = parseTime("daily" in rule ? rule.daily : rule.weekly.time, "time");
    for (let offset = 0; offset <= 7; offset++) {
      const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
      if ("weekly" in rule && !rule.weekly.days.includes(DAYS[date.getDay()])) continue;
      const candidate = at(date, time);
      if (candidate > after) return candidate;
    }
    return undefined;
  }
  const time = parseTime(rule.monthly.time, "monthly.time");
  for (let offset = 0; offset <= 12; offset++) {
    const last = new Date(base.getFullYear(), base.getMonth() + offset + 1, 0).getDate();
    const candidate = at(new Date(base.getFullYear(), base.getMonth() + offset, Math.min(rule.monthly.day, last)), time);
    if (candidate > after) return candidate;
  }
  return undefined;
}

const minEvery = (owner: string) => owner === "os" ? SCHEDULE_MIN_EVERY.os : SCHEDULE_MIN_EVERY.app;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * 予定を保存し、前回の実行のあとで最初に来る時刻を過ぎたものを 1 つずつ実行する。
 * 閉じていた間に何回分過ぎていても 1 回だけ実行する。
 */
export async function createScheduler(options: SchedulerOptions): Promise<Scheduler> {
  const now = options.now ?? Date.now;
  const maxWait = options.maxWait ?? 60_000;
  const saved = new Map(Object.entries(await options.store.getSchedules?.() ?? {}));
  const jobs = new Map<string, ScheduleJob>();
  const running = new Set<string>();
  const listeners = new Set<() => void>();
  let started = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();
  let writing = Promise.resolve();

  const notify = () => { for (const listener of [...listeners]) { try { listener(); } catch (error) { options.report?.(error); } } };
  const persist = () => {
    const copy = structuredClone(Object.fromEntries(saved));
    writing = writing.then(() => options.store.putSchedules?.(copy)).catch(error => options.report?.(error));
    return writing;
  };
  const nextOf = (record: SavedSchedule) =>
    record.enabled ? nextScheduleTime(record.rule, record.last?.time ?? record.registered) : undefined;

  const execute = (id: string) => {
    const result = queue.then(async () => {
      const job = jobs.get(id);
      const record = saved.get(id);
      if (!job || !record || stopped) return;
      const time = now();
      running.add(id);
      notify();
      let outcome = "ok";
      try { await job.run(); } catch (error) { outcome = `error: ${message(error)}`; }
      running.delete(id);
      record.last = { time, result: outcome };
      if ("at" in record.rule) record.enabled = false;
      await persist();
      notify();
    });
    queue = result.catch(() => {});
    return result;
  };

  let checking = false;
  let again = false;
  const check = () => {
    if (!started || stopped) return;
    if (checking) { again = true; return; }
    clearTimeout(timer);
    checking = true;
    const current = now();
    const due = [...jobs.keys()].filter(id => {
      const record = saved.get(id);
      const next = record && nextOf(record);
      return next !== undefined && next <= current && !running.has(id);
    });
    void Promise.all(due.map(execute)).finally(() => {
      checking = false;
      if (stopped) return;
      if (again) { again = false; check(); return; }
      const nexts = [...jobs.keys()].map(id => saved.get(id)).map(record => record && nextOf(record)).filter((next): next is number => next !== undefined);
      const wait = Math.min(maxWait, Math.max(0, Math.min(Infinity, ...nexts) - now()));
      timer = setTimeout(check, wait);
    });
  };

  return {
    register(job) {
      if (jobs.has(job.id)) throw new Error(`予定 ${job.id} はもう登録されています。`);
      const rule = parseScheduleRule(job.rule, minEvery(job.owner));
      const record = saved.get(job.id);
      if (record) {
        record.owner = job.owner;
        if (job.label === undefined) delete record.label; else record.label = job.label;
      } else {
        saved.set(job.id, { owner: job.owner, ...(job.label === undefined ? {} : { label: job.label }), rule, enabled: true, registered: now() });
      }
      jobs.set(job.id, job);
      void persist();
      notify();
      check();
      return () => {
        if (jobs.get(job.id) !== job) return;
        jobs.delete(job.id);
        notify();
      };
    },
    list() {
      return [...jobs.keys()].map(id => {
        const record = saved.get(id)!;
        return structuredClone({ id, ...record, next: nextOf(record), running: running.has(id) });
      });
    },
    async update(id, change) {
      const record = saved.get(id);
      if (!record || !jobs.has(id)) throw new Error(`予定 ${id} がありません。`);
      if (change.rule !== undefined) record.rule = parseScheduleRule(change.rule, minEvery(record.owner));
      if (change.enabled !== undefined) record.enabled = change.enabled;
      await persist();
      notify();
      check();
    },
    runNow(id) {
      if (!jobs.has(id)) return Promise.reject(new Error(`予定 ${id} がありません。`));
      return execute(id);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      if (started || stopped) return;
      started = true;
      check();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      listeners.clear();
    },
  };
}
