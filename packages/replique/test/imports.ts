/** module/function の組を WASM の import object にする。SDK のテスト用 */
export function mockImports(functions: Record<string, CallableFunction>): WebAssembly.Imports {
  const imports: WebAssembly.Imports = {};
  for (const [key, value] of Object.entries(functions)) {
    const [module, name] = key.split("/");
    (imports[module] ??= {})[name] = value;
  }
  return imports;
}
