"use client";
import { useMemo, useState } from "react";
import type { ModelCapabilities } from "@/db/types";
import { ChevronRight, ChevronDown } from "lucide-react";

const CAP_DEFS: { key: keyof ModelCapabilities; label: string; hint: string }[] = [
  { key: "stream", label: "流式 (Stream)", hint: "支持 SSE 增量输出" },
  { key: "tools", label: "工具调用 (Tools)", hint: "支持 function calling" },
  { key: "vision", label: "视觉 (Vision)", hint: "支持图片多模态输入" },
  { key: "systemPrompt", label: "系统提示词 (System)", hint: "支持预设 system role" },
  { key: "reasoning", label: "推理 (Reasoning)", hint: "支持思维链深度推理" },
];

interface CapabilitiesEditorProps {
  initial?: ModelCapabilities;
}

export default function CapabilitiesEditor({ initial }: CapabilitiesEditorProps) {
  const [caps, setCaps] = useState<ModelCapabilities>(initial ?? {});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedText, setAdvancedText] = useState<string>(
    JSON.stringify(initial ?? {}, null, 2)
  );

  const toggle = (key: keyof ModelCapabilities) => {
    setCaps((c) => ({ ...c, [key]: !c[key] }));
  };

  const handleAdvancedChange = (text: string) => {
    setAdvancedText(text);
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        setCaps(parsed as ModelCapabilities);
      }
    } catch {
      /* ignore invalid JSON parsing during typing */
    }
  };

  const openAdvanced = () => {
    setAdvancedText(JSON.stringify(caps, null, 2));
    setShowAdvanced(true);
  };

  const hiddenValue = useMemo(() => {
    if (showAdvanced) return advancedText;
    return JSON.stringify(caps);
  }, [showAdvanced, advancedText, caps]);

  return (
    <div className="mt-1 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 rounded-lg bg-neutral-50/50 dark:bg-neutral-900/30 border border-neutral-100 dark:border-neutral-800/80">
        {CAP_DEFS.map((d) => (
          <label
            key={d.key}
            className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer select-none py-1 hover:text-neutral-900 dark:hover:text-white transition-colors"
            title={d.hint}
          >
            <input
              type="checkbox"
              checked={!!caps[d.key]}
              onChange={() => toggle(d.key)}
              className="rounded border-neutral-300 text-blue-600 focus:ring-blue-500/30 transition-colors"
            />
            <span>{d.label}</span>
          </label>
        ))}
      </div>

      <div className="mt-2">
        {!showAdvanced ? (
          <button
            type="button"
            onClick={openAdvanced}
            className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-700 transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
            <span>配置高级能力参数 (JSON)</span>
          </button>
        ) : (
          <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
            <button
              type="button"
              onClick={() => setShowAdvanced(false)}
              className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-700 transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              <span>收起高级配置，改用复选框</span>
            </button>
            <div className="space-y-1">
              <textarea
                value={advancedText}
                onChange={(e) => handleAdvancedChange(e.target.value)}
                rows={4}
                spellCheck={false}
                className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 px-3.5 py-2 font-mono text-xs bg-white dark:bg-[#0f121a] focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 text-neutral-800 dark:text-neutral-200 transition-all duration-150 resize-y"
                placeholder='{"stream":true,"tools":true}'
              />
              <p className="text-[10px] text-neutral-400 dark:text-neutral-500">
                💡 JSON 格式必须是有效的键值对。若语法错误将不会同步至上方复选框。
              </p>
            </div>
          </div>
        )}
      </div>
      {/* 提交时序列化的能力位 —— 字段名固定 capabilities */}
      <input type="hidden" name="capabilities" value={hiddenValue} />
    </div>
  );
}
