import { assertEquals, assertRejects } from "@std/assert";
import {
  createAppStore,
  createMemoryFileTree,
  createSystemDistribution,
  installedAppKey,
  type SystemManifest,
} from "@binette/regie";
import { Window } from "happy-dom";
import { bootAppStore, loadBootApps } from "./boot.ts";
import { showRecovery } from "./recovery.ts";

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
async function fixture() {
  const tree = createMemoryFileTree();
  const files = new Map<string, Uint8Array>([[
    "system/boot.json",
    encode({ roles: { home: "home", settings: "settings", cadre: "cadre" } }),
  ]]);
  for (const name of ["home", "settings", "cadre"]) {
    files.set(
      `system/apps/${name}/app.json`,
      encode({ id: name, name, roles: [name], entry: { as: "main.ts", css: "src/style.css" } }),
    );
    files.set(
      `system/apps/${name}/app.wasm`,
      new Uint8Array([0, 97, 115, 109]),
    );
    files.set(`system/apps/${name}/index.html`, new Uint8Array());
    files.set(`system/apps/${name}/style.css`, new TextEncoder().encode("p { color: red }"));
  }
  const manifest: SystemManifest = { version: "1", files: [] };
  for (const [path, data] of files) {
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", data.slice()),
    );
    manifest.files.push({
      path,
      size: data.length,
      sha256: [...digest].map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    });
  }
  const distribution = createSystemDistribution(tree, {
    origin: "https://example.test",
    manifestUrl: "https://example.test/manifest.json",
    fetch: (input) => {
      const path = new URL(String(input)).pathname.slice(1);
      const body = path === "manifest.json"
        ? encode(manifest)
        : files.get(path);
      return Promise.resolve(
        new Response(body?.slice(), { status: body ? 200 : 404 }),
      );
    },
  });
  await distribution.install();
  return { tree, distribution };
}

Deno.test("起動は固定物を検証し、設定の上書きと古い固定アプリを使わない", async () => {
  const { tree, distribution } = await fixture();
  await tree.write("/user/apps/settings/app.wasm", new Uint8Array([99]));
  const { apps, roles } = await loadBootApps(tree, distribution);
  assertEquals(apps.find(app => app.prebuilt?.manifest.id === "cadre")?.prebuilt?.css, "p { color: red }");
  assertEquals(roles, {
    home: installedAppKey("binette:system", "home"),
    settings: installedAppKey("binette:system", "settings"),
    cadre: installedAppKey("binette:system", "cadre"),
  });
  assertEquals(
    apps.find((app) => app.prebuilt?.manifest.id === "settings")?.prebuilt
      ?.wasm,
    new Uint8Array([0, 97, 115, 109]),
  );
  const store = createAppStore(tree);
  for (const source of ["binette:system", "binette:bundled", "custom"]) {
    await store.put({
      source,
      key: installedAppKey(source, "old"),
      manifest: { id: "old", name: "old", entry: { as: "main.ts" } },
      wasm: new Uint8Array([99]),
      html: "",
      icon: undefined,
      installedAt: 1,
    });
  }
  const safe = bootAppStore(store);
  assertEquals((await safe.list()).map((app) => app.source), ["custom"]);
  assertEquals(
    await safe.get(installedAppKey("binette:system", "old")),
    undefined,
  );
});

Deno.test("目録にあるアプリの説明ファイルが欠けたときも起動を拒否する", async () => {
  const { tree, distribution } = await fixture();
  const files = new Map<string, Uint8Array>();
  for (const path of await tree.list("/system")) {
    if (path !== "/system/apps/home/app.json") {
      files.set(path, (await tree.read(path))!);
    }
  }
  await tree.replaceSystem(files);
  await assertRejects(
    () => loadBootApps(tree, distribution),
    Error,
    "固定物がありません",
  );
});

Deno.test("改変した固定物と設定役割へのユーザーの差し替えは起動を拒否する", async () => {
  const { tree, distribution } = await fixture();
  await tree.write(
    "/user/apps/home/app.json",
    encode({
      id: "fake",
      name: "fake",
      roles: ["settings"],
      entry: { as: "main.ts" },
    }),
  );
  await assertRejects(
    () => loadBootApps(tree, distribution),
    Error,
    "固定の割り当て",
  );
  await tree.delete("/user/apps/home/app.json");
  const files = new Map<string, Uint8Array>();
  for (const path of await tree.list("/system")) {
    files.set(path, (await tree.read(path))!);
  }
  files.set("/system/apps/home/app.wasm", new Uint8Array([99]));
  await tree.replaceSystem(files);
  await assertRejects(
    () => loadBootApps(tree, distribution),
    Error,
    "大きさが一致",
  );
});

Deno.test("DOM の復旧画面は操作の失敗を表示して再操作できる", async () => {
  const window = new Window();
  try {
    const { distribution } = await fixture();
    const container = window.document.createElement("div");
    window.document.body.append(container);
    showRecovery(container as unknown as HTMLElement, {
      ...distribution,
      recover() {
        return Promise.reject(new Error("保存先が開けません"));
      },
    }, new Error("初回起動失敗"));
    assertEquals(
      container.querySelector('[role="alert"]')?.textContent,
      "起動できませんでした: 初回起動失敗",
    );
    const button = container.querySelector("button")!;
    button.click();
    assertEquals(button.disabled, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(
      container.querySelector('[role="alert"]')?.textContent,
      "保存先が開けません",
    );
    assertEquals(button.disabled, false);
  } finally {
    await window.happyDOM.close();
  }
});

Deno.test("オフラインでも保存済みの配布物を検証してホームと設定を読み込む", async () => {
  const { tree } = await fixture();
  const distribution = createSystemDistribution(tree, {
    origin: "https://example.test",
    manifestUrl: "/manifest.json",
    fetch: () => Promise.reject(new TypeError("offline")),
  });
  const update = await distribution.checkUpdate();
  assertEquals(update.installedVersion, "1");
  assertEquals(update.updateAvailable, false);
  const { apps, roles } = await loadBootApps(tree, distribution);
  assertEquals(roles.home, installedAppKey("binette:system", "home"));
  assertEquals(apps.map((app) => app.prebuilt?.manifest.id), [
    "cadre",
    "home",
    "settings",
  ]);
});
