import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMyKeys: vi.fn(),
  getBindings: vi.fn(),
  getBindableModels: vi.fn(),
  ensureMasterKey: vi.fn(),
  newSubKey: vi.fn(),
  disableKey: vi.fn(),
  bindModels: vi.fn(),
  unbindBinding: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("../actions", () => mocks);

import KeysPage from "./page";
import KeysManager from "./KeysManager";

interface ElementProps {
  bindable?: unknown;
  children?: ReactNode;
  keys?: unknown[];
}

function collectElements(node: ReactNode): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...collectElements(node.props.children)];
}

describe("KeysPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMyKeys.mockResolvedValue([{
      id: "sub-1",
      userId: "user-1",
      parentId: "master-1",
      kind: "sub",
      name: "测试子密钥",
      keyHash: "secret-hash",
      keyPrefix: "sk-test-****abcd",
      enabled: true,
      lastUsedAt: new Date("2026-01-02T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }]);
    mocks.getBindings.mockResolvedValue([{
      id: "binding-1",
      keyId: "sub-1",
      modelId: "model-1",
      createdAt: "2026-01-03T00:00:00.000Z",
    }]);
    mocks.getBindableModels.mockResolvedValue({
      globals: [],
      byos: [{
        id: "model-1",
        name: "model-1",
        displayName: "Model 1",
        systemPrompt: "secret system prompt",
        description: "private description",
        ownerUserId: "user-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
    });
  });

  it("传给 Client Component 的运行时数据只包含展示字段和绑定", async () => {
    const root = await KeysPage();
    const manager = collectElements(root).find((element) => element.type === KeysManager);

    expect(manager?.props.keys).toEqual([{
      id: "sub-1",
      kind: "sub",
      name: "测试子密钥",
      keyPrefix: "sk-test-****abcd",
      enabled: true,
      bindings: [{
        id: "binding-1",
        keyId: "sub-1",
        modelId: "model-1",
        createdAt: "2026-01-03T00:00:00.000Z",
      }],
    }]);
    expect(JSON.stringify(manager?.props.keys)).not.toContain("keyHash");
    expect(JSON.stringify(manager?.props.keys)).not.toContain("parentId");
    expect(manager?.props.bindable).toEqual({
      globals: [],
      byos: [{ id: "model-1", name: "model-1", displayName: "Model 1" }],
    });
    expect(JSON.stringify(manager?.props.bindable)).not.toContain("systemPrompt");
    expect(JSON.stringify(manager?.props.bindable)).not.toContain("description");
    expect(JSON.stringify(manager?.props.bindable)).not.toContain("ownerUserId");
  });
});
