"use client";

import { AlertCircle, CheckCircle2, GitBranchPlus, List, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ProviderModelCandidate } from "@/features/providers/types";
import Modal from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";

export interface ProviderModelMatchCandidate extends ProviderModelCandidate {
  routeExists: boolean;
}

export interface ProviderModelMatchFeedback {
  status: "created" | "exists" | "error";
  modelName: string;
}

interface ProviderModelMatchDialogProps {
  open: boolean;
  upstreamModelName: string;
  candidates: ProviderModelMatchCandidate[];
  allModels: ProviderModelMatchCandidate[];
  pendingModelId: string | null;
  feedback: ProviderModelMatchFeedback | null;
  onClose: () => void;
  onSelect: (candidate: ProviderModelMatchCandidate) => void;
  onCreate: () => void;
}

/** 完全匹配失败后的已有模型选择器；候选永不自动绑定。 */
export default function ProviderModelMatchDialog({
  open,
  upstreamModelName,
  candidates,
  allModels,
  pendingModelId,
  feedback,
  onClose,
  onSelect,
  onCreate,
}: ProviderModelMatchDialogProps) {
  const t = useTranslations("providers");
  const [manualSelectOpen, setManualSelectOpen] = useState(false);
  const visibleCandidates = manualSelectOpen ? allModels : candidates;
  const feedbackText = feedback
    ? t(
        feedback.status === "created"
          ? "modelRouteCreatedDetail"
          : feedback.status === "exists"
            ? "modelRouteExistsDetail"
            : "modelRouteFailedDetail",
        { name: feedback.modelName },
      )
    : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("modelMatchTitle")}
      dialogClassName="m-auto w-[min(560px,92vw)] rounded-lg border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/40   "
    >
      <div className="space-y-4">
        <p className="text-ui-body leading-6 text-neutral-600 ">
          {t("modelMatchDescription", { name: upstreamModelName })}
        </p>

        {visibleCandidates.length > 0 ? (
          <div className="max-h-72 overflow-y-auto rounded-md border border-morning-mist  divide-y divide-neutral-200 ">
            {visibleCandidates.map((candidate) => {
              const pending = pendingModelId === candidate.id;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  disabled={pendingModelId !== null}
                  onClick={() => onSelect(candidate)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sora-blue disabled:cursor-not-allowed disabled:opacity-60 "
                >
                  <GitBranchPlus className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-ui-caption font-semibold text-neutral-800 ">
                      {candidate.name}
                    </span>
                    <span className="block truncate text-ui-caption text-neutral-500 ">
                      {candidate.displayName && candidate.displayName !== candidate.name
                        ? `${candidate.displayName} · ${candidate.catalogName}`
                        : candidate.catalogName}
                    </span>
                  </span>
                  {pending ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sora-blue" aria-hidden="true" />
                  ) : candidate.routeExists ? (
                    <span className="shrink-0 text-ui-caption font-medium text-emerald-700 ">
                      {t("modelRouteExists")}
                    </span>
                  ) : (
                    <span className="shrink-0 text-ui-caption text-neutral-500 ">
                      {t("modelRouteCanAdd")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="rounded-md bg-neutral-50 px-3 py-2.5 text-ui-body text-neutral-600  ">
            {t("modelMatchEmpty")}
          </p>
        )}

        {feedbackText && (
          <div
            role="status"
            className={`flex items-start gap-2 rounded-md px-3 py-2.5 text-ui-body ${
              feedback?.status === "error"
                ? "bg-red-50 text-red-700  "
                : "bg-emerald-50 text-emerald-700  "
            }`}
          >
            {feedback?.status === "error" ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>{feedbackText}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => setManualSelectOpen(true)}
            disabled={pendingModelId !== null || manualSelectOpen}
          >
            <List className="h-4 w-4" aria-hidden="true" />
            {t("modelMatchManualSelect")}
          </Button>
          <Button variant="primary" onClick={onCreate} disabled={pendingModelId !== null}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("modelMatchCreate")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
