import { CircleAlert, Info } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  GATEWAY_GOVERNANCE_POLICY_BOUNDS,
  loadGatewayGovernancePolicy,
} from "@/lib/gateway-governance/policy";
import { requireAdmin } from "@/lib/session";
import { getSettings } from "@/lib/system-settings/service";
import {
  projectSystemSettings,
  type SettingsControlView,
} from "@/lib/settings-control/service";
import GovernanceSettingsForm from "./GovernanceSettingsForm";
import { saveGatewayGovernancePolicy } from "./governance-actions";
import {
  getGatewayGovernanceInsights,
  type GovernanceHistoryRange,
} from "@/lib/gateway-governance/analytics";
import GovernanceHistoryPanel from "./GovernanceHistoryPanel";

export default async function GovernanceSettingsSection({
  control,
  range,
}: {
  control: SettingsControlView;
  range: GovernanceHistoryRange;
}) {
  await requireAdmin();
  const gateway = projectSystemSettings(
    "gateway",
    await getSettings("gateway"),
    control.draft?.changes ?? [],
  );
  const { policy, source } = loadGatewayGovernancePolicy(
    gateway.request_governance_v1 ?? null,
  );
  const insights = await getGatewayGovernanceInsights(range, policy);
  const t = await getTranslations("admin.settings.governance");
  const invalid = source === "invalid";
  const SourceIcon = invalid ? CircleAlert : Info;

  return (
    <div id="governance-policy" className="max-w-5xl space-y-5 scroll-mt-40">
      <div className="max-w-3xl">
        <h2 className="text-ui-title font-semibold text-space-ink">{t("title")}</h2>
        <p className="mt-1 text-ui-body text-neutral-600">{t("desc")}</p>
      </div>

      {source !== "stored" && (
        <div
          role={invalid ? "alert" : "status"}
          className={
            invalid
              ? "flex max-w-3xl items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-red-800"
              : "flex max-w-3xl items-start gap-2 rounded-md border border-sora-blue/20 bg-sora-blue/5 px-3 py-2.5 text-neutral-700"
          }
        >
          <SourceIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-ui-body">{t(invalid ? "invalidStored" : "usingDefaults")}</p>
        </div>
      )}

      <GovernanceSettingsForm
        policy={policy}
        bounds={GATEWAY_GOVERNANCE_POLICY_BOUNDS}
        action={saveGatewayGovernancePolicy.bind(null, {
          changeSetId: control.draft?.id ?? null,
          version: control.draft?.version ?? null,
        })}
      />
      <GovernanceHistoryPanel range={range} {...insights} />
    </div>
  );
}
