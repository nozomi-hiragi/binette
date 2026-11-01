import { createUiDiffer } from "@binette/decor";
import type { DomOp } from "@binette/core";
import { API_KEYS, type ApiDenial, type OsSnapshot, type ShellSnapshot } from "./launch.ts";

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
  let storage: Map<string, string> | undefined;
  let shell: ShellSnapshot | undefined;
  let denied: Record<string, ApiDenial> = {};
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
  const shellState = () => {
    if (shell === undefined) throw new Error("この呼び出しは shell が届いたアプリだけが使えます。");
    return shell;
  };
  const granted = (key: string) => key === "apps" ? apps !== undefined : key === "os" ? os !== undefined : key === "storage" ? storage !== undefined : key === "shell" ? shell !== undefined : false;
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
      "os.role": (role: number) => {
        const roles = system().roles;
        const name = readString(role);
        return writeString(Object.hasOwn(roles, name) ? roles[name]! : "");
      },
      "os.candidateCount": (role: number) => candidates(readString(role)).length,
      "os.candidateName": (role: number, i: number) => writeString(candidateAt(readString(role), i).name),
      "os.candidateId": (role: number, i: number) => writeString(candidateAt(readString(role), i).id),
      "os.assign": (role: number, i: number) => {
        const name = readString(role);
        system().roles[name] = candidateAt(name, i).id;
        scope.postMessage({ type: "os.assign", role: name, i });
      },
      "os.updateAvailable": () => system().updateAvailable,
      "os.update": () => {
        system();
        scope.postMessage({ type: "os.update" });
      },
      "os.launchCount": () => system().launches.length,
      "os.launchTime": (i: number) => launchAt(i).time,
      "os.launchName": (i: number) => writeString(launchAt(i).name),
      "storage.has": (name: number) => files().has(readString(name)),
      "storage.read": (name: number) => {
        const value = files().get(readString(name));
        return value === undefined ? 0 : writeString(value);
      },
      "storage.write": (name: number, value: number) => {
        const key = readString(name);
        // 名前は 1 つの部品で、長すぎる名前と空の名前は受けない
        if (!key || key.length > 256) return false;
        const text = readString(value);
        files().set(key, text);
        scope.postMessage({ type: "storage.write", name: key, value: text });
        return true;
      },
      "storage.remove": (name: number) => {
        const key = readString(name);
        if (files().delete(key)) scope.postMessage({ type: "storage.write", name: key, value: null });
      },
      "storage.count": () => files().size,
      "storage.name": (i: number) => {
        const names = [...files().keys()].sort();
        if (!Number.isInteger(i) || i < 0 || i >= names.length) throw new Error("データの番号が範囲外です。");
        return writeString(names[i]!);
      },
      // 辞書の中身。0 は届いている、1 は NotGranted、2 は NotAssigned。知らないキーはどの役割にもないので NotAssigned
      "api.why": (key: number) => {
        const name = readString(key);
        if (granted(name)) return 0;
        if (!(API_KEYS as readonly string[]).includes(name)) return 2;
        return denied[name] === "NotAssigned" ? 2 : 1;
      },
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
      "shell.count": () => shellState().instances.length,
      "shell.name": (i: number) => {
        const instances = shellState().instances;
        if (!Number.isInteger(i) || i < 0 || i >= instances.length) throw new Error("アプリの番号が範囲外です。");
        return writeString(instances[i]!.name);
      },
      "shell.appIndex": (i: number) => {
        const instances = shellState().instances;
        if (!Number.isInteger(i) || i < 0 || i >= instances.length) throw new Error("アプリの番号が範囲外です。");
        return instances[i]!.appIndex;
      },
      "shell.isFront": (i: number) => {
        const instances = shellState().instances;
        if (!Number.isInteger(i) || i < 0 || i >= instances.length) throw new Error("アプリの番号が範囲外です。");
        return instances[i]!.front ? 1 : 0;
      },
      "shell.isHome": () => shellState().homeFront ? 1 : 0,
      "shell.hasIcon": (i: number) => {
        const instances = shellState().instances;
        if (!Number.isInteger(i) || i < 0 || i >= instances.length) throw new Error("アプリの番号が範囲外です。");
        return instances[i]!.hasIcon ? 1 : 0;
      },
      "shell.open": (i: number) => {
        const instances = shellState().instances;
        if (!Number.isInteger(i) || i < 0 || i >= instances.length) throw new Error("アプリの番号が範囲外です。");
        scope.postMessage({ type: "shell.open", i: instances[i]!.id });
      },
      "shell.close": (i: number) => {
        const instances = shellState().instances;
        if (!Number.isInteger(i) || i < 0 || i >= instances.length) throw new Error("アプリの番号が範囲外です。");
        scope.postMessage({ type: "shell.close", i: instances[i]!.id });
      },
      "shell.openHome": () => {
        shellState();
        scope.postMessage({ type: "shell.home" });
      },
      "shell.back": () => {
        shellState();
        scope.postMessage({ type: "shell.back" });
      },
      "shell.openSettings": () => {
        shellState();
        scope.postMessage({ type: "shell.settings" });
      },
      "shell.isInstalled": () => shellState().installed ? 1 : 0,
      "shell.installBusy": () => shellState().installBusy ? 1 : 0,
      "shell.install": () => {
        shellState();
        scope.postMessage({ type: "shell.install" });
      },
      "shell.notify": (ptr: number) => {
        shellState();
        scope.postMessage({ type: "shell.notify", text: readString(ptr) });
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
    const data = event.data as { type: string; id?: number; name?: string; wasm?: ArrayBuffer; args?: (number | string)[]; page?: string; declarative?: boolean; last?: typeof last; apps?: { id: string; name: string }[]; os?: OsSnapshot; storage?: Map<string, string>; shell?: ShellSnapshot; denied?: Record<string, ApiDenial> };
    if (data.type === "init") {
      try {
        apps = data.apps;
        os = data.os;
        storage = data.storage;
        shell = data.shell;
        denied = data.denied ?? {};
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
    } else if (data.type === "shell.sync") {
      shell = data.shell;
      if (instance && typeof instance.exports.__bina_shell_sync === "function") {
        try {
          (instance.exports.__bina_shell_sync as () => void)();
          flush();
        } catch (error) {
          ops = [];
          exited = true;
          scope.postMessage({ type: "fail", message: messageOf(error), exit: true });
        }
      }
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
        (uiText ? target.node.kind !== "input" : uiValue ? !valueTarget || !Number.isFinite(value) : target.node.kind !== "button" && target.node.kind !== "menuItem"))) {
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
