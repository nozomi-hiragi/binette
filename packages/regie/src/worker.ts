import { createUiDiffer } from "@binette/decor";
import type { DomOp } from "@binette/core";
import type { OsSnapshot } from "./launch.ts";

/** Worker 側が使うメッセージの入口。Worker の `self` や、テストで使う `MessagePort` がこの形を持つ */
export interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

/**
 * Worker の中でアプリの WASM を動かす。メインスレッドの {@link launchApp} とやりとりする。
 *
 * workerSource() が Décor の差分関数とこの関数を toString() で埋め込む。
 * 差分関数を引数で渡すので、圧縮後の import の名前には依存しない。
 *
 * @param scope Worker の `self`、または同じスレッドで試すための `MessagePort`
 */
export function serveApp(scope: WorkerScope, differ: typeof createUiDiffer = createUiDiffer): void {
  let exited = false;
  let instance: WebAssembly.Instance | undefined;
  let apps: { id: string; name: string }[] | undefined;
  let os: OsSnapshot | undefined;
  let page = "";
  let declarative = false;
  let last = { page: "", reason: { kind: 0, cause: 0 } };
  let ops: DomOp[] = [];
  const ui = differ(op => ops.push(op), index => appAt(index));
  const renderUi = (value: string) => { const { root, build } = JSON.parse(value); ui.render(root, build); };
  const flush = () => {
    if (declarative) ops = ops.filter(op => op.op.startsWith("ui-"));
    if (ops.length) { scope.postMessage({ type: "dom", ops }); ops = []; }
  };
  const homeApps = () => {
    if (apps === undefined) throw new Error("この呼び出しはホームのアプリだけが使えます。");
    return apps;
  };
  const appAt = (i: number) => {
    const values = homeApps();
    if (!Number.isInteger(i) || i < 0 || i >= values.length) throw new Error("アプリの番号が範囲外です。");
    return values[i]!;
  };
  const system = () => {
    if (os === undefined) throw new Error("この呼び出しはシステムの設定アプリだけが使えます。");
    return os;
  };
  const homeAt = (i: number) => {
    const homes = system().homes;
    if (!Number.isInteger(i) || i < 0 || i >= homes.length) throw new Error("ホームの番号が範囲外です。");
    return homes[i]!;
  };
  const launchAt = (i: number) => {
    const launches = system().launches;
    if (!Number.isInteger(i) || i < 0 || i >= launches.length) throw new Error("履歴の番号が範囲外です。");
    return launches[i]!;
  };
  // toString() で作る Worker なので、OS と同じ設定 API の範囲をここでも確かめる
  const settingName = (name: string): name is Exclude<keyof OsSnapshot["settings"], "home"> =>
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

  const imports = {
    binette: {
      "os.get": (ptr: number) => {
        const settings = system().settings;
        const name = readString(ptr);
        if (!settingName(name)) throw new Error("知らない設定です。");
        return settings[name];
      },
      "os.set": (ptr: number, value: number) => {
        const settings = system().settings;
        const name = readString(ptr);
        if (!settingName(name) || !Number.isInteger(value) || value < 0 ||
          (name === "stackSize" && value < 1) ||
          ((name === "callTimeout" || name === "destroyTimeout") && value < 1000)) return false;
        settings[name] = value;
        scope.postMessage({ type: "os.set", name, value });
        return true;
      },
      "os.home": () => writeString(system().settings.home),
      "os.homeCount": () => system().homes.length,
      "os.homeName": (i: number) => writeString(homeAt(i).name),
      "os.homeId": (i: number) => writeString(homeAt(i).id),
      "os.setHome": (i: number) => {
        system().settings.home = homeAt(i).id;
        scope.postMessage({ type: "os.setHome", i });
      },
      "os.launchCount": () => system().launches.length,
      "os.launchTime": (i: number) => launchAt(i).time,
      "os.launchName": (i: number) => writeString(launchAt(i).name),
      "app.page": () => writeString(page),
      "app.lastPage": () => writeString(last.page),
      "app.lastKind": () => last.reason.kind,
      "app.lastCause": () => last.reason.cause,
      "app.finish": () => scope.postMessage({ type: "finish" }),
      "ui.render": (ptr: number) => renderUi(readString(ptr)),
      "dom.byId": (handle: number, id: number) => ops.push({ op: "byId", handle, id: readString(id) }),
      "dom.create": (handle: number, tag: number) => ops.push({ op: "create", handle, tag: readString(tag) }),
      "dom.text": (handle: number, value: number) => ops.push({ op: "text", handle, value: readString(value) }),
      "dom.class": (handle: number, value: number) => ops.push({ op: "class", handle, value: readString(value) }),
      "dom.append": (parent: number, child: number) => ops.push({ op: "append", parent, child }),
      "dom.remove": (handle: number) => ops.push({ op: "remove", handle }),
      "dom.listen": (handle: number, type: number, listener: number) => ops.push({ op: "listen", handle, type: readString(type), listener }),
      "dom.unlisten": (handle: number, type: number, listener: number) => ops.push({ op: "unlisten", handle, type: readString(type), listener }),
      "apps.icon": (handle: number, app: number) => { appAt(app); ops.push({ op: "icon", handle, app }); },
      "apps.count": () => homeApps().length,
      "apps.name": (i: number) => writeString(appAt(i).name),
      "apps.id": (i: number) => writeString(appAt(i).id),
      "apps.open": (i: number) => {
        appAt(i);
        scope.postMessage({ type: "apps.open", i });
      },
    },
    env: {
      abort: (message: number, fileName: number, line: number, column: number) => {
        const text = message ? readString(message) : "abort";
        const file = fileName ? readString(fileName) : "";
        throw new Error(`アプリが中断しました: ${text}${file ? ` (${file}:${line}:${column})` : ""}`);
      },
    },
  };

  const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

  scope.addEventListener("message", async (event) => {
    if (exited) return;
    const data = event.data as { type: string; id?: number; name?: string; wasm?: ArrayBuffer; args?: (number | string)[]; page?: string; declarative?: boolean; last?: typeof last; apps?: { id: string; name: string }[]; os?: OsSnapshot };
    if (data.type === "init") {
      try {
        apps = data.apps;
        os = data.os;
        page = data.page ?? "";
        declarative = data.declarative ?? false;
        last = data.last ?? last;
        ops = [];
        const result = await WebAssembly.instantiate(data.wasm!, imports);
        instance = result.instance;
        // トップレベルの初期化は instance を代入してから走らせる。初期化中の dom.* が文字列を読めるように
        const init = instance.exports._start;
        if (typeof init === "function") init();
        const names = Object.keys(instance.exports).filter((key) => key !== "_start" && !key.startsWith("__") && typeof instance!.exports[key] === "function");
        flush();
        scope.postMessage({ type: "ready", exports: names });
      } catch (error) {
        ops = [];
        scope.postMessage({ type: "failed", message: `アプリを起動できません: ${messageOf(error)}` });
      }
    } else if (data.type === "call") {
      if (!instance) {
        scope.postMessage({ type: "fail", id: data.id, message: "アプリがまだ起動していません。" });
        return;
      }
      if (data.name === "__bina_ui_text_ack") {
        const target = ui.findAny(Number(data.args?.[0] ?? -1));
        if (target?.node.kind === "input") {
          ui.inputVersions.set(target.handle, Number(data.args?.[1] ?? 0));
          ops.push(ui.update(target.handle, target.node, target.listItem));
          flush();
        }
        scope.postMessage({ type: "done", id: data.id });
        return;
      }
      const uiText = data.name === "__bina_ui_text_handle";
      const uiHandle = data.name === "__bina_ui_handle" || uiText;
      const target = uiHandle ? ui.find(Number(data.args?.[0] ?? -1)) : undefined;
      if (uiHandle && (!target || target.node.handler === -1 || !target.node.enabled || !target.node.shown || (uiText ? target.node.kind !== "input" : target.node.kind !== "button"))) {
        // 捨てた入力にも版を進めた値を返し、Scene の表示をアプリの値に戻す
        if (uiText && target?.node.kind === "input") {
          ui.inputVersions.set(target.handle, Number(data.args?.[2] ?? 0));
          ops.push(ui.update(target.handle, target.node, target.listItem));
          flush();
        }
        scope.postMessage({ type: "done", id: data.id });
        return;
      }
      const name = uiHandle ? (uiText ? "__bina_ui_text" : "__bina_ui_event") : data.name!;
      const fn = Object.hasOwn(instance.exports, name) ? instance.exports[name] : undefined;
      if (typeof fn !== "function") {
        scope.postMessage({ type: "fail", id: data.id, message: `アプリに関数 ${data.name} がありません。` });
        return;
      }
      try {
        if (uiText) ui.inputVersions.set(target!.handle, Number(data.args?.[2] ?? 0));
        fn(...(uiHandle ? [target!.build, target!.node.handler, ...(uiText ? [writeString(String(data.args?.[1] ?? ""))] : [])] : (data.args ?? [])));
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

/** import を持たない Worker 用のソース。 */
/** Worker のソース。serveApp と Décor の差分関数を埋め込み、`self` で動かす */
export function workerSource(): string { return `(${serveApp.toString()})(self, ${createUiDiffer.toString()})`; }
