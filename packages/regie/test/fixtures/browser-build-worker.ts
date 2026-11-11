import { serveBuild } from "../../src/build-worker.ts";

// Deno が加える Node 互換グローバルを外し、ブラウザ向け asc の分岐を試す。
Reflect.deleteProperty(globalThis, "process");
serveBuild(globalThis);
