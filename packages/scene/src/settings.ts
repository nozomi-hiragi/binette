import { fragment, h, type Child } from "./dom.ts";

export interface SettingsPageProps {
  title: string;
  sections: SettingsSection[];
  basePath: string;
  navigate: (path: string) => void;
}

export interface SettingListItem {
  id: string;
  start?: Child;
  label: string;
  end?: Child;
  sections?: SettingsSection[];
}

export type SettingsSection = { label?: string } &
  (
    { type: "element"; element: Child } |
    { type: "list"; contents: SettingListItem[] }
  );

interface SettingsListProps {
  title: string;
  sections: SettingsSection[];
  path: string[];
  navigate: (path: string[]) => void;
}

function SettingsList(props: SettingsListProps): HTMLElement {
  return h("div", { class: props.path.length > 0 ? "settings-page settings-detail" : "settings-page settings-overview" },
    h("div", { class: "settings-heading-row" },
      props.path.length > 0 && h("button", {
        class: `settings-back${props.path.length === 1 ? " settings-back-top" : ""}`,
        type: "button",
        "aria-label": "戻る",
        onClick: () => props.navigate(props.path.slice(0, -1)),
      }),
      h("h1", null, props.title),
    ),
    props.sections.map((section) => {
      if (section.type === "element") return h("section", null,
        section.label && h("h2", null, section.label),
        section.element,
      );
      if (section.contents.length === 0) return null;
      return h("section", null,
        section.label && h("h2", null, section.label),
        h("ul", { class: "settings-list" },
          section.contents.map((row) => {
            const rowContent = fragment(
              h("span", { class: "settings-row-start" }, row.start),
              h("span", { class: "settings-row-label" }, row.label),
              h("span", { class: "settings-row-end" }, row.end ?? (row.sections ? "›" : undefined)),
            );
            if (row.sections === undefined) {
              return h("li", null, h("div", { class: "settings-row" }, rowContent));
            }
            const button = h("button", { class: "settings-row", type: "button", onClick: () => props.navigate([...props.path, row.id]) }, rowContent);
            button.dataset.settingsPath = JSON.stringify([...props.path, row.id]);
            return h("li", null, button);
          }),
        ),
      );
    }),
  );
}

export function SettingsPage(props: SettingsPageProps): HTMLElement {
  const details = h("div", { class: "settings-details" });
  const navigate = (path: string[]) => {
    const suffix = path.map(encodeURIComponent).join("/");
    props.navigate(`/settings${suffix ? `/${suffix}` : ""}${location.search}${location.hash}`);
  };
  const overview = SettingsList({ title: props.title, sections: props.sections, path: [], navigate });
  const root = h("main", { class: "settings-layout" }, overview, details);
  // URL ごとに DOM だけを保持し、選択経路は常に現在の URL から求める。
  const elements = new Map<string, HTMLElement>();
  const missing = h("div", { class: "settings-page settings-detail" },
    h("h1", null, "見つかりません"),
    h("button", { type: "button", onClick: () => navigate([]) }, "設定一覧へ"),
  );
  details.append(missing);
  const showCurrent = () => {
    const relative = location.pathname.slice(props.basePath.length);
    let path: string[] | undefined;
    try {
      path = relative === "" ? [] : relative.slice(1).split("/").map(decodeURIComponent);
    } catch {
      path = undefined;
    }
    let sections = props.sections;
    let title = props.title;
    let found = path !== undefined;
    for (const id of path ?? []) {
      const row = sections.flatMap(section => section.type === "list" ? section.contents : [])
        .find(row => row.id === id && row.sections !== undefined);
      if (!row) { found = false; break; }
      sections = row.sections!;
      title = row.label;
    }
    let current: HTMLElement | undefined;
    if (found && path && path.length > 0) {
      const key = JSON.stringify(path);
      current = elements.get(key);
      if (!current) {
        current = SettingsList({ title, sections, path, navigate });
        elements.set(key, current);
        details.append(current);
      }
    }
    root.classList.toggle("settings-has-detail", !found || (path?.length ?? 0) > 0);
    for (const element of elements.values()) element.hidden = element !== current;
    missing.hidden = found;
    for (const button of root.querySelectorAll<HTMLElement>("[data-settings-path]")) {
      const target: string[] = JSON.parse(button.dataset.settingsPath!);
      if (found && path && target.length <= path.length && target.every((id, index) => id === path[index])) {
        button.setAttribute("aria-current", "page");
      } else button.removeAttribute("aria-current");
    }
    document.title = found ? title : "見つかりません";
  };
  root.addEventListener("scene-location-change", showCurrent);
  showCurrent();
  return root;
}
