import { readRepliqueLibraries } from "../src/cli.ts";

/** Mirror the distributed SDK layout, including its feature inventory. */
export async function repliqueFiles(): Promise<Map<string, Uint8Array>> {
  const libraries = await readRepliqueLibraries(new URL("../../replique/src/", import.meta.url));
  const encoder = new TextEncoder();
  const files = new Map<string, Uint8Array>();
  const features: string[] = [];
  for (const [specifier, source] of Object.entries(libraries)) {
    const name = specifier === "jsr:@binette/replique" ? "index" : specifier.slice("jsr:@binette/replique/".length);
    files.set(`/system/libraries/replique/${name}.ts`, encoder.encode(source));
    if (name !== "index") features.push(name);
  }
  files.set("/system/libraries/replique/index.json", encoder.encode(JSON.stringify(features)));
  return files;
}
