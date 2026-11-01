import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  createSystemDistribution,
  parseSystemManifest,
  SYSTEM_MANIFEST_PATH,
  type SystemManifest,
} from "../src/distribution.ts";
import { createMemoryFileTree, type FileTree } from "../src/fs.ts";

const encode = (value: string) => new TextEncoder().encode(value);
const origin = "https://binette.example";
async function fixture(version = "1", name = "home", content = "old") {
  const data = encode(content);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const manifest: SystemManifest = {
    version,
    files: [{
      path: `system/apps/${name}/app.wasm`,
      sha256: [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      ),
      size: data.length,
    }],
  };
  const responses = new Map<string, Uint8Array>([
    ["/release/manifest.json", encode(JSON.stringify(manifest))],
    [`/release/${manifest.files[0].path}`, data],
  ]);
  const calls: { path: string; options: RequestInit | undefined }[] = [];
  const fetch: typeof globalThis.fetch = (input, options) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, options });
    const body = responses.get(path);
    return Promise.resolve(
      new Response(body?.slice(), { status: body ? 200 : 404 }),
    );
  };
  return { manifest, data, calls, responses, fetch };
}
function distribution(tree: FileTree, fetch: typeof globalThis.fetch) {
  return createSystemDistribution(tree, {
    origin,
    manifestUrl: "/release/manifest.json",
    fetch,
  });
}

Deno.test("Manifest validates types, canonical system paths, unique files, hash and size", () => {
  const file = { path: "system/boot.json", sha256: "a".repeat(64), size: 0 };
  const valid = { version: "1", files: [file] };
  const parsed = parseSystemManifest(valid);
  file.size = 2;
  assertEquals(parsed.files[0].size, 0);
  for (
    const value of [null, [], {}, { version: "", files: [] }, {
      version: 1,
      files: [],
    }, { version: "1", files: null }]
  ) {
    assertThrows(() => parseSystemManifest(value));
  }
  for (
    const path of [
      "/system/a",
      "user/a",
      "system/",
      "system/../a",
      "system/./a",
      "system//a",
      "system/a\\b",
      "system/%2e%2e/a",
      "system/a?x",
      "system/a#x",
      "system/a\0",
      "system/a\nb",
      "system/.manifest.json",
    ]
  ) {
    assertThrows(() =>
      parseSystemManifest({ ...valid, files: [{ ...file, path }] })
    );
  }
  for (const sha256 of ["A".repeat(64), "g".repeat(64), "a".repeat(63), 1]) {
    assertThrows(() =>
      parseSystemManifest({ ...valid, files: [{ ...file, sha256 }] })
    );
  }
  for (
    const size of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1"]
  ) {
    assertThrows(() =>
      parseSystemManifest({ ...valid, files: [{ ...file, size }] })
    );
  }
  assertThrows(() => parseSystemManifest({ ...valid, files: [file, file] }));
});

Deno.test("First install persists manifest; update check fetches only manifest until explicit replacement", async () => {
  const tree = createMemoryFileTree();
  const first = await fixture();
  const api = distribution(tree, first.fetch);
  assertEquals(await api.checkUpdate(), {
    manifest: first.manifest,
    installedVersion: undefined,
    updateAvailable: true,
  });
  assertEquals(await tree.list("/system"), []);
  assertEquals(first.calls.map((call) => call.path), [
    "/release/manifest.json",
  ]);
  await api.install(first.manifest);
  assertEquals(await api.readSystem("/system/apps/home/app.wasm"), first.data);
  assertEquals(await api.checkUpdate(), {
    manifest: first.manifest,
    installedVersion: "1",
    updateAvailable: false,
  });
  const second = await fixture("2", "new", "new");
  const next = distribution(tree, second.fetch);
  const update = await next.checkUpdate();
  assertEquals(update.installedVersion, "1");
  assertEquals(update.updateAvailable, true);
  assertEquals(await next.readSystem("/system/apps/home/app.wasm"), first.data);
  await tree.write("/user/keep", encode("user"));
  await tree.write("/apps/keep", encode("app"));
  await next.install(update.manifest);
  assertEquals(await tree.list("/system"), [
    SYSTEM_MANIFEST_PATH,
    "/system/apps/new/app.wasm",
  ]);
  assertEquals(await next.readSystem("/system/apps/new/app.wasm"), second.data);
  assertEquals(await tree.read("/user/keep"), encode("user"));
  assertEquals(await tree.read("/apps/keep"), encode("app"));
  for (const call of [...first.calls, ...second.calls]) {
    assertEquals(call.options?.redirect, "error");
    assertEquals(call.options?.cache, "no-store");
  }
});

