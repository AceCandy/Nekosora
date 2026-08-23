"use client";

import { useActionState } from "react";
import { Button } from "@/shared/ui/Button";
import type { SettingsChange } from "@/lib/settings-control/changes";
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
  revision: number;
  draft: {
    id: string;
    kind: "edit" | "rollback";
    version: number;
    changes: SettingsChange[];
  } | null;
  history: HistoryItem[];
  labels: Record<string, string>;
}

export default function SettingsChangeControl({
  revision,
  draft,
  history,
  labels,
}: SettingsChangeControlProps) {
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

  return (
    <section className="sticky bottom-4 z-20 rounded-xl border border-morning-mist bg-nebula-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-ui-body font-semibold text-space-ink">
            {draft
              ? labels.draftSummary
                .replace("{revision}", String(revision))
                .replace("{count}", String(draft.changes.length))
              : labels.currentRevision.replace("{revision}", String(revision))}
          </p>
          <p className="text-ui-caption text-neutral-500">
            {draft ? labels.draftPersisted : labels.noDraft}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <details className="relative">
            <summary className="touch-target cursor-pointer list-none rounded-md border border-morning-mist px-3 py-2 text-ui-body font-medium text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue/40">
              {labels.history}
            </summary>
            <div className="absolute bottom-full right-0 mb-2 max-h-[60vh] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-morning-mist bg-nebula-white p-3">
              {history.length === 0 ? (
                <p className="text-ui-body text-neutral-500">{labels.historyEmpty}</p>
              ) : history.map((item) => (
                <article key={item.id} className="border-b border-morning-mist py-3 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-ui-body font-medium text-space-ink">
                        r{item.appliedRevision} · {item.kind === "rollback" ? labels.rollback : labels.release}
                      </p>
                      <p className="text-ui-caption text-neutral-500">
                        {new Date(item.appliedAt).toLocaleString()} · {item.changes.length} {labels.changes}
                      </p>
                    </div>
                    {!draft && (
                      <form action={rollbackAction}>
                        <input type="hidden" name="target_change_set_id" value={item.id} />
                        <Button type="submit" variant="secondary" disabled={rollbackPending}>
                          {labels.reverseRelease}
                        </Button>
                      </form>
                    )}
                  </div>
                  <ChangeList changes={item.changes} labels={labels} />
                </article>
              ))}
            </div>
          </details>

          {draft && (
            <>
              <form action={abandonAction}>
                <Button type="submit" variant="secondary" disabled={applyPending || abandonPending}>
                  {abandonPending ? labels.working : labels.abandon}
                </Button>
              </form>
              <form action={applyAction}>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={draft.changes.length === 0 || applyPending || abandonPending}
                >
                  {applyPending ? labels.applying : labels.reviewApply}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>

      {draft && <ChangeList changes={draft.changes} labels={labels} expanded />}
      {state.code && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={state.status === "error" ? "mt-2 text-ui-body text-red-700" : "mt-2 text-ui-body text-neutral-600"}
        >
          {labels[state.code]}
        </p>
      )}
    </section>
  );
}

function ChangeList({
  changes,
  labels,
  expanded = false,
}: {
  changes: SettingsChange[];
  labels: Record<string, string>;
  expanded?: boolean;
}) {
  if (changes.length === 0) return null;
  return (
    <details className="mt-2" open={expanded}>
      <summary className="cursor-pointer text-ui-caption font-medium text-neutral-600">
        {labels.reviewChanges}
      </summary>
      <ul className="mt-2 grid gap-1 text-ui-caption text-neutral-600 sm:grid-cols-2">
        {changes.map((change) => (
          <li key={change.resourceKey} className="rounded-md bg-neutral-50 px-2.5 py-2 font-mono">
            {change.resourceKey} · {change.before === null
              ? labels.created
              : change.after === null
                ? labels.deleted
                : labels.updated}
          </li>
        ))}
      </ul>
    </details>
  );
}

function latestState(...states: SettingsControlActionState[]): SettingsControlActionState {
  return states.findLast((state) => state.code !== null) ?? INITIAL_SETTINGS_CONTROL_ACTION_STATE;
}
