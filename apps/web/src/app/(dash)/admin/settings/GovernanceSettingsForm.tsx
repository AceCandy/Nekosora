"use client";

import { useActionState, useState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  GatewayGovernancePolicy,
  GatewayGovernancePolicyBounds,
  GatewayScopeLimits,
} from "@/lib/gateway-governance/policy";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import type { GovernanceSettingsActionState } from "./governance-actions";

type Scope = "key" | "user";
type PolicyField = keyof GatewayScopeLimits;
type BoundKind = keyof GatewayGovernancePolicyBounds;

interface GovernanceSettingsFormProps {
  policy: GatewayGovernancePolicy;
  bounds: GatewayGovernancePolicyBounds;
  action: (
    state: GovernanceSettingsActionState,
    formData: FormData,
  ) => Promise<GovernanceSettingsActionState>;
}

interface FieldDefinition {
  key: PolicyField;
  formSuffix: string;
  labelKey: string;
  unitKey: string;
  bound: BoundKind;
}

interface FieldGroup {
  id: string;
  titleKey: string;
  fields: readonly FieldDefinition[];
}

const SCOPES = [
  { key: "key", labelKey: "keyScope" },
  { key: "user", labelKey: "userScope" },
] as const satisfies readonly { key: Scope; labelKey: string }[];

const FIELD_GROUPS = [
  {
    id: "throughput",
    titleKey: "throughputTitle",
    fields: [
      { key: "rpm", formSuffix: "rpm", labelKey: "rpm", unitKey: "rpmUnit", bound: "rate" },
      { key: "burst", formSuffix: "burst", labelKey: "burst", unitKey: "burstUnit", bound: "rate" },
      {
        key: "concurrency",
        formSuffix: "concurrency",
        labelKey: "concurrency",
        unitKey: "concurrencyUnit",
        bound: "concurrency",
      },
    ],
  },
  {
    id: "quota",
    titleKey: "quotaTitle",
    fields: [
      {
        key: "chatTokensPerMonth",
        formSuffix: "chat_tokens_per_month",
        labelKey: "chatTokens",
        unitKey: "chatTokensUnit",
        bound: "quota",
      },
      {
        key: "imageCountPerMonth",
        formSuffix: "image_count_per_month",
        labelKey: "imageCount",
        unitKey: "imageCountUnit",
        bound: "quota",
      },
      {
        key: "ttsCodePointsPerMonth",
        formSuffix: "tts_code_points_per_month",
        labelKey: "ttsCodePoints",
        unitKey: "ttsCodePointsUnit",
        bound: "quota",
      },
      {
        key: "sttSecondsPerMonth",
        formSuffix: "stt_seconds_per_month",
        labelKey: "sttSeconds",
        unitKey: "sttSecondsUnit",
        bound: "quota",
      },
    ],
  },
] as const satisfies readonly FieldGroup[];

const INITIAL_STATE: GovernanceSettingsActionState = {
  status: "idle",
  error: null,
};

export default function GovernanceSettingsForm({
  policy,
  bounds,
  action,
}: GovernanceSettingsFormProps) {
  const t = useTranslations("admin.settings.governance");
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const policyKey = JSON.stringify(policy);

  return (
    <form
      action={formAction}
      className="rounded-lg border border-morning-mist bg-nebula-white p-4 sm:p-5"
    >
      <div key={policyKey} className="space-y-7">
        {FIELD_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`governance-${group.id}-title`}>
            <h3
              id={`governance-${group.id}-title`}
              className="text-ui-title font-semibold text-space-ink"
            >
              {t(group.titleKey)}
            </h3>

            <div className="mt-4 hidden grid-cols-[minmax(12rem,1fr)_minmax(0,12rem)_minmax(0,12rem)] items-end gap-4 border-b border-morning-mist pb-2 lg:grid">
              <span className="text-ui-caption font-medium text-neutral-600">
                {t("metricColumn")}
              </span>
              {SCOPES.map((scope) => (
                <span
                  key={scope.key}
                  className="text-ui-caption font-medium text-neutral-600"
                >
                  {t(scope.labelKey)}
                </span>
              ))}
            </div>

            <div className="divide-y divide-morning-mist">
              {group.fields.map((field) => {
                const unitId = `governance-${field.key}-unit`;
                const fieldBounds = bounds[field.bound];

                return (
                  <div
                    key={field.key}
                    className="grid gap-3 py-4 first:pt-3 last:pb-0 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,12rem)_minmax(0,12rem)] lg:items-end lg:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-ui-body font-medium text-space-ink">
                        {t(field.labelKey)}
                      </p>
                      <p id={unitId} className="mt-0.5 text-ui-caption text-neutral-600">
                        {t(field.unitKey)}
                      </p>
                    </div>

                    {SCOPES.map((scope) => {
                      const name = `${scope.key}_${field.formSuffix}`;
                      const label = `${t(field.labelKey)} - ${t(scope.labelKey)}`;

                      return (
                        <div key={scope.key} className="min-w-0 space-y-1.5">
                          <label
                            htmlFor={name}
                            className="text-ui-caption font-medium text-neutral-700 lg:sr-only"
                          >
                            <span className="sr-only">{t(field.labelKey)} - </span>
                            {t(scope.labelKey)}
                          </label>
                          <GovernanceFieldInput
                            key={`${policyKey}:${name}`}
                            id={name}
                            name={name}
                            min={fieldBounds.min}
                            max={fieldBounds.max}
                            initialValue={policy[scope.key][field.key]}
                            aria-label={label}
                            describedBy={unitId}
                            disabled={pending}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-morning-mist pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-ui-body" aria-live="polite">
          {!pending && state.status === "success" && (
            <p className="text-success" role="status">{t("saved")}</p>
          )}
          {!pending && state.status === "error" && state.error && (
            <p className="text-danger" role="alert">{t(state.error)}</p>
          )}
        </div>

        <Button
          type="submit"
          variant="primary"
          disabled={pending}
          aria-label={pending ? t("saving") : t("save")}
          className="w-full bg-sora-blue-hover hover:brightness-90 sm:w-auto"
        >
          {pending ? (
            <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Save className="h-4 w-4" aria-hidden="true" />
          )}
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}

interface GovernanceFieldInputProps {
  id: string;
  name: string;
  min: number;
  max: number;
  initialValue: number;
  "aria-label": string;
  describedBy: string;
  disabled: boolean;
}

/** 受控值可抵抗 React Action 的原生 form reset，失败时保留当前输入。 */
function GovernanceFieldInput(props: GovernanceFieldInputProps) {
  const [value, setValue] = useState(String(props.initialValue));
  return (
    <Input
      id={props.id}
      name={props.name}
      type="number"
      inputMode="numeric"
      min={props.min}
      max={props.max}
      step={1}
      required
      value={value}
      onChange={(event) => setValue(event.target.value)}
      aria-label={props["aria-label"]}
      aria-describedby={props.describedBy}
      disabled={props.disabled}
    />
  );
}
