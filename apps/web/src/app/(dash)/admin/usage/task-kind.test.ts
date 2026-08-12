import { describe, expect, it } from "vitest";
import { getTaskKindMessageKey } from "./task-kind";

describe("getTaskKindMessageKey", () => {
  it("normalizes legacy web search task ids and rejects unknown kinds", () => {
    expect(getTaskKindMessageKey("web_search:chatcmpl-tool-1")).toBe("taskKinds.web_search");
    expect(getTaskKindMessageKey("web_search")).toBe("taskKinds.web_search");
    expect(getTaskKindMessageKey("title")).toBe("taskKinds.title");
    expect(getTaskKindMessageKey("memory")).toBe("taskKinds.memory");
    expect(getTaskKindMessageKey("compact")).toBe("taskKinds.compact");
    expect(getTaskKindMessageKey("future_task")).toBeNull();
    expect(getTaskKindMessageKey("future_task:job-1")).toBeNull();
    expect(getTaskKindMessageKey("title:job-1")).toBeNull();
  });
});
