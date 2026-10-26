import { assertEquals, assertRejects } from "@std/assert";
import { buildSystem, systemApps } from "./build-system.ts";
import { parsePrebuiltApp } from "../packages/scene/src/prebuilt.ts";

const replique = new URL("../packages/replique/src/index.ts", import.meta.url).pathname;
async function app(root: string, name: string): Promise<void> {
  await Deno.mkdir(`${root}/${name}`, { recursive: true });
  await Deno.writeTextFile(`${root}/${name}/app.json`, JSON.stringify({ id: name, name, entry: { html: "index.html", as: "main.ts" } }));
  await Deno.writeTextFile(`${root}/${name}/index.html`, "<p>例</p>");
  await Deno.writeTextFile(`${root}/${name}/main.ts`, "export function start(): void {}");
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
    assertEquals(await buildSystem(dir, `${dir}/out`, replique), ["a", "a-b"]);
    const files = Array.from(Deno.readDirSync(`${dir}/out`), (entry) => entry.name).sort();
    assertEquals(files, ["a-b.binapp", "a.binapp", "keep.txt"]);
    for (const name of ["a", "a-b"]) {
      assertEquals(parsePrebuiltApp(await Deno.readTextFile(`${dir}/out/${name}.binapp`)).manifest.id, name);
    }
    await Deno.remove(`${dir}/a-b`, { recursive: true });
    assertEquals(await buildSystem(dir, `${dir}/out`, replique), ["a"]);
    assertEquals(Array.from(Deno.readDirSync(`${dir}/out`), (entry) => entry.name).sort(), ["a.binapp", "keep.txt"]);
  } finally { await Deno.remove(dir, { recursive: true }); }
});
Deno.test("システムアプリの失敗はフォルダ名を示す", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await app(dir, "broken");
    await Deno.writeTextFile(`${dir}/broken/app.json`, "{");
    assertEquals(await systemApps(dir), ["broken"]);
    await assertRejects(() => buildSystem(dir, `${dir}/out`, replique), Error, "システムアプリ「broken」");
    const result = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", new URL("./build-system.ts", import.meta.url).pathname, "--invalid"] }).output();
    assertEquals(result.code, 1);
  } finally { await Deno.remove(dir, { recursive: true }); }
});
