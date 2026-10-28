/**
 * Scene。アプリのパッケージを読み、AS をビルドし、HTML を描いてアプリとつなぐ。
 *
 * @packageDocumentation
 */
export type { BuildOptions, BuiltApp, Compiler, CompilerStream } from "./build.ts";
export { buildApp, loadCompiler } from "./build.ts";
export type { MountedApp, MountOptions } from "./mount.ts";
export { mountApp } from "./mount.ts";
export type { ShellApp, ShellOptions, MountedShell } from "./shell.ts";
export { isInstalled } from "./live.ts";
export { mountShell } from "./shell.ts";
export type { PrebuiltApp } from "./prebuilt.ts";
export { parsePrebuiltApp, stringifyPrebuiltApp } from "./prebuilt.ts";
