"use client";

import React, { forwardRef } from "react";
import { clsx } from "clsx";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "contrast";
  size?: "xs" | "sm" | "md";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", loading, children, disabled, type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={clsx(
          // Base styles
          "touch-target inline-flex items-center justify-center gap-1.5 rounded-md font-medium select-none",
          "transition-[background-color,color,border-color,box-shadow,opacity,transform] duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue focus-visible:ring-offset-2",
          "focus-visible:ring-offset-nebula-white dark:focus-visible:ring-offset-twilight-obsidian",
          "disabled:cursor-not-allowed disabled:opacity-50",
          
          // Variants
          variant === "primary" && "bg-sora-blue hover:bg-sora-blue-hover text-nebula-white shadow-none",
          variant === "secondary" && "bg-nebula-white dark:bg-twilight-obsidian text-space-ink dark:text-nebula-silver border border-morning-mist dark:border-deep-space hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10",
          variant === "danger" && "bg-red-600 hover:bg-red-700 text-white shadow-none",
          variant === "ghost" && "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800",
          variant === "contrast" && "bg-neutral-900 hover:bg-neutral-800 text-white dark:bg-white dark:text-black dark:hover:bg-neutral-100",

          // Sizes
          size === "xs" && "px-2 py-1 text-xs",
          size === "sm" && "px-2.5 py-1.5 text-xs",
          size === "md" && "px-3.5 py-2 text-sm",
          
          className
        )}
        {...props}
      >
        {loading ? (
          <span className="flex items-center gap-1">
            <svg className="animate-spin -ml-1 mr-1 h-3.5 w-3.5 text-current" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>加载中...</span>
          </span>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
export default Button;
