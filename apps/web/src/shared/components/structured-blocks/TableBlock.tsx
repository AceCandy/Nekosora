"use client";

import { clsx } from "clsx";
import type { TableData } from "./schema";

/** 列对齐 → 文本对齐类。 */
function alignClass(align?: string): string {
  if (align === "center") return "text-center";
  if (align === "right") return "text-right";
  return "text-left";
}

/** 结构化表格：按 columns 定义渲染，支持列对齐与单元格强调。 */
export function TableBlock({ data }: { data: TableData }) {
  return (
    <div className="my-2 overflow-x-auto rounded-lg border border-morning-mist ">
      <table className="w-full text-ui-body border-collapse">
        <thead>
          <tr className="bg-morning-mist/50 ">
            {data.columns.map((col) => (
              <th
                key={col.key}
                className={clsx(
                  "px-3 py-2 font-medium text-space-ink  whitespace-nowrap",
                  alignClass(col.align),
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i} className="border-t border-morning-mist ">
              {data.columns.map((col) => {
                const cell = row[col.key];
                return (
                  <td
                    key={col.key}
                    className={clsx(
                      "px-3 py-2 text-space-ink ",
                      col.emphasis && "font-semibold",
                      alignClass(col.align),
                    )}
                  >
                    {cell == null ? "" : String(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
