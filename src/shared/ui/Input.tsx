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
          "touch-target w-full rounded-md border border-morning-mist dark:border-deep-space",
          "bg-white dark:bg-space-ink px-3 py-2 text-ui-body text-space-ink dark:text-nebula-silver",
          "placeholder:text-neutral-600 dark:placeholder:text-neutral-400",
          "focus:outline-none focus:border-sora-blue dark:focus:border-sora-blue",
          "focus-visible:ring-2 focus-visible:ring-sora-blue focus-visible:ring-offset-1",
          "focus-visible:ring-offset-white dark:focus-visible:ring-offset-space-ink",
          "transition-[background-color,color,border-color,box-shadow] duration-150",
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
