"use client";
import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Download, Search } from "lucide-react";
import Modal from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import Input from "@/shared/ui/Input";

/** server action 签名:接收 providerId,返回上游模型列表。 */
export type FetchModelsAction = (providerId: string) => Promise<{ id: string }[]>;

interface UpstreamModelPickerProps {
  /** 拉取列表的 action(由 page bind 好对应域的 list action)。 */
  fetchAction: FetchModelsAction;
  /** 当前选中的 provider id;未选时按钮禁用。 */
  providerId: string;
  /** 选中模型后回填的目标 input ref。 */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** 可选:无搜索词时只显示命中的模型(如 embedding 场景只看含 embed 的);有搜索词时仍从全量搜兜底。 */
  filter?: (m: { id: string }) => boolean;
}

/**
 * 上游模型拉取器 —— 选好 provider 后,从上游 /models 拉取真实模型名,
 * 在弹窗中搜索并点选,回填到 upstreamModelName 输入框,防止手填拼错。
 *
 * 与表单解耦:不接管 input 的 state,只通过 ref 把选中值写回 DOM,
 * 兼容现有基于 defaultValue 的非受控表单提交。
 */
export default function UpstreamModelPicker({
  fetchAction,
  providerId,
  inputRef,
  filter,
}: UpstreamModelPickerProps) {
  const t = useTranslations("models");
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleFetch = () => {
    if (!providerId) return;
    setOpen(true);
    setError(null);
    setModels([]);
    setQuery("");
    startTransition(async () => {
      try {
        const list = await fetchAction(providerId);
        setModels(list);
        // 打开后聚焦搜索框。
        setTimeout(() => searchInputRef.current?.focus(), 50);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const handleSelect = (id: string) => {
    if (inputRef.current) {
      inputRef.current.value = id;
      // 触发 input 事件,兼容依赖 onChange 的逻辑。
      inputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setOpen(false);
  };

  // 无搜索词时按 filter 收窄(如只看 embedding);有搜索词时从全量搜,放开兜底。
  const filtered = query
    ? models.filter((m) => m.id.toLowerCase().includes(query.toLowerCase()))
    : filter
      ? models.filter(filter)
      : models;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={isPending}
        disabled={!providerId}
        onClick={handleFetch}
        className="text-sora-blue hover:text-sora-blue-hover shrink-0"
        title={providerId ? t("fetchModelsTitle") : t("fetchModelsSelectProviderFirst")}
      >
        <Download className="w-3.5 h-3.5" />
        <span>{t("fetchModels")}</span>
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={t("fetchModelsTitle")} dialogClassName="m-auto w-[min(560px,92vw)]">
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("fetchModelsSearchPlaceholder")}
              className="pl-8"
            />
          </div>

          {error ? (
            <div className="text-sm text-red-500 dark:text-red-400 py-6 text-center">
              {t("fetchError")}: {error}
            </div>
          ) : isPending ? (
            <div className="text-sm text-neutral-400 py-6 text-center">{t("fetching")}</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-neutral-400 py-6 text-center">{t("fetchModelsEmpty")}</div>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-md border border-morning-mist dark:border-deep-space divide-y divide-neutral-100 dark:divide-neutral-800/60">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelect(m.id)}
                  className="w-full text-left px-3 py-2 text-xs font-mono hover:bg-neutral-50 dark:hover:bg-neutral-900/40 transition-colors"
                >
                  {m.id}
                </button>
              ))}
            </div>
          )}

          <p className="text-xs text-neutral-400 dark:text-neutral-500 leading-normal">
            {t("fetchModelsHint")}
          </p>
        </div>
      </Modal>
    </>
  );
}
