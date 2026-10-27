/**
 * Scene。アプリのパッケージを読み、AS をビルドし、HTML を描いてアプリとつなぐ。
 *
 * @packageDocumentation
 */
export type { BuildOptions, BuiltApp, Compiler, CompilerStream } from "./build.ts";
export { buildApp, loadCompiler } from "./build.ts";
export type { MountedApp, MountOptions } from "./mount.ts";
export { DestroyCause, DestroyKind, mountApp, State } from "./mount.ts";
export type { ShellApp, ShellOptions, MountedShell } from "./shell.ts";
export { mountShell } from "./shell.ts";
export type { PrebuiltApp } from "./prebuilt.ts";
export { parsePrebuiltApp, stringifyPrebuiltApp } from "./prebuilt.ts";
