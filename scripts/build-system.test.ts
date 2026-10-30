import { assertEquals, assertRejects } from "@std/assert";
import { buildApps, buildFolder, appNames } from "./build-system.ts";
import { parsePrebuiltApp } from "../packages/regie/src/prebuilt.ts";

const replique = new URL("../packages/replique/src/index.ts", import.meta.url).pathname;
async function app(root: string, name: string): Promise<void> {
  await Deno.mkdir(`${root}/${name}`, { recursive: true });
  await Deno.writeTextFile(`${root}/${name}/app.json`, JSON.stringify({ id: name, name, entry: { html: "index.html", as: "main.ts" } }));
  await Deno.writeTextFile(`${root}/${name}/index.html`, "<p>例</p>");
  await Deno.writeTextFile(`${root}/${name}/main.ts`, 'import { App, launch } from "jsr:@binette/replique"; launch(new App());');
}
Deno.test("システムアプリだけをフォルダ名順で書き出し、古い .binapp を消す", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await app(dir, "a-b");
    await app(dir, "a");
    await Deno.mkdir(`${dir}/ignored`);
    await Deno.mkdir(`${dir}/out`);
    await Deno.writeTextFile(`${dir}/out/old.binapp`, "古い");
    await Deno.writeTextFile(`${dir}/out/keep.txt`, "残す");
    assertEquals(await buildFolder(dir, `${dir}/out`, replique), ["a", "a-b"]);
    const files = Array.from(Deno.readDirSync(`${dir}/out`), (entry) => entry.name).sort();
    assertEquals(files, ["a-b.binapp", "a.binapp", "keep.txt"]);
    for (const name of ["a", "a-b"]) {
      assertEquals(parsePrebuiltApp(await Deno.readTextFile(`${dir}/out/${name}.binapp`)).manifest.id, name);
    }
    await Deno.remove(`${dir}/a-b`, { recursive: true });
    assertEquals(await buildFolder(dir, `${dir}/out`, replique), ["a"]);
    assertEquals(Array.from(Deno.readDirSync(`${dir}/out`), (entry) => entry.name).sort(), ["a.binapp", "keep.txt"]);
  } finally { await Deno.remove(dir, { recursive: true }); }
});
Deno.test("システムアプリの失敗はフォルダ名を示す", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await app(dir, "broken");
    await Deno.writeTextFile(`${dir}/broken/app.json`, "{");
    assertEquals(await appNames(dir), ["broken"]);
    await assertRejects(() => buildFolder(dir, `${dir}/out`, replique), Error, "システムアプリ「broken」");
    const result = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", new URL("./build-system.ts", import.meta.url).pathname, "--invalid"] }).output();
    assertEquals(result.code, 1);
  } finally { await Deno.remove(dir, { recursive: true }); }
});

Deno.test("実際のシステムアプリは HTML なしで宣言 UI をビルドする", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const root = new URL("../apps", import.meta.url).pathname;
    assertEquals(await buildFolder(root, dir, replique), ["home", "settings"]);
    for (const name of ["home", "settings"]) {
      const built = parsePrebuiltApp(await Deno.readTextFile(`${dir}/${name}.binapp`));
      assertEquals(built.manifest.entry.html, undefined);
      assertEquals(built.html, "");
    }
  } finally { await Deno.remove(dir, { recursive: true }); }
});

Deno.test("システムアプリと同梱アプリの出力を分け、同梱アプリが空でも古い生成物を消す", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/apps`);
    await Deno.mkdir(`${dir}/bundled`);
    await Deno.mkdir(`${dir}/.binapp/bundled`, { recursive: true });
    await Deno.writeTextFile(`${dir}/.binapp/old.binapp`, "古い");
    await Deno.writeTextFile(`${dir}/.binapp/keep.txt`, "残す");
    await Deno.writeTextFile(`${dir}/.binapp/bundled/removed.binapp`, "古い");
    await buildApps(dir);
    assertEquals(Array.from(Deno.readDirSync(`${dir}/.binapp`), (entry) => entry.name).sort(), ["bundled", "keep.txt", "system"]);
    assertEquals(Array.from(Deno.readDirSync(`${dir}/.binapp/bundled`)), []);
    // フォルダ名が同じでも、一方の出力を消すときに他方を残す。
    await Deno.mkdir(`${dir}/packages/replique/src`, { recursive: true });
    await Deno.symlink(replique, `${dir}/packages/replique/src/index.ts`);
    await app(`${dir}/apps`, "same");
    await app(`${dir}/bundled`, "same");
    await buildApps(dir);
    for (const kind of ["system", "bundled"]) {
      assertEquals(parsePrebuiltApp(await Deno.readTextFile(`${dir}/.binapp/${kind}/same.binapp`)).manifest.id, "same");
    }
    await Deno.remove(`${dir}/bundled/same`, { recursive: true });
    await buildApps(dir);
    assertEquals(Array.from(Deno.readDirSync(`${dir}/.binapp/bundled`)), []);
    assertEquals(Array.from(Deno.readDirSync(`${dir}/.binapp/system`), (entry) => entry.name), ["same.binapp"]);
  } finally { await Deno.remove(dir, { recursive: true }); }
});
