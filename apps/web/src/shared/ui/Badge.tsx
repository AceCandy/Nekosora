import React from "react";
import { clsx } from "clsx";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "primary" | "warning" | "success" | "danger" | "neutral";
}

export function Badge({ className, variant = "neutral", children, ...props }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded px-1.5 py-0.5 text-ui-caption font-semibold border transition-[background-color,color,border-color,opacity] duration-150",
        variant === "primary" && "bg-sora-blue/[0.03] border-sora-blue/20 text-sora-blue",
        variant === "warning" && "bg-neku-amber/[0.03] border-neku-amber/20 text-warning",
        variant === "success" && "bg-success/[0.06] border-success/25 text-success ",
        variant === "danger" && "bg-danger/[0.06] border-danger/25 text-danger ",
        variant === "neutral" && "bg-neutral-100  border-morning-mist  text-neutral-600 ",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export default Badge;
