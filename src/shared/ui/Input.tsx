"use client";

import React, { forwardRef } from "react";
import { clsx } from "clsx";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={clsx(
          "w-full rounded-md border border-morning-mist dark:border-deep-space",
          "bg-white dark:bg-[#0f121a] px-3 py-2 text-sm text-space-ink dark:text-nebula-silver",
          "focus:outline-none focus:border-sora-blue dark:focus:border-sora-blue",
          "focus-visible:ring-2 focus-visible:ring-sora-blue/20 transition-all duration-150",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
export default Input;
