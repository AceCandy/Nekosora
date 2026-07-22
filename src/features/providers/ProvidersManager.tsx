"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type {
  AttachProviderModelRouteAction,
  FormDataSerializableAction,
  ProviderModelCandidate,
  ProviderRouteRef,
} from "@/features/providers/types";
import type { ProviderKeyResult } from "@/db/schema/pg";
import type { EditorRow, TestKeyAction } from "@/features/providers/KeyBundleEditor";
import ProviderFormDialog from "@/features/providers/ProviderFormDialog";
import ProviderHealthButton, { type HealthAction, type HealthDisplay } from "@/features/providers/ProviderHealthButton";
import ModelProbeButton, { type ModelProbeAction, type ModelProbeDisplay } from "@/features/providers/ModelProbeButton";
import ProviderModelMatchDialog, {
  type ProviderModelMatchCandidate,
  type ProviderModelMatchFeedback,
} from "@/features/providers/ProviderModelMatchDialog";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import Popover from "@/shared/ui/Popover";
import Input from "@/shared/ui/Input";
import Select from "@/shared/ui/Select";
import { Plus, Edit2, Trash2, ShieldAlert, HeartPulse, Loader2, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/shared/ui/Button";
import { rankSimilarModels } from "@/lib/model-catalog";

// 4 种协议各自的彩色块(低饱和填充,与「莫兰迪灰调」管理侧协调);未命中协议回退中性色。
const PROTOCOL_STYLE: Record<string, { bg: string; text: string }> = {
  openai: { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300" },
  anthropic: { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-700 dark:text-orange-300" },
  gemini: { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300" },
  "openai-compatible": { bg: "bg-slate-200 dark:bg-slate-700/50", text: "text-slate-700 dark:text-slate-200" },
};

/** server action 签名:拉取 provider 最新上游模型列表,返回模型 id 列表 + 时间。 */
export type RefreshAction = (providerId: string) => Promise<{
  models: string[];
  checkedAt: number;
}>;

export interface ProviderItem {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  enabled: boolean;
  /** 密钥轮询策略(编辑时回显)。 */
  keyStrategy?: string;
  /** 回显的明文 key(编辑时用)。 */
  keys: EditorRow[];
  /** 落库的最近一次存活检测结果(列表回显)。 */
  health?: {
    healthy: number | null;
    total: number | null;
    checkedAt: Date | null;
    networkOk: boolean | null;
    keyResults?: ProviderKeyResult[];
    /** 落库的最近一次 testModel 深度检测结果(列表回显)。 */
    modelProbeOk?: boolean | null;
    modelProbeAt?: Date | null;
    modelProbeError?: string | null;
  };
  /** 检测模型(手填或从上游模型列表选);用于后续深度健康检测。 */
  testModel?: string | null;
  /** 已拉取并落库的上游模型 id 列表(/models)。 */
  upstreamModels?: string[];
  /** 上次拉取上游模型列表的时间。 */
  upstreamModelsAt?: Date | null;
}

interface ProvidersManagerProps {
  providers: ProviderItem[];
  protocols: { value: string; label: string }[];
  createAction: FormDataSerializableAction;
  updateActions: Record<string, FormDataSerializableAction>;
  toggleActions: Record<string, FormDataSerializableAction>;
  deleteActions: Record<string, FormDataSerializableAction>;
  /** 逐 key 测试 action(可选)。传入则编辑弹窗启用密钥测试。 */
  testKeyAction?: TestKeyAction;
  /** 全量健康检测 action(按 id 索引)。不传则不显示检测按钮。 */
  healthActions?: Record<string, HealthAction>;
  /** 拉取最新上游模型列表 action(按 id 索引)。不传则不显示拉取按钮。 */
  refreshActions?: Record<string, RefreshAction>;
  /** testModel 深度检测 action(按 id 索引)。不传则不显示深度检测按钮。 */
  modelProbeActions?: Record<string, ModelProbeAction>;
  /** 已配置的路由引用(用于检测模型悬浮窗标注哪些上游模型已配路由)。 */
  routes?: ProviderRouteRef[];
  /** 当前操作者可管理的模型，用于完全匹配和相似候选。 */
  modelCandidates: ProviderModelCandidate[];
  /** 服务端补路由 action；会重新校验权限和重复路由。 */
  attachModelRouteAction: AttachProviderModelRouteAction;
  modelCreatePath: "/panel/models" | "/admin/models";
}

interface ModelMatchState {
  providerId: string;
  upstreamModelName: string;
  candidates: ProviderModelMatchCandidate[];
}

type RouteFeedbackStatus = "pending" | "created" | "exists" | "error";

export default function ProvidersManager({
  providers,
  protocols,
  createAction,
  updateActions,
  toggleActions,
  deleteActions,
  testKeyAction,
  healthActions,
  refreshActions,
  modelProbeActions,
  routes,
  modelCandidates,
  attachModelRouteAction,
  modelCreatePath,
}: ProvidersManagerProps) {
  const router = useRouter();
  const t = useTranslations("providers");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [modelMatch, setModelMatch] = useState<ModelMatchState | null>(null);
  const [modelMatchFeedback, setModelMatchFeedback] = useState<ProviderModelMatchFeedback | null>(null);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [routeFeedback, setRouteFeedback] = useState<Record<string, RouteFeedbackStatus>>({});
  const [createdRoutes, setCreatedRoutes] = useState<ProviderRouteRef[]>([]);
  const [, startRouteTransition] = useTransition();

  // 健康度状态上提到此层:既支持单行检测,也支持表头"全部检测"统一刷新所有行。
  // healthMap 只存本次会话的检测结果;未检测的行回显落库值(p.health)。
  const [healthMap, setHealthMap] = useState<Record<string, HealthDisplay>>({});
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [allPending, setAllPending] = useState(false);

  // 上游模型列表的会话级覆盖:拉取成功后即时刷新"共 N 个模型",无需等 RSC 重渲。
  const [modelsMap, setModelsMap] = useState<Record<string, { models: string[]; checkedAt: number }>>({});
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());

  // testModel 深度检测结果:会话级覆盖优先,回退落库值(p.health.modelProbe*)。
  const [modelProbeMap, setModelProbeMap] = useState<Record<string, ModelProbeDisplay>>({});
  const [modelProbePending, setModelProbePending] = useState<Set<string>>(new Set());

  const editing = providers.find((p) => p.id === editId) ?? null;
  const deleting = providers.find((p) => p.id === deleteId) ?? null;

  const displayFor = (p: ProviderItem): HealthDisplay => {
    if (healthMap[p.id]) return healthMap[p.id];
    if (p.health?.checkedAt) {
      return {
        healthy: p.health.healthy ?? 0,
        total: p.health.total ?? 0,
        checkedAt:
          p.health.checkedAt instanceof Date ? p.health.checkedAt.getTime() : Number(p.health.checkedAt),
        // 旧数据(迁移前未检测网络层)networkOk 为 null,视为不显红(true)。
        networkOk: p.health.networkOk ?? true,
        keyResults: p.health.keyResults ?? [],
      };
    }
    return null;
  };

  const checkOne = (id: string) => {
    const action = healthActions?.[id];
    if (!action || pendingIds.has(id)) return;
    setPendingIds((prev) => new Set(prev).add(id));
    action(id)
      .then((result) => setHealthMap((prev) => ({ ...prev, [id]: result })))
      .catch(() => {})
      .finally(() =>
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      );
  };

  const checkAll = () => {
    if (allPending) return;
    const ids = providers.map((p) => p.id).filter((id) => !!healthActions?.[id]);
    if (ids.length === 0) return;
    setAllPending(true);
    setPendingIds(new Set(ids));
    // 并行触发,每个 provider 完成即更新该行 UI(不等所有),避免"全部 pending -> 一次性完成"的排队感。
    const promises = ids.map((id) =>
      healthActions![id](id)
        .then((result) => {
          setHealthMap((prev) => ({ ...prev, [id]: result }));
          return result;
        })
        .catch(() => {})
        .finally(() =>
          setPendingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          }),
        ),
    );
    Promise.allSettled(promises).finally(() => setAllPending(false));
  };

  // 当前展示的上游模型列表:会话级覆盖优先,回退落库值。
  const modelsFor = (p: ProviderItem): string[] => modelsMap[p.id]?.models ?? p.upstreamModels ?? [];

  // 上次拉取时间(毫秒):会话级覆盖优先,回退落库值,供检测模型下拉的按需刷新缓存判定。
  const fetchedAtFor = (p: ProviderItem): number | null =>
    modelsMap[p.id]?.checkedAt ??
    (p.upstreamModelsAt instanceof Date
      ? p.upstreamModelsAt.getTime()
      : p.upstreamModelsAt
        ? Number(p.upstreamModelsAt)
        : null);

  const refreshOne = (id: string) => {
    const action = refreshActions?.[id];
    if (!action || refreshingIds.has(id)) return;
    setRefreshingIds((prev) => new Set(prev).add(id));
    action(id)
      .then((result) => setModelsMap((prev) => ({ ...prev, [id]: result })))
      .catch(() => {})
      .finally(() =>
        setRefreshingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      );
  };

  // 深度检测展示:会话级覆盖优先,回退落库值。
  const displayModelProbeFor = (p: ProviderItem): ModelProbeDisplay => {
    if (modelProbeMap[p.id]) return modelProbeMap[p.id];
    if (p.health?.modelProbeAt) {
      return {
        ok: p.health.modelProbeOk ?? false,
        checkedAt:
          p.health.modelProbeAt instanceof Date
            ? p.health.modelProbeAt.getTime()
            : Number(p.health.modelProbeAt),
        error: p.health.modelProbeError ?? undefined,
      };
    }
    return null;
  };

  const probeOne = (id: string) => {
    const action = modelProbeActions?.[id];
    if (!action || modelProbePending.has(id)) return;
    setModelProbePending((prev) => new Set(prev).add(id));
    action(id)
      .then((result) =>
        setModelProbeMap((prev) => ({
          ...prev,
          [id]: {
            ok: result.ok,
            checkedAt: Date.now(),
            error: result.error,
            errorKind: result.errorKind,
          },
        })),
      )
      .catch(() => {})
      .finally(() =>
        setModelProbePending((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      );
  };

  // 筛选:客户端过滤(空值不过滤)。密钥精准匹配,其余模糊(大小写不敏感)。
  const [filter, setFilter] = useState({
    name: "",
    baseUrl: "",
    key: "",
    model: "",
    status: "all" as "all" | "enabled" | "disabled",
  });
  const filteredProviders = providers.filter((p) => {
    const q = filter;
    if (q.name && !p.name.toLowerCase().includes(q.name.toLowerCase())) return false;
    if (q.baseUrl && !p.baseUrl.toLowerCase().includes(q.baseUrl.toLowerCase())) return false;
    if (q.key && !p.keys.some((k) => k.key === q.key)) return false;
    if (q.model && !modelsFor(p).some((m) => m.toLowerCase().includes(q.model.toLowerCase()))) return false;
    if (q.status === "enabled" && !p.enabled) return false;
    if (q.status === "disabled" && p.enabled) return false;
    return true;
  });

  const allRoutes = [...(routes ?? []), ...createdRoutes];
  const routeFeedbackKey = (providerId: string, upstreamModelName: string) =>
    JSON.stringify([providerId, upstreamModelName]);
  const hasRoute = (modelId: string, providerId: string, upstreamModelName: string) =>
    allRoutes.some((route) =>
      route.modelId === modelId &&
      route.providerId === providerId &&
      route.upstreamModelName === upstreamModelName,
    );

  const openCreateModel = (providerId: string, upstreamModelName: string) => {
    router.push(`${modelCreatePath}?createModel=1&name=${encodeURIComponent(upstreamModelName)}&providerId=${encodeURIComponent(providerId)}&upstreamModelName=${encodeURIComponent(upstreamModelName)}`);
  };

  const attachRoute = (
    model: ProviderModelCandidate,
    providerId: string,
    upstreamModelName: string,
    showDialogFeedback: boolean,
  ) => {
    if (pendingModelId) return;
    const feedbackKey = routeFeedbackKey(providerId, upstreamModelName);
    setPendingModelId(model.id);
    setRouteFeedback((previous) => ({ ...previous, [feedbackKey]: "pending" }));
    if (showDialogFeedback) setModelMatchFeedback(null);
    startRouteTransition(async () => {
      try {
        const result = await attachModelRouteAction(model.id, providerId, upstreamModelName);
        setCreatedRoutes((previous) => previous.some((route) =>
          route.modelId === model.id &&
          route.providerId === providerId &&
          route.upstreamModelName === upstreamModelName,
        ) ? previous : [...previous, { modelId: model.id, providerId, upstreamModelName }]);
        setRouteFeedback((previous) => ({ ...previous, [feedbackKey]: result.status }));
        if (showDialogFeedback) {
          setModelMatchFeedback({ status: result.status, modelName: model.name });
          setModelMatch((current) => current ? {
            ...current,
            candidates: current.candidates.map((candidate) =>
              candidate.id === model.id ? { ...candidate, routeExists: true } : candidate,
            ),
          } : current);
        }
      } catch {
        setRouteFeedback((previous) => ({ ...previous, [feedbackKey]: "error" }));
        if (showDialogFeedback) setModelMatchFeedback({ status: "error", modelName: model.name });
      } finally {
        setPendingModelId(null);
      }
    });
  };

  const handleUpstreamModelClick = (providerId: string, rawUpstreamModelName: string) => {
    if (pendingModelId) return;
    const upstreamModelName = rawUpstreamModelName.trim();
    const exact = modelCandidates.find((model) => model.name.trim() === upstreamModelName);
    if (exact) {
      attachRoute(exact, providerId, upstreamModelName, false);
      return;
    }

    const candidates = rankSimilarModels(modelCandidates, upstreamModelName).map((model) => ({
      ...model,
      routeExists: hasRoute(model.id, providerId, upstreamModelName),
    }));
    setModelMatch({ providerId, upstreamModelName, candidates });
    setModelMatchFeedback(null);
  };

  const selectModelCandidate = (candidate: ProviderModelMatchCandidate) => {
    if (!modelMatch) return;
    attachRoute(candidate, modelMatch.providerId, modelMatch.upstreamModelName, true);
  };

  // 按 provider 聚合已配路由的上游模型集合,供悬浮窗标注绿/灰底。
  const configuredByProvider = new Map<string, Set<string>>();
  for (const r of allRoutes) {
    let set = configuredByProvider.get(r.providerId);
    if (!set) { set = new Set(); configuredByProvider.set(r.providerId, set); }
    set.add(r.upstreamModelName);
  }

  // 检测模型悬浮窗:已配路由模型绿底在前,其余灰底在后。
  const renderModelsList = (p: ProviderItem) => {
    const configured = configuredByProvider.get(p.id);
    const models = modelsFor(p);
    const listed = models.filter((m) => configured?.has(m));
    const rest = models.filter((m) => !configured?.has(m));
    return [...listed, ...rest].map((m) => {
      const feedback = routeFeedback[routeFeedbackKey(p.id, m.trim())];
      return (
        <button
          type="button"
          key={m}
          title={m}
          disabled={pendingModelId !== null}
          onClick={() => handleUpstreamModelClick(p.id, m)}
          className={clsx(
            "flex w-full items-center gap-2 px-2 py-1 text-left text-xs font-mono hover:bg-sora-blue/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sora-blue disabled:cursor-not-allowed disabled:opacity-60",
            configured?.has(m)
              ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
              : "bg-neutral-100 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{m}</span>
          {feedback === "pending" ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          ) : feedback ? (
            <span className={clsx("shrink-0 font-sans text-[11px] font-medium", feedback === "error" && "text-red-600 dark:text-red-300")}>
              {t(
                feedback === "created"
                  ? "modelRouteCreated"
                  : feedback === "exists"
                    ? "modelRouteExists"
                    : "modelRouteFailed",
              )}
            </span>
          ) : null}
        </button>
      );
    });
  };

  return (
    <div className="flex flex-col min-h-0 flex-1 gap-4">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
          {t("configuredCount", { count: providers.length })}
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setAddOpen(true)}
          className="font-semibold"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t("addProvider")}</span>
        </Button>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Input
          placeholder={t("filterNamePlaceholder")}
          value={filter.name}
          onChange={(e) => setFilter((f) => ({ ...f, name: e.target.value }))}
          className="h-8 w-32 text-xs"
        />
        <Input
          placeholder={t("filterBaseUrlPlaceholder")}
          value={filter.baseUrl}
          onChange={(e) => setFilter((f) => ({ ...f, baseUrl: e.target.value }))}
          className="h-8 w-36 text-xs"
        />
        <Input
          placeholder={t("filterKeyPlaceholder")}
          value={filter.key}
          onChange={(e) => setFilter((f) => ({ ...f, key: e.target.value }))}
          className="h-8 w-36 text-xs"
        />
        <Input
          placeholder={t("filterModelPlaceholder")}
          value={filter.model}
          onChange={(e) => setFilter((f) => ({ ...f, model: e.target.value }))}
          className="h-8 w-32 text-xs"
        />
        <Select
          value={filter.status}
          onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as typeof filter.status }))}
          className="h-8 w-24 text-xs"
        >
          <option value="all">{t("filterStatusAll")}</option>
          <option value="enabled">{t("filterStatusEnabled")}</option>
          <option value="disabled">{t("filterStatusDisabled")}</option>
        </Select>
      </div>

      <div className="rounded-lg border border-morning-mist dark:border-deep-space bg-nebula-white dark:bg-twilight-obsidian overflow-auto transition-colors duration-150 flex-1 min-h-0">
        <table className="w-full text-sm border-collapse text-left">
          <thead className="bg-neutral-50 dark:bg-neutral-900 border-b border-morning-mist dark:border-deep-space text-neutral-500 dark:text-neutral-400 font-mono text-xs uppercase sticky top-0 z-10">
            <tr>
              <th className="p-3.5 font-medium">{t("colName")}</th>
              <th className="p-3.5 font-medium">{t("colBaseUrl")}</th>
              <th className="p-3.5 font-medium text-center">
                <div className="inline-flex items-center gap-1.5">
                  <span>{t("colKeyCount")}</span>
                  {healthActions && providers.length > 0 && (
                    <button
                      type="button"
                      onClick={checkAll}
                      disabled={allPending}
                      title={t("healthCheckAllTitle")}
                      className="inline-flex items-center justify-center rounded p-0.5 text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {allPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <HeartPulse className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </th>
              <th className="p-3.5 font-medium">{t("colTestModel")}</th>
              <th className="p-3.5 font-medium">{t("colStatus")}</th>
              <th className="p-3.5 font-medium text-right">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/60">
            {filteredProviders.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-10 text-center text-xs text-neutral-400 dark:text-neutral-500">
                  {providers.length === 0 ? t("emptyState") : t("filterNoMatch")}
                </td>
              </tr>
            ) : (
              filteredProviders.map((p) => {
                const protocolStyle =
                  PROTOCOL_STYLE[p.protocol] ?? { bg: "bg-neutral-100 dark:bg-neutral-800/60", text: "text-neutral-600 dark:text-neutral-400" };
                return (
                <tr
                  key={p.id}
                  className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10 transition-colors duration-150"
                >
                  <td className="p-3.5 font-semibold text-neutral-800 dark:text-neutral-200">
                    {p.name}
                  </td>
                  <td className="p-3.5 max-w-[220px]">
                    <div className="space-y-1.5">
                      <div className="font-mono text-xs text-neutral-500 dark:text-neutral-400 truncate">
                        {p.baseUrl}
                      </div>
                      <span className={clsx("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium", protocolStyle.bg, protocolStyle.text)}>
                        {p.protocol}
                      </span>
                    </div>
                  </td>
                  <td className="p-3.5 text-center font-mono text-xs">
                    <div className="flex flex-col items-center gap-1.5">
                      <span>{p.keys.length}</span>
                      {healthActions?.[p.id] && (
                        <ProviderHealthButton
                          display={displayFor(p)}
                          pending={pendingIds.has(p.id)}
                          onCheck={() => checkOne(p.id)}
                          iconOnly
                        />
                      )}
                    </div>
                  </td>
                  <td className="p-3.5">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <div className={clsx("truncate text-xs font-medium max-w-[14rem]", p.testModel ? "text-neutral-700 dark:text-neutral-300" : "text-amber-600 dark:text-amber-400")}>
                          {p.testModel || t("testModelPlaceholder")}
                        </div>
                        {modelProbeActions?.[p.id] && (
                          <ModelProbeButton
                            display={displayModelProbeFor(p)}
                            pending={modelProbePending.has(p.id)}
                            onProbe={() => probeOne(p.id)}
                            hasTestModel={!!p.testModel}
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {modelsFor(p).length > 0 ? (
                          <Popover
                            openOnHover
                            hoverDelayMs={1500}
                            clickToggle
                            side="bottom"
                            align="left"
                            panelClassName="p-0"
                            trigger={
                              <span className="text-[11px] text-neutral-400 dark:text-neutral-500 font-mono cursor-default">
                                {t.rich("modelsCount", {
                                  count: modelsFor(p).length,
                                  num: (chunks: ReactNode) => (
                                    <span className="font-semibold text-sora-blue tabular-nums">{chunks}</span>
                                  ),
                                })}
                              </span>
                            }
                          >
                            <div className="max-h-60 w-64 overflow-auto py-1">
                              {renderModelsList(p)}
                            </div>
                          </Popover>
                        ) : (
                          <span className="text-[11px] text-neutral-400 dark:text-neutral-500 font-mono">
                            {t("modelsEmpty")}
                          </span>
                        )}
                        {refreshActions?.[p.id] && (
                          <button
                            type="button"
                            onClick={() => refreshOne(p.id)}
                            disabled={refreshingIds.has(p.id)}
                            title={t("refreshModelsTitle")}
                            className="inline-flex items-center justify-center rounded p-1 text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                          >
                            {refreshingIds.has(p.id) ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3.5">
                    <form action={toggleActions[p.id]} className="inline-block">
                      <button
                        type="submit"
                        role="switch"
                        aria-checked={p.enabled}
                        aria-label={p.enabled ? t("disable") : t("enable")}
                        title={p.enabled ? t("disable") : t("enable")}
                        className={clsx(
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue/40",
                          p.enabled ? "bg-green-600 dark:bg-green-500" : "bg-neutral-300 dark:bg-neutral-600"
                        )}
                      >
                        <span
                          className={clsx(
                            "pointer-events-none absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 rounded-full bg-white transition-transform duration-200",
                            p.enabled ? "translate-x-[18px]" : "translate-x-[2px]"
                          )}
                        />
                      </button>
                    </form>
                  </td>
                  <td className="p-3.5 text-right space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditId(p.id)}
                      className="text-neutral-750 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                      title={t("edit")}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>{t("edit")}</span>
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteId(p.id)}
                      className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-650"
                      title={t("delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t("delete")}</span>
                    </Button>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 新增弹窗 */}
      <ProviderFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode="add"
        action={createAction}
        protocols={protocols}
        testAction={testKeyAction}
      />

      {/* 编辑弹窗 */}
      {editing && (
        <ProviderFormDialog
          open={true}
          onClose={() => setEditId(null)}
          mode="edit"
          action={updateActions[editing.id]}
          protocols={protocols}
          testAction={testKeyAction}
          refreshUpstreamModels={
            refreshActions?.[editing.id]
              ? () => refreshActions![editing.id]!(editing.id)
              : undefined
          }
          initial={{
            name: editing.name,
            protocol: editing.protocol,
            baseUrl: editing.baseUrl,
            keys: editing.keys,
            testModel: editing.testModel ?? "",
            upstreamModels: modelsFor(editing),
            upstreamModelsAt: fetchedAtFor(editing),
          }}
        />
      )}

      {modelMatch && (
        <ProviderModelMatchDialog
          open={true}
          upstreamModelName={modelMatch.upstreamModelName}
          candidates={modelMatch.candidates}
          pendingModelId={pendingModelId}
          feedback={modelMatchFeedback}
          onClose={() => {
            setModelMatch(null);
            setModelMatchFeedback(null);
          }}
          onSelect={selectModelCandidate}
          onCreate={() => openCreateModel(modelMatch.providerId, modelMatch.upstreamModelName)}
        />
      )}

      {/* 删除二次确认弹窗 */}
      {deleting && (
        <ConfirmDialog
          open={true}
          onClose={() => setDeleteId(null)}
          title={t("deleteTitle")}
          message={
            <div className="flex gap-3 text-sm text-neutral-600 dark:text-neutral-400 mt-2">
              <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
              <div>
                {t("deleteConfirm", { name: deleting.name })}
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 leading-normal">
                  {t("deleteWarning")}
                </p>
              </div>
            </div>
          }
          confirmLabel={t("deleteButton")}
          danger
          action={deleteActions[deleting.id]}
        />
      )}
    </div>
  );
}
