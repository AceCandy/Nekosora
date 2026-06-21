import React from "react";
import { clsx } from "clsx";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "primary" | "warning" | "success" | "danger" | "neutral";
}

export function Badge({ className, variant = "neutral", children, ...props }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border transition-all duration-150",
        variant === "primary" && "bg-sora-blue/[0.03] border-sora-blue/20 text-sora-blue",
        variant === "warning" && "bg-neku-amber/[0.03] border-neku-amber/20 text-neku-amber",
        variant === "success" && "bg-green-500/[0.03] border-green-500/20 text-green-600 dark:text-green-400",
        variant === "danger" && "bg-red-500/[0.03] border-red-500/20 text-red-600 dark:text-red-400",
        variant === "neutral" && "bg-neutral-100 dark:bg-neutral-800 border-morning-mist dark:border-deep-space text-neutral-600 dark:text-neutral-300",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export default Badge;
