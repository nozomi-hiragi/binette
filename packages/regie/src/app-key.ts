import { formatAppId } from "@binette/core";

/** 入手元と識別子から完全な ID を作る。埋め込みアプリは生の識別子を使う */
export function appId(source: string, id: string): string {
  return formatAppId(source === "binette:system" || source === "binette:bundled" ? { id } : { list: source, id }, { allowHttp: true });
}
