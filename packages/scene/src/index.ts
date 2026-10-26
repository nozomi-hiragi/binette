/**
 * Scene。アプリのパッケージを読み、AS をビルドし、HTML を描いてアプリとつなぐ。
 *
 * @packageDocumentation
 */
export type { BuildOptions, BuiltApp, Compiler, CompilerStream } from "./build.ts";
export { buildApp, loadCompiler } from "./build.ts";
export type { MountedApp, MountOptions } from "./mount.ts";
export { mountApp } from "./mount.ts";
export type { BindingKind, Bindings, HtmlParser } from "./bindings.ts";
export { generateBindingsSource, parseBindings } from "./bindings.ts";
