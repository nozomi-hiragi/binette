import { assert, assertEquals } from "@std/assert";
import { checkVersions, FEATURES, PUBLISHED } from "./check-version.ts";

Deno.test("公開対象は 6 パッケージで、SDK の版は独立し、既存パッケージの版・名前・ライセンスは検証する", async () => {
  const root = new URL("../", import.meta.url);
  const temp = await Deno.makeTempDir();
  try {
    await Deno.copyFile(new URL("LICENSE", root), `${temp}/LICENSE`);
    for (const directory of Object.keys({ ...PUBLISHED, ...FEATURES })) {
      await Deno.mkdir(`${temp}/${directory}`, { recursive: true });
      for (const file of ["deno.json", "LICENSE"]) await Deno.copyFile(new URL(`${directory}/${file}`, root), `${temp}/${directory}/${file}`);
    }
    assertEquals(Object.keys(FEATURES).length, 14);
    assertEquals(checkVersions(temp).errors, []);
    const sdkPath = `${temp}/packages/replique/ui/deno.json`;
    const sdk = JSON.parse(await Deno.readTextFile(sdkPath));
    await Deno.writeTextFile(sdkPath, JSON.stringify({ ...sdk, version: "0.1.1" }));
    assertEquals(checkVersions(temp).errors, []);
    await Deno.writeTextFile(sdkPath, JSON.stringify({ ...sdk, name: "@binette/other" }));
    assert(checkVersions(temp).errors.some(error => error.includes("expected name @binette/replique-ui")));
    await Deno.writeTextFile(sdkPath, JSON.stringify(sdk));
    await Deno.writeTextFile(`${temp}/packages/replique/ui/LICENSE`, "異なるライセンス");
    assert(checkVersions(temp).errors.some(error => error.includes("packages/replique/ui/LICENSE: differs")));
    assert(checkVersions(temp, "v99.0.0").errors.some(error => error.includes("does not match package version")));
  } finally { await Deno.remove(temp, { recursive: true }); }
});
