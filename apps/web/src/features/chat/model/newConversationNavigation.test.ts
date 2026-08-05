import { describe, expect, it } from "vitest";
import { newConversationHref, newConversationKey } from "./newConversationNavigation";

describe("new conversation navigation", () => {
  it("把每次命令键写入 URL", () => {
    expect(newConversationHref("reset key")).toBe("/chat?new=reset%20key");
  });

  it("使用有效参数作为 Composer key", () => {
    expect(newConversationKey({ new: "reset-2" })).toBe("reset-2");
    expect(newConversationKey({ new: ["reset-2"] })).toBe("__new__");
    expect(newConversationKey({})).toBe("__new__");
  });
});
