import { describe, expect, it } from "vitest";
import { captureChatScrollMemory, resolveChatScrollEntry } from "./chatScrollMemory";

describe("chat scroll memory", () => {
  it("keeps following when there is no saved position", () => {
    expect(resolveChatScrollEntry(undefined)).toEqual({ kind: "follow-end" });
  });

  it("keeps following instead of restoring a stale pixel position at the end", () => {
    expect(resolveChatScrollEntry({ scrollTop: 120, atEnd: true })).toEqual({ kind: "follow-end" });
  });

  it("restores an exact position only when the user was reading history", () => {
    expect(resolveChatScrollEntry({ scrollTop: 320, atEnd: false })).toEqual({
      kind: "restore",
      scrollTop: 320,
    });
  });

  it("uses the message scroller edge threshold when recording the end state", () => {
    expect(captureChatScrollMemory({ scrollTop: 276, clientHeight: 700, scrollHeight: 1000 })).toEqual({
      scrollTop: 276,
      atEnd: true,
    });
    expect(captureChatScrollMemory({ scrollTop: 275, clientHeight: 700, scrollHeight: 1000 })).toEqual({
      scrollTop: 275,
      atEnd: false,
    });
  });
});
