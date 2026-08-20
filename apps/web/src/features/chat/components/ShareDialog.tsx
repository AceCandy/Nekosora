"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, CircleAlert, Copy, Link2, LockKeyhole, Trash2 } from "lucide-react";
import type {
  ConversationShareListItem,
  CreateShareInput,
} from "@/features/chat/actions/share";
import { copyToClipboard } from "@/shared/lib/clipboard";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import Modal from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Popover } from "@/shared/ui/Popover";

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  canShare: boolean;
  createShareAction: (input: CreateShareInput) => Promise<ConversationShareListItem>;
  listSharesAction: (conversationId: string) => Promise<ConversationShareListItem[]>;
  revokeShareAction: (shareId: string) => Promise<void>;
}

type ExpirationChoice = "1" | "7" | "30" | "forever" | "custom";

interface ShareFormState {
  mode: "snapshot" | "live";
  expiration: ExpirationChoice;
  customExpiration: string;
  passwordEnabled: boolean;
  password: string;
}

function toDateTimeLocalValue(date: Date): string {
  const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

export default function ShareDialog(props: ShareDialogProps) {
  const {
    open,
    onClose,
    conversationId,
    canShare,
    createShareAction,
    listSharesAction,
    revokeShareAction,
  } = props;
  const t = useTranslations("share");
  const [tab, setTab] = useState<"create" | "existing">("create");
  const [mode, setMode] = useState<"snapshot" | "live">("snapshot");
  const [expiration, setExpiration] = useState<ExpirationChoice>("7");
  const [expirationOpen, setExpirationOpen] = useState(false);
  const [customExpiration, setCustomExpiration] = useState("");
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [shares, setShares] = useState<ConversationShareListItem[]>([]);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedForm, setSavedForm] = useState<ShareFormState>({
    mode: "snapshot",
    expiration: "7",
    customExpiration: "",
    passwordEnabled: false,
    password: "",
  });
  const [isPending, startTransition] = useTransition();
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customExpirationRef = useRef<HTMLInputElement>(null);

  const loadShares = useCallback(() => {
    startTransition(async () => {
      try {
        setShares(await listSharesAction(conversationId));
      } catch {
        setError(t("loadFailed"));
      }
    });
  }, [conversationId, listSharesAction, t]);

  useEffect(() => {
    if (!open) return;
    loadShares();
  }, [open, loadShares]);

  useEffect(() => () => {
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
  }, []);

  const expirationInput = useMemo<CreateShareInput["expiration"] | null>(() => {
    if (expiration === "forever") return { kind: "forever" };
    if (expiration === "custom") {
      if (!customExpiration) return null;
      const value = new Date(customExpiration);
      if (Number.isNaN(value.getTime()) || value <= new Date()) return null;
      return { kind: "custom", value: value.toISOString() };
    }
    return { kind: "days", days: Number(expiration) as 1 | 7 | 30 };
  }, [customExpiration, expiration]);

  const canSubmit = canShare && expirationInput && (!passwordEnabled || password.length >= 8);
  const currentForm: ShareFormState = {
    mode,
    expiration,
    customExpiration,
    passwordEnabled,
    password,
  };
  const isDirty = Object.entries(currentForm).some(([key, value]) =>
    savedForm[key as keyof ShareFormState] !== value);
  const customExpirationMin = toDateTimeLocalValue(new Date());
  const expirationLabel = expiration === "custom"
    ? customExpiration
      ? t("deadline", { date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(customExpiration)) })
      : t("chooseDeadline")
    : t(expiration === "1" ? "oneDay" : expiration === "7" ? "sevenDays" : expiration === "30" ? "thirtyDays" : "forever");

  const requestClose = () => {
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const discardChanges = () => {
    setMode(savedForm.mode);
    setExpiration(savedForm.expiration);
    setCustomExpiration(savedForm.customExpiration);
    setPasswordEnabled(savedForm.passwordEnabled);
    setPassword(savedForm.password);
    setExpirationOpen(false);
    setDiscardOpen(false);
    setError(null);
    onClose();
  };

  const selectExpiration = (choice: ExpirationChoice) => {
    setExpiration(choice);
    setExpirationOpen(false);
    setError(null);
    if (choice !== "custom") return;
    const input = customExpirationRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  };

  const updateCustomExpiration = (value: string) => {
    if (!value) {
      setCustomExpiration("");
      return;
    }
    const selected = new Date(value);
    if (Number.isNaN(selected.getTime()) || selected <= new Date()) {
      setCustomExpiration("");
      setError(t("expirationFuture"));
      return;
    }
    setCustomExpiration(value);
    setError(null);
  };

  const create = () => {
    if (!expirationInput || !canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await createShareAction({
          conversationId,
          mode,
          expiration: expirationInput,
          password: passwordEnabled ? password : undefined,
        });
        const url = `${window.location.origin}/share/${result.shareId}`;
        setCreatedUrl(url);
        setShares((current) => [result, ...current]);
        setSavedForm(currentForm);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("createFailed"));
      }
    });
  };

  const copy = async (url: string) => {
    setError(null);
    setFailedUrl(null);
    if (!await copyToClipboard(url)) {
      setFailedUrl(url);
      setError(t("copyFailed"));
      return;
    }
    setCopiedUrl(url);
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopiedUrl(null), 2000);
  };

  const revoke = () => {
    if (!revokeId) return;
    const target = revokeId;
    setRevokeId(null);
    startTransition(async () => {
      try {
        await revokeShareAction(target);
        setShares((current) => current.map((share) =>
          share.shareId === target ? { ...share, status: "revoked" } : share));
      } catch {
        setError(t("revokeFailed"));
      }
    });
  };

  return (
    <>
      <Modal open={open} onClose={requestClose} ariaLabel={t("configureTitle")} dialogClassName="m-auto w-[min(500px,94vw)] max-w-[94vw] max-h-[90vh] rounded-lg border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/40   " bodyClassName="max-h-[90vh] overflow-y-auto p-0">
        <div className="flex border-b border-morning-mist px-4 " role="tablist">
          {(["create", "existing"] as const).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={`h-11 border-b-2 px-3 text-ui-body font-medium ${tab === item ? "border-sora-blue text-sora-blue" : "border-transparent text-neutral-500 hover:text-neutral-800 "}`}>
              {item === "create" ? t("createTab") : t("existingTab", { count: shares.length })}
            </button>
          ))}
        </div>

        {tab === "create" ? (
          <div className="space-y-4 p-4">
            <fieldset className="space-y-2">
              <div className="flex items-center gap-3">
                <legend className="w-20 shrink-0 text-ui-body font-medium">{t("mode")}</legend>
                <div className="grid min-w-0 flex-1 grid-cols-2 rounded-lg bg-neutral-100 p-1 ">
                {(["snapshot", "live"] as const).map((item) => (
                  <button key={item} type="button" onClick={() => setMode(item)} className={`h-9 rounded-md text-ui-body font-medium transition-colors ${mode === item ? "bg-white text-space-ink  " : "text-neutral-500"}`}>
                    {t(item)}
                  </button>
                ))}
                </div>
              </div>
              {mode === "live" && <p className="text-ui-caption leading-5 text-amber-700 ">{t("liveWarning")}</p>}
            </fieldset>

            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-ui-body font-medium">{t("expiration")}</span>
              <Popover
                open={expirationOpen}
                onClose={() => setExpirationOpen(false)}
                portal={false}
                align="right"
                panelClassName="w-52"
                panelZ="z-50"
                trigger={(
                  <>
                    <button type="button" onClick={() => setExpirationOpen((value) => !value)} aria-expanded={expirationOpen} className="flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-morning-mist bg-white px-3 text-ui-body font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue  ">
                      <span className="truncate">{expirationLabel}</span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400" />
                    </button>
                    <input ref={customExpirationRef} type="datetime-local" tabIndex={-1} value={customExpiration} min={customExpirationMin} onChange={(event) => updateCustomExpiration(event.target.value)} aria-hidden="true" className="pointer-events-none absolute bottom-0 left-1/2 h-px w-px opacity-0" />
                  </>
                )}
              >
                {(["1", "7", "30", "forever", "custom"] as const).map((choice) => (
                  <button key={choice} type="button" onClick={() => selectExpiration(choice)} className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-ui-body transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue  ${expiration === choice ? "text-sora-blue" : "text-neutral-700 "}`}>
                    <span className="w-4 shrink-0" aria-hidden="true">{expiration === choice ? "✓" : ""}</span>
                    {t(choice === "1" ? "oneDay" : choice === "7" ? "sevenDays" : choice === "30" ? "thirtyDays" : choice === "forever" ? "forever" : "custom")}
                  </button>
                ))}
              </Popover>
            </div>

            <div className="flex min-h-10 items-center gap-3">
              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-ui-body font-medium"><input type="checkbox" checked={passwordEnabled} onChange={(event) => { setPasswordEnabled(event.target.checked); if (!event.target.checked) setPassword(""); }} className="h-4 w-4 accent-sora-blue" />{t("passwordProtection")}</label>
              {passwordEnabled && <input type="password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("passwordPlaceholder")} autoComplete="new-password" className="h-10 min-w-0 flex-1 rounded-lg border border-morning-mist bg-white px-3 text-ui-body placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue  " />}
            </div>

            {createdUrl && <div className="flex items-center gap-2 rounded-lg bg-neutral-50 p-2 "><input readOnly value={createdUrl} aria-label={t("shareLink")} className="min-w-0 flex-1 bg-transparent px-2 text-ui-caption" /><button type="button" onClick={() => void copy(createdUrl)} className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-neutral-200 " aria-label={copiedUrl === createdUrl ? t("copied") : failedUrl === createdUrl ? t("copyFailed") : t("copyLink")} title={copiedUrl === createdUrl ? t("copied") : failedUrl === createdUrl ? t("copyFailed") : t("copyLink")}>{copiedUrl === createdUrl ? <Check className="h-4 w-4 text-success" /> : failedUrl === createdUrl ? <CircleAlert className="h-4 w-4 text-danger " /> : <Copy className="h-4 w-4" />}</button></div>}
            {error && <p role="alert" className="text-ui-caption text-danger ">{error}</p>}
            <div className="flex justify-end gap-2"><button type="button" onClick={requestClose} className="h-10 rounded-md px-4 text-ui-body font-medium text-neutral-600 hover:bg-neutral-100  ">{t("cancel")}</button><Button variant="primary" loading={isPending} disabled={!canSubmit} onClick={create} className="h-10">{!isPending && <Link2 className="h-4 w-4" aria-hidden="true" />}{t("createLink")}</Button></div>
          </div>
        ) : (
          <div className="p-4">
            {shares.length === 0 ? (
              <p className="py-8 text-center text-ui-body text-neutral-500">{t("noShares")}</p>
            ) : (
              <div className="divide-y divide-morning-mist ">
                {shares.map((share) => {
                  const sharePath = `/share/${share.shareId}`;
                  const copied = copiedUrl?.endsWith(sharePath) ?? false;
                  const failed = failedUrl?.endsWith(sharePath) ?? false;
                  return (
                    <div key={share.shareId} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-ui-body font-medium">
                          <span>{t(share.mode === "live" ? "live" : "snapshot")}</span>
                          {share.hasPassword && <LockKeyhole className="h-3.5 w-3.5 text-neutral-400" />}
                          <span className={`text-ui-caption ${share.status === "active" ? "text-success " : "text-neutral-400"}`}>{t(share.status)}</span>
                        </div>
                        <p className="mt-1 text-ui-caption text-neutral-500">
                          {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(share.createdAt))} · {share.expiresAt ? t("expiresOn", { date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(share.expiresAt)) }) : t("forever")}
                        </p>
                      </div>
                      <button type="button" onClick={() => void copy(`${window.location.origin}${sharePath}`)} className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 " aria-label={copied ? t("copied") : failed ? t("copyFailed") : t("copyLink")} title={copied ? t("copied") : failed ? t("copyFailed") : t("copyLink")}>
                        {copied ? <Check className="h-4 w-4 text-success" /> : failed ? <CircleAlert className="h-4 w-4 text-danger " /> : <Copy className="h-4 w-4" />}
                      </button>
                      {share.status === "active" && <button type="button" onClick={() => setRevokeId(share.shareId)} className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-500 hover:bg-red-50 hover:text-danger-hover " aria-label={t("revoke")}><Trash2 className="h-4 w-4" /></button>}
                    </div>
                  );
                })}
              </div>
            )}
            {error && <p role="alert" className="mt-3 text-ui-caption text-danger ">{error}</p>}
          </div>
        )}
      </Modal>
      <ConfirmDialog open={Boolean(revokeId)} onClose={() => setRevokeId(null)} onConfirm={revoke} title={t("revokeTitle")} message={t("revokeMessage")} confirmLabel={t("revoke")} cancelLabel={t("cancel")} />
      <ConfirmDialog open={discardOpen} onClose={() => setDiscardOpen(false)} onConfirm={discardChanges} title={t("discardTitle")} message={t("discardMessage")} confirmLabel={t("discardConfirm")} cancelLabel={t("continueEditing")} />
    </>
  );
}
