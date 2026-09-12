"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Select } from "@/shared/ui/Select";
import Modal from "@/shared/ui/Modal";
import UnsavedChangesDialog, { useUnsavedChanges } from "@/shared/ui/UnsavedChangesDialog";

interface MemoryAddDialogProps {
  action: (formData: FormData) => Promise<void>;
}

/** 手动添加长期记忆，保存成功后关闭，失败时保留输入。 */
export default function MemoryAddDialog({ action }: MemoryAddDialogProps) {
  const t = useTranslations("panel.memory");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { contentRef, requestClose, dialogProps } = useUnsavedChanges<HTMLFormElement>(() => setOpen(false));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!String(data.get("content") ?? "").trim()) return;
    setSaving(true);
    setError(null);
    try {
      await action(data);
      setOpen(false);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="primary" size="sm" className="font-semibold" onClick={() => { setError(null); setOpen(true); }}>
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{t("addBtn")}</span>
      </Button>
      <Modal open={open} onClose={saving ? () => {} : requestClose} title={t("addTitle")} bodyClassName="max-h-[80vh] overflow-y-auto px-5 py-4">
        <form ref={contentRef} onSubmit={handleSubmit} className="space-y-4">
          <fieldset disabled={saving} className="space-y-4">
            <label className="block space-y-1">
              <span className="block text-ui-caption font-semibold text-ink-secondary">{t("scopeLabel")}</span>
              <Select name="scope" className="w-full">
                <option value="preference">{t("scopePreferenceOpt")}</option>
                <option value="profile">{t("scopeProfileOpt")}</option>
                <option value="project">{t("scopeProjectOpt")}</option>
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="block text-ui-caption font-semibold text-ink-secondary">{t("contentLabel")}</span>
              <textarea name="content" required placeholder={t("contentPlaceholder")} rows={4} className="w-full rounded-md border border-morning-mist bg-white px-3.5 py-2 text-ui-body text-space-ink focus:outline-none focus:border-sora-blue focus-visible:ring-2 focus-visible:ring-sora-blue resize-y" />
            </label>
          </fieldset>
          <div className="rounded p-3 bg-neutral-50 text-ui-caption text-ink-secondary leading-normal space-y-1">
            <p className="font-semibold">{t("guideTitle")}</p>
            <p>{t("guide1")}</p>
            <p>{t("guide2")}</p>
            <p>{t("guide3")}</p>
          </div>
          {error && <p role="alert" className="text-ui-body text-danger">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-morning-mist pt-3">
            <Button size="sm" onClick={requestClose} disabled={saving}>{tc("cancel")}</Button>
            <Button type="submit" variant="primary" size="sm" loading={saving}>{t("addBtn")}</Button>
          </div>
        </form>
      </Modal>
      <UnsavedChangesDialog {...dialogProps} />
    </>
  );
}
