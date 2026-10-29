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
  | { op: "ui-create"; handle: number; kind: "column" | "row" | "text" | "button" }
  | { op: "ui-update"; handle: number; text: string; padding: number | null; gap: number | null; grow: boolean; label: string | null; enabled: boolean; listener: number | null; build: number }
  | { op: "ui-insert"; parent: number | null; child: number; before: number | null }
  | { op: "ui-remove"; handle: number };
