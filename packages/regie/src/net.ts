/** 通信先の判定に使うリスト。URL は origin か、末尾が / のパスで指定する。 */
export interface NetLists {
  request: readonly string[];
  appAllow: readonly string[];
  appDeny: readonly string[];
  commonAllow: readonly string[];
  commonDeny: readonly string[];
}

/** 正規化した URL の origin とパスを比べる。 */
export function matchesNetUrl(target: string, prefix: string): boolean {
  try {
    const url = new URL(target);
    const rule = new URL(prefix);
    return url.href.startsWith(rule.href);
  } catch {
    return false;
  }
}

/** deny を優先し、要求または allow に含まれる通信先だけを通す。 */
export function allowsNetUrl(url: string, lists: NetLists): boolean {
  const matches = (entries: readonly string[]) => entries.some(entry => matchesNetUrl(url, entry));
  return !matches(lists.commonDeny) && !matches(lists.appDeny) &&
    (matches(lists.request) || matches(lists.appAllow) || matches(lists.commonAllow));
}
