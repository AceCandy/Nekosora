import { describe, expect, it } from "vitest";
import { getMessageTimeSeparatorInfo, toMessageCreatedAtIso } from "./messageTime";

const now = new Date("2026-07-28T08:00:00.000Z");

describe("getMessageTimeSeparatorInfo", () => {
  it("首条今天不显示，首条非今天显示相对日期", () => {
    expect(getMessageTimeSeparatorInfo({
      createdAt: "2026-07-28T06:30:00.000Z",
      isFirst: true,
      now,
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
    })).toBeNull();

    expect(getMessageTimeSeparatorInfo({
      createdAt: "2026-07-27T06:30:00.000Z",
      isFirst: true,
      now,
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
    })).toEqual({
      dateTime: "2026-07-27T06:30:00.000Z",
      kind: "yesterday",
      time: "14:30",
    });

    expect(getMessageTimeSeparatorInfo({
      createdAt: "2026-07-26T06:30:00.000Z",
      isFirst: true,
      now,
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
    })).toEqual({
      dateTime: "2026-07-26T06:30:00.000Z",
      kind: "dayBeforeYesterday",
      time: "14:30",
    });
  });

  it("同一本地自然日不显示，跨日只在后一条消息前显示", () => {
    expect(getMessageTimeSeparatorInfo({
      createdAt: "2026-07-28T15:59:00.000Z",
      previousCreatedAt: "2026-07-27T16:01:00.000Z",
      isFirst: false,
      now,
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
    })).toBeNull();

    expect(getMessageTimeSeparatorInfo({
      createdAt: "2026-07-27T16:01:00.000Z",
      previousCreatedAt: "2026-07-27T15:59:00.000Z",
      isFirst: false,
      now,
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
    })).toEqual({
      dateTime: "2026-07-27T16:01:00.000Z",
      kind: "today",
      time: "00:01",
    });
  });

  it("今年更早与往年使用本地化日期", () => {
    expect(getMessageTimeSeparatorInfo({
      createdAt: "2026-05-03T06:30:00.000Z",
      isFirst: true,
      now,
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
    })).toEqual({
      dateTime: "2026-05-03T06:30:00.000Z",
      kind: "thisYear",
      date: "5月3日",
      time: "14:30",
    });

    expect(getMessageTimeSeparatorInfo({
      createdAt: "2025-05-03T06:30:00.000Z",
      isFirst: true,
      now,
      locale: "en",
      timeZone: "Asia/Shanghai",
    })).toEqual({
      dateTime: "2025-05-03T06:30:00.000Z",
      kind: "otherYear",
      date: "May 3, 2025",
      time: "14:30",
    });
  });

  it("按显式时区判断自然日边界", () => {
    const input = {
      createdAt: "2026-07-28T07:30:00.000Z",
      previousCreatedAt: "2026-07-28T06:30:00.000Z",
      isFirst: false,
      now: new Date("2026-07-28T18:00:00.000Z"),
      locale: "en",
    };

    expect(getMessageTimeSeparatorInfo({ ...input, timeZone: "Asia/Shanghai" })).toBeNull();
    expect(getMessageTimeSeparatorInfo({ ...input, timeZone: "America/Los_Angeles" })).toEqual({
      dateTime: "2026-07-28T07:30:00.000Z",
      kind: "today",
      time: "00:30",
    });
  });

  it("按日历日期处理夏令时造成的 23 小时昨天", () => {
    expect(getMessageTimeSeparatorInfo({
      createdAt: "2026-03-08T05:30:00.000Z",
      isFirst: true,
      now: new Date("2026-03-09T04:30:00.000Z"),
      locale: "en",
      timeZone: "America/New_York",
    })).toEqual({
      dateTime: "2026-03-08T05:30:00.000Z",
      kind: "yesterday",
      time: "00:30",
    });
  });

  it("缺失或无效时间时不显示", () => {
    expect(getMessageTimeSeparatorInfo({
      createdAt: "not-a-date",
      isFirst: true,
      now,
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
    })).toBeNull();

    expect(getMessageTimeSeparatorInfo({
      createdAt: "2026-07-27T06:30:00.000Z",
      previousCreatedAt: "not-a-date",
      isFirst: false,
      now,
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
    })).toBeNull();
  });
});

describe("toMessageCreatedAtIso", () => {
  it("统一 Date 和字符串输入并忽略无效值", () => {
    expect(toMessageCreatedAtIso(new Date("2026-07-28T01:02:03.000Z")))
      .toBe("2026-07-28T01:02:03.000Z");
    expect(toMessageCreatedAtIso("2026-07-28T01:02:03Z"))
      .toBe("2026-07-28T01:02:03.000Z");
    expect(toMessageCreatedAtIso("not-a-date")).toBeUndefined();
    expect(toMessageCreatedAtIso(undefined)).toBeUndefined();
  });
});
