import { describe, expect, it } from "vitest";
import {
  conversationGroupFor,
  createConversationGroupBoundaries,
  encodeConversationGroupCursor,
  mergeConversationIds,
  mergeConversations,
  type ConversationNavigationItem,
} from "./conversationNavigation";

function item(
  id: string,
  rank: number,
  updatedAt: number,
  title = id,
  sortUpdatedAt = new Date(updatedAt).toISOString().replace("Z", "000Z"),
): ConversationNavigationItem {
  return { id, title, rank, updatedAt, sortUpdatedAt, pinned: rank === 0, archived: rank === 2, generating: false };
}

describe("conversation navigation merge", () => {
  it("按 rank、更新时间和 id 稳定排序", () => {
    expect(mergeConversations([], [
      item("archived", 2, 300),
      item("normal-a", 1, 200),
      item("pinned", 0, 100),
      item("normal-b", 1, 200),
    ]).map(({ id }) => id)).toEqual([
      "pinned",
      "normal-b",
      "normal-a",
      "archived",
    ]);
  });

  it("按 id 覆盖重复项且保留已有窗口", () => {
    const merged = mergeConversations(
      [item("existing", 1, 100), item("same", 1, 90, "旧标题")],
      [item("same", 0, 120, "新标题"), item("next", 2, 80)],
    );
    expect(merged.map(({ id }) => id)).toEqual(["same", "existing", "next"]);
    expect(merged[0].title).toBe("新标题");
  });

  it("保留 PostgreSQL 微秒精度用于客户端补入排序", () => {
    const earlier = item("z", 1, 1000, "earlier", "1970-01-01T00:00:01.000001Z");
    const later = item("a", 1, 1000, "later", "1970-01-01T00:00:01.000002Z");
    expect(mergeConversations([earlier], [later]).map(({ title }) => title)).toEqual([
      "later",
      "earlier",
    ]);
  });

  it("合并服务端活动 run 与客户端流式会话并去重", () => {
    expect(mergeConversationIds(
      ["server-b", "shared"],
      ["client-a", "shared"],
    )).toEqual(["client-a", "server-b", "shared"]);
  });
});

describe("conversation groups", () => {
  it("按浏览器本地自然日生成跨年边界", () => {
    const boundaries = createConversationGroupBoundaries(new Date(2026, 0, 1, 12));
    expect(boundaries.todayStart).toBe(new Date(2026, 0, 1).toISOString());
    expect(boundaries.yesterdayStart).toBe(new Date(2025, 11, 31).toISOString());
    expect(boundaries.thirtyDaysAgoStart).toBe(new Date(2025, 11, 2).toISOString());
  });

  it("置顶和归档优先于互斥时间分组", () => {
    const boundaries = createConversationGroupBoundaries(new Date(2026, 7, 14, 12));
    const at = (key: keyof typeof boundaries) => Date.parse(boundaries[key]);
    expect(conversationGroupFor({ pinned: true, archived: false, updatedAt: 0 }, boundaries)).toBe("pinned");
    expect(conversationGroupFor({ pinned: true, archived: true, updatedAt: Date.now() }, boundaries)).toBe("archived");
    expect(conversationGroupFor({ pinned: false, archived: false, updatedAt: at("todayStart") }, boundaries)).toBe("today");
    expect(conversationGroupFor({ pinned: false, archived: false, updatedAt: at("yesterdayStart") }, boundaries)).toBe("yesterday");
    expect(conversationGroupFor({ pinned: false, archived: false, updatedAt: at("dayBeforeYesterdayStart") }, boundaries)).toBe("dayBeforeYesterday");
    expect(conversationGroupFor({ pinned: false, archived: false, updatedAt: at("sevenDaysAgoStart") }, boundaries)).toBe("withinWeek");
    expect(conversationGroupFor({ pinned: false, archived: false, updatedAt: at("thirtyDaysAgoStart") }, boundaries)).toBe("withinMonth");
    expect(conversationGroupFor({ pinned: false, archived: false, updatedAt: at("thirtyDaysAgoStart") - 1 }, boundaries)).toBe("earlier");
  });

  it("生成服务端可验证的组内续页游标", () => {
    const encoded = encodeConversationGroupCursor(item("conversation-1", 1, 1000));
    expect(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))).toEqual({
      updatedAt: "1970-01-01T00:00:01.000000Z",
      id: "conversation-1",
    });
  });
});