Deno.test("Foreign URLs and redirects cannot install distributions", async () => {
  const tree = createMemoryFileTree();
  const create = (manifestUrl: string, fetch = globalThis.fetch) =>
    createSystemDistribution(tree, { origin, manifestUrl, fetch });
  for (
    const url of [
      "https://other.example/manifest.json",
      "http://binette.example/manifest.json",
      "https://user:pass@binette.example/manifest.json",
      "/manifest.json#fragment",
    ]
  ) {
    assertThrows(() => create(url));
  }
  const foreign: typeof globalThis.fetch = () => {
    const response = new Response("{}");
    Object.defineProperty(response, "url", {
      value: "https://other.example/manifest.json",
    });
    return Promise.resolve(response);
  };
  await assertRejects(
    () => create("/manifest.json", foreign).install(),
    Error,
    "同じオリジン",
  );
  const redirect: typeof globalThis.fetch = () =>
    Promise.resolve(Response.redirect(`${origin}/other`));
  await assertRejects(
    () => create("/manifest.json", redirect).install(),
    Error,
    "取得に失敗",
  );
  assertEquals(await tree.list("/"), []);
});

Deno.test("Network, malformed manifest, hash, size and persistence failures preserve the installed system", async () => {
  const tree = createMemoryFileTree();
  const first = await fixture();
  const api = distribution(tree, first.fetch);
  await api.install();
  const before = await tree.readFiles(await tree.list("/system"));
  for (
    const failure of [
      "network",
      "http",
      "json",
      "manifest",
      "hash",
      "size",
      "save",
    ]
  ) {
    const next = await fixture("2", "other", "new");
    const manifestPath = "/release/manifest.json";
    const filePath = `/release/${next.manifest.files[0].path}`;
    if (failure === "http") next.responses.delete(filePath);
    if (failure === "json") next.responses.set(manifestPath, encode("{"));
    if (failure === "manifest") next.responses.set(manifestPath, encode("{}"));
    if (failure === "hash") next.responses.set(filePath, encode("bad"));
    if (failure === "size") next.responses.set(filePath, encode("longer"));
    const broken = failure === "save"
      ? { ...tree, replaceSystem: () => Promise.reject(new Error("save")) }
      : tree;
    const fetcher = failure === "network"
      ? (() => Promise.reject(new Error("offline")))
      : next.fetch;
    await assertRejects(() => distribution(broken, fetcher).install());
    assertEquals(await tree.readFiles(await tree.list("/system")), before);
    assertEquals(
      await api.readSystem("/system/apps/home/app.wasm"),
      first.data,
    );
  }
});

