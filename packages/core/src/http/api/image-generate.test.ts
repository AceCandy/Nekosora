import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), db: vi.fn(), schema: vi.fn(), generate: vi.fn(), storage: vi.fn(),
}));
vi.mock("../../lib/session-request", () => ({ getSessionFromHeaders: mocks.session }));
vi.mock("../../lib/infra/db/index", () => ({ getDb: mocks.db, getSchema: mocks.schema }));
vi.mock("../../lib/providers/multimodal/image-gen", () => ({ generateImageViaRoute: mocks.generate }));
vi.mock("../../lib/infra/storage/index", () => ({ getStorage: mocks.storage }));

import { POST } from "./image-generate";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ id: "user-1" });
});

function request(body: unknown) {
  return new Request("http://localhost/api/images/generate", { method: "POST", body: JSON.stringify(body) });
}

it.each([null, [], {}, { model: 1, prompt: "p" },
  ...[{ prompt: {} }, { n: "2" }, { n: 1.5 }, { size: "invalid" }, { modelId: {} }]
    .map((patch) => ({ model: "m", prompt: "p", ...patch })),
])("非法图像请求不写任务或调用上游：%j", async (body) => {
  const response = await POST(request(body));
  expect(response.status).toBe(400);
  expect(mocks.db).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
});

it.each([[undefined, 1], [0, 1], [2, 2], [9, 4]])("图像数量 %s 在任务和上游保持一致", async (n, expected) => {
  const values = vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: "job-1" }]) }));
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) }));
  mocks.db.mockResolvedValue({ insert: vi.fn(() => ({ values })), update });
  mocks.schema.mockReturnValue({ imageJobs: { id: "id" } });
  mocks.generate.mockResolvedValue({ images: [{ url: "https://example.com/image.png" }] });
  mocks.storage.mockReturnValue({});
  const response = await POST(request({ model: "m", prompt: "p", n, size: "1024x1024" }));
  expect(response.status).toBe(200);
  expect(values).toHaveBeenCalledWith(expect.objectContaining({ n: expected }));
  expect(mocks.generate).toHaveBeenCalledWith(expect.anything(), "m",
    expect.objectContaining({ n: expected, size: "1024x1024" }), undefined);
});
