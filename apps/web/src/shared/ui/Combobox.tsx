"use client";
/**
 * Combobox —— 可搜索下拉(typeahead)。
 *
 * 输入 debounce(250ms) → loadOptions(q) → 候选列表。用于筛选栏的用户/密钥/服务商/模型/
 * 上游key;级联过滤(userId/providerName)由调用方在 loadOptions 闭包里注入。
 *
 * 受控:value(id)+displayLabel(已选 label,由父组件随 URL 维护)+onChange(id,label)。
 * fetch 由 event handler(打开/输入)触发,不用 useEffect(规避 react-hooks
 * set-state-in-effect / refs-during-render)。loadOptions 是 prop,直接在 handler 闭包捕获最新。
 */
import { useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { clsx } from "clsx";
import { Popover } from "./Popover";

export interface ComboOption {
  id: string;
  label: string;
  sub?: string;
}

interface ComboboxProps {
  /** 当前选中 id(筛选值)。 */
  value: string;
  /** 已选项展示 label(父组件随 URL 维护;provider/model/upstreamKey 的 label=value)。 */
  displayLabel?: string;
  onChange: (id: string, label: string) => void;
  /** 加载候选(typeahead action 闭包,可带级联 filter)。 */
  loadOptions: (q: string) => Promise<ComboOption[]>;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** 有值时在右侧显示清除(×)按钮:hover 时替代 ▼ 显现,点击清空回到空值。 */
  allowClear?: boolean;
  widthClass?: string;
  triggerClassName?: string;
  panelClassName?: string;
  portal?: boolean;
  ariaLabel?: string;
}

export function Combobox({
  value,
  displayLabel,
  onChange,
  loadOptions,
  placeholder = "选择",
  searchPlaceholder = "搜索...",
  emptyText = "无匹配",
  disabled,
  allowClear = false,
  widthClass = "w-44",
  triggerClassName,
  panelClassName = "w-56",
  portal = true,
  ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<ComboOption[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // event handler 触发 fetch(setTimeout 回调内 setState,非 effect,规避新规则)。
  const runSearch = (query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        setOptions(await loadOptions(query));
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  };

  const onTriggerClick = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setQ("");
      runSearch("");
    }
  };

  const onQueryChange = (v: string) => {
    setQ(v);
    runSearch(v);
  };

  const onSelect = (o: ComboOption) => {
    onChange(o.id, o.label);
    setOpen(false);
    setQ("");
  };

  const label = displayLabel ?? "";
  const showClear = allowClear && !!value && !disabled;

  return (
    <div className={clsx("group relative", widthClass)}>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        side="bottom"
        portal={portal}
        trigger={
          <button
            type="button"
            disabled={disabled}
            onClick={onTriggerClick}
            className={clsx(
              "flex w-full items-center justify-between gap-1.5 px-2.5 py-1.5 text-ui-caption rounded-md border bg-white ",
              "border-neutral-200  text-neutral-700 ",
              "hover:border-neutral-300  transition-colors",
              disabled && "opacity-50 cursor-not-allowed",
              triggerClassName,
            )}
            aria-label={ariaLabel}
          >
            <span className={clsx("truncate", !label && "text-ink-tertiary")}>{label || placeholder}</span>
            <ChevronDown
              className={clsx(
                "size-3.5 text-ink-tertiary shrink-0 transition-opacity",
                showClear && "group-hover:opacity-0",
              )}
            />
          </button>
        }
        panelClassName={panelClassName}
      >
        <div className="p-1.5 space-y-1">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-ink-tertiary" />
            <input
              autoFocus
              value={q}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="w-full pl-6 pr-2 py-1 text-ui-caption rounded border border-neutral-200  bg-white  text-neutral-700  focus:outline-none focus:ring-1 focus:ring-sora-blue/40"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {loading && <div className="px-2 py-1.5 text-ui-caption text-ink-tertiary">…</div>}
            {!loading && options.length === 0 && (
              <div className="px-2 py-1.5 text-ui-caption text-ink-tertiary">{emptyText}</div>
            )}
            {!loading &&
              options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onSelect(o)}
                  className={clsx(
                    "w-full text-left px-2 py-1.5 text-ui-caption rounded transition-colors",
                    o.id === value
                      ? "bg-sora-blue/[0.06] text-sora-blue"
                      : "text-neutral-700  hover:bg-neutral-50 ",
                  )}
                >
                  <span className="block truncate">{o.label}</span>
                  {o.sub && <span className="block text-ui-caption text-ink-tertiary truncate">{o.sub}</span>}
                </button>
              ))}
          </div>
        </div>
      </Popover>
      {showClear && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onChange("", "");
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 z-30 flex size-4 items-center justify-center rounded-sm text-ink-tertiary opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-700 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100  "
          aria-label="清除"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

Combobox.displayName = "Combobox";
export default Combobox;