Deno.test("Reads verify saved bytes each time, fail closed on missing metadata, and permit only user overrides", async () => {
  const tree = createMemoryFileTree();
  const source = await fixture();
  const api = distribution(tree, source.fetch);
  await assertRejects(
    () => api.readSystem("/system/a"),
    Error,
    "目録がありません",
  );
  await api.install();
  await tree.write("/user/apps/home/app.wasm", encode("override"));
  assertEquals(
    await api.readOverlay("/apps/home/app.wasm"),
    encode("override"),
  );
  await tree.delete("/user/apps/home/app.wasm");
  assertEquals(await api.readOverlay("/apps/home/app.wasm"), source.data);
  assertEquals(await api.readSystem("/system/absent"), undefined);
  const saved = (await tree.read(SYSTEM_MANIFEST_PATH))!;
  await tree.replaceSystem(
    new Map([[SYSTEM_MANIFEST_PATH, saved], [
      "/system/apps/home/app.wasm",
      encode("bad"),
    ]]),
  );
  await assertRejects(
    () => api.readSystem("/system/apps/home/app.wasm"),
    Error,
    "SHA-256",
  );
  await tree.replaceSystem(new Map([[SYSTEM_MANIFEST_PATH, saved]]));
  await assertRejects(
    () => api.readSystem("/system/apps/home/app.wasm"),
    Error,
    "固定物がありません",
  );
  await tree.replaceSystem(
    new Map([[SYSTEM_MANIFEST_PATH, saved], [
      "/system/unlisted",
      encode("extra"),
    ]]),
  );
  await assertRejects(
    () => api.readSystem("/system/unlisted"),
    Error,
    "目録にない",
  );
  await tree.replaceSystem(new Map([[SYSTEM_MANIFEST_PATH, encode("{}")]]));
  await assertRejects(() => api.readSystem("/system/apps/home/app.wasm"));
  for (
    const path of [
      "/system/../user/a",
      "/system/.manifest.json",
      "system/a",
      "/user/a",
    ]
  ) {
    await assertRejects(() => api.readSystem(path));
  }
  const settings = await fixture("1", "settings");
  const fixed = distribution(tree, settings.fetch);
  await fixed.install();
  await tree.write("/user/apps/settings/app.wasm", encode("unsafe"));
  assertEquals(
    await fixed.readOverlay("/apps/settings/app.wasm"),
    settings.data,
  );
});

Deno.test("Read uses one snapshot for manifest and bytes during an update", async () => {
  const tree = createMemoryFileTree();
  const first = await fixture();
  const next = await fixture("2", "home", "new");
  await distribution(tree, first.fetch).install();
  const snapshot: FileTree = {
    ...tree,
    async readFiles(paths) {
      const result = await tree.readFiles(paths);
      await distribution(tree, next.fetch).install();
      return result;
    },
  };
  assertEquals(
    await distribution(snapshot, first.fetch).readSystem(
      "/system/apps/home/app.wasm",
    ),
    first.data,
  );
  assertEquals(
    await distribution(tree, next.fetch).readSystem(
      "/system/apps/home/app.wasm",
    ),
    next.data,
  );
});

Deno.test("Recovery clears overrides, refetches corrupt system, and clears every layer", async () => {
  const tree = createMemoryFileTree();
  const source = await fixture();
  const api = distribution(tree, source.fetch);
  await api.install();
  await tree.write("/user/apps/home/app.wasm", encode("override"));
  await tree.write("/apps/custom/app.wasm", encode("custom"));
  await tree.write("/data/custom/state", encode("state"));
  await api.recover("clear-user");
  assertEquals(await tree.list("/user"), []);
  assertEquals(await api.readOverlay("/apps/home/app.wasm"), source.data);
  await tree.replaceSystem(new Map([[SYSTEM_MANIFEST_PATH, encode("bad")]]));
  await api.recover("refetch-system");
  assertEquals(await api.readSystem("/system/apps/home/app.wasm"), source.data);
  assertEquals(await tree.read("/apps/custom/app.wasm"), encode("custom"));
  await api.recover("clear-all");
  assertEquals(await tree.list("/"), []);
  assertEquals((await api.checkUpdate()).installedVersion, undefined);
});

