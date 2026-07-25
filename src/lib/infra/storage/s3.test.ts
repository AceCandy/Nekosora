import { beforeEach, describe, expect, it, vi } from "vitest";

const aws = vi.hoisted(() => ({
  send: vi.fn(),
  getObjectCommand: vi.fn((input: Record<string, unknown>) => ({ input })),
  putObjectCommand: vi.fn((input: Record<string, unknown>) => ({ input })),
  getSignedUrl: vi.fn(),
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
  PutObjectCommand: class {
    constructor(input: Record<string, unknown>) {
      aws.putObjectCommand(input);
    }
  },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: aws.getSignedUrl,
}));

import { S3Driver } from "@/lib/infra/storage/s3";

function makeDriver(publicBaseUrl?: string) {
  return new S3Driver({
    kind: "s3",
    region: "us-east-1",
    bucket: "test-bucket",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    publicBaseUrl,
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
    aws.putObjectCommand.mockClear();
    aws.getSignedUrl.mockReset().mockResolvedValue(
      "https://s3.example.com/user-a/file.png?X-Amz-Signature=signed",
    );
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

  it("配置公共 CDN 时 signedUrl 仍返回临时预签名 URL", async () => {
    const driver = makeDriver("https://cdn.example.com");

    await expect(driver.signedUrl("user-a/file.png", 3600)).resolves.toBe(
      "https://s3.example.com/user-a/file.png?X-Amz-Signature=signed",
    );
    expect(aws.getObjectCommand).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "user-a/file.png",
    });
    expect(aws.getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { expiresIn: 3600 },
    );
  });

  it("把预签名 TTL 夹在 1 秒到 7 天", async () => {
    const driver = makeDriver("https://cdn.example.com");

    await driver.signedUrl("user-a/file.png", 0);
    await driver.signedUrl("user-a/file.png", 999999);

    expect(aws.getSignedUrl).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.anything(),
      { expiresIn: 1 },
    );
    expect(aws.getSignedUrl).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.anything(),
      { expiresIn: 604800 },
    );
  });

  it("配置公共 CDN 时 put 仍返回公共产物 URL", async () => {
    const driver = makeDriver("https://cdn.example.com");

    await expect(
      driver.put("generated/image.png", Buffer.from("image"), "image/png"),
    ).resolves.toEqual({
      key: "generated/image.png",
      url: "https://cdn.example.com/generated/image.png",
      size: 5,
    });
    expect(aws.putObjectCommand).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "generated/image.png",
      Body: Buffer.from("image"),
      ContentType: "image/png",
    });
  });
});
