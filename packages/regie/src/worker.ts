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
  const rows = new Map<string, number>();
  const homeApps = () => {
    if (apps === undefined) throw new Error("この呼び出しはホームのアプリだけが使えます。");
    return apps;
  };
  const appAt = (i: number) => {
    const values = homeApps();
    if (!Number.isInteger(i) || i < 0 || i >= values.length) throw new Error("アプリの番号が範囲外です。");
    return values[i]!;
  };
  const checkRow = (list: string, row: number) => {
    if (!Number.isInteger(row) || row < 0 || row >= (rows.get(list) ?? 0)) throw new Error("行の番号が範囲外です。");
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
      "list.add": (ptr: number) => {
        const list = readString(ptr);
        const row = rows.get(list) ?? 0;
        if (row >= 0x7fffffff) throw new Error("行の番号が範囲外です。");
        rows.set(list, row + 1);
        scope.postMessage({ type: "list.add", list, row });
        return row;
      },
      "list.clear": (ptr: number) => {
        const list = readString(ptr);
        rows.set(list, 0);
        scope.postMessage({ type: "list.clear", list });
      },
      "item.text": (ptr: number, row: number, name: number, value: number) => {
        const list = readString(ptr);
        checkRow(list, row);
        scope.postMessage({ type: "item.text", list, row, name: readString(name), value: readString(value) });
      },
      "item.icon": (ptr: number, row: number, app: number) => {
        const list = readString(ptr);
        checkRow(list, row);
        appAt(app);
        scope.postMessage({ type: "item.icon", list, row, app });
      },
      "apps.count": () => homeApps().length,
      "apps.name": (i: number) => writeString(appAt(i).name),
      "apps.id": (i: number) => writeString(appAt(i).id),
      "apps.open": (i: number) => {
        appAt(i);
        scope.postMessage({ type: "apps.open", i });
      },
      "elem.text": (name: number, value: number) => {
        scope.postMessage({ type: "text", name: readString(name), value: readString(value) });
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
    const data = event.data as { type: string; id?: number; name?: string; wasm?: ArrayBuffer; arg?: number; apps?: { id: string; name: string }[] };
    if (data.type === "init") {
      try {
        apps = data.apps;
        rows.clear();
        const result = await WebAssembly.instantiate(data.wasm!, imports);
        instance = result.instance;
        // トップレベルの初期化は instance を代入してから走らせる。初期化中の elem.text が文字列を読めるように
        const init = instance.exports._start;
        if (typeof init === "function") init();
        const names = Object.keys(instance.exports).filter((key) => key !== "_start" && !key.startsWith("__") && typeof instance!.exports[key] === "function");
        scope.postMessage({ type: "ready", exports: names });
      } catch (error) {
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
        if (data.arg === undefined) fn();
        else fn(data.arg);
        scope.postMessage({ type: "done", id: data.id });
      } catch (error) {
        exited = true;
        scope.postMessage({ type: "fail", id: data.id, message: messageOf(error), exit: true });
      }
    }
  });
}
