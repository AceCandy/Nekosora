"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { ImageIcon, Sparkles, Download } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/shared/ui/Button";

interface ImageModel {
  /** 模型 id(选项唯一标识,WebChat byId 路由解析,避免 public/private 同名歧义)。 */
  modelId: string;
  name: string;
  displayName?: string;
}

interface ImageJob {
  id: string;
  model: string;
  prompt: string;
  n: number;
  size: string | null;
  status: "pending" | "done" | "failed";
  resultUrls: string[] | null;
  error: string | null;
  createdAt: string;
}

const SIZES = ["1024x1024", "1792x1024", "1024x1792"] as const;

export default function ImageStudio({ models }: { models: ImageModel[] }) {
  const t = useTranslations("image");
  // model 状态持有 modelId(配合 byId 路由解析);modelName 反查用于 image_jobs 记录。
  const [model, setModel] = useState(models[0]?.modelId ?? "");
  const selectedModel = models.find((item) => item.modelId === model) ?? models[0];
  const [prompt, setPrompt] = useState("");
  const [n, setN] = useState(1);
  const [size, setSize] = useState<string>("1024x1024");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUrls, setCurrentUrls] = useState<string[]>([]);
  const [history, setHistory] = useState<ImageJob[]>([]);
  const historyRequestRef = useRef<AbortController | null>(null);

  const loadHistory = useCallback(async () => {
    historyRequestRef.current?.abort();
    const controller = new AbortController();
    historyRequestRef.current = controller;
    try {
      const res = await fetch("/api/images", { signal: controller.signal });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: ImageJob[] };
      if (historyRequestRef.current === controller) {
        setHistory(data.jobs);
      }
    } catch {
      /* ignore */
    } finally {
      if (historyRequestRef.current === controller) historyRequestRef.current = null;
    }
  }, []);

  // 首次挂载加载历史
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHistory();
    return () => {
      historyRequestRef.current?.abort();
    };
  }, [loadHistory]);

  const handleGenerate = async () => {
    if (!prompt.trim() || !selectedModel || generating) return;
    setGenerating(true);
    setError(null);
    setCurrentUrls([]);
    try {
      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel.name,
          modelId: selectedModel.modelId,
          prompt: prompt.trim(),
          n,
          size,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成失败");
      setCurrentUrls(data.urls ?? []);
      void loadHistory(); // 刷新历史
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  if (models.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-tertiary p-8">
        <div className="text-center space-y-2 max-w-sm">
          <ImageIcon className="w-8 h-8 mx-auto text-neutral-300 " aria-hidden="true" />
          <p className="text-ui-caption leading-relaxed">{t("noModels")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full">
      {/* 左侧:控制区 */}
      <div className="lg:w-80 shrink-0 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-ui-caption font-semibold text-neutral-600 ">{t("model")}</span>
          <select
            value={selectedModel?.modelId ?? ""}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-md border border-morning-mist  bg-white  px-3 py-2 text-ui-body text-neutral-700  focus:outline-none focus:border-sora-blue cursor-pointer"
          >
            {models.map((m) => (
              <option key={m.modelId} value={m.modelId}>
                {m.displayName ?? m.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-ui-caption font-semibold text-neutral-600 ">{t("prompt")}</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("promptPlaceholder")}
            rows={5}
            className="w-full rounded-md border border-morning-mist  bg-white  px-3 py-2 text-ui-body text-neutral-700  focus:outline-none focus:border-sora-blue resize-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-ui-caption font-semibold text-neutral-600 ">{t("count")}</span>
            <select
              value={n}
              onChange={(e) => setN(Number(e.target.value))}
              className="w-full rounded-md border border-morning-mist  bg-white  px-3 py-2 text-ui-body text-neutral-700  focus:outline-none focus:border-sora-blue cursor-pointer"
            >
              {[1, 2, 3, 4].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-ui-caption font-semibold text-neutral-600 ">{t("size")}</span>
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-full rounded-md border border-morning-mist  bg-white  px-3 py-2 text-ui-body text-neutral-700  focus:outline-none focus:border-sora-blue cursor-pointer"
            >
              {SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>

        <Button
          variant="primary"
          loading={generating}
          disabled={!prompt.trim()}
          onClick={handleGenerate}
          className="w-full px-4 py-2.5 font-semibold"
        >
          <Sparkles className="w-4 h-4" aria-hidden="true" />
          <span>{t("generate")}</span>
        </Button>

        {error && <p className="text-ui-caption text-danger">{error}</p>}
      </div>

      {/* 右侧:结果 + 历史 */}
      <div className="flex-1 min-w-0 space-y-6 overflow-y-auto">
        {/* 当前结果 */}
        {currentUrls.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-ui-caption font-semibold text-neutral-500 ">{t("currentResult")}</h3>
            <div className="grid grid-cols-2 gap-3">
              {currentUrls.map((url, i) => (
                <div key={i} className="relative group rounded-lg overflow-hidden border border-morning-mist  bg-neutral-50 ">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`生成结果 ${i + 1}`} className="w-full h-auto" loading="lazy" decoding="async" />
                  <a
                    href={url}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute top-2 right-2 p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity"
                    aria-label={t("download")}
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 历史 */}
        <div className="space-y-3">
          <h3 className="text-ui-caption font-semibold text-neutral-500 ">{t("history")}</h3>
          {history.length === 0 ? (
            <p className="text-ui-caption text-ink-tertiary py-8 text-center">{t("emptyHistory")}</p>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
              {history
                .filter((j) => j.status === "done" && j.resultUrls && j.resultUrls.length > 0)
                .flatMap((j) => (j.resultUrls ?? []).map((url, i) => ({ url, prompt: j.prompt, key: `${j.id}-${i}` })))
                .map((item) => (
                  <div key={item.key} className="group relative aspect-square rounded-lg overflow-hidden border border-morning-mist  bg-neutral-50  cursor-pointer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt={item.prompt} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    <div className={clsx("absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2")}>
                      <p className="text-ui-caption text-white line-clamp-3">{item.prompt}</p>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
