/** Décor の式を編集する木。コールバックは実行せず、元の式を保持する。 */
export class Modifier {
  constructor(public name: string, public value: string = "") {}
}
export class Node {
  value: string = "";
  callback: string = "() => {}";
  children: Node[] = [];
  modifiers: Modifier[] = [];
  constructor(public kind: string = "text") {}
}
export function container(kind: string): boolean {
  return kind == "column" || kind == "row" || kind == "grid" || kind == "buttonOf";
}
export function numeric(name: string): boolean {
  return name == "padding" || name == "gap" || name == "minWidth" || name == "heading" || name == "arg";
}
export function flag(name: string): boolean {
  return name == "grow" || name == "list" || name == "multiline";
}
/** 修飾がその部品の見た目や振る舞いに効くか。インスペクターに出す行を選ぶのに使う。 */
export function applicable(kind: string, name: string): boolean {
  if (name == "gap") return container(kind);
  if (name == "heading") return kind == "text";
  if (name == "list") return kind == "column" || kind == "row" || kind == "grid";
  if (name == "enabled") return kind == "button" || kind == "buttonOf" || kind == "input";
  if (name == "multiline") return kind == "input";
  if (name == "arg") return kind == "button" || kind == "buttonOf";
  return name == "padding" || name == "minWidth" || name == "grow" || name == "key" || name == "label";
}
/** 木の行に出す値の要約。複数行は 1 行目だけにして「…」を付ける。 */
export function summary(node: Node): string {
  if (container(node.kind)) return "";
  const end = node.value.indexOf("\n");
  return end < 0 ? node.value : node.value.substring(0, end) + "…";
}
export function numberValue(value: string): f64 {
  const names = ["xs", "sm", "md", "lg", "xl"];
  for (let i = 0; i < names.length; i++) {
    if (value == "space." + names[i] || value == "radius." + names[i] || value == "fontSize." + names[i]) return -i - 1;
  }
  return F64.parseFloat(value);
}
export function validNumber(value: string): boolean {
  if (value.startsWith("space.") || value.startsWith("radius.") || value.startsWith("fontSize.")) return !isNaN(numberValue(value));
  if (value.length == 0) return false;
  let i = value.charAt(0) == "-" || value.charAt(0) == "+" ? 1 : 0;
  let digits = 0;
  while (i < value.length && value.charAt(i) >= "0" && value.charAt(i) <= "9") { i++; digits++; }
  if (value.charAt(i) == ".") {
    i++;
    while (i < value.length && value.charAt(i) >= "0" && value.charAt(i) <= "9") { i++; digits++; }
  }
  if (digits == 0) return false;
  if (value.charAt(i) == "e" || value.charAt(i) == "E") {
    i++;
    if (value.charAt(i) == "-" || value.charAt(i) == "+") i++;
    const start = i;
    while (i < value.length && value.charAt(i) >= "0" && value.charAt(i) <= "9") i++;
    if (i == start) return false;
  }
  if (i != value.length || !isFinite(numberValue(value))) return false;
  return true;
}
/** AS の f64 の整数表記から不要な .0 を除く。指数表記も保つ。 */
export function formatNumber(value: f64): string {
  const raw = value.toString();
  const exponent = raw.indexOf("e");
  const end = exponent < 0 ? raw.length : exponent;
  return raw.substring(0, end).endsWith(".0") ? raw.substring(0, end - 2) + raw.substring(end) : raw;
}
export function validModifierNumber(name: string, value: string): boolean {
  if (value.length == 0) return name == "padding" || name == "gap";
  if (!validNumber(value)) return false;
  if (name != "heading" && name != "arg") return true;
  const n = numberValue(value);
  return n == Math.floor(n) && !value.startsWith("space.") && !value.startsWith("radius.") && !value.startsWith("fontSize.");
}
/** 名前付き段は名前空間を保持する。padding/gap の負整数も space 段。 */
export function stepNumber(name: string, before: string, delta: i32, configured: boolean = true): string {
  // 空の padding/gap（padding() の省略形）は md が既定なのでそこから始める
  if (configured && before.length == 0 && (name == "padding" || name == "gap")) return "space.md";
  let value = !configured ? (name == "heading" ? 1 : 0) : before.length == 0 ? (name == "padding" || name == "gap" ? -3 : name == "heading" ? 1 : 0) : numberValue(before);
  let prefix = "";
  const dot = before.indexOf(".");
  if (before.startsWith("space.") || before.startsWith("radius.") || before.startsWith("fontSize.")) prefix = before.substring(0, dot + 1);
  if (prefix.length > 0 || ((name == "padding" || name == "gap") && value >= -5 && value <= -1 && value == Math.floor(value))) {
    const names = ["xs", "sm", "md", "lg", "xl"];
    const index = <i32>Math.max(0, Math.min(4, -value - 1 + delta));
    return (prefix.length > 0 ? prefix : "space.") + names[index];
  }
  if (name == "heading") value = Math.max(1, Math.min(3, value));
  const next = name == "heading" ? Math.max(1, Math.min(3, value + delta))
    : name == "padding" || name == "gap" || name == "minWidth" ? Math.max(0, Math.max(0, value) + delta) : value + delta;
  return formatNumber(next);
}
function writtenNumber(value: string): string {
  if (!validNumber(value) || value.startsWith("space.") || value.startsWith("radius.") || value.startsWith("fontSize.")) return value;
  return formatNumber(numberValue(value));
}
export function quote(value: string): string {
  let out = '"';
  const hex = "0123456789abcdef";
  for (let i = 0; i < value.length; i++) {
    const c = value.charAt(i), code = value.charCodeAt(i);
    if (c == '"' || c == "\\") out += "\\" + c;
    else if (c == "\n") out += "\\n";
    else if (c == "\r") out += "\\r";
    else if (c == "\t") out += "\\t";
    else if (code < 32) out += "\\u00" + hex.charAt(code >> 4) + hex.charAt(code & 15);
    else out += c;
  }
  return out + '"';
}
export function write(node: Node, depth: i32 = 0): string {
  let pad = "";
  for (let i = 0; i < depth; i++) pad += "  ";
  let out = node.kind + "(";
  if (container(node.kind)) {
    out += "[";
    for (let i = 0; i < node.children.length; i++) out += "\n" + pad + "  " + write(node.children[i], depth + 1) + ",";
    if (node.children.length > 0) out += "\n" + pad;
    out += "]";
    if (node.kind == "buttonOf") out += ", " + node.callback + (node.callback.includes("//") ? "\n" + pad : "");
  } else {
    out += node.kind == "appIcon" ? writtenNumber(node.value) : quote(node.value);
    if (node.kind == "button" || node.kind == "input") out += ", " + node.callback + (node.callback.includes("//") ? "\n" + pad : "");
  }
  out += ")";
  for (let i = 0; i < node.modifiers.length; i++) {
    const m = node.modifiers[i];
    out += "." + m.name + "(" + (m.name == "key" || m.name == "label" ? quote(m.value) : numeric(m.name) ? writtenNumber(m.value) : m.value) + ")";
  }
  return out;
}
export class ParseResult {
  root: Node | null = null;
  error: string = "";
  offset: i32 = 0;
  line: i32 = 1;
  column: i32 = 1;
}
class Parser {
  pos: i32 = 0;
  count: i32 = 0;
  result: ParseResult = new ParseResult();
  constructor(private source: string) {}
  fail(reason: string): void {
    if (this.result.error.length > 0) return;
    this.result.error = reason;
    this.result.offset = this.pos;
    for (let i = 0; i < this.pos; i++) {
      if (this.source.charAt(i) == "\n") { this.result.line++; this.result.column = 1; }
      else this.result.column++;
    }
  }
  peek(): string { return this.source.charAt(this.pos); }
  skip(): void {
    while (this.pos < this.source.length) {
      const c = this.peek();
      if (c == " " || c == "\t" || c == "\r" || c == "\n") { this.pos++; continue; }
      if (this.source.substr(this.pos, 2) == "//") {
        while (this.pos < this.source.length && this.peek() != "\n") this.pos++;
        continue;
      }
      if (this.source.substr(this.pos, 2) == "/*") {
        this.pos += 2;
        while (this.pos < this.source.length && this.source.substr(this.pos, 2) != "*/") this.pos++;
        if (this.pos == this.source.length) { this.fail("コメントが閉じていません"); return; }
        this.pos += 2; continue;
      }
      return;
    }
  }
  take(s: string): boolean {
    this.skip();
    if (this.peek() != s) { this.fail("「" + s + "」が必要です"); return false; }
    this.pos++; return true;
  }
  identifier(): string {
    this.skip(); const start = this.pos;
    while (this.pos < this.source.length) {
      const c = this.peek();
      if (!(c >= "a" && c <= "z") && !(c >= "A" && c <= "Z")) break;
      this.pos++;
    }
    return this.source.substring(start, this.pos);
  }
  stringValue(): string {
    this.skip(); const q = this.peek();
    if (q != '"' && q != "'") { this.fail("文字列が必要です"); return ""; }
    this.pos++; let out = "";
    while (this.pos < this.source.length) {
      let c = this.peek(); this.pos++;
      if (c == q) return out;
      if (c == "\n" || c == "\r") { this.fail("文字列内の改行は \\n と書いてください"); return out; }
      if (c == "\\") {
        if (this.pos >= this.source.length) break;
        c = this.peek(); this.pos++;
        if (c == "n") out += "\n";
        else if (c == "r") out += "\r";
        else if (c == "t") out += "\t";
        else if (c == "b") out += "\b";
        else if (c == "f") out += "\f";
        else if (c == "\\" || c == '"' || c == "'") out += c;
        else if (c == "u") {
          let code = 0;
          for (let j = 0; j < 4; j++) {
            const digit = "0123456789abcdef".indexOf(this.peek().toLowerCase());
            if (this.pos >= this.source.length || digit < 0) { this.fail("Unicode エスケープには16進数4桁が必要です"); return out; }
            code = code * 16 + digit; this.pos++;
          }
          out += String.fromCharCode(code);
        } else { this.fail("対応していないエスケープです"); return out; }
      } else out += c;
    }
    this.fail("文字列が閉じていません"); return out;
  }
  /** 引数の区切りまでを字句として保持し、式を実行しない。 */
  expression(): string {
    this.skip(); const start = this.pos;
    let stack = "", q = "";
    while (this.pos < this.source.length) {
      const c = this.peek();
      if (q.length > 0) {
        this.pos++;
        if (c == "\\") { if (this.pos < this.source.length) this.pos++; }
        else if (c == q) q = "";
        continue;
      }
      if (c == '"' || c == "'" || c == "`") { q = c; this.pos++; continue; }
      if (this.source.substr(this.pos, 2) == "//" || this.source.substr(this.pos, 2) == "/*") { this.skip(); continue; }
      if (stack.length == 0 && (c == ")" || c == ",")) break;
      if (c == "(" || c == "[" || c == "{") stack += c == "(" ? ")" : c == "[" ? "]" : "}";
      else if (c == ")" || c == "]" || c == "}") {
        if (stack.length == 0 || c != stack.charAt(stack.length - 1)) { this.fail("式の括弧が対応していません"); break; }
        stack = stack.substring(0, stack.length - 1);
      }
      this.pos++;
    }
    if (q.length > 0 || stack.length > 0) this.fail("式が閉じていません");
    const value = this.source.substring(start, this.pos).trim();
    if (value.length == 0) this.fail("引数が必要です");
    return value;
  }
  node(depth: i32): Node {
    const n = new Node(this.identifier());
    if (++this.count > 500 || depth > 48) { this.fail("部品は500個、深さは48段までです"); return n; }
    if (!container(n.kind) && n.kind != "text" && n.kind != "button" && n.kind != "input" && n.kind != "appIcon") { this.fail("対応していない部品です: " + n.kind); return n; }
    if (!this.take("(")) return n;
    if (container(n.kind)) {
      if (!this.take("[")) return n;
      this.skip();
      while (this.peek() != "]" && this.result.error.length == 0) {
        n.children.push(this.node(depth + 1)); this.skip();
        if (this.peek() != ",") break;
        this.pos++; this.skip();
      }
      if (!this.take("]")) return n;
    } else if (n.kind == "appIcon") {
      n.value = this.expression();
      if (!validNumber(n.value)) this.fail("アイコン番号は有限の数値で指定してください");
    } else n.value = this.stringValue();
    if (n.kind == "button" || n.kind == "buttonOf" || n.kind == "input") {
      if (!this.take(",")) return n;
      n.callback = this.expression();
    }
    this.skip();
    if (this.peek() == ",") this.pos++;
    if (!this.take(")")) return n;
    this.skip();
    while (this.peek() == "." && this.result.error.length == 0) {
      this.pos++; const name = this.identifier();
      if (!numeric(name) && !flag(name) && name != "key" && name != "label" && name != "enabled") { this.fail("対応していない修飾です: " + name); return n; }
      if (!this.take("(")) return n;
      let value = "";
      this.skip();
      if (name == "key" || name == "label") value = this.stringValue();
      else if (!flag(name) && this.peek() != ")") value = this.expression();
      else if (numeric(name) && name != "padding" && name != "gap") this.fail("数値が必要です");
      if (numeric(name) && value.length > 0 && !validModifierNumber(name, value)) this.fail(name == "heading" || name == "arg" ? "整数を指定してください（段の名前は使えません）" : "有限の数値か段の名前が必要です");
      if (name == "enabled" && value != "true" && value != "false") this.fail("true または false が必要です");
      if (!this.take(")")) return n;
      n.modifiers.push(new Modifier(name, value)); this.skip();
    }
    return n;
  }
  run(): ParseResult {
    if (this.source.length > 65536) { this.fail("コードは65536文字までです"); return this.result; }
    const n = this.node(0); this.skip();
    if (this.peek() == ";") { this.pos++; this.skip(); }
    if (this.pos < this.source.length) this.fail("部品の式の後に余分な文字があります");
    if (this.result.error.length == 0) this.result.root = n;
    return this.result;
  }
}
export function parse(source: string): ParseResult { return new Parser(source).run(); }
export const example: string = 'column([\n  text("こんにちは").heading(1),\n  row([text("Décor の見本"), button("押す", () => {}).padding(space.sm)]).gap(12),\n  input("複数行\\n編集できます", (value: string) => {}).multiline().label("メモ"),\n]).gap(16).padding(16)';
