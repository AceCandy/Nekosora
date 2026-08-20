"use client";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, MessageSquareText, Plus, Trash2, ShieldCheck } from "lucide-react";
import { clsx } from "clsx";
import Input from "@/shared/ui/Input";
import Select from "@/shared/ui/Select";
import { Button } from "@/shared/ui/Button";
import Modal from "@/shared/ui/Modal";
import type { ProbeResult } from "@/lib/providers/probe";

export interface EditorRow {
  key: string;
  weight: string;
  note: string;
}

/** 保存前查重暴露给父表单的句柄。 */
export interface KeyBundleEditorHandle {
  /**
   * 保存前查重:对所有非空密钥行(trim 后、区分大小写)整体比对。
   * 命中重复:高亮并滚动到第一个重复行,返回 true(由父表单阻止保存);
   * 无重复:返回 false(放行原保存流程)。
   */
  validateDuplicates: () => boolean;
  /** 打开批量设置弹窗:预填当前所有行(key,weight,note),交由用户编辑/追加后整体替换。 */
  openBatch: () => void;
}

/** 逐 key 测试 action:直接用原始参数探测,不读 DB。有 testModel 时走深度检测(带 model 极小生成)。 */
export type TestKeyAction = (input: {
  protocol: string;
  baseUrl: string;
  apiKey: string;
  /** 检测模型:传入则走深度检测(极小生成验全链路),缺省走空 body 验 key。 */
  testModel?: string;
}) => Promise<ProbeResult>;

interface KeyBundleEditorProps {
  requireKeys?: boolean;
  initialRows?: EditorRow[];
  /** 无 key 模式:禁用所有密钥输入与按钮(提交时由父级 hidden 字段标记空 bundle)。 */
  noKey?: boolean;
  /** 当前 provider 协议(测试用)。 */
  protocol?: string;
  /** 当前 provider 接口地址(测试用)。 */
  baseUrl?: string;
  /** 检测模型(测试用):传入则逐 key 测试走深度检测(带 model 极小生成)。 */
  testModel?: string;
  /** 已拉取的上游模型列表,供单 key 测试弹窗选择。 */
  upstreamModels?: string[];
  /** 逐 key 测试 action(可选,传入则启用测试按钮)。 */
  testAction?: TestKeyAction;
}

type TestState = "idle" | "pending" | { result: ProbeResult };

