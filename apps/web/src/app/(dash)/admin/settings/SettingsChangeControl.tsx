"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { changedFields, type SettingsChange } from "@/lib/settings-control/changes";
import { Button } from "@/shared/ui/Button";
import Modal from "@/shared/ui/Modal";
import {
  INITIAL_SETTINGS_CONTROL_ACTION_STATE,
  abandonSettingsChangeSet,
  applySettingsChangeSet,
  createSettingsRollback,
  type SettingsControlActionState,
} from "./settings-control-actions";

interface HistoryItem {
  id: string;
  kind: "edit" | "rollback";
  rollbackOf: string | null;
  appliedRevision: number;
  appliedAt: string;
  changes: SettingsChange[];
}

interface SettingsChangeControlProps {
  draft: {
    id: string;
    kind: "edit" | "rollback";
    version: number;
    changes: SettingsChange[];
  } | null;
  history: HistoryItem[];
}

type ChangeDomain = "models" | "outputModes" | "renderStyles" | "governance" | "protocol";
type ChangeOperation = "created" | "deleted" | "updated";

interface PresentedField {
  key: string;
  before: unknown;
  after: unknown;
  long: boolean;
}

interface PresentedChange {
  resourceKey: string;
  resourceName: string;
  resourceLabelKey: string | null;
  domain: ChangeDomain;
  operation: ChangeOperation;
  fields: PresentedField[];
  attention: boolean;
}

interface ChangeGroup {
  domain: ChangeDomain;
  items: PresentedChange[];
}

interface ChangeLabels {
  domains: Record<ChangeDomain, string>;
  operations: Record<ChangeOperation, string>;
  resources: Record<string, string>;
  fields: Record<string, string>;
  attention: string;
  before: string;
  after: string;
  unset: string;
  enabled: string;
  disabled: string;
  inspectLongValue: string;
}

const DOMAIN_ORDER: readonly ChangeDomain[] = [
  "models",
  "outputModes",
  "renderStyles",
  "governance",
  "protocol",
];

const SYSTEM_RESOURCES: Record<string, { domain: ChangeDomain; labelKey: string }> = {
  "gateway:chat_ua": { domain: "protocol", labelKey: "gatewayChatUa" },
  "gateway:gateway_ua": { domain: "protocol", labelKey: "gatewayApiUa" },
  "gateway:request_governance_v1": { domain: "governance", labelKey: "governancePolicy" },
  "rag:embedding_provider_id": { domain: "models", labelKey: "embeddingProvider" },
  "rag:embedding_model": { domain: "models", labelKey: "embeddingModel" },
  "rag:mem0_llm_model_id": { domain: "models", labelKey: "mem0Model" },
  "rag:mem0_llm_model": { domain: "models", labelKey: "mem0Model" },
  "task:title_model_id": { domain: "models", labelKey: "titleModel" },
  "task:title_model": { domain: "models", labelKey: "titleModel" },
  "task:compact_model_id": { domain: "models", labelKey: "compactModel" },
  "task:compact_model": { domain: "models", labelKey: "compactModel" },
};

const HIDDEN_FIELDS = new Set(["id", "namespace", "key"]);
const LONG_FIELDS = new Set(["value", "systemPrompt", "css"]);