Deno.test("Install reuses only verified local files; recovery always downloads every file", async () => {
  const tree = createMemoryFileTree();
  const source = await fixture();
  const api = distribution(tree, source.fetch);
  await api.install();
  source.calls.length = 0;
  const update = { ...source.manifest, version: "2" };
  await api.install(update);
  assertEquals(source.calls, []);
  assertEquals((await api.checkUpdate()).installedVersion, "2");
  source.calls.length = 0;
  await api.recover("refetch-system");
  assertEquals(source.calls.map((call) => call.path), [
    "/release/manifest.json",
    "/release/system/apps/home/app.wasm",
  ]);
  const saved = (await tree.read(SYSTEM_MANIFEST_PATH))!;
  await tree.replaceSystem(
    new Map([[SYSTEM_MANIFEST_PATH, saved], [
      "/system/apps/home/app.wasm",
      encode("bad"),
    ]]),
  );
  source.calls.length = 0;
  await api.install(source.manifest);
  assertEquals(source.calls.map((call) => call.path), [
    "/release/system/apps/home/app.wasm",
  ]);
  assertEquals(await api.readSystem("/system/apps/home/app.wasm"), source.data);
});

Deno.test("A later file failing inspection cannot publish partially downloaded files", async () => {
  const tree = createMemoryFileTree();
  const first = await fixture();
  const source = await fixture("2", "second", "new");
  source.manifest.files.unshift({
    ...first.manifest.files[0],
    path: "system/apps/first/app.wasm",
  });
  source.responses.set("/release/system/apps/first/app.wasm", first.data);
  source.responses.set("/release/system/apps/second/app.wasm", encode("bad"));
  await distribution(tree, first.fetch).install();
  await assertRejects(
    () => distribution(tree, source.fetch).install(source.manifest),
    Error,
    "SHA-256",
  );
  assertEquals(await tree.read("/system/apps/first/app.wasm"), undefined);
  assertEquals(
    await distribution(tree, first.fetch).readSystem(
      "/system/apps/home/app.wasm",
    ),
    first.data,
  );
  assertEquals(
    (await distribution(tree, first.fetch).checkUpdate()).installedVersion,
    "1",
  );
});

Deno.test("Recovery download failure preserves the current system and user files", async () => {
  const tree = createMemoryFileTree();
  const source = await fixture();
  const api = distribution(tree, source.fetch);
  await api.install();
  await tree.write("/user/keep", encode("keep"));
  source.responses.delete("/release/system/apps/home/app.wasm");
  await assertRejects(() => api.recover("refetch-system"));
  assertEquals(await api.readSystem("/system/apps/home/app.wasm"), source.data);
  assertEquals(await tree.read("/user/keep"), encode("keep"));
});

Deno.test("A same-version network manifest detects jointly modified saved manifest and bytes", async () => {
  const tree = createMemoryFileTree();
  const source = await fixture();
  const original = distribution(tree, source.fetch);
  await original.install();
  const tampered = await fixture("1", "home", "bad");
  await distribution(tree, tampered.fetch).install(tampered.manifest);
  await assertRejects(
    () => distribution(tree, source.fetch).checkUpdate(),
    Error,
    "同版の配布目録と一致しません",
  );
  await assertRejects(
    () => original.readSystem("/system/apps/home/app.wasm"),
    Error,
    "確認済みの目録と一致しません",
  );
  await original.recover("refetch-system");
  assertEquals(
    await original.readSystem("/system/apps/home/app.wasm"),
    source.data,
  );
});

Deno.test("Cross-origin response URLs on individual files fail before replacement", async () => {
  const tree = createMemoryFileTree();
  const source = await fixture();
  const fetcher: typeof globalThis.fetch = async (input, options) => {
    const response = await source.fetch(input, options);
    if (new URL(String(input)).pathname.endsWith(".wasm")) {
      Object.defineProperty(response, "url", {
        value: "https://other.example/app.wasm",
      });
    }
    return response;
  };
  await assertRejects(
    () => distribution(tree, fetcher).install(),
    Error,
    "同じオリジン",
  );
  assertEquals(await tree.list("/"), []);
});

