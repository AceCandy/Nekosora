"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus, Pencil, Trash2, Loader2, Sparkles } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/shared/ui/Button";
import Modal from "@/shared/ui/Modal";
import Input from "@/shared/ui/Input";
import {
  listMyCards,
  createMyCard,
  updateMyCard,
  deleteMyCard,
} from "@/features/panel/cards/actions";
import type { InstructionCard, CardScope } from "@/lib/instruction-cards/service";

/**
 * 指令卡管理器 —— /panel/cards 的主组件。
 *
 * 功能:
 *   - 列出可见卡(builtin 只读 + 自己的 private/shared 可编辑)
 *   - 新建卡(trigger/title/markdown/scope)
 *   - 编辑/删除自己的卡
 *
 * builtin 卡来自管理员配置,普通用户只读可见。
 */
export default function CardsManager({ initialCards }: { initialCards: InstructionCard[] }) {
  const t = useTranslations("panel.cards");
  const [cards, setCards] = useState(initialCards);
  const [editing, setEditing] = useState<InstructionCard | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();

  const refresh = () => {
    startTransition(async () => {
      setCards(await listMyCards());
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)} disabled={pending}>
          <Plus className="w-4 h-4 mr-1" />
          {t("create")}
        </Button>
      </div>

      {cards.length === 0 ? (
        <div className="text-center py-16 text-neutral-400">
          <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-ui-body">{t("empty")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              onEdit={() => setEditing(card)}
              onDelete={async () => {
                if (!confirm(t("deleteConfirm", { title: card.title }))) return;
                await deleteMyCard(card.id);
                refresh();
              }}
            />
          ))}
        </div>
      )}

      {creating && (
        <CardEditor
          title={t("create")}
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            await createMyCard(input);
            setCreating(false);
            refresh();
          }}
        />
      )}

      {editing && (
        <CardEditor
          title={t("edit")}
          initial={editing}
          readOnly={editing.scope === "builtin"}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await updateMyCard(editing.id, patch);
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** 单张指令卡卡片。 */
function CardItem({
  card,
  onEdit,
  onDelete,
}: {
  card: InstructionCard;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("panel.cards");
  const scopeLabelKey: Record<CardScope, string> = {
    builtin: "scopeBuiltin",
    shared: "scopeShared",
    private: "scopePrivate",
  };
  const scopeStyle: Record<CardScope, string> = {
    builtin: "bg-neutral-100 dark:bg-neutral-800 text-neutral-500",
    shared: "bg-sora-blue/[0.04] text-sora-blue",
    private: "bg-neku-amber/[0.04] text-neku-amber",
  };
  const isMine = card.scope !== "builtin";

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-ui-body font-semibold text-neutral-800 dark:text-neutral-200 truncate">
              {card.title}
            </h3>
            <span className={clsx("text-ui-caption px-1.5 py-0.5 rounded font-medium", scopeStyle[card.scope])}>
              {t(scopeLabelKey[card.scope])}
            </span>
          </div>
          <code className="text-ui-caption text-neutral-400 font-mono">/{card.trigger}</code>
        </div>
        {isMine && (
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={onEdit} className="touch-target inline-flex items-center justify-center p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300" title={t("editButton")} aria-label={t("editButton")}>
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button type="button" onClick={onDelete} className="touch-target inline-flex items-center justify-center p-1 text-neutral-400 hover:text-red-500" title={t("deleteButton")} aria-label={t("deleteButton")}>
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {card.description && (
        <p className="text-ui-caption text-neutral-500 mb-2 line-clamp-2">{card.description}</p>
      )}
      <pre className="text-ui-caption text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900/50 rounded p-2 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono">
        {card.markdown.slice(0, 200)}
        {card.markdown.length > 200 && "\n…"}
      </pre>
      <div className="mt-2 text-ui-caption text-neutral-400">
        {t("useCount", { count: card.useCount })}
      </div>
    </div>
  );
}

/** 编辑/新建弹窗。 */
function CardEditor({
  title,
  initial,
  readOnly,
  onClose,
  onSave,
}: {
  title: string;
  initial?: InstructionCard;
  readOnly?: boolean;
  onClose: () => void;
  onSave: (
    input: {
      scope: Exclude<CardScope, "builtin">;
      trigger: string;
      title: string;
      description?: string;
      markdown: string;
    },
  ) => Promise<void>;
}) {
  const [trigger, setTrigger] = useState(initial?.trigger ?? "");
  const [cardTitle, setCardTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [markdown, setMarkdown] = useState(initial?.markdown ?? "");
  const [scope, setScope] = useState<Exclude<CardScope, "builtin">>(
    (initial?.scope as Exclude<CardScope, "builtin">) ?? "private",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("panel.cards");
  const tc = useTranslations("common");

  const handleSave = async () => {
    setError(null);
    if (!trigger.trim() || !cardTitle.trim() || !markdown.trim()) {
      setError(t("fieldsRequired"));
      return;
    }
    setSaving(true);
    try {
      await onSave({ scope, trigger: trigger.trim(), title: cardTitle.trim(), description, markdown });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={title} dialogClassName="m-auto w-[min(640px,92vw)] rounded-lg border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/40 dark:border-deep-space dark:bg-twilight-obsidian dark:text-nebula-silver" bodyClassName="p-0">
      <div className="p-5 space-y-3 max-h-[80vh] overflow-y-auto">
        {readOnly && (
          <p className="text-ui-caption text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded p-2">
            {t("builtinReadonly")}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-ui-caption font-semibold text-neutral-600 dark:text-neutral-400 mb-1 block">
              {t("trigger")}
            </label>
            <Input value={trigger} onChange={(e) => setTrigger(e.target.value)} disabled={readOnly} placeholder={t("triggerPlaceholder")} />
          </div>
          <div>
            <label className="text-ui-caption font-semibold text-neutral-600 dark:text-neutral-400 mb-1 block">
              {t("scope")}
            </label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Exclude<CardScope, "builtin">)}
              disabled={readOnly}
              className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2 text-ui-body disabled:opacity-50"
            >
              <option value="private">{t("scopePrivate")}</option>
              <option value="shared">{t("scopeShared")}</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-ui-caption font-semibold text-neutral-600 dark:text-neutral-400 mb-1 block">
            {t("cardTitle")}
          </label>
          <Input value={cardTitle} onChange={(e) => setCardTitle(e.target.value)} disabled={readOnly} placeholder={t("titlePlaceholder")} />
        </div>
        <div>
          <label className="text-ui-caption font-semibold text-neutral-600 dark:text-neutral-400 mb-1 block">
            {t("description")}
          </label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} placeholder={t("descPlaceholder")} />
        </div>
        <div>
          <label className="text-ui-caption font-semibold text-neutral-600 dark:text-neutral-400 mb-1 block">
            {t("content")}
          </label>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            disabled={readOnly}
            rows={10}
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2 text-ui-caption font-mono resize-y disabled:opacity-50"
            placeholder={t("contentPlaceholder")}
          />
          <div className="text-ui-caption text-neutral-400 mt-0.5 text-right">{markdown.length} / 10000</div>
        </div>
        {error && <p className="text-ui-caption text-red-500">{error}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-200 dark:border-neutral-800">
        <Button variant="ghost" onClick={onClose}>{tc("cancel")}</Button>
        <Button onClick={handleSave} disabled={saving || readOnly}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {tc("save")}
        </Button>
      </div>
    </Modal>
  );
}
