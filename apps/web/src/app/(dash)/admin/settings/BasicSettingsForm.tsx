"use client";

import { Button } from "@/shared/ui/Button";
import { useDraftAction } from "./useDraftAction";

interface BasicSettingsFormProps {
  action: (formData: FormData) => Promise<void>;
  chatUa: string;
  gatewayUa: string;
  defaultUa: string;
  chatSummary: string;
  gatewaySummary: string;
  labels: {
    chat: string;
    chatHint: string;
    gateway: string;
    gatewayHint: string;
    save: string;
    saving: string;
    saved: string;
    failed: string;
  };
}

export default function BasicSettingsForm(props: BasicSettingsFormProps) {
  const { onSubmit, pending, status } = useDraftAction(props.action);

  return (
    <form autoComplete="off" onSubmit={onSubmit} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5">
      <UaField
        name="chat_ua"
        label={props.labels.chat}
        hint={props.labels.chatHint}
        value={props.chatUa}
        defaultUa={props.defaultUa}
        summary={props.chatSummary}
        disabled={pending}
      />
      <UaField
        name="gateway_ua"
        label={props.labels.gateway}
        hint={props.labels.gatewayHint}
        value={props.gatewayUa}
        defaultUa={props.defaultUa}
        summary={props.gatewaySummary}
        disabled={pending}
      />
      <div className="min-h-5 text-ui-body" aria-live="polite">
        {pending && <p className="text-neutral-600">{props.labels.saving}</p>}
        {!pending && status === "success" && <p role="status" className="text-success">{props.labels.saved}</p>}
        {!pending && status === "error" && <p role="alert" className="text-danger">{props.labels.failed}</p>}
      </div>
      <Button type="submit" variant="primary" disabled={pending} className="px-4 py-2 font-semibold">
        {pending ? props.labels.saving : props.labels.save}
      </Button>
    </form>
  );
}

interface UaFieldProps {
  name: string;
  label: string;
  hint: string;
  value: string;
  defaultUa: string;
  summary: string;
  disabled: boolean;
}

function UaField(props: UaFieldProps) {
  return (
    <label className="block space-y-1">
      <span className="text-ui-caption font-medium text-neutral-500">{props.label}</span>
      <input
        name={props.name}
        defaultValue={props.value}
        placeholder={props.defaultUa}
        disabled={props.disabled}
        className="w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-ui-body font-mono focus-visible:border-sora-blue"
      />
      <p className="text-ui-caption text-ink-tertiary">{props.hint}</p>
      <p className="text-ui-caption text-neutral-500">{props.summary}</p>
    </label>
  );
}
