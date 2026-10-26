/** Worker 側が使うメッセージの入口。Worker の `self` や Node の `MessagePort` がこの形を持つ */
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
  let instance: WebAssembly.Instance | undefined;

  /** AssemblyScript の文字列のポインタを読む。長さ（バイト数）は `ptr - 4` の u32、中身は UTF-16LE */
  const readString = (ptr: number): string => {
    const memory = instance!.exports.memory as WebAssembly.Memory;
    const length = new Uint32Array(memory.buffer, ptr - 4, 1)[0]!;
    return new TextDecoder("utf-16le").decode(new Uint8Array(memory.buffer, ptr, length));
  };

  const imports = {
    binette: {
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
    const data = event.data as { type: string; id?: number; name?: string; wasm?: ArrayBuffer };
    if (data.type === "init") {
      try {
        const result = await WebAssembly.instantiate(data.wasm!, imports);
        instance = result.instance;
        // トップレベルの初期化は instance を代入してから走らせる。初期化中の elem.text が文字列を読めるように
        const init = instance.exports._start;
        if (typeof init === "function") init();
        const names = Object.keys(instance.exports).filter((key) => key !== "_start" && typeof instance!.exports[key] === "function");
        scope.postMessage({ type: "ready", exports: names });
      } catch (error) {
        scope.postMessage({ type: "failed", message: `アプリを起動できません: ${messageOf(error)}` });
      }
    } else if (data.type === "call") {
      try {
        if (!instance) throw new Error("アプリがまだ起動していません。");
        const fn = Object.hasOwn(instance.exports, data.name!) ? instance.exports[data.name!] : undefined;
        if (typeof fn !== "function") throw new Error(`アプリに関数 ${data.name} がありません。`);
        fn();
        scope.postMessage({ type: "done", id: data.id });
      } catch (error) {
        scope.postMessage({ type: "fail", id: data.id, message: messageOf(error) });
      }
    }
  });
}
