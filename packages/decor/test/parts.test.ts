import { assertEquals } from "@std/assert";
import asc from "assemblyscript/asc";
import { tree, integers, multiline, looks } from "./fixtures/parts.ts";
import { View, intString } from "../src/parts.ts";
import { theme, text } from "../src/view.ts";

Deno.test("shared parts produce identical themes and integer strings in Deno and asc", async () => {
  const fixture = await Deno.readTextFile(new URL("./fixtures/parts.ts", import.meta.url));
  const parts = await Deno.readTextFile(new URL("../src/parts.ts", import.meta.url));
  let wasm: Uint8Array | undefined;
  const stderr = asc.createMemoryStream();
  const result = await asc.main(["fixture.ts", "--outFile", "fixture.wasm", "--exportRuntime"], {
    readFile(name: string) {
      if (name === "fixture.ts") return fixture.replace('"../../src/parts.ts"', '"./parts.ts"') + '\nexport function themeValue(): string { return tree().themeValue; }';
      if (name === "parts.ts") return parts;
      return null;
    },
    writeFile(name: string, value: string | Uint8Array) { if (name === "fixture.wasm" && typeof value !== "string") wasm = value; },
    listFiles: () => [], stderr,
  });
  assertEquals(result.error, null, stderr.toString());
  const { instance } = await WebAssembly.instantiate(new Uint8Array(wasm!), { env: { abort() { throw new Error("AS aborted"); } } });
  const exports = instance.exports as { memory: WebAssembly.Memory; themeValue(): number; integers(): number; multiline(): number; looks(): number };
  function string(pointer: number): string {
    const length = new DataView(exports.memory.buffer).getUint32(pointer - 4, true) / 2;
    return String.fromCharCode(...new Uint16Array(exports.memory.buffer, pointer, length));
  }
  await checkNonFinite(new Uint8Array(wasm!));
  assertEquals(string(exports.themeValue()), tree().themeValue);
  assertEquals(string(exports.integers()), integers());
  assertEquals(string(exports.multiline()), multiline());
  assertEquals(multiline(), "input:true:-1:first\nsecond");
  assertEquals(string(exports.looks()), looks());
  assertEquals(looks(), "ghost|muted|card|top left|111111111|240,0,420|1,0|なし;||||000000000|0,0,0|0,-1|;||||000000000|0,0,0|-1,-1|");
  const view = new View("text");
  assertEquals(view.multilineValue, false);
  assertEquals(view.multiline(), view);
  assertEquals(view.multilineValue, true);
  assertEquals(view.appValue, -1);
  assertEquals(integers(), "0,0,-42,1234567890123,9007199254740991");
  assertEquals(intString(-3.8), "-3");
  assertEquals(tree().children[0]!.children[0]!.headingValue, 3);
});

Deno.test("TS partial themes preserve omitted fields, fractions and nested precedence", () => {
  const view = theme({ space: { md: 12.5, xs: undefined }, button: { padding: 2.5, radius: undefined } },
    theme({ space: { sm: 3, md: 20 } }, text("value")));
  assertEquals(view.themeValue,
    "--bina-ui-space-md:12.5px;--bina-ui-button-padding-px:2.5px;" +
    "--bina-ui-button-padding-xs:0;--bina-ui-button-padding-sm:0;--bina-ui-button-padding-md:0;" +
    "--bina-ui-button-padding-lg:0;--bina-ui-button-padding-xl:0;" +
    "--bina-ui-space-sm:3px;--bina-ui-space-md:20px;");
});

// Run unbounded numeric inputs off the test thread so a regression fails on timeout.
async function checkNonFinite(wasm: Uint8Array): Promise<void> {
  const parts = new URL("../src/parts.ts", import.meta.url).href;
  const view = new URL("../src/view.ts", import.meta.url).href;
  const url = URL.createObjectURL(new Blob([`
    import { intString } from ${JSON.stringify(parts)};
    import { theme, text } from ${JSON.stringify(view)};
    onmessage = async ({ data }) => {
      const { instance } = await WebAssembly.instantiate(data, { env: { abort() { throw new Error("AS aborted"); } } });
      const exports = instance.exports;
      const pointer = exports.nonFinite();
      const length = new DataView(exports.memory.buffer).getUint32(pointer - 4, true) / 2;
      const result = String.fromCharCode(...new Uint16Array(exports.memory.buffer, pointer, length));
      const css = theme({ space: { md: Infinity }, button: { padding: NaN } }, text("value")).themeValue;
      postMessage([intString(NaN) + "," + intString(Infinity) + "," + intString(-Infinity), result,
        css.includes("--bina-ui-space-md:Infinitypx;") && css.includes("--bina-ui-button-padding-px:NaNpx;")]);
    };
  `], { type: "text/javascript" }));
  const worker = new Worker(url, { type: "module" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await new Promise<unknown>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Non-finite formatting timed out")), 5000);
      worker.onmessage = event => resolve(event.data);
      worker.onerror = event => { event.preventDefault(); reject(new Error(event.message)); };
      worker.postMessage(wasm);
    });
    assertEquals(result, ["NaN,Infinity,-Infinity", "NaN,Infinity,-Infinity", true]);
  } finally {
    clearTimeout(timer);
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}
