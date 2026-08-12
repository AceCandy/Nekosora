import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let stateValues: unknown[] = [];
let stateCursor = 0;
let transitionTasks: Promise<unknown>[] = [];

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = stateCursor++;
      if (!(index in stateValues)) {
        stateValues[index] = typeof initial === "function"
          ? (initial as () => unknown)()
          : initial;
      }
      const setValue = (next: unknown) => {
        stateValues[index] = typeof next === "function"
          ? (next as (current: unknown) => unknown)(stateValues[index])
          : next;
      };
      return [stateValues[index], setValue];
    },
    useTransition: () => [false, (callback: () => unknown) => {
      transitionTasks.push(Promise.resolve(callback()));
    }],
  };
});

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import KeysManager from "./KeysManager";

interface TestElementProps {
  children?: ReactNode;
  onClick?: (event?: { stopPropagation: () => void }) => void;
  title?: string;
}

function collectElements(node: ReactNode): ReactElement<TestElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (!isValidElement<TestElementProps>(node)) return [];
  return [node, ...collectElements(node.props.children)];
}

function elementText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join("");
  if (!isValidElement<TestElementProps>(node)) return "";
  return elementText(node.props.children);
}

async function flushTransitions() {
  const tasks = transitionTasks;
  transitionTasks = [];
  await Promise.all(tasks);
}

describe("KeysManager", () => {
  type Props = ComponentProps<typeof KeysManager>;
  let props: Props;

  const render = () => {
    stateCursor = 0;
    return KeysManager(props);
  };

  beforeEach(() => {
    stateValues = [];
    stateCursor = 0;
    transitionTasks = [];
    props = {
      keys: [],
      bindable: { globals: [], byos: [] },
      ensureMasterAction: vi.fn().mockResolvedValue({
        key: "sk-complete-new-master-key",
        error: null,
      }),
      newSubKeyAction: vi.fn(),
      disableKeyAction: vi.fn().mockResolvedValue(undefined),
      bindModelAction: vi.fn(),
      unbindBindingAction: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("生成主密钥后展示后端返回的完整明文", async () => {
    let root = render();
    const generateButton = collectElements(root).find((element) =>
      elementText(element) === "generateMaster" && element.props.onClick);

    generateButton?.props.onClick?.();
    await flushTransitions();

    root = render();
    const rawKey = collectElements(root).find((element) => element.type === "code");
    expect(elementText(rawKey)).toBe("sk-complete-new-master-key");
  });

  it("已撤销的主密钥不占用当前主密钥位置", () => {
    props.keys = [{
      id: "master-1",
      name: "主密钥",
      keyPrefix: "sk-old-m…",
      kind: "master",
      enabled: false,
      bindings: [],
    }];

    const elements = collectElements(render());
    expect(elements.some((element) => elementText(element) === "generateMaster" && element.props.onClick)).toBe(true);
    expect(elements.some((element) => elementText(element) === "sk-old-m…")).toBe(false);
  });

  it("主密钥撤销按钮调用禁用动作", async () => {
    props.keys = [{
      id: "master-1",
      name: "主密钥",
      keyPrefix: "sk-live-…",
      kind: "master",
      enabled: true,
      bindings: [],
    }];

    const revokeButton = collectElements(render()).find((element) =>
      elementText(element) === "revoke" && element.props.onClick);
    revokeButton?.props.onClick?.();
    await flushTransitions();

    expect(props.disableKeyAction).toHaveBeenCalledWith("master-1");
  });

  it("列表只展示脱敏值且不提供部分密钥复制按钮", () => {
    props.keys = [
      {
        id: "master-1",
        name: "主密钥",
        keyPrefix: "sk-live-…",
        kind: "master",
        enabled: true,
        bindings: [],
      },
      {
        id: "sub-1",
        name: "生产环境",
        keyPrefix: "sk-new-a****7XyZ",
        kind: "sub",
        enabled: true,
        bindings: [],
      },
    ];

    const elements = collectElements(render());
    expect(elements.some((element) => elementText(element) === "sk-live-****")).toBe(true);
    expect(elements.some((element) => elementText(element) === "sk-new-a****7XyZ")).toBe(true);
    expect(elements.some((element) => element.props.title === "copyPrefix")).toBe(false);
  });
});
