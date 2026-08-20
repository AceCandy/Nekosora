import Link from "next/link";
import { clsx } from "clsx";

interface PaginationProps {
  /** 当前页(从 1 起)。 */
  page: number;
  pageSize: number;
  /** 总条数。 */
  total: number;
  /** 构造某页的 href(调用方负责保留 tab/筛选等 query)。 */
  buildHref: (page: number) => string;
  /** 文案。 */
  labels: { prev: string; next: string; summary: string };
}

/**
 * 分页器 —— 纯链接(无 "use client"),可由 Server / Client 组件渲染。
 * 通过 buildHref 回调生成各页 href,跳转由浏览器导航触发服务端重新查询。
 * 样式贴合 DESIGN.md:莫兰迪中性、零影子、细边框。
 */
export function Pagination({ page, pageSize, total, buildHref, labels }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const btnBase =
    "touch-target inline-flex items-center px-2.5 py-1 rounded-md text-ui-caption font-medium border transition-colors duration-150";
  const btnEnabled =
    "border-morning-mist  bg-nebula-white  text-neutral-700  hover:text-sora-blue hover:border-sora-blue/40";
  const btnDisabled = "opacity-40 cursor-not-allowed border-transparent text-neutral-400  select-none";

  return (
    <div className="flex items-center justify-between pt-3">
      <span className="text-ui-caption text-ink-tertiary font-mono">{labels.summary}</span>
      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Link href={buildHref(page - 1)} className={clsx(btnBase, btnEnabled)} prefetch={false}>
            {labels.prev}
          </Link>
        ) : (
          <span className={clsx(btnBase, btnDisabled)}>{labels.prev}</span>
        )}
        {hasNext ? (
          <Link href={buildHref(page + 1)} className={clsx(btnBase, btnEnabled)} prefetch={false}>
            {labels.next}
          </Link>
        ) : (
          <span className={clsx(btnBase, btnDisabled)}>{labels.next}</span>
        )}
      </div>
    </div>
  );
}

export default Pagination;
