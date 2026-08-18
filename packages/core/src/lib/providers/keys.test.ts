import { beforeAll, describe, expect, it } from "vitest";
import { encrypt } from "@/lib/infra/crypto";
import { encryptKeyBundle, parseKeyBundle } from "./keys";

beforeAll(() => {
  process.env.DATA_ENCRYPTION_KEY = "1".repeat(64);
});

describe("provider key bundle notes", () => {
  it("round-trips optional notes without affecting legacy entries", () => {
    const bundle = encryptKeyBundle([
      { key: "key-a", weight: 2, note: "Primary" },
      { key: "key-b", weight: 1 },
    ]);

    expect(parseKeyBundle(bundle)).toEqual([
      { key: "key-a", weight: 2, note: "Primary" },
      { key: "key-b", weight: 1 },
    ]);
    expect(parseKeyBundle(encrypt(JSON.stringify({ keys: ["legacy-key"] })))).toEqual([
      { key: "legacy-key", weight: 1 },
    ]);
  });
});
