import { describe, expect, it } from "vitest";
import { adminNavGroups, panelNavGroups, searchNavGroups } from "./nav-config";

const translate = (key: string) => key;

describe("searchNavGroups", () => {
  it("按任务分组，管理员额外保留系统管理", () => {
    expect(panelNavGroups("user").map((group) => group.titleKey)).toEqual([
      "sectionConnections", "sectionWorkspace", "sectionActivity",
    ]);
    expect(panelNavGroups("admin").map((group) => group.titleKey)).toEqual([
      "sectionConnections", "sectionWorkspace", "sectionActivity",
      "sectionGlobalManagement",
    ]);
  });

  it("只搜索当前角色可见的页面与主要设置项", () => {
    const userGroups = panelNavGroups("user");
    const adminGroups = adminNavGroups();

    expect(searchNavGroups(userGroups, "base url", translate)).toEqual([
      expect.objectContaining({ href: "/panel/providers", labelKey: "providers" }),
    ]);
    expect(searchNavGroups(userGroups, "embedding", translate)).toEqual([]);
    expect(searchNavGroups(adminGroups, "embedding", translate)).toEqual([
      expect.objectContaining({
        href: "/admin/settings?tab=models#embedding-model",
        labelKey: "searchTargets.embedding",
      }),
    ]);
    expect(searchNavGroups(adminGroups, "", translate)).toEqual([]);
  });
});
