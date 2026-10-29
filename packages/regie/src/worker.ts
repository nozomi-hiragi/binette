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
 * 関数の `toString()` から Worker を作るので、外の import や関数は一切参照しない。補助の関数も中に書く。
 *
 * @param scope Worker の `self`、または同じスレッドで試すための `MessagePort`
 */
export function serveApp(scope: WorkerScope): void {
  let exited = false;
  let instance: WebAssembly.Instance | undefined;
  let apps: { id: string; name: string }[] | undefined;
  let os: OsSnapshot | undefined;
  let page = "";
  let declarative = false;
  let last = { page: "", reason: { kind: 0, cause: 0 } };
  let ops: DomOp[] = [];
  type UiNode = { kind: "column" | "row" | "text" | "button"; children: UiNode[]; text: string; padding: number; gap: number; grow: boolean; key: string; label: string; enabled: boolean; handler: number };
  type Mounted = { handle: number; node: UiNode; children: Mounted[]; build: number };
  let uiRoot: Mounted | undefined;
  let nextUiHandle = 1;
  // 木の照合は Worker 内で行い、Scene には実際に変わった操作だけを渡す。
  const updateUi = (node: UiNode, old: Mounted | undefined, build: number): Mounted => {
    const mounted: Mounted = old ?? { handle: nextUiHandle++, node, children: [], build };
    if (!old) ops.push({ op: "ui-create", handle: mounted.handle, kind: node.kind });
    const prev = old?.node;
    if (!prev || prev.text !== node.text || prev.padding !== node.padding || prev.gap !== node.gap ||
      prev.grow !== node.grow || prev.label !== node.label || prev.enabled !== node.enabled ||
      (prev.handler !== -1) !== (node.handler !== -1)) {
      ops.push({ op: "ui-update", handle: mounted.handle, text: node.text, padding: node.padding, gap: node.gap,
        grow: node.grow, label: node.label || null, enabled: node.enabled,
        clickable: node.handler !== -1 });
    }
    const previous = mounted.children;
    const used = new Set<Mounted>();
    const children = node.children.map((child, i) => {
      const match = child.key
        ? previous.find(item => !used.has(item) && item.node.key === child.key && item.node.kind === child.kind)
        : previous[i] && !used.has(previous[i]!) && !previous[i]!.node.key && previous[i]!.node.kind === child.kind ? previous[i] : undefined;
      if (match) used.add(match);
      return updateUi(child, match, build);
    });
    for (const child of previous) if (!used.has(child)) ops.push({ op: "ui-remove", handle: child.handle });
    const order = previous.filter(child => used.has(child));
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (order[i] === child) continue;
      const index = order.indexOf(child);
      if (index !== -1) order.splice(index, 1);
      ops.push({ op: "ui-insert", parent: mounted.handle, child: child.handle, before: order[i]?.handle ?? null });
      order.splice(i, 0, child);
    }
    mounted.node = node;
    mounted.children = children;
    mounted.build = build;
    return mounted;
  };
  const renderUi = (value: string) => {
    const { build, root } = JSON.parse(value) as { build: number; root: UiNode };
    const old = uiRoot;
    if (old && (old.node.kind !== root.kind || old.node.key !== root.key)) {
      ops.push({ op: "ui-remove", handle: old.handle });
      uiRoot = undefined;
    }
    uiRoot = updateUi(root, uiRoot, build);
    if (!old || old !== uiRoot) ops.push({ op: "ui-insert", parent: null, child: uiRoot.handle, before: null });
  };
  const findUi = (mounted: Mounted | undefined, handle: number): Mounted | undefined => {
    if (!mounted) return undefined;
    if (mounted.handle === handle) return mounted;
    for (const child of mounted.children) {
      const found = findUi(child, handle);
      if (found) return found;
    }
    return undefined;
  };
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
    const data = event.data as { type: string; id?: number; name?: string; wasm?: ArrayBuffer; args?: number[]; page?: string; declarative?: boolean; last?: typeof last; apps?: { id: string; name: string }[]; os?: OsSnapshot };
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
      const uiHandle = data.name === "__bina_ui_handle";
      const target = uiHandle ? findUi(uiRoot, data.args?.[0] ?? -1) : undefined;
      if (uiHandle && (!target || target.node.handler === -1 || !target.node.enabled)) {
        scope.postMessage({ type: "done", id: data.id });
        return;
      }
      const name = uiHandle ? "__bina_ui_event" : data.name!;
      const fn = Object.hasOwn(instance.exports, name) ? instance.exports[name] : undefined;
      if (typeof fn !== "function") {
        scope.postMessage({ type: "fail", id: data.id, message: `アプリに関数 ${data.name} がありません。` });
        return;
      }
      try {
        fn(...(uiHandle ? [target!.build, target!.node.handler] : (data.args ?? [])));
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
