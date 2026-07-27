"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Link2, Loader2, LockKeyhole, Trash2 } from "lucide-react";
import type {
  ConversationShareListItem,
  CreateShareInput,
} from "@/features/chat/actions/share";
import type { RenderStyleOption } from "@/features/chat/model/types";
import { copyToClipboard } from "@/shared/lib/clipboard";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import Modal from "@/shared/ui/Modal";

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  canShare: boolean;
  renderStyles: RenderStyleOption[];
  currentRenderStyleId: string | null;
  createShareAction: (input: CreateShareInput) => Promise<ConversationShareListItem>;
  listSharesAction: (conversationId: string) => Promise<ConversationShareListItem[]>;
  revokeShareAction: (shareId: string) => Promise<void>;
}

type ExpirationChoice = "1" | "7" | "30" | "forever" | "custom";

export default function ShareDialog(props: ShareDialogProps) {
  const {
    open,
    onClose,
    conversationId,
    canShare,
    renderStyles,
    currentRenderStyleId,
    createShareAction,
    listSharesAction,
    revokeShareAction,
  } = props;
  const t = useTranslations("share");
  const [tab, setTab] = useState<"create" | "existing">("create");
  const [mode, setMode] = useState<"snapshot" | "live">("snapshot");
  const [expiration, setExpiration] = useState<ExpirationChoice>("7");
  const [customExpiration, setCustomExpiration] = useState("");
  const [renderStyleId, setRenderStyleId] = useState(currentRenderStyleId ?? "");
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [shares, setShares] = useState<ConversationShareListItem[]>([]);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
          renderStyleId: mode === "snapshot" ? (renderStyleId || null) : null,
        });
        const url = `${window.location.origin}/share/${result.shareId}`;
        setCreatedUrl(url);
        setShares((current) => [result, ...current]);
        if (await copyToClipboard(url)) setCopiedId(result.shareId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("createFailed"));
      }
    });
  };

  const copy = async (shareId: string) => {
    if (await copyToClipboard(`${window.location.origin}/share/${shareId}`)) {
      setCopiedId(shareId);
      setTimeout(() => setCopiedId(null), 2000);
    }
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
      <Modal open={open} onClose={onClose} title={t("configureTitle")} dialogClassName="m-auto w-[min(560px,94vw)] max-h-[90vh] rounded-lg border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/40 dark:border-deep-space dark:bg-twilight-obsidian dark:text-nebula-silver" bodyClassName="max-h-[calc(90vh-56px)] overflow-y-auto p-0">
        <div className="flex border-b border-morning-mist px-5 dark:border-deep-space" role="tablist">
          {(["create", "existing"] as const).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={`h-11 border-b-2 px-3 text-ui-body font-medium ${tab === item ? "border-sora-blue text-sora-blue" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"}`}>
              {item === "create" ? t("createTab") : t("existingTab", { count: shares.length })}
            </button>
          ))}
        </div>

        {tab === "create" ? (
          <div className="space-y-5 p-5">
            <fieldset className="space-y-2">
              <legend className="text-ui-body font-medium">{t("mode")}</legend>
              <div className="grid grid-cols-2 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-900">
                {(["snapshot", "live"] as const).map((item) => (
                  <button key={item} type="button" onClick={() => setMode(item)} className={`h-9 rounded-md text-ui-body font-medium transition-colors ${mode === item ? "bg-white text-space-ink dark:bg-neutral-800 dark:text-white" : "text-neutral-500"}`}>
                    {t(item)}
                  </button>
                ))}
              </div>
              {mode === "live" && <p className="text-ui-caption leading-5 text-amber-700 dark:text-amber-300">{t("liveWarning")}</p>}
            </fieldset>

            <label className="block space-y-1.5 text-ui-body font-medium">
              <span>{t("expiration")}</span>
              <select value={expiration} onChange={(event) => setExpiration(event.target.value as ExpirationChoice)} className="h-10 w-full rounded-lg border border-morning-mist bg-white px-3 text-ui-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:border-deep-space dark:bg-neutral-950">
                <option value="1">{t("oneDay")}</option><option value="7">{t("sevenDays")}</option><option value="30">{t("thirtyDays")}</option><option value="forever">{t("forever")}</option><option value="custom">{t("custom")}</option>
              </select>
            </label>
            {expiration === "custom" && <input type="datetime-local" value={customExpiration} onChange={(event) => setCustomExpiration(event.target.value)} className="h-10 w-full rounded-lg border border-morning-mist bg-white px-3 text-ui-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:border-deep-space dark:bg-neutral-950" />}

            <label className="block space-y-1.5 text-ui-body font-medium">
              <span>{t("renderStyle")}</span>
              {mode === "live" ? <div className="flex h-10 items-center rounded-lg border border-morning-mist px-3 text-ui-body text-neutral-500 dark:border-deep-space">{t("followConversation")}</div> : (
                <select value={renderStyleId} onChange={(event) => setRenderStyleId(event.target.value)} className="h-10 w-full rounded-lg border border-morning-mist bg-white px-3 text-ui-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:border-deep-space dark:bg-neutral-950">
                  <option value="">{t("defaultStyle")}</option>
                  {renderStyles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
                </select>
              )}
            </label>

            <div className="space-y-2">
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-ui-body font-medium"><input type="checkbox" checked={passwordEnabled} onChange={(event) => setPasswordEnabled(event.target.checked)} className="h-4 w-4 accent-sora-blue" /><LockKeyhole className="h-4 w-4 text-neutral-400" />{t("passwordProtection")}</label>
              {passwordEnabled && <input type="password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("passwordPlaceholder")} autoComplete="new-password" className="h-10 w-full rounded-lg border border-morning-mist bg-white px-3 text-ui-body placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:border-deep-space dark:bg-neutral-950" />}
            </div>

            {createdUrl && <div className="flex items-center gap-2 rounded-lg bg-neutral-50 p-2 dark:bg-neutral-900"><input readOnly value={createdUrl} className="min-w-0 flex-1 bg-transparent px-2 text-ui-caption" /><button type="button" onClick={() => void copy(createdUrl.split("/").pop()!)} className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label={t("copyLink")}><Copy className="h-4 w-4" /></button></div>}
            {error && <p className="text-ui-caption text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="h-10 rounded-md px-4 text-ui-body font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900">{t("cancel")}</button><button type="button" onClick={create} disabled={!canSubmit || isPending} className="inline-flex h-10 items-center gap-2 rounded-md bg-sora-blue px-4 text-ui-body font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50">{isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}{t("createLink")}</button></div>
          </div>
        ) : (
          <div className="p-5">
            {shares.length === 0 ? <p className="py-10 text-center text-ui-body text-neutral-500">{t("noShares")}</p> : <div className="divide-y divide-morning-mist dark:divide-deep-space">{shares.map((share) => <div key={share.shareId} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-ui-body font-medium"><span>{t(share.mode === "live" ? "live" : "snapshot")}</span>{share.hasPassword && <LockKeyhole className="h-3.5 w-3.5 text-neutral-400" />}<span className={`text-ui-caption ${share.status === "active" ? "text-green-600 dark:text-green-400" : "text-neutral-400"}`}>{t(share.status)}</span></div><p className="mt-1 text-ui-caption text-neutral-500">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(share.createdAt))} · {share.expiresAt ? t("expiresOn", { date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(share.expiresAt)) }) : t("forever")}</p></div><button type="button" onClick={() => void copy(share.shareId)} className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900" aria-label={t("copyLink")}>{copiedId === share.shareId ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}</button>{share.status === "active" && <button type="button" onClick={() => setRevokeId(share.shareId)} className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" aria-label={t("revoke")}><Trash2 className="h-4 w-4" /></button>}</div>)}</div>}
            {error && <p className="mt-3 text-ui-caption text-red-600 dark:text-red-400">{error}</p>}
          </div>
        )}
      </Modal>
      <ConfirmDialog open={Boolean(revokeId)} onClose={() => setRevokeId(null)} onConfirm={revoke} title={t("revokeTitle")} message={t("revokeMessage")} confirmLabel={t("revoke")} cancelLabel={t("cancel")} />
    </>
  );
}
