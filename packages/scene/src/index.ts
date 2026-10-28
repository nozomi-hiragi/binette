/**
 * Scene。HTML を描き、アプリとシステム UI をつなぐ。
 *
 * @packageDocumentation
 */
export type { MountedApp, MountOptions } from "./mount.ts";
export { mountApp } from "./mount.ts";
export type { ShellOptions, MountedShell, ShellUiOptions, ShellUi } from "./shell.ts";
export { isInstalled } from "./live.ts";
export { mountShell, createShellUi } from "./shell.ts";
