import { HOST_ABI, type HostImports, validateAppAbi } from "./abi.ts";
import { createUiDiffer } from "@binette/decor";
import { BinetteError, type DomOp } from "@binette/core";
import { API_KEYS, type ApiDenial, type OsSnapshot, type CadreSnapshot, type PigeonSnapshot, type ManagerSnapshot, type ManagerApp, type ManagerDetails, type SchedulerSnapshot, type ScheduleSnapshot } from "./launch.ts";
import { parseScheduleRule, SCHEDULE_MIN_EVERY } from "./scheduler.ts";

/** Worker 側が使うメッセージの入口。Worker の `self` や、テストで使う `MessagePort` がこの形を持つ */
export interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

/**
 * Worker の中でアプリの WASM を動かす。メインスレッドの {@link launchApp} とやりとりする。
 *
 * @param scope Worker の `self`、または同じスレッドで試すための `MessagePort`
 */
export function serveApp(scope: WorkerScope, differ: typeof createUiDiffer = createUiDiffer): void {
  let exited = false;
  let instance: WebAssembly.Instance | undefined;
  let apps: { id: string; name: string }[] | undefined;
  let os: OsSnapshot | undefined;
  let manager: ManagerSnapshot | undefined;
  let scheduler: SchedulerSnapshot | undefined;
  let ownSchedule: ScheduleSnapshot | undefined;
  let storage: Map<string, string> | undefined;
  let cadre: CadreSnapshot | undefined;
  let shares = false;
  let nextShareRequest = 0;
  const shareResults = new Map<number, string>();
  let pigeon: PigeonSnapshot | undefined;
  const acknowledgedLetters = new Set<number>();
  let denied: Record<string, ApiDenial> = {};
  let page = "";
  let sub = "";
  let declarative = false;
  let last = { page: "", reason: { kind: 0, cause: 0 } };
  let ops: DomOp[] = [];
  const ui = differ(op => ops.push(op), index => appAt(index));
  const renderUi = (value: string) => { const { root, build } = JSON.parse(value); ui.render(root, build); };
  const flush = () => {
    if (declarative) ops = ops.filter(op => op.op.startsWith("ui-"));
    if (ops.length) { scope.postMessage({ type: "dom", ops }); ops = []; }
  };
  // 辞書に載らなかったキーを呼ぶと、アプリを終了する（辞書を通さない呼び出しは、権限のない呼び出しと同じ扱い）
  const homeApps = () => {
    if (apps === undefined) throw new Error("この呼び出しは apps が届いたアプリだけが使えます。");
    return apps;
  };
  const appAt = (i: number) => {
    const values = homeApps();
    if (!Number.isInteger(i) || i < 0 || i >= values.length) throw new Error("アプリの番号が範囲外です。");
    return values[i]!;
  };
  const system = () => {
    if (os === undefined) throw new Error("この呼び出しは os が届いたシステムの設定アプリだけが使えます。");
    return os;
  };
  const candidates = (role: string) => Object.hasOwn(system().candidates, role) ? system().candidates[role]! : [];
  const candidateAt = (role: string, i: number) => {
    const list = candidates(role);
    if (!Number.isInteger(i) || i < 0 || i >= list.length) throw new Error("候補の番号が範囲外です。");
    return list[i]!;
  };
  const files = () => {
    if (storage === undefined) throw new Error("この呼び出しは storage が届いたアプリだけが使えます。");
    return storage;
  };
  const cadreState = () => {
    if (cadre === undefined) throw new Error("この呼び出しは cadre が届いたアプリだけが使えます。");
    return cadre;
  };
  const inbox = () => { if (!pigeon) throw new Error("pigeon が届いていません。"); return pigeon; };
  const letterAt = (i: number) => { const letter = inbox().letters[i]; if (!Number.isInteger(i) || !letter) throw new Error("手紙の番号が範囲外です。"); return letter; };
  const notificationAt = (i: number) => { const letter = cadreState().notifications?.[i]; if (!Number.isInteger(i) || !letter) throw new Error("通知の番号が範囲外です。"); return letter; };
  const actionAt = (i: number, a: number) => { const action = notificationAt(i).actions?.[a]; if (!Number.isInteger(a) || !action) throw new Error("操作の番号が範囲外です。"); return action; };
  const notificationSetting = (i: number) => { const value = system().notifications?.[i]; if (!Number.isInteger(i) || !value) throw new Error("通知設定の番号が範囲外です。"); return value; };
  const granted = (key: string) => key === "shares" ? shares : key === "pigeon" ? pigeon !== undefined : key === "apps" ? apps !== undefined : key === "os" ? os !== undefined : key === "manager" ? manager !== undefined : key === "scheduler" ? scheduler !== undefined : key === "schedule" ? ownSchedule !== undefined : key === "storage" ? storage !== undefined : key === "cadre" ? cadre !== undefined : false;
  const launchAt = (i: number) => {
    const launches = system().launches;
    if (!Number.isInteger(i) || i < 0 || i >= launches.length) throw new Error("履歴の番号が範囲外です。");
    return launches[i]!;
  };
  // toString() で作る Worker なので、OS と同じ設定 API の範囲をここでも確かめる
  const settingName = (name: string): name is keyof OsSnapshot["settings"] =>
    ["stackSize", "stopDelay", "callTimeout", "destroyTimeout", "historyLimit", "homeRetryWindow"].includes(name);
  /** __new はメモリを伸ばすことがあるので、確保してから buffer を読む */
  const writeString = (value: string): number => {
    const allocate = instance!.exports.__new;
    if (typeof allocate !== "function") throw new Error("文字列を返すには --exportRuntime が必要です。");
    const ptr = allocate(value.length * 2, 2) as number;
    const memory = instance!.exports.memory as WebAssembly.Memory;
    const view = new DataView(memory.buffer);
    for (let i = 0; i < value.length; i++) view.setUint16(ptr + i * 2, value.charCodeAt(i), true);
    return ptr;
  };

  /** AssemblyScript の文字列のポインタを読む。長さ（バイト数）は `ptr - 4` の u32、中身は UTF-16LE */
  const readString = (ptr: number): string => {
    const memory = instance!.exports.memory as WebAssembly.Memory;
    const length = new Uint32Array(memory.buffer, ptr - 4, 1)[0]!;
    return new TextDecoder("utf-16le").decode(new Uint8Array(memory.buffer, ptr, length));
  };

  const managerState = () => {
    if (!manager) throw new Error("この呼び出しは manager が届いたアプリだけが使えます。");
    return manager;
  };
  const at = <T>(items: readonly T[], i: number, what: string): T => {
    if (!Number.isInteger(i) || i < 0 || i >= items.length) throw new Error(`${what}の番号が範囲外です。`);
    return items[i]!;
  };
  const managerApp = (key: string): ManagerApp | undefined => managerState().apps.find(app => app.key === key);
  const catalog = (url: string) => managerState().apps.filter(app => app.listed && (url === "" || app.list === url));
  const installedApps = () => managerState().apps.filter(app => app.present || app.removed);
  const updateKeys = (url: string) => managerState().updates.filter(key => url === "" || managerApp(key)?.list === url);
  const details = (key: string): ManagerDetails | undefined => managerState().details[key];
  const managerText = (query: string, key: string, i: number): string => {
    const state = managerState();
    const app = managerApp(key);
    switch (query) {
      case "repoUrl": return at(state.repos, i, "提供リスト").url;
      case "repoName": return at(state.repos, i, "提供リスト").name;
      case "repoHost": return at(state.repos, i, "提供リスト").host;
      case "repoState": return at(state.repos, i, "提供リスト").state;
      case "appId": return at(catalog(key), i, "アプリ").key;
      case "installedId": return at(installedApps(), i, "アプリ").key;
      case "updateId": return at(updateKeys(key), i, "更新");
      case "list": return app?.list ?? "";
      case "name": return app?.name ?? "";
      case "icon": return app?.icon ?? "";
      case "description": return app?.description ?? "";
      case "version": return app?.version ?? "";
      case "installedVersion": return app?.installed ?? "";
      case "state": return app?.state ?? "none";
      case "error": return app?.error ?? "";
      case "compatibilityError": return app?.compatibilityError ?? "";
      case "installedError": return app?.installedError ?? "";
      case "detailError": return details(key)?.error ?? "";
      case "detailListName": return details(key)?.listName ?? "";
      case "permissionName": return at(details(key)?.permissions ?? [], i, "権限")[0];
      case "permissionReason": return at(details(key)?.permissions ?? [], i, "権限")[1];
      case "addedName": return at(details(key)?.added ?? [], i, "権限");
      case "roleName": return at(details(key)?.roles ?? [], i, "役割");
    }
    throw new Error(`知らない manager の問い合わせです: ${query}`);
  };
  const managerNumber = (query: string, key: string, i: number): number => {
    const state = managerState();
    const app = managerApp(key);
    switch (query) {
      case "repoCount": return state.repos.length;
      case "repoRemovable": return at(state.repos, i, "提供リスト").removable ? 1 : 0;
      case "appCount": return catalog(key).length;
      case "installedCount": return installedApps().length;
      case "updateCount": return updateKeys(key).length;
      case "compatible": return app?.compatibilityError ? 0 : 1;
      case "removed": return app?.removed ? 1 : 0;
      case "removable": return app?.removable ? 1 : 0;
      case "files": return app?.files ?? 0;
      case "bytes": return app?.bytes ?? 0;
      case "auto": return app?.auto ? 1 : 0;
      case "autoAll": return state.auto.all ? 1 : 0;
      case "autoList": return state.auto.lists[key] ? 1 : 0;
      case "autoApp": return (state.auto.apps[key] ?? true) ? 1 : 0;
      case "detailReady": { const d = details(key); return d && !d.loading ? 1 : 0; }
      case "permissionCount": return details(key)?.permissions.length ?? 0;
      case "addedCount": return details(key)?.added.length ?? 0;
      case "roleCount": return details(key)?.roles.length ?? 0;
      case "integrity": return details(key)?.integrity ? 1 : 0;
    }
    throw new Error(`知らない manager の問い合わせです: ${query}`);
  };
  const managerActions = ["addRepo", "removeRepo", "checkUpdates", "install", "reinstall", "uninstall", "cancel", "apply", "details", "setAutoUpdate"];

  const pad = (value: number) => String(value).padStart(2, "0");
  // 端末の時刻帯で「YYYY-MM-DD HH:MM」。0 は空
  const localTime = (time: number) => {
    if (!time) return "";
    const date = new Date(time);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const dayNames: Record<string, string> = { mon: "月", tue: "火", wed: "水", thu: "木", fri: "金", sat: "土", sun: "日" };
  const duration = (seconds: number) =>
    seconds % 86400 === 0 ? `${seconds / 86400} 日` : seconds % 3600 === 0 ? `${seconds / 3600} 時間` : seconds % 60 === 0 ? `${seconds / 60} 分` : `${seconds} 秒`;
  const describeRule = (json: string) => {
    const rule = JSON.parse(json) as { every?: number; at?: string; daily?: string; weekly?: { days: string[]; time: string }; monthly?: { day: number; time: string } };
    if (rule.every !== undefined) return `${duration(rule.every)}ごと`;
    if (rule.at !== undefined) return `${rule.at.replace("T", " ")} に 1 回`;
    if (rule.daily !== undefined) return `毎日 ${rule.daily}`;
    if (rule.weekly) return `毎週 ${rule.weekly.days.map(day => dayNames[day] ?? day).join("・")} ${rule.weekly.time}`;
    if (rule.monthly) return `毎月 ${rule.monthly.day} 日 ${rule.monthly.time}`;
    return json;
  };
  const schedulerState = () => {
    if (!scheduler) throw new Error("この呼び出しは scheduler が届いたアプリだけが使えます。");
    return scheduler;
  };
  const schedule = (i: number) => at(schedulerState().schedules, i, "予定");
  const schedulerText = (query: string, i: number): string => {
    switch (query) {
      case "id": return schedule(i).id;
      case "owner": return schedule(i).owner;
      case "ownerName": return schedule(i).ownerName;
      case "label": return schedule(i).label;
      case "rule": return schedule(i).rule;
      case "lastResult": return schedule(i).lastResult;
      case "description": return describeRule(schedule(i).rule);
      case "nextText": return localTime(schedule(i).next);
      case "lastText": return localTime(schedule(i).lastTime);
    }
    throw new Error(`知らない scheduler の問い合わせです: ${query}`);
  };
  const schedulerNumber = (query: string, i: number): number => {
    switch (query) {
      case "count": return schedulerState().schedules.length;
      case "enabled": return schedule(i).enabled ? 1 : 0;
      case "running": return schedule(i).running ? 1 : 0;
      case "next": return schedule(i).next;
      case "lastTime": return schedule(i).lastTime;
      case "every": { const rule = JSON.parse(schedule(i).rule) as { every?: number }; return typeof rule.every === "number" ? rule.every : 0; }
    }
    throw new Error(`知らない scheduler の問い合わせです: ${query}`);
  };
  const schedulerActions = ["update", "setEnabled", "runNow"];
  // アプリの自分の予定（schedule）。写しを同期的に読み、変更は写しに入れてから OS に知らせる
  const ownSchedules = () => {
    if (!ownSchedule) throw new Error("この呼び出しは schedule が届いたアプリだけが使えます。");
    return ownSchedule;
  };
  const ownSlot = (slot: number) => {
    const slots = ownSchedules().slots;
    return Number.isInteger(slot) && slot >= 0 && slot < slots.length ? slots[slot] : undefined;
  };
  const ownRule = (value: string) => {
    try { return JSON.stringify(parseScheduleRule(JSON.parse(value), SCHEDULE_MIN_EVERY.app)); } catch { return undefined; }
  };
  const scheduleDo = (action: string, slot: number, value: string, label: string): boolean => {
    const slots = ownSchedules().slots;
    const current = ownSlot(slot);
    if (current === undefined) return false;
    switch (action) {
      case "register": {
        const rule = ownRule(value);
        if (current !== null || rule === undefined) return false;
        slots[slot] = { rule, label, enabled: true, lastTime: 0, lastResult: "" };
        scope.postMessage({ type: "schedule.do", action, scheduleArgs: [slot, rule, label] });
        return true;
      }
      case "update": {
        const rule = ownRule(value);
        if (current === null || rule === undefined) return false;
        current.rule = rule;
        scope.postMessage({ type: "schedule.do", action, scheduleArgs: [slot, rule, ""] });
        return true;
      }
      case "remove":
      case "runNow":
        if (current === null) return false;
        if (action === "remove") slots[slot] = null;
        scope.postMessage({ type: "schedule.do", action, scheduleArgs: [slot, "", ""] });
        return true;
    }
    throw new Error(`知らない schedule の操作です: ${action}`);
  };

  const imports = {
    [HOST_ABI.schedule.module]: {
      "do": (action: number, slot: number, value: number, label: number) => scheduleDo(readString(action), slot, readString(value), readString(label)) ? 1 : 0,
      "text": (query: number, slot: number) => {
        const name = readString(query);
        const found = ownSlot(slot);
        if (name === "rule") return writeString(found?.rule ?? "");
        if (name === "label") return writeString(found?.label ?? "");
        if (name === "lastResult") return writeString(found?.lastResult ?? "");
        throw new Error(`知らない schedule の問い合わせです: ${name}`);
      },
      "number": (query: number, slot: number) => {
        const name = readString(query);
        const found = ownSlot(slot);
        if (name === "count") return ownSchedules().slots.length;
        if (name === "exists") return found ? 1 : 0;
        if (name === "enabled") return found?.enabled ? 1 : 0;
        if (name === "lastTime") return found?.lastTime ?? 0;
        throw new Error(`知らない schedule の問い合わせです: ${name}`);
      },
    },
    [HOST_ABI.scheduler.module]: {
      "text": (query: number, i: number) => writeString(schedulerText(readString(query), i)),
      "number": (query: number, i: number) => schedulerNumber(readString(query), i),
      "do": (action: number, id: number, value: number, flag: number) => {
        schedulerState();
        const name = readString(action);
        if (!schedulerActions.includes(name)) throw new Error(`知らない scheduler の操作です: ${name}`);
        scope.postMessage({ type: "scheduler.do", action: name, schedulerArgs: [readString(id), readString(value), !!flag] });
      },
    },
    [HOST_ABI.manager.module]: {
      "text": (query: number, key: number, i: number) => writeString(managerText(readString(query), readString(key), i)),
      "number": (query: number, key: number, i: number) => managerNumber(readString(query), readString(key), i),
      "do": (action: number, a: number, b: number, flag: number) => {
        managerState();
        const name = readString(action);
        if (!managerActions.includes(name)) throw new Error(`知らない manager の操作です: ${name}`);
        scope.postMessage({ type: "manager.do", action: name, managerArgs: [readString(a), readString(b), !!flag] });
      },
    },
    [HOST_ABI.shares.module]: {
      "request": (operation: number, args: number) => {
        if (!shares) throw new Error("共有 API は許可されていません。");
        const values: unknown = JSON.parse(readString(args));
        if (!Array.isArray(values) || values.some(value => typeof value !== "string")) throw new Error("共有の引数が不正です。");
        if (nextShareRequest >= 2147483647) throw new Error("共有の要求番号を使い切りました。");
        const id = ++nextShareRequest;
        scope.postMessage({ type: "shares.request", id, operation: readString(operation), args: values });
        return id;
      },
      "result": (id: number) => { const result = shareResults.get(id); if (result === undefined) return 0; shareResults.delete(id); return writeString(result); },
    },
    [HOST_ABI.pigeon.module]: {
      "shares": (i: number) => writeString(JSON.stringify(letterAt(i).shares ?? [])),
      "send": (to: number, kind: number, title: number, body: number, urgent: number, actions: number, attachments: number) => {
        const state = inbox();
        const target = readString(to);
        if (target === "user" && !state.notify) return false;
        let attached;
        try { attached = attachments ? JSON.parse(readString(attachments)) : []; } catch { return false; }
        if (!Array.isArray(attached) || attached.some(a => !a || typeof a.id !== "string" || !["read", "write"].includes(a.access)) || (target === "user" && attached.length)) return false;
        let buttons;
        try { buttons = JSON.parse(readString(actions)); } catch { return false; }
        if (!Array.isArray(buttons) || buttons.some(a => !a || typeof a.id !== "string" || typeof a.label !== "string" || (a.input !== undefined && typeof a.input !== "boolean") || (a.placeholder !== undefined && typeof a.placeholder !== "string"))) return false;
        if (buttons.some(a => !a.id) || new Set(buttons.map(a => a.id)).size !== buttons.length) return false;
        if (!target || !readString(kind)) return false;
        scope.postMessage({ type: "pigeon.send", letter: { to: target, kind: readString(kind), title: readString(title), body: readString(body), urgent: !!urgent, actions: buttons, ...(attached.length ? { shares: attached } : {}) } });
        return true;
      },
      "count": () => inbox().letters.length,
      "done": (i: number) => { const letter = letterAt(i); acknowledgedLetters.add(letter.id); inbox().letters.splice(i, 1); scope.postMessage({ type: "pigeon.done", i: letter.id }); },
      "urgent": (i: number) => !!letterAt(i).urgent,
      "actions": (i: number) => writeString(JSON.stringify(letterAt(i).actions ?? [])),
      "from": (i: number) => writeString(letterAt(i).from),
      "to": (i: number) => writeString(letterAt(i).to),
      "kind": (i: number) => writeString(letterAt(i).kind),
      "title": (i: number) => writeString(letterAt(i).title),
      "body": (i: number) => writeString(letterAt(i).body),
    },
    [HOST_ABI.os.module]: {
      "notificationCount": () => system().notifications?.length ?? 0,
      "notificationName": (i: number) => writeString(notificationSetting(i).name),
      "notificationId": (i: number) => writeString(notificationSetting(i).id),
      "notificationMuted": (i: number) => notificationSetting(i).muted,
      "setNotificationMuted": (i: number, muted: number) => { notificationSetting(i).muted = !!muted; scope.postMessage({ type: "os.notificationMuted", i, muted: !!muted }); },
      "get": (ptr: number) => {
        const settings = system().settings;
        const name = readString(ptr);
        if (!settingName(name)) throw new Error("知らない設定です。");
        return settings[name];
      },
      "set": (ptr: number, value: number) => {
        const settings = system().settings;
        const name = readString(ptr);
        if (!settingName(name) || !Number.isInteger(value) || value < 0 ||
          (name === "stackSize" && value < 1) ||
          ((name === "callTimeout" || name === "destroyTimeout") && value < 1000)) return false;
        settings[name] = value;
        scope.postMessage({ type: "os.set", name, value });
        return true;
      },
      "role": (role: number) => {
        const roles = system().roles;
        const name = readString(role);
        return writeString(Object.hasOwn(roles, name) ? roles[name]! : "");
      },
      "candidateCount": (role: number) => candidates(readString(role)).length,
      "candidateName": (role: number, i: number) => writeString(candidateAt(readString(role), i).name),
      "candidateId": (role: number, i: number) => writeString(candidateAt(readString(role), i).id),
      "assign": (role: number, i: number) => {
        const name = readString(role);
        system().roles[name] = candidateAt(name, i).id;
        scope.postMessage({ type: "os.assign", role: name, i });
      },
      "updatePhase": () => writeString(system().updateState?.phase ?? "idle"),
      "updateCurrent": () => writeString(system().updateState?.current ?? ""),
      "updateNext": () => writeString(system().updateState?.next ?? ""),
      "openRecovery": () => { system(); scope.postMessage({ type: "os.openRecovery" }); },
      "checkUpdate": () => { system(); scope.postMessage({ type: "os.checkUpdate" }); },
      "updateAvailable": () => system().updateAvailable,
      "update": () => {
        system();
        scope.postMessage({ type: "os.update" });
      },
      "launchCount": () => system().launches.length,
      "launchTime": (i: number) => launchAt(i).time,
      "launchName": (i: number) => writeString(launchAt(i).name),
    },
    [HOST_ABI.cadre.module]: {
      "notificationCount": () => cadreState().notifications?.length ?? 0,
      "notificationId": (i: number) => notificationAt(i).id,
      "notificationActionCount": (i: number) => notificationAt(i).actions?.length ?? 0,
      "notificationActionInput": (i: number, a: number) => !!actionAt(i,a).input,
      "notificationActionPlaceholder": (i: number, a: number) => writeString(actionAt(i,a).placeholder ?? ""),
      "notificationOpen": (i: number) => { cadreState(); scope.postMessage({ type: "cadre.notificationOpen", i }); },
      "notificationDismiss": (i: number) => { cadreState(); scope.postMessage({ type: "cadre.notificationDismiss", i }); },
      "notificationReply": (i: number, action: number, body: number) => { cadreState(); scope.postMessage({ type: "cadre.notificationReply", i, action: readString(action), body: readString(body) }); },
      "notificationFrom": (i: number) => writeString(notificationAt(i).from),
      "notificationTitle": (i: number) => writeString(notificationAt(i).title),
      "notificationBody": (i: number) => writeString(notificationAt(i).body),
      "notificationActionId": (i: number, a: number) => writeString(actionAt(i,a).id),
      "notificationActionLabel": (i: number, a: number) => writeString(actionAt(i,a).label),
      "count": () => cadreState().instances.length,
      "name": (i: number) => {
        const instances = cadreState().instances;
        if (!Number.isInteger(i) || i < 0 || i >= instances.length) throw new Error("アプリの番号が範囲外です。");
        return writeString(instances[i]!.name);
      },
      "appIndex": (i: number) => {
        const instances = cadreState().instances;
        if (!Number.isInteger(i) || i < 0 || i >= instances.length) throw new Error("アプリの番号が範囲外です。");
        return instances[i]!.appIndex;
      },
      "isFront": (i: number) => {
        const instances = cadreState().instances;
        if (!Number.isInteger(i) || i < 0 || i >= instances.length) throw new Error("アプリの番号が範囲外です。");
        return instances[i]!.front ? 1 : 0;
      },
      "isHome": () => cadreState().homeFront ? 1 : 0,
      "hasIcon": (i: number) => {
        const instances = cadreState().instances;
        if (!Number.isInteger(i) || i < 0 || i >= instances.length) throw new Error("アプリの番号が範囲外です。");
        return instances[i]!.hasIcon ? 1 : 0;
      },
      "open": (i: number) => {
        const instances = cadreState().instances;
        if (!Number.isInteger(i) || i < 0 || i >= instances.length) throw new Error("アプリの番号が範囲外です。");
        scope.postMessage({ type: "cadre.open", i: instances[i]!.id });
      },
      "close": (i: number) => {
        const instances = cadreState().instances;
        if (!Number.isInteger(i) || i < 0 || i >= instances.length) throw new Error("アプリの番号が範囲外です。");
        scope.postMessage({ type: "cadre.close", i: instances[i]!.id });
      },
      "openHome": () => {
        cadreState();
        scope.postMessage({ type: "cadre.home" });
      },
      "back": () => {
        cadreState();
        scope.postMessage({ type: "cadre.back" });
      },
      "openSettings": () => {
        cadreState();
        scope.postMessage({ type: "cadre.settings" });
      },
      "isInstalled": () => cadreState().installed ? 1 : 0,
      "installBusy": () => cadreState().installBusy ? 1 : 0,
      "install": () => {
        cadreState();
        scope.postMessage({ type: "cadre.install" });
      },
      "notify": (ptr: number) => {
        cadreState();
        scope.postMessage({ type: "cadre.notify", text: readString(ptr) });
      },
    },
    [HOST_ABI.storage.module]: {
      "has": (name: number) => files().has(readString(name)),
      "read": (name: number) => {
        const value = files().get(readString(name));
        return value === undefined ? 0 : writeString(value);
      },
      "write": (name: number, value: number) => {
        const key = readString(name);
        // 名前は 1 つの部品で、長すぎる名前と空の名前は受けない
        if (!key || key.length > 256) return false;
        const text = readString(value);
        files().set(key, text);
        scope.postMessage({ type: "storage.write", name: key, value: text });
        return true;
      },
      "remove": (name: number) => {
        const key = readString(name);
        if (files().delete(key)) scope.postMessage({ type: "storage.write", name: key, value: null });
      },
      "count": () => files().size,
      "name": (i: number) => {
        const names = [...files().keys()].sort();
        if (!Number.isInteger(i) || i < 0 || i >= names.length) throw new Error("データの番号が範囲外です。");
        return writeString(names[i]!);
      },
    },
    [HOST_ABI.app.module]: {
      // 辞書の中身。0 は届いている、1 は NotGranted、2 は NotAssigned。知らないキーはどの役割にもないので NotAssigned
      "sub": () => writeString(sub),
      "why": (key: number) => {
        const name = readString(key);
        if (granted(name)) return 0;
        if (!(API_KEYS as readonly string[]).includes(name)) return 2;
        return denied[name] === "NotAssigned" ? 2 : 1;
      },
      "page": () => writeString(page),
      "lastPage": () => writeString(last.page),
      "lastKind": () => last.reason.kind,
      "lastCause": () => last.reason.cause,
      "finish": () => scope.postMessage({ type: "finish" }),
    },
    [HOST_ABI.ui.module]: {
      "render": (ptr: number) => renderUi(readString(ptr)),
    },
    [HOST_ABI.dom.module]: {
      "byId": (handle: number, id: number) => ops.push({ op: "byId", handle, id: readString(id) }),
      "create": (handle: number, tag: number) => ops.push({ op: "create", handle, tag: readString(tag) }),
      "text": (handle: number, value: number) => ops.push({ op: "text", handle, value: readString(value) }),
      "class": (handle: number, value: number) => ops.push({ op: "class", handle, value: readString(value) }),
      "append": (parent: number, child: number) => ops.push({ op: "append", parent, child }),
      "remove": (handle: number) => ops.push({ op: "remove", handle }),
      "listen": (handle: number, type: number, listener: number) => ops.push({ op: "listen", handle, type: readString(type), listener }),
      "unlisten": (handle: number, type: number, listener: number) => ops.push({ op: "unlisten", handle, type: readString(type), listener }),
    },
    [HOST_ABI.apps.module]: {
      "icon": (handle: number, app: number) => { appAt(app); ops.push({ op: "icon", handle, app }); },
      "count": () => homeApps().length,
      "name": (i: number) => writeString(appAt(i).name),
      "id": (i: number) => writeString(appAt(i).id),
      "open": (i: number) => {
        appAt(i);
        scope.postMessage({ type: "apps.open", i });
      },
    },
    [HOST_ABI.env.module]: {
      abort: (message: number, fileName: number, line: number, column: number) => {
        const text = message ? readString(message) : "abort";
        const file = fileName ? readString(fileName) : "";
        throw new Error(`アプリが中断しました: ${text}${file ? ` (${file}:${line}:${column})` : ""}`);
      },
    },
  } satisfies HostImports;

  const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

  scope.addEventListener("message", async (event) => {
    if (exited) return;
    const data = event.data as { type: string; id?: number; name?: string; wasm?: ArrayBuffer; args?: (number | string)[]; page?: string; sub?: string; declarative?: boolean; last?: typeof last; apps?: { id: string; name: string }[]; os?: OsSnapshot; manager?: ManagerSnapshot; scheduler?: SchedulerSnapshot; schedule?: ScheduleSnapshot; storage?: Map<string, string>; cadre?: CadreSnapshot; pigeon?: PigeonSnapshot; shares?: boolean; result?: string; denied?: Record<string, ApiDenial> };
    if (data.type === "shares.result") {
      shareResults.set(data.id!, data.result!);
      const callback = instance?.exports.__bina_share;
      if (typeof callback === "function") { try { callback(); flush(); } catch (error) { ops = []; exited = true; scope.postMessage({ type: "fail", message: messageOf(error), exit: true }); } }
      return;
    }
    if (data.type === "init") {
      try {
        apps = data.apps;
        os = data.os;
        manager = data.manager;
        scheduler = data.scheduler;
        ownSchedule = data.schedule;
        storage = data.storage;
        cadre = data.cadre;
        pigeon = data.pigeon;
        shares = data.shares === true;
        denied = data.denied ?? {};
        page = data.page ?? "";
        sub = data.sub ?? "";
        declarative = data.declarative ?? false;
        last = data.last ?? last;
        ops = [];
        const module = await validateAppAbi(data.wasm!);
        instance = await WebAssembly.instantiate(module, imports);
        // トップレベルの初期化は instance を代入してから走らせる。初期化中の dom.* が文字列を読めるように
        const init = instance.exports._start;
        if (typeof init === "function") init();
        const names = Object.keys(instance.exports).filter((key) => key !== "_start" && !key.startsWith("__") && typeof instance!.exports[key] === "function");
        flush();
        scope.postMessage({ type: "ready", exports: names });
      } catch (error) {
        ops = [];
        const message = error instanceof BinetteError && error.code === "unsupported_abi"
          ? error.message : `アプリを起動できません: ${messageOf(error)}`;
        scope.postMessage({ type: "failed", message, ...(error instanceof BinetteError ? { code: error.code } : {}) });
      }
    } else if (data.type === "cadre.sync" || data.type === "os.sync" || data.type === "pigeon.sync" || data.type === "manager.sync" || data.type === "scheduler.sync" || data.type === "schedule.sync") {
      if (data.type === "manager.sync") manager = data.manager;
      else if (data.type === "schedule.sync") ownSchedule = data.schedule;
      else if (data.type === "scheduler.sync") scheduler = data.scheduler;
      else if (data.type === "pigeon.sync") { pigeon = data.pigeon; if (pigeon) pigeon.letters = pigeon.letters.filter(letter => !acknowledgedLetters.has(letter.id)); }
      else if (data.type === "os.sync" && data.os) os = { ...data.os, launches: os?.launches ?? data.os.launches };
      else cadre = data.cadre;
      const syncName = data.type === "pigeon.sync" ? "__bina_pigeon" : "__bina_cadre_sync";
      if (instance && typeof instance.exports[syncName] === "function") {
        try {
          (instance.exports[syncName] as () => void)();
          flush();
        } catch (error) {
          ops = [];
          exited = true;
          scope.postMessage({ type: "fail", id: data.id, message: messageOf(error), exit: true });
          return;
        }
      }
      scope.postMessage({ type: "done", id: data.id });
    } else if (data.type === "call") {
      if (!instance) {
        scope.postMessage({ type: "fail", id: data.id, message: "アプリがまだ起動していません。" });
        return;
      }
      // 値を返す部品。番号は選択肢の数の中の整数だけ、slider は範囲に丸めて渡す
      const valueKinds = ["checkbox", "radio", "slider", "picker", "segmented", "tabs"];
      if (data.name === "__bina_ui_text_ack" || data.name === "__bina_ui_value_ack") {
        const target = ui.findAny(Number(data.args?.[0] ?? -1));
        if (target && (data.name === "__bina_ui_text_ack" ? target.node.kind === "input" : valueKinds.includes(target.node.kind))) {
          ui.inputVersions.set(target.handle, Number(data.args?.[1] ?? 0));
          ops.push(ui.update(target.handle, target.node, target.listItem));
          flush();
        }
        scope.postMessage({ type: "done", id: data.id });
        return;
      }
      const uiText = data.name === "__bina_ui_text_handle";
      const uiValue = data.name === "__bina_ui_value_handle";
      const uiHandle = data.name === "__bina_ui_handle" || uiText || uiValue;
      const target = uiHandle ? ui.find(Number(data.args?.[0] ?? -1)) : undefined;
      const valueTarget = uiValue && target !== undefined && valueKinds.includes(target.node.kind);
      let value = Number(data.args?.[1]);
      if (valueTarget) {
        const node = target!.node;
        if (node.kind === "slider" && Number.isFinite(value)) value = Math.min(node.max ?? 1, Math.max(node.min ?? 0, value));
        if (node.kind === "checkbox") value = value ? 1 : 0;
        if (["picker", "segmented", "tabs"].includes(node.kind) && !(Number.isInteger(value) && value >= 0 && value < (node.options ?? []).length)) value = NaN;
      }
      if (uiHandle && (!target || target.node.handler === -1 || !target.node.enabled || !target.node.shown ||
        (uiText ? target.node.kind !== "input" && target.node.kind !== "filePick" : uiValue ? !valueTarget || !Number.isFinite(value) : target.node.kind !== "button" && target.node.kind !== "menuItem"))) {
        // 捨てた入力にも版を進めた値を返し、Scene の表示をアプリの値に戻す
        if ((uiText && target?.node.kind === "input") || valueTarget) {
          ui.inputVersions.set(target!.handle, Number(data.args?.[2] ?? 0));
          ops.push(ui.update(target.handle, target.node, target.listItem));
          flush();
        }
        scope.postMessage({ type: "done", id: data.id });
        return;
      }
      const name = uiHandle ? (uiText ? "__bina_ui_text" : uiValue ? "__bina_ui_value" : "__bina_ui_event") : data.name!;
      const fn = Object.hasOwn(instance.exports, name) ? instance.exports[name] : undefined;
      if (typeof fn !== "function") {
        scope.postMessage({ type: "fail", id: data.id, message: `アプリに関数 ${data.name} がありません。` });
        return;
      }
      try {
        if (uiText || uiValue) ui.inputVersions.set(target!.handle, Number(data.args?.[2] ?? 0));
        fn(...(uiHandle ? [target!.build, target!.node.handler, ...(uiText ? [writeString(String(data.args?.[1] ?? ""))] : uiValue ? [value] : [])] : (data.args ?? [])));
        flush();
        scope.postMessage({ type: "done", id: data.id });
      } catch (error) {
        flush();
        exited = true;
        scope.postMessage({ type: "fail", id: data.id, message: messageOf(error), exit: true });
      }
    }
  });
}