Deno.test("Install snapshots a supplied manifest before asynchronous work", async () => {
  const tree = createMemoryFileTree();
  const source = await fixture();
  const api = distribution(tree, source.fetch);
  const pending = api.install(source.manifest);
  source.manifest.version = "mutated";
  source.manifest.files[0].sha256 = "0".repeat(64);
  await pending;
  assertEquals(await api.readSystem("/system/apps/home/app.wasm"), source.data);
  assertEquals(
    JSON.parse(new TextDecoder().decode(await tree.read(SYSTEM_MANIFEST_PATH)))
      .version,
    "1",
  );
});

Deno.test("Unavailable manifests use verified saved files without an update notice", async () => {
  for (const failure of ["network", "http", "body"]) {
    const tree = createMemoryFileTree();
    const source = await fixture();
    await distribution(tree, source.fetch).install();
    const before = await tree.readFiles(await tree.list("/system"));
    const offline: typeof globalThis.fetch = () => {
      if (failure === "network") {
        return Promise.reject(new TypeError("offline"));
      }
      if (failure === "http") {
        return Promise.resolve(new Response(null, { status: 503 }));
      }
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("disconnected"));
            },
          }),
        ),
      );
    };
    const api = distribution(tree, offline);
    assertEquals(await api.checkUpdate(), {
      manifest: source.manifest,
      installedVersion: "1",
      updateAvailable: false,
    });
    assertEquals(
      await api.readSystem("/system/apps/home/app.wasm"),
      source.data,
    );
    assertEquals(await tree.readFiles(await tree.list("/system")), before);
    await assertRejects(
      () => distribution(createMemoryFileTree(), offline).checkUpdate(),
      Error,
      "取得に失敗",
    );
  }
});

Deno.test("Offline startup rejects malformed saved manifests and changed or missing fixed files", async () => {
  for (const failure of ["json", "manifest", "hash", "size", "missing"]) {
    const tree = createMemoryFileTree();
    const source = await fixture();
    await distribution(tree, source.fetch).install();
    const paths = await tree.list("/system");
    const files = new Map<string, Uint8Array>();
    for (const path of paths) files.set(path, (await tree.read(path))!);
    const path = "/system/apps/home/app.wasm";
    if (failure === "json") files.set(SYSTEM_MANIFEST_PATH, encode("{"));
    if (failure === "manifest") files.set(SYSTEM_MANIFEST_PATH, encode("{}"));
    if (failure === "hash") files.set(path, encode("bad"));
    if (failure === "size") files.set(path, encode("longer"));
    if (failure === "missing") files.delete(path);
    await tree.replaceSystem(files);
    const offline: typeof globalThis.fetch = () =>
      Promise.reject(new TypeError("offline"));
    await assertRejects(() => distribution(tree, offline).checkUpdate());
    assertEquals(await tree.readFiles([...files.keys()]), [...files.values()]);
  }
});

Deno.test("Online manifest inspection failures never fall back to a valid saved system", async () => {
  const tree = createMemoryFileTree();
  const source = await fixture();
  await distribution(tree, source.fetch).install();
  for (
    const body of ["{", "{}", JSON.stringify({ ...source.manifest, files: [] })]
  ) {
    const fetcher: typeof globalThis.fetch = () =>
      Promise.resolve(new Response(body));
    await assertRejects(() => distribution(tree, fetcher).checkUpdate());
  }
  for (const violation of ["origin", "redirect"]) {
    const fetcher: typeof globalThis.fetch = () => {
      const response = violation === "redirect"
        ? Response.redirect(`${origin}/other`)
        : new Response(JSON.stringify(source.manifest));
      if (violation === "origin") {
        Object.defineProperty(response, "url", {
          value: "https://other.example/manifest.json",
        });
      }
      return Promise.resolve(response);
    };
    await assertRejects(() => distribution(tree, fetcher).checkUpdate());
  }
  assertEquals(await distribution(tree, source.fetch).checkUpdate(), {
    manifest: source.manifest,
    installedVersion: "1",
    updateAvailable: false,
  });
});
