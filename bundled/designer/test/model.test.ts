import { assertEquals } from "@std/assert";
import asc from "assemblyscript/asc";

// 純粋ロジックを実際の AssemblyScript コンパイラーと Wasm で検証する。
const fixture = `
import { parse, write, Node, example, validNumber, formatNumber, validModifierNumber, stepNumber } from "./model";
export function roundTrip(): i32 {
  const first = parse(example);
  if (first.root === null) return 1;
  const code = write(changetype<Node>(first.root));
  const next = parse(code);
  if (next.root === null) return 2;
  return write(changetype<Node>(next.root)) == code ? 0 : 3;
}
export function allParts(): string {
  const code = 'grid([column([]), row([]), text("日本語\\\\n二行目").heading(2), button("押す", (i: i32): void => { use(i, "a,b)"); }).arg(2), buttonOf([appIcon(1)], open).key("a"), input("メモ", (s: string) => { save(s); }).multiline()]).padding().gap(space.md).minWidth(120.5).grow().list().enabled(false).label("見本")';
  const first = parse(code);
  if (first.root === null) return first.error;
  const output = write(changetype<Node>(first.root));
  const next = parse(output);
  if (next.root === null) return next.error;
  return write(changetype<Node>(next.root)) == output ? output : "不一致";
}
export function position(): string {
  const r = parse('column([\\n  text("よい"),\\n  unknown("悪い")\\n])');
  return r.line.toString() + ":" + r.column.toString() + ":" + r.error + ":" + (r.root === null ? "木なし" : "木あり");
}
export function callback(): string {
  const r = parse('button("試験", (i: i32) => { /* , ) */ call([i, 2], { a: "a,b)" }); })');
  if (r.root === null) return r.error;
  return changetype<Node>(r.root).callback;
}
export function comment(): i32 {
  const r = parse('button("末尾", () => {} // 末尾のコメント\\n)');
  if (r.root === null) return 1;
  const code = write(changetype<Node>(r.root));
  return parse(code).root === null ? 2 : 0;
}
export function errors(): i32 {
  const cases = ['text("未完)', 'text("x").other()', 'text("x").enabled(1)', 'text("x").gap(Infinity)', 'column([text("x"))', 'button("x", () => {]', 'text("x") trailing', 'text("x").grow(true)', 'text("x").heading()', '/* 未完'];
  for (let i = 0; i < cases.length; i++) if (parse(cases[i]).root !== null) return i + 1;
  return 0;
}
export function escaping(): i32 {
  const n = new Node("text");
  n.value = "引用\\\"\\\\\\n\\t" + String.fromCharCode(0) + "日本語";
  const r = parse(write(n));
  if (r.root === null) return 1;
  return changetype<Node>(r.root).value == n.value ? 0 : 2;
}
export function limits(): i32 {
  let code = 'text("x")';
  for (let i = 0; i < 51; i++) code = 'column([' + code + '])';
  if (parse(code).root !== null) return 1;
  code = 'column([';
  for (let i = 0; i < 501; i++) code += 'text("x"),';
  code += '])';
  return parse(code).root === null && !validNumber("1e999") && !validNumber("space.no") && validNumber("-.5") && validNumber("1e+21") && !validNumber("1e+") ? 0 : 2;
}
export function numberFormatting(): string {
  return [formatNumber(1), formatNumber(-2), formatNumber(0), formatNumber(1.25), formatNumber(-0.5), formatNumber(1e21)].join(",");
}
export function numberSteps(): string {
  return [
    stepNumber("minWidth", "10", 1), stepNumber("minWidth", "10.5", -1),
    stepNumber("padding", "space.xs", -1), stepNumber("gap", "space.xl", 1),
    stepNumber("padding", "radius.sm", 1), stepNumber("gap", "fontSize.lg", -1),
    stepNumber("padding", "-1", -1), stepNumber("gap", "-5", 1),
    stepNumber("padding", "", 1), stepNumber("gap", "", -1),
    stepNumber("heading", "", 1), stepNumber("heading", "1", -1), stepNumber("heading", "3", 1),
    stepNumber("heading", "99", -1), stepNumber("heading", "-4", 1),
    stepNumber("arg", "", 1), stepNumber("arg", "-2", -1), stepNumber("minWidth", "", 1)
  ].join(",");
}
export function integerModifiers(): i32 {
  const names = ["heading", "arg"];
  const valid = ["0", "-2", "3", "2.0", "1e2"];
  const invalid = ["", "1.5", "space.md", "radius.sm", "fontSize.lg", "Infinity", "1e999"];
  for (let i = 0; i < names.length; i++) {
    for (let j = 0; j < valid.length; j++) {
      if (!validModifierNumber(names[i], valid[j])) return 1;
      if (parse('text("x").' + names[i] + '(' + valid[j] + ')').root === null) return 2;
    }
    for (let j = 0; j < invalid.length; j++) {
      if (validModifierNumber(names[i], invalid[j])) return 3;
      if (parse('text("x").' + names[i] + '(' + invalid[j] + ')').root !== null) return 4;
    }
  }
  return validModifierNumber("padding", "") && validModifierNumber("gap", "") &&
    validModifierNumber("minWidth", "1.5") && validModifierNumber("gap", "space.md") ? 0 : 5;
}
`;

