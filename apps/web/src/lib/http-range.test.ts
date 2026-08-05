import { describe, expect, it } from "vitest";
import { parseByteRange } from "@/lib/http-range";

describe("parseByteRange", () => {
  it("解析明确的起止字节并返回闭区间", () => {
    expect(parseByteRange("bytes=2-5", 10)).toEqual({ start: 2, end: 5 });
  });

  it("开放结尾读取到文件末尾", () => {
    expect(parseByteRange("bytes=6-", 10)).toEqual({ start: 6, end: 9 });
  });

  it("suffix range 读取文件末尾指定字节数", () => {
    expect(parseByteRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
  });

  it("超出文件末尾的范围夹取到完整文件边界", () => {
    expect(parseByteRange("bytes=7-20", 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange("bytes=-20", 10)).toEqual({ start: 0, end: 9 });
  });

  it.each([
    ["items=0-1", 10],
    ["bytes=-", 10],
    ["bytes=0-1,3-4", 10],
    ["bytes=10-", 10],
    ["bytes=5-4", 10],
    ["bytes=-0", 10],
    ["bytes=0-0", 0],
  ])("拒绝非法或不可满足的范围 %s", (header, size) => {
    expect(parseByteRange(header, size)).toBeNull();
  });
});
