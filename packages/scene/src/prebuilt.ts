import { type AppManifest, parseAppManifest } from "@binette/core";

/** 最初から配る、ビルド済みのアプリ */
export interface PrebuiltApp {
  manifest: AppManifest;
  html: string;
  icon?: string;
  wasm: Uint8Array;
}

/** ビルド済みアプリを .binapp の JSON にする */
export function stringifyPrebuiltApp(app: PrebuiltApp): string {
  let binary = "";
  for (const byte of app.wasm) binary += String.fromCharCode(byte);
  return JSON.stringify({ format: "binette-app", version: "0.2", manifest: app.manifest,
    html: app.html, ...(app.icon === undefined ? {} : { icon: app.icon }), wasm: btoa(binary) });
}

/** .binapp の形式と欄を確かめて読む。HTML や WASM の安全性は検証しない */
export function parsePrebuiltApp(text: string): PrebuiltApp {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error(".binapp を JSON として読めません。"); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(".binapp はオブジェクトで指定してください。");
  const app = value as Record<string, unknown>;
  if (app.format !== "binette-app") throw new Error(".binapp の形式名が違います。");
  if (app.version !== "0.2") throw new Error(".binapp の版に対応していません。");
  if (typeof app.html !== "string") throw new Error(".binapp の html は文字列で指定してください。");
  if (Object.hasOwn(app, "icon") && typeof app.icon !== "string") throw new Error(".binapp の icon は文字列で指定してください。");
  if (typeof app.wasm !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(app.wasm)) {
    throw new Error(".binapp の wasm は base64 の文字列で指定してください。");
  }
  const manifest = parseAppManifest(JSON.stringify(app.manifest));
  const binary = atob(app.wasm);
  const wasm = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return { manifest, html: app.html, ...(app.icon === undefined ? {} : { icon: app.icon as string }), wasm };
}
