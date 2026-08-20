"use client";
/**
 * 用量明细筛选栏(两排 + Combobox typeahead + 级联 + 即时刷新)。
 *
 * 第一排:时间区间 / 用户(admin) / 来源 / 密钥
 * 第二排:服务商 / 模型 / 上游key(服务商未选时禁用)
 *
 * 级联:选用户 → 密钥/服务商候选按 userId;选服务商 → 模型/上游key 按 userId+provider。
 * 选定即 router.push 刷新(级联下级清空,重置 page=1)。
 * typeahead 候选由 server action 异步加载(Combobox debounce 调用)。
 */
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Combobox, type ComboOption } from "@/shared/ui/Combobox";
import { Select } from "@/shared/ui/Select";
import { DateRangePicker } from "./DateRangePicker";
import { searchUsageCandidatesAction } from "./actions";
import { searchPanelUsageCandidatesAction } from "@/app/(dash)/panel/usage/actions";
import { ALL_USERS } from "./time-range";

export interface UsageFilterValues {
  range: string;
  start?: string;
  end?: string;
  user: string;
  source: string;
  key: string;
  provider: string;
  model: string;
  upstreamKey: string;
}

interface UsageFilterBarProps {
  variant: "admin" | "panel";
  values: UsageFilterValues;
  /** 已选 user/key 的 displayLabel(SSR 查;provider/model/upstreamKey 的 label=value 本身)。 */
  labels: { user?: string; key?: string };
  basePath: string;
  tab: "usage" | "errors";
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-ui-caption text-neutral-400 ">{children}</span>;
}

export function UsageFilterBar({ variant, values, labels, basePath, tab }: UsageFilterBarProps) {
  const t = useTranslations("admin.usage");
  const router = useRouter();

  const searchAction = variant === "admin" ? searchUsageCandidatesAction : searchPanelUsageCandidatesAction;
  // admin 用 values.user(可跨用户)作级联 filter;panel action 内部强制自己,不传 userId。
  const userIdFilter = variant === "admin" ? values.user : undefined;

  // admin 默认回填自己;×清空=查全部(写 __all__),选具体用户=查该用户。Combobox 候选即真实用户列表,不前置「全部用户」。
  const loadUsers = async (q: string) => searchUsageCandidatesAction({ type: "users", q });
  const loadKeys = (q: string) => searchAction({ type: "keys", q, userId: userIdFilter }) as Promise<ComboOption[]>;
  const loadProviders = (q: string) => searchAction({ type: "providers", q, userId: userIdFilter }) as Promise<ComboOption[]>;
  const loadModels = (q: string) =>
    searchAction({ type: "models", q, userId: userIdFilter, providerName: values.provider }) as Promise<ComboOption[]>;
  const loadUpstreamKeys = (q: string) =>
    searchAction({ type: "upstreamKeys", q, userId: userIdFilter, providerName: values.provider }) as Promise<ComboOption[]>;

  const update = (patch: Record<string, string>) => {
    const next = { ...values, ...patch };
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (next.range) params.set("range", next.range);
    if (next.start) params.set("start", next.start);
    if (next.end) params.set("end", next.end);
    if (next.user) params.set("user", next.user);
    if (next.source) params.set("source", next.source);
    if (next.key) params.set("key", next.key);
    if (next.provider) params.set("provider", next.provider);
    if (next.model) params.set("model", next.model);
    if (next.upstreamKey) params.set("upstreamKey", next.upstreamKey);
    router.push(`${basePath}?${params.toString()}`);
  };

  const onTimeChange = (patch: { range?: string; start?: string; end?: string }) =>
    update({ range: patch.range ?? "", start: patch.start ?? "", end: patch.end ?? "" });
  // Combobox × 清空回调传空串 → 写入 ALL_USERS 哨兵(查全部),避免清空后又默认回填自己。
  const onUserChange = (id: string) => update({ user: id || ALL_USERS, key: "", provider: "", model: "", upstreamKey: "" });
  const onKeyChange = (id: string) => update({ key: id });
  const onProviderChange = (id: string) => update({ provider: id, model: "", upstreamKey: "" });
  const onModelChange = (id: string) => update({ model: id });
  const onUpstreamKeyChange = (id: string) => update({ upstreamKey: id });

  const sourceOptions = [
    { value: "", label: t("rangeAll") },
    { value: "chat", label: t("sources.chat") },
    { value: "gateway", label: t("sources.gateway") },
  ];

  return (
    <div className="space-y-2.5 rounded-lg border border-neutral-200 bg-white   p-3 shadow-none">
      {/* 第一排:时间范围(独占一行) */}
      <div className="flex flex-wrap items-end gap-3">
        <DateRangePicker range={values.range} start={values.start} end={values.end} onChange={onTimeChange} />
        <button
          type="button"
          onClick={() => router.refresh()}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-ui-caption border border-neutral-200  bg-white  text-neutral-500 hover:text-neutral-700  transition-colors"
        >
          <RefreshCw className="size-3" />
          {t("filters.refresh")}
        </button>
      </div>
      {/* 第二排:用户(admin) / 来源 / 密钥 */}
      <div className="flex flex-wrap items-end gap-3">
        {variant === "admin" && (
          <div className="flex flex-col gap-1">
            <FieldLabel>{t("filters.user")}</FieldLabel>
            <Combobox
              value={values.user}
              displayLabel={labels.user}
              onChange={(id) => onUserChange(id)}
              loadOptions={loadUsers}
              placeholder={t("filters.user")}
              allowClear
              widthClass="w-44"
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <FieldLabel>{t("filters.source")}</FieldLabel>
          <Select
            value={values.source}
            onChange={(e) => update({ source: e.target.value })}
            className="w-28 py-1.5 text-ui-caption"
          >
            {sourceOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel>{t("filters.key")}</FieldLabel>
          <Combobox
            value={values.key}
            displayLabel={labels.key}
            onChange={(id) => onKeyChange(id)}
            loadOptions={loadKeys}
            placeholder={t("filters.key")}
            widthClass="w-44"
          />
        </div>
      </div>
      {/* 第二排:服务商 / 模型 / 上游key */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <FieldLabel>{t("filters.provider")}</FieldLabel>
          <Combobox
            value={values.provider}
            displayLabel={values.provider}
            onChange={(id) => onProviderChange(id)}
            loadOptions={loadProviders}
            placeholder={t("filters.provider")}
            widthClass="w-44"
          />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel>{t("filters.model")}</FieldLabel>
          <Combobox
            value={values.model}
            displayLabel={values.model}
            onChange={(id) => onModelChange(id)}
            loadOptions={loadModels}
            placeholder={t("filters.model")}
            widthClass="w-44"
            disabled={!values.provider}
          />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel>{t("filters.upstreamKey")}</FieldLabel>
          <Combobox
            value={values.upstreamKey}
            displayLabel={values.upstreamKey}
            onChange={(id) => onUpstreamKeyChange(id)}
            loadOptions={loadUpstreamKeys}
            placeholder={t("filters.upstreamKey")}
            widthClass="w-44"
            disabled={!values.provider}
          />
        </div>
      </div>
    </div>
  );
}

export default UsageFilterBar;
