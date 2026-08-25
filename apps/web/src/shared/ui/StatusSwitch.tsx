"use client";

import type { ButtonHTMLAttributes } from "react";
import { clsx } from "clsx";

export interface StatusSwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-checked" | "aria-label" | "role" | "title"
> {
  checked: boolean;
  label: string;
}

export default function StatusSwitch({
  checked,
  label,
  type = "button",
  className,
  ...props
}: StatusSwitchProps) {
  return (
    <button
      {...props}
      type={type}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className={clsx(
        "touch-target inline-flex cursor-pointer items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue/40 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200",
          checked ? "bg-sora-blue" : "bg-neutral-300",
        )}
      >
        <span
          className={clsx(
            "pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-nebula-white transition-transform duration-200",
            checked ? "translate-x-[18px]" : "translate-x-[2px]",
          )}
        />
      </span>
    </button>
  );
}