const KeyBundleEditor = forwardRef<KeyBundleEditorHandle, KeyBundleEditorProps>(
  function KeyBundleEditor({ requireKeys = true, initialRows, noKey = false, protocol, baseUrl, testModel, upstreamModels = [], testAction }, ref) {
    const t = useTranslations("providers");
    const [rows, setRows] = useState<EditorRow[]>(
      initialRows && initialRows.length > 0
        ? initialRows
        : [{ key: "", weight: "1", note: "" }]
    );
    const [revealed, setRevealed] = useState<boolean[]>(
      () => rows.map(() => false)
    );
    // 每行各自的测试状态(按行索引)。null = 未测/idle。
    const [testStates, setTestStates] = useState<TestState[]>(() => rows.map(() => "idle"));
    const [testDialog, setTestDialog] = useState<number | null>(null);
    const [selectedModel, setSelectedModel] = useState(testModel ?? "");
    const [noteDialog, setNoteDialog] = useState<number | null>(null);
    const [noteDraft, setNoteDraft] = useState("");

    // 批量设置弹窗。
    const [batchOpen, setBatchOpen] = useState(false);
    const [batchText, setBatchText] = useState("");

    // 保存时查重命中:dup=后出现的重复行,first=首次出现的同值行;null=无重复。
    const [duplicateInfo, setDuplicateInfo] = useState<{ dup: number; first: number } | null>(null);
    const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
    const dupClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 清除重复高亮与定时器(增删行 / 改 key / 批量导入后调用)。
    const clearDuplicate = () => {
      if (dupClearTimer.current) {
        clearTimeout(dupClearTimer.current);
        dupClearTimer.current = null;
      }
      setDuplicateInfo(null);
    };

    const addRow = () => {
      clearDuplicate();
      setRows((r) => [...r, { key: "", weight: "1", note: "" }]);
      setRevealed((v) => [...v, false]);
      setTestStates((s) => [...s, "idle"]);
    };
    const removeRow = (i: number) => {
      clearDuplicate();
      setRows((r) => (r.length <= 1 ? r : r.filter((_, idx) => idx !== i)));
      setRevealed((v) => (v.length <= 1 ? v : v.filter((_, idx) => idx !== i)));
      setTestStates((s) => (s.length <= 1 ? s : s.filter((_, idx) => idx !== i)));
    };
    const update = (i: number, field: "key" | "weight" | "note", val: string) => {
      setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: val } : row)));
      // key 改动后,该行既有结果失效,并清掉残留的重复高亮。
      if (field === "key") {
        setTestStates((s) => s.map((st, idx) => (idx === i ? "idle" : st)));
        if (duplicateInfo) clearDuplicate();
      }
    };
    const toggleReveal = (i: number) =>
      setRevealed((v) => v.map((on, idx) => (idx === i ? !on : on)));

    // 批量设置:弹窗预填当前所有行(key,weight),用户可编辑/追加。
    // 确定时按行解析「key」或「key,权重,备注」(权重省略/非法 -> 1),整体去重(同 key 保留首次),
    // 整体替换 rows(与"保存后整体更新"语义一致)。
    const commitBatch = () => {
      const seen = new Set<string>();
      const result: EditorRow[] = [];
      for (const raw of batchText.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        const commaIdx = line.indexOf(",");
        let key: string;
        let weight: string;
        let note = "";
        if (commaIdx === -1) {
          key = line;
          weight = "1";
        } else {
          key = line.slice(0, commaIdx).trim();
          const rest = line.slice(commaIdx + 1);
          const secondCommaIdx = rest.indexOf(",");
          const wStr = (secondCommaIdx === -1 ? rest : rest.slice(0, secondCommaIdx)).trim();
          note = secondCommaIdx === -1 ? "" : rest.slice(secondCommaIdx + 1).trim();
          weight = wStr && Number.isFinite(Number(wStr)) && Number(wStr) >= 0 ? wStr : "1";
        }
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push({ key, weight, note });
      }
      if (result.length > 0) {
        clearDuplicate();
        setRows(result);
        setRevealed(result.map(() => false));
        setTestStates(result.map((): TestState => "idle"));
      }
      setBatchText("");
      setBatchOpen(false);
    };

    // 暴露给父表单:保存前查重 + 打开批量设置弹窗。依赖 rows,确保读到最新值。
    useImperativeHandle(
      ref,
      () => ({
        validateDuplicates: () => {
          const seen = new Map<string, number>(); // trimKey -> 首次出现行号
          for (let i = 0; i < rows.length; i++) {
            const k = rows[i].key.trim();
            if (!k) continue;
            const first = seen.get(k);
            if (first !== undefined) {
              setDuplicateInfo({ dup: i, first });
              const el = rowRefs.current[i];
              if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
              if (dupClearTimer.current) clearTimeout(dupClearTimer.current);
              dupClearTimer.current = setTimeout(() => setDuplicateInfo(null), 4500);
              return true;
            }
            seen.set(k, i);
          }
          setDuplicateInfo(null);
          return false;
        },
        openBatch: () => {
          setBatchText(rows.map((r) => `${r.key},${r.weight}${r.note ? `,${r.note}` : ""}`).join("\n"));
          setBatchOpen(true);
        },
      }),
      [rows],
    );

    // 测试单行:用当前协议+接口地址+该行 key 明文发探测请求。
    const testOne = async (i: number, model = testModel) => {
      if (!testAction || !protocol || !baseUrl) return;
      const apiKey = rows[i]?.key.trim();
      if (!apiKey) return;
      setTestStates((s) => s.map((st, idx) => (idx === i ? "pending" : st)));
      try {
        const result = await testAction({ protocol, baseUrl, apiKey, testModel: model || undefined });
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

    const canTest = !!testAction && !!protocol && !!baseUrl;
    const firstTestableKey = rows.findIndex((row) => row.key.trim());
    const testing = testStates.includes("pending");

    return (
      <div className="mt-1 space-y-2.5">
        {rows.map((row, i) => {
          const isDup = duplicateInfo?.dup === i;
          return (
            <div
              key={i}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              className={clsx(
                "flex items-center gap-2 animate-in fade-in duration-150 rounded-md transition-colors",
                isDup && "ring-2 ring-red-500/70 bg-red-500/[0.07]",
              )}
            >
              <div className="relative flex-1">
                <Input
                  name="keys[].key"
                  type={revealed[i] ? "text" : "password"}
                  required={requireKeys}
                  disabled={noKey}
                  value={row.key}
                  onChange={(e) => update(i, "key", e.target.value)}
                  className="pr-9 font-mono text-ui-caption"
                  placeholder={t("keyPlaceholder", { index: i + 1 })}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => {
                    setNoteDraft(row.note);
                    setNoteDialog(i);
                  }}
                  disabled={noKey}
                  className={clsx(
                    "absolute left-3 top-0 z-10 inline-flex max-w-[calc(100%_-_4rem)] -translate-y-1/2 items-center bg-white px-1 text-ui-caption leading-4 transition-colors ",
                    row.note
                      ? "font-medium text-neutral-600 hover:text-sora-blue  "
                      : "text-neutral-400 hover:text-sora-blue  ",
                  )}
                  title={row.note || t("keyNoteTitle")}
                  aria-label={t("keyNoteTitle")}
                >
                  {row.note ? <span className="truncate">{row.note}</span> : <MessageSquareText size={13} />}
                </button>
                <button
                  type="button"
                  onClick={() => toggleReveal(i)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600  p-0.5 rounded transition-colors"
                  aria-label={revealed[i] ? t("hideKeyAria") : t("showKeyAria")}
                  title={revealed[i] ? t("hideKey") : t("showKey")}
                >
                  {revealed[i] ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <input type="hidden" name="keys[].note" value={row.note} />
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-ui-caption font-semibold text-neutral-500 ">{t("weight")}</span>
                <Input
                  name="keys[].weight"
                  type="number"
                  min={0}
                  step={1}
                  disabled={noKey}
                  value={row.weight}
                  onChange={(e) => update(i, "weight", e.target.value)}
                  className="!w-[4.25rem] font-mono text-ui-caption"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => removeRow(i)}
                className="shrink-0 p-2 text-danger hover:text-danger-hover hover:bg-red-50  disabled:opacity-30 transition-colors"
                disabled={noKey || rows.length <= 1}
                aria-label={t("deleteKeyAria")}
                title={t("deleteKeyTitle")}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          );
        })}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={addRow}
            disabled={noKey}
            className="inline-flex items-center gap-1 text-ui-caption font-semibold text-sora-blue hover:text-sora-blue-hover transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-sora-blue"
          >
            <Plus size={14} />
            <span>{t("addApiKey")}</span>
          </button>
          {canTest && firstTestableKey >= 0 && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                setSelectedModel(testModel ?? "");
                setTestDialog(firstTestableKey);
              }}
              disabled={noKey}
              className="text-sora-blue hover:text-sora-blue-hover"
            >
              <ShieldCheck size={14} />
              <span>{t("testKeys")}</span>
            </Button>
          )}
        </div>

        {duplicateInfo && (
          <p className="text-ui-caption text-danger  leading-normal">
            {t("duplicateKeyHint", { dup: duplicateInfo.dup + 1, first: duplicateInfo.first + 1 })}
          </p>
        )}

        <Modal
          open={testDialog !== null}
          onClose={() => setTestDialog(null)}
          title={t("testKeyDialogTitle")}
          dialogClassName="m-auto w-[min(480px,92vw)] rounded-lg border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/40   "
        >
          <div className="space-y-3">
            <label className="block">
              <span className="text-ui-caption font-semibold text-neutral-500 ">
                {t("testKeySelectLabel")}
              </span>
              <Select
                value={testDialog ?? ""}
                onChange={(event) => setTestDialog(Number(event.target.value))}
                disabled={testing}
                className="mt-1 w-full"
              >
                {rows.map((row, index) => row.key.trim() && (
                  <option key={index} value={index}>
                    {t("testKeyOption", { index: index + 1 })}{row.note ? ` · ${row.note}` : ""}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="text-ui-caption font-semibold text-neutral-500 ">
                {t("testKeyModelLabel")}
              </span>
              <Input
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                placeholder={t("testModelPlaceholder")}
                autoFocus
              />
              {upstreamModels.length > 0 && (
                <div className="mt-2 max-h-36 overflow-auto border-y border-morning-mist  py-1">
                  {upstreamModels.map((model) => (
                    <button
                      key={model}
                      type="button"
                      onClick={() => setSelectedModel(model)}
                      className="block w-full truncate px-2 py-1.5 text-left font-mono text-ui-caption text-neutral-700 hover:bg-neutral-100  "
                    >
                      {model}
                    </button>
                  ))}
                </div>
              )}
            </label>
            {testDialog !== null && testStates[testDialog] !== "idle" && testStates[testDialog] !== "pending" && (
              <ResultDetail result={testStates[testDialog].result} />
            )}
            <div className="flex justify-end gap-2.5 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setTestDialog(null)}>{t("cancel")}</Button>
              <Button
                variant="contrast"
                size="sm"
                loading={testing}
                disabled={testing || !selectedModel.trim() || testDialog === null}
                onClick={async () => {
                  if (testDialog === null) return;
                  await testOne(testDialog, selectedModel.trim());
                }}
              >
                <ShieldCheck size={14} />
                <span>{t("testKeySubmit")}</span>
              </Button>
            </div>
          </div>
        </Modal>

        <Modal
          open={noteDialog !== null}
          onClose={() => setNoteDialog(null)}
          title={t("keyNoteDialogTitle")}
          dialogClassName="m-auto w-[min(400px,92vw)] rounded-lg border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/40   "
        >
          <div className="space-y-3">
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              rows={3}
              autoFocus
              placeholder={t("keyNotePlaceholder")}
              className="w-full resize-y rounded-md border border-morning-mist bg-white px-3 py-2 text-ui-body text-space-ink placeholder:text-neutral-600 focus:border-sora-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue    "
            />
            <div className="flex justify-end gap-2.5">
              <Button variant="secondary" size="sm" onClick={() => setNoteDialog(null)}>{t("cancel")}</Button>
              <Button
                variant="contrast"
                size="sm"
                onClick={() => {
                  if (noteDialog === null) return;
                  update(noteDialog, "note", noteDraft.trim());
                  setNoteDialog(null);
                }}
              >
                {t("save")}
              </Button>
            </div>
          </div>
        </Modal>

        <p className="text-ui-caption text-neutral-400  leading-normal flex items-start gap-1">
          <span className="text-sora-blue shrink-0">※</span>
          <span>{t("keyHintRequired")}</span>
        </p>

        {/* 批量设置弹窗(嵌套于编辑服务商弹窗;原生 <dialog> 支持叠层展示)。 */}
        <Modal open={batchOpen} onClose={() => setBatchOpen(false)} title={t("batchAddTitle")}>
          <div className="space-y-3">
            <p className="text-ui-caption text-neutral-500  leading-normal">
              {t("batchAddHint")}
            </p>
            <textarea
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              rows={8}
              autoFocus
              spellCheck={false}
              placeholder={t("batchAddPlaceholder")}
              className="mt-1 w-full rounded-md border border-morning-mist  px-3.5 py-2 text-ui-caption bg-white  focus:outline-none focus:border-sora-blue  focus-visible:ring-2 focus-visible:ring-sora-blue/20 transition-colors duration-150 resize-y font-mono text-space-ink "
            />
            <div className="flex justify-end gap-2.5 pt-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setBatchText("");
                  setBatchOpen(false);
                }}
              >
                {t("cancel")}
              </Button>
              <Button variant="contrast" size="sm" onClick={commitBatch}>
                {t("batchAddConfirm")}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    );
  },
);

export default KeyBundleEditor;

function ResultDetail({ result }: { result: ProbeResult }) {
  const t = useTranslations("providers");
  return (
    <div className="rounded-md border border-morning-mist  p-3 text-ui-caption space-y-1">
      <div className={result.ok ? "text-success " : "text-danger "}>
        {result.ok ? t("keyValid") : result.error ?? t("keyUnknownError")}
        {result.latencyMs != null ? ` · ${result.latencyMs}ms` : ""}
      </div>
      {result.responseText && <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-neutral-600 ">{result.responseText}</pre>}
    </div>
  );
}
