// Run with: node scripts/storage-opfs.browser.cjs
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "binette-opfs-test-"));
  let server, browser;
  try {
    const bundle = path.join(dir, "fs.js");
    execFileSync("deno", ["bundle", "--platform=browser", "--output", bundle, "packages/regie/src/fs.ts"], { stdio: "inherit" });
    server = http.createServer((req, res) => {
      if (req.url === "/fs.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(fs.readFileSync(bundle)); }
      else { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>OPFS test</title>"); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
      const { createIndexedDbFileTree, createOpfsContentStore } = await import("/fs.js");
      // Add indexes while preserving existing v4 metadata and OPFS content.
      const legacyName = "upgrade-test";
      const legacyOwner = "_1/-2";
      const legacyId = "https://legacy.test/apps/#memo";
      const legacyBytes = new TextEncoder().encode("preserved v4");
      const legacyHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", legacyBytes))].map(value => value.toString(16).padStart(2, "0")).join("");
      await createOpfsContentStore(legacyName).write(`${legacyOwner}/${legacyHash}`, legacyBytes);
      const legacy = await new Promise((resolve, reject) => {
        const request = indexedDB.open(legacyName, 4);
        request.onupgradeneeded = () => { for (const name of ["providers", "apps", "files", "counters"]) request.result.createObjectStore(name); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = legacy.transaction(["providers", "apps", "files", "counters"], "readwrite");
        tx.objectStore("providers").put({ url: "https://legacy.test/apps/", name: "Legacy", added: 1 }, 1);
        tx.objectStore("apps").put(legacyId, [1, 2]);
        tx.objectStore("files").put({ hash: legacyHash, history: [], name: "日本語", size: legacyBytes.length, created: 1, modified: 1 }, [legacyOwner, "/data/日本語"]);
        tx.objectStore("counters").put(2, "provider"); tx.objectStore("counters").put(3, "app:1");
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      });
      legacy.close();
      const upgraded = createIndexedDbFileTree({ name: legacyName });
      const recoveredOwner = await upgraded.storage.appOwner(legacyId);
      const assertLegacy = new TextDecoder().decode(await upgraded.storage.forOwner(recoveredOwner).read("/data/日本語"));
      if (recoveredOwner !== legacyOwner || assertLegacy !== "preserved v4") throw new Error("v4 upgrade lost existing owner or contents");
      await upgraded.storage.moveProvider("https://legacy.test/apps/", "https://moved.test/apps/");
      const movedOwner = await upgraded.storage.appOwner("https://moved.test/apps/#memo");
      if (movedOwner !== legacyOwner || new TextDecoder().decode(await upgraded.storage.forOwner(movedOwner).read("/data/日本語")) !== "preserved v4") throw new Error("v4 upgrade provider move lost existing owner or contents");
      const tree = createIndexedDbFileTree();
      const bytes = s => new TextEncoder().encode(s);
      await tree.write("/user/example.txt", bytes("first"));
      await tree.write("/user/example.txt", bytes("second"));
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("binette-apps");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const row = await new Promise((resolve, reject) => {
        const req = db.transaction("files").objectStore("files").get(["_0/-0", "/user/example.txt"]);
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      });
      db.close();
      const root = await navigator.storage.getDirectory();
      const provider = await root.getDirectoryHandle("_0");
      const owner = await provider.getDirectoryHandle("-0");
      const stored = await (await owner.getFileHandle(row.hash)).getFile();
      const previous = await (await owner.getFileHandle(row.history[0])).getFile();
      const read = new TextDecoder().decode(await tree.read("/user/example.txt"));
      const separate = createIndexedDbFileTree({ name: "separate-test" });
      await separate.write("/user/other.txt", bytes("separate"));
      await tree.storage.gc();
      const isolated = new TextDecoder().decode(await separate.read("/user/other.txt"));
      await tree.delete("/user/example.txt");
      return { stored: await stored.text(), previous: await previous.text(), read, isolated, deleted: await tree.read("/user/example.txt") === undefined };
    });
    assert.deepEqual(result, { stored: "second", previous: "first", read: "second", isolated: "separate", deleted: true });
    console.log("Chromium OPFS: 1 passed, 0 failed");
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