Deno.test("デザイナーの木と式の往復・全パーツ・修飾・日本語を AS で確認する", async () => {
  const model = await Deno.readTextFile(new URL("../src/model.ts", import.meta.url));
  const stderr = asc.createMemoryStream();
  let wasm: Uint8Array | undefined;
  const result = await asc.main(["fixture.ts", "--outFile", "fixture.wasm"], {
    readFile: (name) => name === "fixture.ts" ? fixture : name === "model.ts" ? model : null,
    writeFile(name, value) {
      if (name === "fixture.wasm" && typeof value !== "string") wasm = value;
    },
    listFiles: () => [], stderr,
  });
  assertEquals(result.error, null, stderr.toString());
  const { instance } = await WebAssembly.instantiate(new Uint8Array(wasm!), {
    env: { abort() { throw new Error("AssemblyScript の検証が中断されました"); } },
  });
  const exports = instance.exports as {
    memory: WebAssembly.Memory;
    roundTrip(): number;
    allParts(): number;
    position(): number;
    callback(): number;
    comment(): number;
    errors(): number;
    escaping(): number;
    limits(): number;
    numberFormatting(): number;
    numberSteps(): number;
    integerModifiers(): number;
  };
  function string(pointer: number): string {
    const length = new DataView(exports.memory.buffer).getUint32(pointer - 4, true) / 2;
    return String.fromCharCode(...new Uint16Array(exports.memory.buffer, pointer, length));
  }
  assertEquals(exports.roundTrip(), 0);
  const output = string(exports.allParts());
  assertEquals(output.includes(".padding().gap(space.md).minWidth(120.5).grow().list().enabled(false)"), true, output);
  assertEquals(output.includes(".multiline()"), true);
  assertEquals(output.includes('buttonOf(['), true);
  assertEquals(output.includes('.arg(2)'), true);
  assertEquals(string(exports.position()), "3:10:対応していない部品です: unknown:木なし");
  assertEquals(string(exports.callback()), '(i: i32) => { /* , ) */ call([i, 2], { a: "a,b)" }); }');
  assertEquals(exports.comment(), 0);
  assertEquals(exports.errors(), 0);
  assertEquals(exports.escaping(), 0);
  assertEquals(exports.limits(), 0);
  // 整数表記、小数、段の境界・既定値、整数専用の修飾を実 Wasm で確認する。
  assertEquals(string(exports.numberFormatting()), "1,-2,0,1.25,-0.5,1e+21");
  assertEquals(string(exports.numberSteps()), "11,9.5,space.xs,space.xl,radius.md,fontSize.md,space.xs,space.xl,space.md,space.md,2,1,3,2,2,1,-3,1");
  assertEquals(exports.integerModifiers(), 0);
});
