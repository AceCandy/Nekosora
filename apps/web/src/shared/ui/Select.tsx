"use client";

import React, { forwardRef } from "react";
import { clsx } from "clsx";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={clsx(
          "touch-target rounded-md border border-morning-mist ",
          "bg-white  px-3 py-2 text-ui-body text-space-ink ",
          "focus:outline-none focus:border-sora-blue ",
          "transition-[background-color,color,border-color,box-shadow] duration-150",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className
        )}
        {...props}
      >
        {children}
      </select>
    );
  }
);

Select.displayName = "Select";
export default Select;