export default function SettingsChangeControl({
  draft,
  history,
}: SettingsChangeControlProps) {
  const t = useTranslations("admin.settings.control");
  const locale = useLocale();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const expected = {
    changeSetId: draft?.id ?? null,
    version: draft?.version ?? null,
  };
  const [applyState, applyAction, applyPending] = useActionState(
    applySettingsChangeSet.bind(null, expected),
    INITIAL_SETTINGS_CONTROL_ACTION_STATE,
  );
  const [abandonState, abandonAction, abandonPending] = useActionState(
    abandonSettingsChangeSet.bind(null, expected),
    INITIAL_SETTINGS_CONTROL_ACTION_STATE,
  );
  const [rollbackState, rollbackAction, rollbackPending] = useActionState(
    createSettingsRollback,
    INITIAL_SETTINGS_CONTROL_ACTION_STATE,
  );
  const state = latestState(applyState, abandonState, rollbackState);
  const draftGroups = presentSettingsChanges(draft?.changes ?? []);
  const labels: ChangeLabels = {
    domains: {
      models: t("domains.models"),
      outputModes: t("domains.outputModes"),
      renderStyles: t("domains.renderStyles"),
      governance: t("domains.governance"),
      protocol: t("domains.protocol"),
    },
    operations: {
      created: t("created"),
      deleted: t("deleted"),
      updated: t("updated"),
    },
    resources: {
      gatewayChatUa: t("resources.gatewayChatUa"),
      gatewayApiUa: t("resources.gatewayApiUa"),
      governancePolicy: t("resources.governancePolicy"),
      embeddingProvider: t("resources.embeddingProvider"),
      embeddingModel: t("resources.embeddingModel"),
      mem0Model: t("resources.mem0Model"),
      titleModel: t("resources.titleModel"),
      compactModel: t("resources.compactModel"),
    },
    fields: {
      value: t("fields.value"),
      name: t("fields.name"),
      description: t("fields.description"),
      systemPrompt: t("fields.systemPrompt"),
      icon: t("fields.icon"),
      enabled: t("fields.enabled"),
      sortOrder: t("fields.sortOrder"),
      cssClass: t("fields.cssClass"),
      css: t("fields.css"),
      renderer: t("fields.renderer"),
      builtin: t("fields.builtin"),
    },
    attention: t("attention"),
    before: t("before"),
    after: t("after"),
    unset: t("unset"),
    enabled: t("enabled"),
    disabled: t("disabled"),
    inspectLongValue: t("inspectLongValue"),
  };
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <aside>
      {draft ? (
        <section className="border-y border-morning-mist bg-neutral-50/60 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-ui-body font-semibold text-space-ink">
                {t("draftSummary", { count: draft.changes.length })}
              </p>
              <p className="mt-0.5 text-ui-caption text-ink-tertiary">{t("draftPersisted")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="primary"
                disabled={draft.changes.length === 0 || applyPending || abandonPending}
                onClick={() => setReviewOpen(true)}
              >
                {t("reviewApply")}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setHistoryOpen(true)}>
                {t("history")}
              </Button>
              <form action={abandonAction}>
                <Button
                  type="submit"
                  variant="ghost"
                  disabled={applyPending || abandonPending}
                >
                  {abandonPending ? t("working") : t("abandon")}
                </Button>
              </form>
            </div>
          </div>

          {state.code && !reviewOpen && !historyOpen && (
            <p
              role={state.status === "error" ? "alert" : "status"}
              aria-live="polite"
              className={`mt-3 text-ui-body ${statusColor(state.status)}`}
            >
              {t(actionMessageKey(state.code))}
            </p>
          )}
        </section>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {state.code && !historyOpen && (
            <p
              role={state.status === "error" ? "alert" : "status"}
              aria-live="polite"
              className={`text-ui-body ${statusColor(state.status)}`}
            >
              {t(actionMessageKey(state.code))}
            </p>
          )}
          <Button type="button" variant="ghost" onClick={() => setHistoryOpen(true)}>
            {t("history")}
          </Button>
        </div>
      )}

      <Modal
        open={reviewOpen && Boolean(draft)}
        onClose={() => setReviewOpen(false)}
        title={t("reviewTitle")}
        dialogClassName="modal-pop m-auto max-h-[90vh] w-[min(760px,92vw)] overflow-hidden rounded-lg border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/40"
        bodyClassName="max-h-[calc(90vh-3.5rem)] overflow-y-auto px-5 py-4"
      >
        {draft && (
          <>
            <p className="max-w-prose text-ui-body text-neutral-600">{t("reviewIntro")}</p>
            <ChangeSummary groups={draftGroups} labels={labels} />
            {applyState.code && (
              <p
                role={applyState.status === "error" ? "alert" : "status"}
                aria-live="polite"
                className={`mt-4 text-ui-body ${statusColor(applyState.status)}`}
              >
                {t(actionMessageKey(applyState.code))}
              </p>
            )}
            <div className="mt-5 flex flex-col-reverse gap-2 border-t border-morning-mist pt-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => setReviewOpen(false)}>
                {t("cancel")}
              </Button>
              <form action={applyAction}>
                <Button type="submit" variant="primary" disabled={applyPending} className="w-full sm:w-auto">
                  {applyPending ? t("applying") : t("applyAtomically")}
                </Button>
              </form>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t("history")}
        dialogClassName="modal-pop m-auto max-h-[90vh] w-[min(760px,92vw)] overflow-hidden rounded-lg border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/40"
        bodyClassName="max-h-[calc(90vh-3.5rem)] overflow-y-auto px-5 py-2"
      >
        {history.length === 0 ? (
          <p className="py-4 text-ui-body text-ink-tertiary">{t("historyEmpty")}</p>
        ) : (
          <>
            {rollbackState.code && (
              <p
                role={rollbackState.status === "error" ? "alert" : "status"}
                aria-live="polite"
                className={`py-3 text-ui-body ${statusColor(rollbackState.status)}`}
              >
                {t(actionMessageKey(rollbackState.code))}
              </p>
            )}
            {history.map((item) => (
              <article key={item.id} className="border-b border-morning-mist py-4 last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-ui-body font-semibold text-space-ink">
                      r{item.appliedRevision} · {item.kind === "rollback" ? t("rollback") : t("release")}
                    </h3>
                    <p className="mt-0.5 text-ui-caption text-ink-tertiary">
                      {dateFormatter.format(new Date(item.appliedAt))} · {t("changeCount", { count: item.changes.length })}
                    </p>
                  </div>
                  {!draft && (
                    <form action={rollbackAction}>
                      <input type="hidden" name="target_change_set_id" value={item.id} />
                      <Button type="submit" variant="secondary" disabled={rollbackPending}>
                        {rollbackPending ? t("working") : t("reverseRelease")}
                      </Button>
                    </form>
                  )}
                </div>
                <ChangeSummary groups={presentSettingsChanges(item.changes)} labels={labels} compact />
              </article>
            ))}
          </>
        )}
      </Modal>
    </aside>
  );
}

