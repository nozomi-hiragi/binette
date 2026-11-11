// A small JSON reader for the OS operation results.
export class Json {
  kind: string = "";
  value: string = "";
  keys: string[] = [];
  children: Json[] = [];
  get(key: string): Json | null {
    const i = this.keys.indexOf(key);
    return i < 0 ? null : this.children[i];
  }
  string(key: string): string {
    const v = this.get(key);
    return v === null ? "" : v.value;
  }
}
class Reader {
  private i: i32 = 0;
  constructor(private source: string) {}
  private whitespace(): void { while (this.i < this.source.length && this.source.charCodeAt(this.i) <= 32) this.i++; }
  private quoted(): string {
    let out = ""; this.i++;
    while (this.i < this.source.length) {
      const c = this.source.charAt(this.i++);
      if (c == '"') break;
      if (c != "\\") { out += c; continue; }
      const e = this.source.charAt(this.i++);
      if (e == "n") out += "\n"; else if (e == "r") out += "\r"; else if (e == "t") out += "\t";
      else if (e == "b") out += "\b"; else if (e == "f") out += "\f";
      else if (e == "u") { out += String.fromCharCode(I32.parseInt(this.source.substr(this.i, 4), 16)); this.i += 4; }
      else out += e;
    }
    return out;
  }
  read(): Json {
    this.whitespace(); const result = new Json(); const c = this.source.charAt(this.i);
    if (c == '"') { result.kind = "string"; result.value = this.quoted(); return result; }
    if (c == "[" || c == "{") {
      result.kind = c == "[" ? "array" : "object"; this.i++;
      while (this.i < this.source.length) {
        this.whitespace(); if (this.source.charAt(this.i) == (c == "[" ? "]" : "}")) { this.i++; break; }
        if (c == "{") { result.keys.push(this.quoted()); this.whitespace(); this.i++; }
        result.children.push(this.read()); this.whitespace();
        if (this.source.charAt(this.i) == ",") this.i++; else { this.i++; break; }
      }
      return result;
    }
    const start = this.i;
    while (this.i < this.source.length && ",]} \n\r\t".indexOf(this.source.charAt(this.i)) < 0) this.i++;
    result.kind = "literal"; result.value = this.source.substring(start, this.i); return result;
  }
}
export function parseJson(source: string): Json { return new Reader(source).read(); }
export function quote(value: string): string {
  let out = '"'; const hex = "0123456789abcdef";
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c == 34 || c == 92) out += "\\" + value.charAt(i);
    else if (c < 32) out += "\\u00" + hex.charAt(c >> 4) + hex.charAt(c & 15);
    else out += value.charAt(i);
  }
  return out + '"';
}
export function args(values: string[]): string {
  let out = "[";
  for (let i = 0; i < values.length; i++) { if (i > 0) out += ","; out += quote(values[i]); }
  return out + "]";
}
