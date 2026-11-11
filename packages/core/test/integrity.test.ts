import { assertEquals, assertRejects } from "@std/assert";
import { type AppFile, BinetteError, computeIntegrity, hashFile, hashFolder, verifyIntegrity } from "../src/index.ts";

const enc = new TextEncoder();
const file = (path: string, content: string): AppFile => ({ path, bytes: enc.encode(content) });
/** 期待値は実装とは別に、バイト列を手で組んで求める */
async function expected(bytes: number[]): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return `sha256-${btoa(String.fromCharCode(...digest))}`;
}
const bytesOf = (s: string) => [...enc.encode(s)];

Deno.test("ファイルのハッシュは中身の SHA-256（既知の値）", async () => {
  assertEquals(await hashFile(enc.encode("abc")), "sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
  assertEquals(await hashFile(new Uint8Array()), "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
});

Deno.test("フォルダのハッシュ: パス・バイト数・中身をつないだものを、パスの順に求める", async () => {
  const files = [file("b.txt", "BB"), file("a/x.txt", "あ"), file("a.txt", "A")];
  // 並び順: "a.txt" < "a/x.txt" < "b.txt"（"." 0x2E < "/" 0x2F）。あ は UTF-8 で 3 バイト
  const manual = [
    ...bytesOf("a.txt"), 0, ...bytesOf("1"), 0, ...bytesOf("A"),
    ...bytesOf("a/x.txt"), 0, ...bytesOf("3"), 0, 0xE3, 0x81, 0x82,
    ...bytesOf("b.txt"), 0, ...bytesOf("2"), 0, ...bytesOf("BB"),
  ];
  assertEquals(await hashFolder(files), await expected(manual));
  assertEquals(await hashFolder(files, "/"), await expected(manual));
  assertEquals(await computeIntegrity(files, "/"), await expected(manual));
});

Deno.test("フォルダのハッシュ: 入力の順に左右されず、フォルダからの相対パスで求める", async () => {
  const files = [file("src/b.ts", "2"), file("src/a.ts", "1"), file("app.json", "{}"), file("srcx/c.ts", "3")];
  const manual = [...bytesOf("a.ts"), 0, ...bytesOf("1"), 0, ...bytesOf("1"), ...bytesOf("b.ts"), 0, ...bytesOf("1"), 0, ...bytesOf("2")];
  assertEquals(await computeIntegrity(files, "src/"), await expected(manual));
  assertEquals(await computeIntegrity([...files].reverse(), "src/"), await expected(manual));
});

Deno.test("フォルダのハッシュ: パスの順は UTF-16 コード単位（コードポイントの順ではない）", async () => {
  // U+1F600 は UTF-16 で D83D DE00、U+FF5E は FF5E。コード単位の順では絵文字が先
  const emoji = "\u{1F600}.txt";
  const wide = "～.txt";
  const manual = [
    ...bytesOf(emoji), 0, ...bytesOf("1"), 0, ...bytesOf("e"),
    ...bytesOf(wide), 0, ...bytesOf("1"), 0, ...bytesOf("w"),
  ];
  assertEquals(await hashFolder([file(wide, "w"), file(emoji, "e")]), await expected(manual));
});

Deno.test("integrity: ファイルかフォルダが無ければ BinetteError", async () => {
  const files = [file("app.json", "{}")];
  await assertRejects(() => computeIntegrity(files, "missing.ts"), BinetteError);
  await assertRejects(() => computeIntegrity(files, "src/"), BinetteError);
  await assertRejects(() => hashFolder([]), BinetteError);
});

Deno.test("verifyIntegrity: 合えば通り、合わない・無いと止まる", async () => {
  const files = [file("app.json", "{}"), file("src/main.ts", "x")];
  const integrity = {
    "/": await computeIntegrity(files, "/"),
    "src/": await computeIntegrity(files, "src/"),
    "app.json": await hashFile(enc.encode("{}")),
  };
  await verifyIntegrity(integrity, files);
  await verifyIntegrity({}, files);
  const wrong = { ...integrity, "app.json": await hashFile(enc.encode("x")) };
  const error = await assertRejects(() => verifyIntegrity(wrong, files), BinetteError);
  assertEquals(error.message, "ハッシュが合いません: app.json");
  await assertRejects(() => verifyIntegrity(integrity, [file("app.json", "{}")]), BinetteError);
  await assertRejects(() => verifyIntegrity({ "gone/": integrity["/"] }, files), BinetteError);
  await assertRejects(() => verifyIntegrity({ "gone.ts": integrity["/"] }, files), BinetteError);
});
