/** DOMParser の形。本番はブラウザ、テストと CLI は happy-dom を使う */
export interface HtmlParser {
  parseFromString(html: string, type: "text/html"): Document;
}

/** bina の要素の種類 */
export interface BindingKind {
  tag: string;
  type?: string;
}

/** HTML とアプリをつなぐ名前 */
export interface Bindings {
  /** 名前ごとの要素数と、出てきた順の種類（重複なし） */
  elements: Record<string, { count: number; kinds: BindingKind[] }>;
  /** クリックで呼ぶ関数名（重複なし、出てきた順） */
  clicks: string[];
}

const reserved = new Set(`break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public as async await of type namespace declare abstract readonly get set constructor from module assert asserts infer is keyof require global unique override out accessor using satisfies intrinsic unknown i8 i16 i32 i64 isize u8 u16 u32 u64 usize bool f32 f64 v128 string number boolean any never object symbol bigint`.split(" "));

function validateName(name: string, click: boolean): void {
  let reason: string | undefined;
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) reason = "AS の識別子の形ではありません";
  else if (reserved.has(name)) reason = "予約語または型名です";
  else if (name.startsWith("__")) reason = "__ で始まる名前は自動生成用です";
  else if (!click && name === "elem") reason = "elem は自動生成ファイルの import に使います";
  else if (click && name === "_start") reason = "_start はビルドの初期化に使います";
  if (reason) throw new Error(`${click ? "bina-on-click" : "bina"} の名前「${name}」は使えません。${reason}。`);
}

/** HTML から要素とクリックの名前を集め、AS で使える名前か確かめる */
export function parseBindings(html: string, parser: HtmlParser): Bindings {
  const document = parser.parseFromString(html, "text/html");
  const elements: Bindings["elements"] = Object.create(null);
  const clicks: string[] = [];
  for (const element of document.querySelectorAll("[bina], [bina-on-click]")) {
    const name = element.getAttribute("bina");
    if (name !== null) {
      validateName(name, false);
      const tag = element.tagName.toLowerCase();
      const kind: BindingKind = tag === "input" ? { tag, type: (element.getAttribute("type") ?? "text").toLowerCase() } : { tag };
      const binding = elements[name] ??= { count: 0, kinds: [] };
      binding.count++;
      if (!binding.kinds.some((item) => item.tag === kind.tag && item.type === kind.type)) binding.kinds.push(kind);
    }
    const click = element.getAttribute("bina-on-click");
    if (click !== null) {
      validateName(click, true);
      if (!clicks.includes(click)) clicks.push(click);
    }
  }
  return { elements, clicks };
}

/** HTML の名前を補完できる AS のソースを作る */
export function generateBindingsSource(bindings: Bindings): string {
  const lines = ['// bina.ts（HTML から自動生成。手で書き換えない）', 'import { elem } from "jsr:@binette/replique";'];
  const names = Object.keys(bindings.elements).sort();
  if (names.length) lines.push("", ...names.map((name) => `export const ${name} = elem("${name}");`));
  return lines.join("\n") + "\n";
}
