// AssemblyScript の JSR 指定子を公開パッケージのソースへ解決して型検査する。
import asc from "assemblyscript/asc";
import decorAs from "@binette/decor/as" with { type: "text" };

import decorParts from "@binette/decor/parts" with { type: "text" };

const entry = new URL("../src/index.ts", import.meta.url).pathname;
const { error } = await asc.main([entry, "--noEmit"], {
  readFile: async (name: string) => {
    if (name.endsWith("/jsr:@binette/decor/as.ts")) return decorAs;
    if (name.endsWith("/jsr:@binette/decor/parts.ts")) return decorParts;
    const feature = name.match(/\/jsr:@binette\/replique\/(\w+)\.ts$/);
    if (feature) return await Deno.readTextFile(new URL(`../src/${feature[1]}.ts`, import.meta.url));
    try { return await Deno.readTextFile(name); } catch { return null; }
  },
});
if (error) Deno.exit(1);
