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
      // Vite が設定を束ねると @std/path を解決できないので、自前でつなぐ
      outDir = config.build.outDir.startsWith("/") ? config.build.outDir : `${config.root}/${config.build.outDir}`;
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
    // SW は入口とカーネルをキャッシュから返すので、どれかが変わったら sw.js の中身も変え、ブラウザに新しい SW を入れさせる
    async closeBundle() {
      const sw = `${outDir}/sw.js`;
      let source: string;
      try {
        source = await Deno.readTextFile(sw);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return;
        throw error;
      }
      // SW がキャッシュから返す固定物（入口・カーネル・アイコンなど）のどれかが変わったら版を変える。
      const parts: Uint8Array[] = [];
      for (const name of ["index.html", "manifest.webmanifest", "icon.svg", "regie.js", "regie-worker.js", "build-worker.js"]) {
        let data: Uint8Array;
        try {
          data = await Deno.readFile(`${outDir}/${name}`);
        } catch (error) {
          if (error instanceof Deno.errors.NotFound && !["regie.js", "regie-worker.js", "build-worker.js"].includes(name)) continue;
          throw error;
        }
        parts.push(new TextEncoder().encode(`${name}\0${data.byteLength}\0`), data);
      }
      const both = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
      let offset = 0;
      for (const part of parts) { both.set(part, offset); offset += part.byteLength; }
      const stamp = hex(await crypto.subtle.digest("SHA-256", both)).slice(0, 16);
      const stamped = source.replace(/const CACHE = "([^"]+)";/, (_line, name) => `const CACHE = "${name}-${stamp}";`);
      if (stamped === source) throw new Error("sw.js にキャッシュの版がありません。");
      await Deno.writeTextFile(sw, stamped);
    },
  };
}
