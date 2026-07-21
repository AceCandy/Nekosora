import { beforeEach, describe, expect, it, vi } from "vitest";

const aws = vi.hoisted(() => ({
  send: vi.fn(),
  getObjectCommand: vi.fn((input: Record<string, unknown>) => ({ input })),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = aws.send;
  },
  GetObjectCommand: class {
    constructor(input: Record<string, unknown>) {
      aws.getObjectCommand(input);
    }
  },
}));

import { S3Driver } from "@/lib/infra/storage/s3";

function makeDriver() {
  return new S3Driver({
    kind: "s3",
    region: "us-east-1",
    bucket: "test-bucket",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
  });
}

describe("S3Driver.get", () => {
  beforeEach(() => {
    aws.send.mockReset().mockResolvedValue({
      Body: {
        transformToByteArray: async () => new Uint8Array([2, 3, 4, 5]),
      },
    });
    aws.getObjectCommand.mockClear();
  });

  it("把闭区间翻译为 S3 Range 请求", async () => {
    await makeDriver().get("sample.txt", { start: 2, end: 5 });

    expect(aws.getObjectCommand).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "sample.txt",
      Range: "bytes=2-5",
    });
  });

  it("未指定范围时保持全量 GetObject 请求", async () => {
    await makeDriver().get("sample.txt");

    expect(aws.getObjectCommand).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "sample.txt",
    });
  });
});
