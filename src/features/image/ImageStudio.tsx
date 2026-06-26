"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { ImageIcon, Loader2, Sparkles, Download } from "lucide-react";
import { clsx } from "clsx";

interface ImageModel {
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
  const [model, setModel] = useState(models[0]?.name ?? "");
  const [prompt, setPrompt] = useState("");
  const [n, setN] = useState(1);
  const [size, setSize] = useState<string>("1024x1024");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUrls, setCurrentUrls] = useState<string[]>([]);
  const [history, setHistory] = useState<ImageJob[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/images");
      if (res.ok) {
        const data = (await res.json()) as { jobs: ImageJob[] };
        setHistory(data.jobs);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // 首次挂载加载历史
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/images");
        if (!cancelled && res.ok) {
          const data = (await res.json()) as { jobs: ImageJob[] };
          setHistory(data.jobs);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim() || !model || generating) return;
    setGenerating(true);
    setError(null);
    setCurrentUrls([]);
    try {
      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: prompt.trim(), n, size }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成失败");
      setCurrentUrls(data.urls ?? []);
      loadHistory(); // 刷新历史
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  if (models.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400 p-8">
        <div className="text-center space-y-2 max-w-sm">
          <ImageIcon className="w-8 h-8 mx-auto text-neutral-300 dark:text-neutral-700" aria-hidden="true" />
          <p className="text-xs leading-relaxed">{t("noModels")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full">
      {/* 左侧:控制区 */}
      <div className="lg:w-80 shrink-0 space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">{t("model")}</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink px-3 py-2 text-sm text-neutral-700 dark:text-neutral-200 focus:outline-none focus:border-sora-blue cursor-pointer"
          >
            {models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.displayName ?? m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">{t("prompt")}</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("promptPlaceholder")}
            rows={5}
            className="w-full rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink px-3 py-2 text-sm text-neutral-700 dark:text-neutral-200 focus:outline-none focus:border-sora-blue resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">{t("count")}</label>
            <select
              value={n}
              onChange={(e) => setN(Number(e.target.value))}
              className="w-full rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink px-3 py-2 text-sm text-neutral-700 dark:text-neutral-200 focus:outline-none focus:border-sora-blue cursor-pointer"
            >
              {[1, 2, 3, 4].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">{t("size")}</label>
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-full rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink px-3 py-2 text-sm text-neutral-700 dark:text-neutral-200 focus:outline-none focus:border-sora-blue cursor-pointer"
            >
              {SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={!prompt.trim() || generating}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-sora-blue hover:bg-sora-blue-hover text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-40 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
        >
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span>{t("generating")}</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              <span>{t("generate")}</span>
            </>
          )}
        </button>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      {/* 右侧:结果 + 历史 */}
      <div className="flex-1 min-w-0 space-y-6 overflow-y-auto">
        {/* 当前结果 */}
        {currentUrls.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">{t("currentResult")}</h3>
            <div className="grid grid-cols-2 gap-3">
              {currentUrls.map((url, i) => (
                <div key={i} className="relative group rounded-lg overflow-hidden border border-morning-mist dark:border-deep-space bg-neutral-50 dark:bg-neutral-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`生成结果 ${i + 1}`} className="w-full h-auto" />
                  <a
                    href={url}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute top-2 right-2 p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
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
          <h3 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">{t("history")}</h3>
          {history.length === 0 ? (
            <p className="text-xs text-neutral-400 py-8 text-center">{t("emptyHistory")}</p>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
              {history
                .filter((j) => j.status === "done" && j.resultUrls && j.resultUrls.length > 0)
                .flatMap((j) => (j.resultUrls ?? []).map((url, i) => ({ url, prompt: j.prompt, key: `${j.id}-${i}` })))
                .map((item) => (
                  <div key={item.key} className="group relative aspect-square rounded-lg overflow-hidden border border-morning-mist dark:border-deep-space bg-neutral-50 dark:bg-neutral-900 cursor-pointer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt={item.prompt} className="w-full h-full object-cover" />
                    <div className={clsx("absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2")}>
                      <p className="text-[10px] text-white line-clamp-3">{item.prompt}</p>
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
