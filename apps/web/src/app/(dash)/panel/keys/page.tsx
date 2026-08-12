import { getTranslations } from "next-intl/server";
import {
  getMyKeys,
  ensureMasterKey,
  newSubKey,
  disableKey,
  getBindings,
  getBindableModels,
  bindModel,
  unbindBinding,
  type BindableModels,
} from "../actions";
import KeysManager from "./KeysManager";
import { Key } from "lucide-react";
import { PageHeader } from "@/shared/components/PageHeader";

export default async function KeysPage() {
  const t = await getTranslations("panel.keys");
  const tn = await getTranslations("nav");
  const [keys, bindable] = await Promise.all([getMyKeys(), getBindableModels()]);
  const displayBindable: BindableModels = {
    globals: bindable.globals.map((model) => ({
      id: model.id,
      name: model.name,
      displayName: model.displayName,
    })),
    byos: bindable.byos.map((model) => ({
      id: model.id,
      name: model.name,
      displayName: model.displayName,
    })),
  };

  // Parallel prefetch of all bindings for subkeys
  const augmentedKeys = await Promise.all(
    keys.map(async (k) => {
      const displayKey = {
        id: k.id,
        kind: k.kind,
        name: k.name,
        keyPrefix: k.keyPrefix,
        enabled: k.enabled,
      };
      if (k.kind === "sub") {
        const bindings = await getBindings(k.id);
        return {
          ...displayKey,
          bindings: bindings.map((b: {
            id: string;
            keyId: string;
            modelId: string;
            createdAt: Date | string | null;
          }) => ({
            id: b.id,
            keyId: b.keyId,
            modelId: b.modelId,
            createdAt: b.createdAt
          }))
        };
      }
      return { ...displayKey, bindings: [] };
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

  async function handleBindModel(keyId: string, modelId: string) {
    "use server";
    return bindModel(keyId, modelId);
  }

  async function handleUnbindBinding(bindingId: string) {
    "use server";
    return unbindBinding(bindingId);
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader icon={Key} title={tn("keys")} desc={t("desc")} />

      <KeysManager
        keys={augmentedKeys}
        bindable={displayBindable}
        ensureMasterAction={handleEnsureMaster}
        newSubKeyAction={handleNewSubKey}
        disableKeyAction={handleDisableKey}
        bindModelAction={handleBindModel}
        unbindBindingAction={handleUnbindBinding}
      />
    </div>
  );
}
