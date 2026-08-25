export type SettingsTab = "models" | "output" | "governance" | "protocol";
export type SettingsSubview = "modes" | "styles" | "policy" | "history";

export interface SettingsSelection {
  tab: SettingsTab;
  view?: SettingsSubview;
}

/** 兼容旧 tab 值，并把复合领域收敛到一个明确子视图。 */
export function resolveSettingsSelection(tabParam: string, viewParam: string): SettingsSelection {
  if (tabParam === "basic" || tabParam === "protocol") return { tab: "protocol" };
  if (tabParam === "output-modes") return { tab: "output", view: "modes" };
  if (tabParam === "render-styles") return { tab: "output", view: "styles" };
  if (tabParam === "output") {
    return { tab: "output", view: viewParam === "styles" ? "styles" : "modes" };
  }
  if (tabParam === "governance") {
    return { tab: "governance", view: viewParam === "history" ? "history" : "policy" };
  }
  return { tab: "models" };
}
