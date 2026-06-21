"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import Input from "@/shared/ui/Input";
import { Button } from "@/shared/ui/Button";

export interface EditorRow {
  key: string;
  weight: string;
}

interface KeyBundleEditorProps {
  requireKeys?: boolean;
  initialRows?: EditorRow[];
}

export default function KeyBundleEditor({
  requireKeys = true,
  initialRows,
}: KeyBundleEditorProps) {
  const t = useTranslations("providers");
  const [rows, setRows] = useState<EditorRow[]>(
    initialRows && initialRows.length > 0
      ? initialRows
      : [{ key: "", weight: "1" }]
  );
  const [revealed, setRevealed] = useState<boolean[]>(
    () => rows.map(() => false)
  );

  const addRow = () => {
    setRows((r) => [...r, { key: "", weight: "1" }]);
    setRevealed((v) => [...v, false]);
  };
  const removeRow = (i: number) => {
    setRows((r) => (r.length <= 1 ? r : r.filter((_, idx) => idx !== i)));
    setRevealed((v) => (v.length <= 1 ? v : v.filter((_, idx) => idx !== i)));
  };
  const update = (i: number, field: "key" | "weight", val: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: val } : row)));
  const toggleReveal = (i: number) =>
    setRevealed((v) => v.map((on, idx) => (idx === i ? !on : on)));

  return (
    <div className="mt-1 space-y-2.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2 animate-in fade-in duration-150">
          <div className="relative flex-1">
            <Input
              name="keys[].key"
              type={revealed[i] ? "text" : "password"}
              required={requireKeys}
              value={row.key}
              onChange={(e) => update(i, "key", e.target.value)}
              className="pr-9 font-mono text-xs"
              placeholder={t("keyPlaceholder", { index: i + 1 })}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => toggleReveal(i)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-250 p-0.5 rounded transition-colors"
              aria-label={revealed[i] ? t("hideKeyAria") : t("showKeyAria")}
              title={revealed[i] ? t("hideKey") : t("showKey")}
            >
              {revealed[i] ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("weight")}</span>
            <Input
              name="keys[].weight"
              type="number"
              min={0}
              step={1}
              value={row.weight}
              onChange={(e) => update(i, "weight", e.target.value)}
              className="w-16 font-mono text-xs"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => removeRow(i)}
            className="shrink-0 p-2 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-30 transition-colors"
            disabled={rows.length <= 1}
            aria-label={t("deleteKeyAria")}
            title={t("deleteKeyTitle")}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      ))}
      
      <button
        type="button"
        onClick={addRow}
        className="inline-flex items-center gap-1 text-xs font-semibold text-sora-blue hover:text-sora-blue-hover transition-colors"
      >
        <Plus size={14} />
        <span>{t("addApiKey")}</span>
      </button>

      <p className="text-xs text-neutral-400 dark:text-neutral-500 leading-normal flex items-start gap-1">
        <span className="text-sora-blue shrink-0">※</span>
        <span>
          {requireKeys ? t("keyHintRequired") : t("keyHintEdit")}
        </span>
      </p>
    </div>
  );
}

