/** アプリから届く DOM 操作 */
export type DomOp =
  | { op: "byId"; handle: number; id: string }
  | { op: "create"; handle: number; tag: string }
  | { op: "text"; handle: number; value: string }
  | { op: "class"; handle: number; value: string }
  | { op: "append"; parent: number; child: number }
  | { op: "remove"; handle: number }
  | { op: "listen"; handle: number; type: string; listener: number }
  | { op: "unlisten"; handle: number; type: string; listener: number }
  | { op: "icon"; handle: number; app: number }
  | { op: "ui-create"; handle: number; kind: "column" | "row" | "text" | "button" | "input" | "grid" | "appIcon"; multiline?: boolean }
  | { op: "ui-update"; theme?: string; handle: number; text: string; padding: number | null; gap: number | null; grow: boolean; label: string | null; enabled: boolean; clickable: boolean; inputVersion?: number; key?: string; minWidth?: number | null; heading?: number; list?: boolean; listItem?: boolean; shown?: boolean; app?: number | null;
      /** 見た目の修飾。省略は既定を表す */
      tone?: string; divider?: string; mono?: boolean; small?: boolean; bold?: boolean; truncate?: boolean; width?: number; center?: boolean; selected?: boolean; toggle?: boolean; scroll?: boolean; fill?: boolean; collapse?: boolean; placeholder?: string; height?: number; minHeight?: number; wrap?: boolean }
  | { op: "ui-insert"; parent: number | null; child: number; before: number | null }
  | { op: "ui-remove"; handle: number };