function ChangeSummary({
  groups,
  labels,
  compact = false,
}: {
  groups: ChangeGroup[];
  labels: ChangeLabels;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mt-3" : "mt-5"}>
      {groups.map((group) => (
        <section key={group.domain} className="border-t border-morning-mist py-4 first:border-t-0 first:pt-0">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-ui-body font-semibold text-space-ink">{labels.domains[group.domain]}</h3>
            <span className="text-ui-caption text-ink-tertiary">{group.items.length}</span>
          </div>
          <div className="mt-2 divide-y divide-morning-mist border-y border-morning-mist">
            {group.items.map((item) => (
              <article key={item.resourceKey} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-ui-body font-medium text-neutral-800">
                      {item.resourceLabelKey
                        ? labels.resources[item.resourceLabelKey] ?? item.resourceName
                        : item.resourceName}
                    </p>
                    <p className="break-all font-mono text-ui-micro text-ink-tertiary">{item.resourceKey}</p>
                  </div>
                  <span className="text-ui-caption font-medium text-neutral-600">
                    {labels.operations[item.operation]}
                  </span>
                </div>
                {item.attention && (
                  <p className="mt-2 text-ui-caption font-medium text-warning">{labels.attention}</p>
                )}
                {!compact && item.fields.length > 0 && (
                  <dl className="mt-3 space-y-3">
                    {item.fields.map((field) => (
                      <FieldDiff key={field.key} field={field} labels={labels} />
                    ))}
                  </dl>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FieldDiff({ field, labels }: { field: PresentedField; labels: ChangeLabels }) {
  const fieldLabel = labels.fields[field.key] ?? field.key;
  if (field.long) {
    return (
      <div>
        <dt className="text-ui-caption font-medium text-neutral-700">{fieldLabel}</dt>
        <dd className="mt-1">
          <details>
            <summary className="touch-target cursor-pointer text-ui-caption text-sora-blue">
              {labels.inspectLongValue}
            </summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <ValueBlock label={labels.before} value={formatValue(field.before, labels)} />
              <ValueBlock label={labels.after} value={formatValue(field.after, labels)} />
            </div>
          </details>
        </dd>
      </div>
    );
  }
  return (
    <div>
      <dt className="text-ui-caption font-medium text-neutral-700">{fieldLabel}</dt>
      <dd className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-ui-caption">
        <span className="min-w-0 break-all rounded bg-neutral-50 px-2 py-1 font-mono">
          <span className="sr-only">{labels.before}: </span>{formatValue(field.before, labels)}
        </span>
        <span aria-hidden="true" className="text-ink-tertiary">→</span>
        <span className="min-w-0 break-all rounded bg-neutral-50 px-2 py-1 font-mono">
          <span className="sr-only">{labels.after}: </span>{formatValue(field.after, labels)}
        </span>
      </dd>
    </div>
  );
}

function ValueBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-ui-caption font-medium text-neutral-600">{label}</p>
      <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-2 text-ui-caption">{value}</pre>
    </div>
  );
}

export function presentSettingsChanges(changes: readonly SettingsChange[]): ChangeGroup[] {
  const groups = new Map<ChangeDomain, PresentedChange[]>();
  for (const change of changes) {
    const snapshot = change.after ?? change.before;
    if (!snapshot) continue;
    const operation: ChangeOperation = change.before === null
      ? "created"
      : change.after === null
        ? "deleted"
        : "updated";
    const systemSnapshot = change.resource === "system_setting"
      ? change.after ?? change.before
      : null;
    const renderSnapshot = change.resource === "render_style"
      ? change.after ?? change.before
      : null;
    const systemKey = systemSnapshot
      ? `${systemSnapshot.namespace}:${systemSnapshot.key}`
      : null;
    const systemResource = systemKey ? SYSTEM_RESOURCES[systemKey] : undefined;
    const domain: ChangeDomain = change.resource === "output_mode"
      ? "outputModes"
      : change.resource === "render_style"
        ? "renderStyles"
        : systemResource?.domain ?? "protocol";
    const changed = changedFields(change);
    const rawFields = changed.includes("*")
      ? Object.keys(snapshot)
      : changed;
    const fields = rawFields
      .filter((key) => !HIDDEN_FIELDS.has(key))
      .map((key) => {
        const before = change.before && key in change.before
          ? (change.before as unknown as Record<string, unknown>)[key]
          : undefined;
        const after = change.after && key in change.after
          ? (change.after as unknown as Record<string, unknown>)[key]
          : undefined;
        return {
          key,
          before,
          after,
          long: LONG_FIELDS.has(key)
            && (String(before ?? "").length > 80 || String(after ?? "").length > 80),
        };
      });
    const attention = operation === "deleted"
      || systemKey === "gateway:request_governance_v1"
      || (change.resource === "render_style"
        && (fields.some((field) => field.key === "css" || field.key === "renderer")
          || renderSnapshot?.renderer === "custom"));
    const resourceName = change.resource === "system_setting"
      ? change.resourceKey
      : (change.after ?? change.before)!.name;
    const item: PresentedChange = {
      resourceKey: change.resourceKey,
      resourceName,
      resourceLabelKey: systemResource?.labelKey ?? null,
      domain,
      operation,
      fields,
      attention,
    };
    groups.set(domain, [...(groups.get(domain) ?? []), item]);
  }
  return DOMAIN_ORDER.flatMap((domain) => {
    const items = groups.get(domain);
    return items ? [{ domain, items }] : [];
  });
}

function formatValue(value: unknown, labels: ChangeLabels): string {
  if (value === undefined || value === null || value === "") return labels.unset;
  if (typeof value === "boolean") return value ? labels.enabled : labels.disabled;
  return String(value);
}

function statusColor(status: SettingsControlActionState["status"]): string {
  if (status === "error") return "text-danger";
  if (status === "warning") return "text-warning";
  if (status === "success") return "text-success";
  return "text-neutral-600";
}

function actionMessageKey(code: NonNullable<SettingsControlActionState["code"]>): string {
  const keys: Record<NonNullable<SettingsControlActionState["code"]>, string> = {
    applied: "applied",
    applied_cache_warning: "appliedCacheWarning",
    abandoned: "abandoned",
    rollback_created: "rollbackCreated",
    stale: "stale",
    rollback_conflict: "rollbackConflict",
    invalid: "invalid",
    failed: "failed",
  };
  return keys[code];
}

function latestState(...states: SettingsControlActionState[]): SettingsControlActionState {
  return states.findLast((state) => state.code !== null) ?? INITIAL_SETTINGS_CONTROL_ACTION_STATE;
}
