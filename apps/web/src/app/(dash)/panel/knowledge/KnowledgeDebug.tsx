"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Button } from "@/shared/ui/Button";

interface Chunk {
  fileId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

/** 检索调试:输入 query,在用户全部知识库下查看召回块。 */
export default function KnowledgeDebug({ kbIds }: { kbIds: string[] }) {
  const t = useTranslations("panel.knowledge");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [status, setStatus] = useState<string>("");

  const handleSearch = async () => {
    if (!query.trim() || kbIds.length === 0) return;
    setLoading(true);
    setChunks([]);
    try {
      const res = await fetch("/api/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), kbIds }),
      });
      const data = await res.json();
      setChunks(data.chunks ?? []);
      setStatus(data.status ?? "");
    } catch {
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  if (kbIds.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="text-ui-caption font-semibold text-neutral-400">{t("debugTitle")}</div>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder={t("debugPlaceholder")}
          className="flex-1 rounded-md border border-neutral-200  bg-transparent px-3 py-2 text-ui-body focus:outline-none focus:border-sora-blue"
        />
        <Button
          variant="primary"
          loading={loading}
          disabled={!query.trim()}
          onClick={handleSearch}
          className="px-4 py-2 font-semibold"
        >
          <Search className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t("search")}</span>
        </Button>
      </div>

      {status && (
        <div className="text-ui-caption text-neutral-400 font-mono">
          {t("debugStatus")}: {status} · {chunks.length} {t("chunks")}
        </div>
      )}

      <div className="space-y-2">
        {chunks.map((c, i) => (
          <div key={i} className="rounded-md border border-neutral-200  bg-white  p-3">
            <div className="flex items-center justify-between text-ui-caption text-neutral-400 mb-1.5 font-mono">
              <span className="truncate">{c.filename} #{c.chunkIndex}</span>
              <span className="text-sora-blue shrink-0 ml-2">{(c.similarity * 100).toFixed(0)}%</span>
            </div>
            <p className="text-ui-caption text-neutral-600  line-clamp-4">{c.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
