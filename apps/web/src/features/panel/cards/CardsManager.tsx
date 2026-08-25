"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus, Pencil, Trash2, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import Modal from "@/shared/ui/Modal";
import Input from "@/shared/ui/Input";
import UnsavedChangesDialog, { useUnsavedChanges } from "@/shared/ui/UnsavedChangesDialog";
import {
  listMyCards,
  createMyCard,
  updateMyCard,
  deleteMyCard,
} from "@/features/panel/cards/actions";
import type { InstructionCard } from "@/lib/instruction-cards/service";

/**
 * 指令卡管理器 —— /panel/cards 的主组件。
 *
 * 功能:
 *   - 列出当前用户的卡
 *   - 新建卡(trigger/title/markdown)
 *   - 编辑/删除自己的卡
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

  return (
    <div className="rounded-lg border border-morning-mist bg-white p-4 transition-colors hover:border-neutral-300">
      <div className="min-w-0">
        <h3 className="truncate text-ui-body font-semibold text-neutral-800">{card.title}</h3>
        <code className="mt-1.5 inline-flex max-w-full truncate rounded-md bg-nebula-silver px-2 py-1 font-mono text-ui-caption text-ink-secondary">
          /{card.trigger}
        </code>
      </div>
      {card.description && (
        <p className="mt-3 line-clamp-2 text-ui-caption text-ink-secondary">{card.description}</p>
      )}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-morning-mist pt-3">
        <span className="text-ui-caption text-ink-tertiary">{t("useCount", { count: card.useCount })}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onEdit} className="touch-target inline-flex items-center justify-center rounded-md p-1 text-neutral-500 transition-colors hover:bg-nebula-silver hover:text-neutral-700" title={t("editButton")} aria-label={t("editButton")}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" onClick={onDelete} className="touch-target inline-flex items-center justify-center rounded-md p-1 text-neutral-500 transition-colors hover:bg-nebula-silver hover:text-danger" title={t("deleteButton")} aria-label={t("deleteButton")}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 编辑/新建弹窗。 */
function CardEditor({
  title,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  initial?: InstructionCard;
  onClose: () => void;
  onSave: (
    input: {
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("panel.cards");
  const tc = useTranslations("common");
  const { contentRef, requestClose, dialogProps } = useUnsavedChanges<HTMLDivElement>(onClose);

  const handleSave = async () => {
    setError(null);
    if (!trigger.trim() || !cardTitle.trim() || !markdown.trim()) {
      setError(t("fieldsRequired"));
      return;
    }
    setSaving(true);
    try {
      await onSave({ trigger: trigger.trim(), title: cardTitle.trim(), description, markdown });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal open onClose={requestClose} title={title} dialogClassName="m-auto w-[min(640px,92vw)] rounded-lg border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/40   " bodyClassName="p-0">
      <div ref={contentRef} className="p-5 space-y-3 max-h-[80vh] overflow-y-auto">
        <div>
          <label className="text-ui-caption font-semibold text-neutral-600  mb-1 block">
            {t("trigger")}
          </label>
          <Input value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder={t("triggerPlaceholder")} />
        </div>
        <div>
          <label className="text-ui-caption font-semibold text-neutral-600  mb-1 block">
            {t("cardTitle")}
          </label>
          <Input value={cardTitle} onChange={(e) => setCardTitle(e.target.value)} placeholder={t("titlePlaceholder")} />
        </div>
        <div>
          <label className="text-ui-caption font-semibold text-neutral-600  mb-1 block">
            {tc("description")}
          </label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("descPlaceholder")} />
        </div>
        <div>
          <label className="text-ui-caption font-semibold text-neutral-600  mb-1 block">
            {t("content")}
          </label>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            rows={10}
            className="w-full rounded-md border border-neutral-200  bg-white  px-3 py-2 text-ui-caption font-mono resize-y"
            placeholder={t("contentPlaceholder")}
          />
          <div className="text-ui-caption text-neutral-400 mt-0.5 text-right">{markdown.length} / 10000</div>
        </div>
        {error && <p className="text-ui-caption text-danger">{error}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-200 ">
        <Button variant="ghost" onClick={requestClose}>{tc("cancel")}</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {tc("save")}
        </Button>
      </div>
      </Modal>
      <UnsavedChangesDialog {...dialogProps} />
    </>
  );
}
