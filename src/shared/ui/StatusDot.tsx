import React from "react";
import { clsx } from "clsx";

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  enabled: boolean;
  label?: string;
  /** 启用态文案，优先于默认中文，供已接入 i18n 的调用方覆盖。 */
  enabledLabel?: string;
  /** 禁用态文案，优先于默认中文，供已接入 i18n 的调用方覆盖。 */
  disabledLabel?: string;
}

export function StatusDot({ className, enabled, label, enabledLabel, disabledLabel, ...props }: StatusDotProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 text-xs font-semibold select-none",
        enabled ? "text-green-600 dark:text-green-500" : "text-neutral-400 dark:text-neutral-500",
        className
      )}
      {...props}
    >
      <span
        className={clsx(
          "w-1.5 h-1.5 rounded-full transition-all duration-150",
          enabled ? "bg-green-600 dark:bg-green-500" : "bg-neutral-400 dark:bg-neutral-500"
        )}
      />
      {label ?? (enabled ? (enabledLabel ?? "已启用") : (disabledLabel ?? "已禁用"))}
    </span>
  );
}

export default StatusDot;
