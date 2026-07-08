"use client";
/**
 * 用量/错误列表通用筛选栏(Client Component)。
 *
 * 通过 router.push 更新 query 触发服务端重新查询,组件本身不持有数据。
 * 切换筛选会重置 page=1(避免越界)。preservedParams 用于保留 tab / range 等
 * 非筛选项。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Select } from "@/shared/ui/Select";

export interface FilterField {
  /** query 参数名。 */
  name: string;
  /** 标签(已 i18n)。 */
  label: string;
  type: "text" | "select" | "checkbox";
  /** select 的选项。 */
  options?: { value: string; label: string }[];
  /** text 的占位符。 */
  placeholder?: string;
  /** text 宽度占位类(可选,默认 w-40)。 */
  widthClass?: string;
}

interface UsageFiltersProps {
  fields: FilterField[];
  /** 当前已应用的筛选值(来自 searchParams)。 */
  values: Record<string, string>;
  /** 页面根路径。 */
  basePath: string;
  /** 切换筛选时要保留的 query 参数(如 tab / range)。 */
  preservedParams: Record<string, string | undefined>;
  applyLabel: string;
  resetLabel: string;
}

export function UsageFilters({
  fields,
  values,
  basePath,
  preservedParams,
  applyLabel,
  resetLabel,
}: UsageFiltersProps) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, string>>(values);

  const navigate = (vals: Record<string, string>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(preservedParams)) {
      if (v) params.set(k, v);
    }
    for (const f of fields) {
      const v = vals[f.name];
      if (v) params.set(f.name, v);
    }
    router.push(`${basePath}?${params.toString()}`);
  };

  const onApply = () => navigate(state);
  const onReset = () => {
    const cleared: Record<string, string> = {};
    for (const f of fields) cleared[f.name] = "";
    setState(cleared);
    navigate(cleared);
  };

  const update = (name: string, v: string) => setState((prev) => ({ ...prev, [name]: v }));

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {fields.map((f) => {
        if (f.type === "checkbox") {
          return (
            <label
              key={f.name}
              className="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={state[f.name] === "1"}
                onChange={(e) => update(f.name, e.target.checked ? "1" : "")}
                className="rounded border-morning-mist dark:border-deep-space text-sora-blue focus:ring-sora-blue/30"
              />
              {f.label}
            </label>
          );
        }
        return (
          <div key={f.name} className="flex flex-col gap-1">
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500">{f.label}</span>
            {f.type === "select" ? (
              <Select
                value={state[f.name] ?? ""}
                onChange={(e) => update(f.name, e.target.value)}
                className={f.widthClass ?? "w-36 py-1.5 text-xs"}
              >
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                value={state[f.name] ?? ""}
                onChange={(e) => update(f.name, e.target.value)}
                placeholder={f.placeholder}
                className={(f.widthClass ?? "w-40") + " py-1.5 text-xs"}
              />
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-2 mt-[18px]">
        <Button size="sm" variant="primary" onClick={onApply}>
          {applyLabel}
        </Button>
        <Button size="sm" variant="secondary" onClick={onReset}>
          {resetLabel}
        </Button>
      </div>
    </div>
  );
}

export default UsageFilters;
