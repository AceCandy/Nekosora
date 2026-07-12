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
} from "../actions";
import KeysManager, { type ApiKeyRecord, type BindableModels } from "./KeysManager";
import { Key } from "lucide-react";
import { PageHeader } from "@/shared/components/PageHeader";

export default async function KeysPage() {
  const t = await getTranslations("panel.keys");
  const tn = await getTranslations("nav");
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

