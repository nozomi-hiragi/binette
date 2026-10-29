// AssemblyScript の JSR 指定子を公開パッケージのソースへ解決して型検査する。
import asc from "npm:assemblyscript@0.28.20/asc";
import decorAs from "jsr:@binette/decor@0.1.0/as" with { type: "text" };

const entry = new URL("../src/index.ts", import.meta.url).pathname;
const { error } = await asc.main([entry, "--noEmit"], {
  readFile: async (name: string) => {
    if (name.endsWith("/jsr:@binette/decor/as.ts")) return decorAs;
    try { return await Deno.readTextFile(name); } catch { return null; }
  },
});
if (error) Deno.exit(1);
