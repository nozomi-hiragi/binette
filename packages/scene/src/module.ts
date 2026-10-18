// js の asset は相対 import を使えない前提で、Blob URL から読み込む。
export async function importModule(code: string): Promise<{ mount?: unknown }> {
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
