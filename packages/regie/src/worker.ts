import type { DomOp } from "./launch.ts";

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
  let page = "";
  let ops: DomOp[] = [];
  const flush = () => {
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
      "app.page": () => writeString(page),
      "app.lastPage": () => writeString(""),
      "app.lastKind": () => 0,
      "app.lastCause": () => 0,
      "app.finish": () => scope.postMessage({ type: "finish" }),
      "dom.byId": (handle: number, id: number) => ops.push({ op: "byId", handle, id: readString(id) }),
      "dom.create": (handle: number, tag: number) => ops.push({ op: "create", handle, tag: readString(tag) }),
      "dom.text": (handle: number, value: number) => ops.push({ op: "text", handle, value: readString(value) }),
      "dom.class": (handle: number, value: number) => ops.push({ op: "class", handle, value: readString(value) }),
      "dom.append": (parent: number, child: number) => ops.push({ op: "append", parent, child }),
      "dom.remove": (handle: number) => ops.push({ op: "remove", handle }),
      "dom.listen": (handle: number, type: number, listener: number) => ops.push({ op: "listen", handle, type: readString(type), listener }),
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
    const data = event.data as { type: string; id?: number; name?: string; wasm?: ArrayBuffer; args?: number[]; page?: string; apps?: { id: string; name: string }[] };
    if (data.type === "init") {
      try {
        apps = data.apps;
        page = data.page ?? "";
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
      const fn = Object.hasOwn(instance.exports, data.name!) ? instance.exports[data.name!] : undefined;
      if (typeof fn !== "function") {
        scope.postMessage({ type: "fail", id: data.id, message: `アプリに関数 ${data.name} がありません。` });
        return;
      }
      try {
        fn(...(data.args ?? []));
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
