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
          "touch-target w-full rounded-md border border-morning-mist ",
          "bg-white  px-3 py-2 text-ui-body text-space-ink ",
          "placeholder:text-neutral-600 ",
          "focus:outline-none focus:border-sora-blue ",
          "focus-visible:ring-2 focus-visible:ring-sora-blue focus-visible:ring-offset-1",
          "focus-visible:ring-offset-white ",
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
