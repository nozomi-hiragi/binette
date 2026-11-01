import { resolve } from "@std/path";
import type { Plugin } from "vite";

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** 圧縮を終えた実バイトを HTML の SRI に使う。開発時は変換しない。 */
export function kernelIntegrity(): Plugin {
  let outDir = "";
  return {
    name: "binette-kernel-integrity",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle: {
      order: "post",
      async handler(_options, bundle) {
        const kernel = bundle["regie.js"];
        const html = bundle["index.html"];
        if (kernel?.type !== "chunk" || html?.type !== "asset" || typeof html.source !== "string") {
          throw new Error("カーネルまたは HTML のビルド結果がありません。");
        }
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-384", new TextEncoder().encode(kernel.code)));
        const integrity = `sha384-${btoa(String.fromCharCode(...digest))}`;
        let found = false;
        html.source = html.source.replace(/<script\b[^>]*\bsrc="\.\/regie\.js"[^>]*>/g, (tag) => {
          found = true;
          return tag.replace("<script", `<script integrity="${integrity}"`);
        });
        if (!found) throw new Error("HTML にカーネルの script がありません。");
      },
    },
    // SW は index.html をキャッシュから返すので、カーネルが変わったら sw.js の中身も変え、ブラウザに新しい SW を入れさせる
    async closeBundle() {
      const sw = resolve(outDir, "sw.js");
      let source: string;
      try {
        source = await Deno.readTextFile(sw);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return;
        throw error;
      }
      const kernel = await Deno.readFile(resolve(outDir, "regie.js"));
      const worker = await Deno.readFile(resolve(outDir, "regie-worker.js"));
      const both = new Uint8Array(kernel.byteLength + worker.byteLength);
      both.set(kernel);
      both.set(worker, kernel.byteLength);
      const stamp = hex(await crypto.subtle.digest("SHA-256", both)).slice(0, 16);
      const stamped = source.replace(/const CACHE = "([^"]+)";/, (_line, name) => `const CACHE = "${name}-${stamp}";`);
      if (stamped === source) throw new Error("sw.js にキャッシュの版がありません。");
      await Deno.writeTextFile(sw, stamped);
    },
  };
}
