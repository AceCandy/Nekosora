import {
  getMyKeys,
  ensureMasterKey,
  newSubKey,
  disableKey,
  getBindings,
  getBindableModels,
  bindModel,
  unbindBinding,
} from "../actions";
import KeysManager, { type ApiKeyRecord, type BindableModels } from "./KeysManager";

export default async function KeysPage() {
  const [keys, bindable] = await Promise.all([getMyKeys(), getBindableModels()]);

  // Parallel prefetch of all bindings for subkeys
  const augmentedKeys = await Promise.all(
    keys.map(async (k) => {
      if (k.kind === "sub") {
        const bindings = await getBindings(k.id);
        return {
          ...k,
          bindings: bindings.map((b: {
            id: string;
            keyId: string;
            scope: string;
            globalModelId: string | null;
            userModelId: string | null;
            createdAt: Date | string | null;
          }) => ({
            id: b.id,
            keyId: b.keyId,
            scope: b.scope as "global" | "byo",
            globalModelId: b.globalModelId,
            userModelId: b.userModelId,
            createdAt: b.createdAt
          }))
        };
      }
      return { ...k, bindings: [] };
    })
  );

  // Define client-friendly server action wrappers
  async function handleEnsureMaster() {
    "use server";
    return ensureMasterKey();
  }

  async function handleNewSubKey(name: string) {
    "use server";
    return newSubKey(name);
  }

  async function handleDisableKey(keyId: string) {
    "use server";
    return disableKey(keyId);
  }

  async function handleBindModel(keyId: string, scope: "global" | "byo", modelId: string) {
    "use server";
    return bindModel(keyId, scope, modelId);
  }

  async function handleUnbindBinding(bindingId: string) {
    "use server";
    return unbindBinding(bindingId);
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold mb-1">API Keys & 权限绑定</h1>
        <p className="text-sm text-neutral-500">
          管理您调用网关模型的 API 密钥。主密钥拥有全部权限，子密钥可精细控制绑定的上游模型范围。
        </p>
      </div>

      <KeysManager
        keys={augmentedKeys as ApiKeyRecord[]}
        bindable={bindable as unknown as BindableModels}
        ensureMasterAction={handleEnsureMaster}
        newSubKeyAction={handleNewSubKey}
        disableKeyAction={handleDisableKey}
        bindModelAction={handleBindModel}
        unbindBindingAction={handleUnbindBinding}
      />
    </div>
  );
}

