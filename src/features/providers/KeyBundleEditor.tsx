"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, Plus, Trash2, ShieldCheck } from "lucide-react";
import Input from "@/shared/ui/Input";
import { Button } from "@/shared/ui/Button";
import Badge from "@/shared/ui/Badge";
import type { ProbeResult } from "@/lib/providers/probe";

export interface EditorRow {
  key: string;
  weight: string;
}

/** 逐 key 测试 action:直接用原始参数探测,不读 DB。 */
export type TestKeyAction = (input: {
  protocol: string;
  baseUrl: string;
  apiKey: string;
}) => Promise<ProbeResult>;

interface KeyBundleEditorProps {
  requireKeys?: boolean;
  initialRows?: EditorRow[];
  /** 当前 provider 协议(测试用)。 */
  protocol?: string;
  /** 当前 provider 接口地址(测试用)。 */
  baseUrl?: string;
  /** 逐 key 测试 action(可选,传入则启用测试按钮)。 */
  testAction?: TestKeyAction;
}

type TestState = "idle" | "pending" | { result: ProbeResult };

export default function KeyBundleEditor({
  requireKeys = true,
  initialRows,
  protocol,
  baseUrl,
  testAction,
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
  // 每行各自的测试状态(按行索引)。null = 未测/idle。
  const [testStates, setTestStates] = useState<TestState[]>(() => rows.map(() => "idle"));

  const addRow = () => {
    setRows((r) => [...r, { key: "", weight: "1" }]);
    setRevealed((v) => [...v, false]);
    setTestStates((s) => [...s, "idle"]);
  };
  const removeRow = (i: number) => {
    setRows((r) => (r.length <= 1 ? r : r.filter((_, idx) => idx !== i)));
    setRevealed((v) => (v.length <= 1 ? v : v.filter((_, idx) => idx !== i)));
    setTestStates((s) => (s.length <= 1 ? s : s.filter((_, idx) => idx !== i)));
  };
  const update = (i: number, field: "key" | "weight", val: string) => {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: val } : row)));
    // key 改动后,该行既有结果失效。
    if (field === "key") {
      setTestStates((s) => s.map((st, idx) => (idx === i ? "idle" : st)));
    }
  };
  const toggleReveal = (i: number) =>
    setRevealed((v) => v.map((on, idx) => (idx === i ? !on : on)));

  // 测试单行:用当前协议+接口地址+该行 key 明文发探测请求。
  const testOne = async (i: number) => {
    if (!testAction || !protocol || !baseUrl) return;
    const apiKey = rows[i]?.key.trim();
    if (!apiKey) return;
    setTestStates((s) => s.map((st, idx) => (idx === i ? "pending" : st)));
    try {
      const result = await testAction({ protocol, baseUrl, apiKey });
      setTestStates((s) => s.map((st, idx) => (idx === i ? { result } : st)));
    } catch (e) {
      setTestStates((s) =>
        s.map((st, idx) =>
          idx === i
            ? { result: { ok: false, error: e instanceof Error ? e.message : String(e), errorKind: "unknown" } }
            : st,
        ),
      );
    }
  };

  // 全部测试:依次对每个非空 key 探测(串行,避免并发冲击上游)。
  const testAll = async () => {
    if (!testAction || !protocol || !baseUrl) return;
    for (let i = 0; i < rows.length; i++) {
      const apiKey = rows[i]?.key.trim();
      if (!apiKey) continue;
      await testOne(i);
    }
  };

  const canTest = !!testAction && !!protocol && !!baseUrl;

  return (
    <div className="mt-1 space-y-2.5">
      {rows.map((row, i) => {
        const st = testStates[i];
        return (
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
            {canTest && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => testOne(i)}
                loading={st === "pending"}
                disabled={!row.key.trim()}
                className="shrink-0 text-sora-blue hover:text-sora-blue-hover"
                title={t("testKeyTitle")}
              >
                <ShieldCheck size={14} />
              </Button>
            )}
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
            {st !== "idle" && st !== "pending" && <ResultBadge result={st.result} />}
          </div>
        );
      })}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 text-xs font-semibold text-sora-blue hover:text-sora-blue-hover transition-colors"
        >
          <Plus size={14} />
          <span>{t("addApiKey")}</span>
        </button>
        {canTest && rows.length > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={testAll}
            className="text-sora-blue hover:text-sora-blue-hover"
          >
            <ShieldCheck size={14} />
            <span>{t("testAllKeys")}</span>
          </Button>
        )}
      </div>

      <p className="text-xs text-neutral-400 dark:text-neutral-500 leading-normal flex items-start gap-1">
        <span className="text-sora-blue shrink-0">※</span>
        <span>
          {requireKeys ? t("keyHintRequired") : t("keyHintEdit")}
        </span>
      </p>
    </div>
  );
}

/** 单行测试结果徽章(与行绑定,明确是哪个 key 的结果)。 */
function ResultBadge({ result }: { result: ProbeResult }) {
  const t = useTranslations("providers");
  if (result.ok) {
    return (
      <Badge variant="success" className="shrink-0" title={result.error}>
        {t("keyValid")}{result.latencyMs != null ? ` ${result.latencyMs}ms` : ""}
      </Badge>
    );
  }
  if (result.errorKind === "auth") {
    return (
      <Badge variant="danger" className="shrink-0" title={result.error}>
        {t("keyInvalid")}
      </Badge>
    );
  }
  if (result.errorKind === "network") {
    return (
      <Badge variant="warning" className="shrink-0" title={result.error}>
        {t("keyNetworkError")}
      </Badge>
    );
  }
  return (
    <Badge variant="warning" className="shrink-0" title={result.error}>
      {t("keyUnknownError")}
    </Badge>
  );
}
