"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

/**
 * 登录页星图场景:「星枢」的具象化——轨道系统 + 猫咪星座(Neku) + 坐标刻度。
 *
 * 纯 SVG + CSS 驱动(orbit-spin 公转、star-twinkle 闪烁),无 JS 逐帧;
 * 指针视差通过 --px/--py 两个 CSS 变量按层深 calc 倍增,transition 拖尾平滑,
 * reduced-motion 时直接不挂监听器。整层 pointer-events:none + aria-hidden。
 */

/** 轨道圆心(viewBox 800×900 坐标系)。 */
const CX = 316;
const CY = 396;

const ORBITS = [
  { r: 138, dashed: false, opacity: 0.13 },
  { r: 208, dashed: true, opacity: 0.1 },
  { r: 298, dashed: false, opacity: 0.07 },
] as const;

/** 沿轨道公转的卫星:琥珀金那颗是 Neku 的温度点。 */
const SATELLITES = [
  { r: 138, size: 3, fill: "var(--color-sora-blue)", opacity: 0.55, duration: "36s", reverse: false },
  { r: 208, size: 2.4, fill: "var(--color-space-ink)", opacity: 0.4, duration: "58s", reverse: true },
  { r: 298, size: 3.4, fill: "var(--color-neku-amber)", opacity: 0.75, duration: "84s", reverse: false },
] as const;

/** 猫咪星座顶点(局部坐标,双耳尖 + 头顶 + 双颊 + 下巴)。 */
const CAT_POINTS: Array<[number, number]> = [
  [-36, -44],
  [-13, -23],
  [0, -28],
  [13, -23],
  [36, -44],
  [27, 3],
  [9, 17],
  [-9, 17],
  [-27, 3],
];
const CAT_PATH = CAT_POINTS.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ") + " Z";

export default function StarChart() {
  const rootRef = useRef<HTMLDivElement>(null);

  // 指针视差:把指针相对场景中心的偏移写入 --px/--py,各层按 --depth 倍增位移。
  // 直接写 CSS 变量(不经过 React state),transition 负责平滑拖尾。
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = rootRef.current;
    if (!el) return;
    let raf = 0;
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) return;
        const dx = (event.clientX - (rect.left + rect.width / 2)) / rect.width;
        const dy = (event.clientY - (rect.top + rect.height / 2)) / rect.height;
        el.style.setProperty("--px", (dx * 9).toFixed(2));
        el.style.setProperty("--py", (dy * 7).toFixed(2));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  const parallax = (depth: number): CSSProperties => ({
    transform: "translate3d(calc(var(--px, 0) * 1px * var(--depth)), calc(var(--py, 0) * 1px * var(--depth)), 0)",
    transition: "transform 0.7s cubic-bezier(0.22, 1, 0.36, 1)",
    ["--depth" as string]: depth,
  });

  return (
    <div ref={rootRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* 轨道层(景深远) */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 800 900" preserveAspectRatio="xMidYMid slice" style={parallax(0.7)}>
        <g>
          {ORBITS.map((orbit) => (
            <circle
              key={orbit.r}
              cx={CX}
              cy={CY}
              r={orbit.r}
              fill="none"
              stroke="var(--color-sora-blue)"
              strokeOpacity={orbit.opacity}
              strokeWidth={1}
              strokeDasharray={orbit.dashed ? "1.5 7" : undefined}
            />
          ))}
          {/* 枢轴十字 + 枢点:星枢之名 */}
          <path d={`M${CX - 7},${CY} H${CX + 7} M${CX},${CY - 7} V${CY + 7}`} stroke="var(--color-space-ink)" strokeOpacity={0.3} strokeWidth={1} />
          <circle cx={CX} cy={CY} r={2.4} fill="var(--color-sora-blue)" fillOpacity={0.6} />
        </g>
        {/* 卫星:旋转 g 承载,圆点置于半径处,公转一周即沿轨道一圈 */}
        {SATELLITES.map((sat) => (
          <g
            key={sat.r}
            className="orbit-spin"
            style={{
              transformOrigin: `${CX}px ${CY}px`,
              animationDuration: sat.duration,
              animationDirection: sat.reverse ? "reverse" : undefined,
            }}
          >
            <circle cx={CX + sat.r} cy={CY} r={sat.size} fill={sat.fill} fillOpacity={sat.opacity} />
          </g>
        ))}
        {/* 坐标刻度:星图语言,mono 10px 极弱,于内轨道右侧成组标注 */}
        <text x={CX + 148} y={CY - 10} className="font-mono" fontSize={10} fill="var(--color-ink-tertiary)" fillOpacity={0.55}>
          RA 02h 31m
        </text>
        <text x={CX + 148} y={CY + 8} className="font-mono" fontSize={10} fill="var(--color-ink-tertiary)" fillOpacity={0.55}>
          DEC +41° 16′
        </text>
      </svg>

      {/* 猫咪星座层(景近,视差更大) */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 800 900" preserveAspectRatio="xMidYMid slice" style={parallax(1.5)}>
        <g transform="translate(600,192) scale(1.35)">
          <path d={CAT_PATH} fill="none" stroke="var(--color-sora-blue)" strokeOpacity={0.18} strokeWidth={1} strokeLinejoin="round" />
          {CAT_POINTS.map(([x, y], i) => (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={i % 3 === 0 ? 2.2 : 1.6}
              fill="color-mix(in oklab, var(--color-sora-blue) 55%, var(--color-space-ink))"
              fillOpacity={0.5}
            />
          ))}
          {/* 双眼(Neku 的琥珀温度):让星座一眼读作猫 */}
          <circle cx={-10} cy={-3} r={2.1} fill="var(--color-neku-amber)" fillOpacity={0.65} className="star-twinkle" style={{ "--star-duration": "4.6s" } as CSSProperties} />
          <circle cx={10} cy={-3} r={2.1} fill="var(--color-neku-amber)" fillOpacity={0.65} className="star-twinkle" style={{ "--star-duration": "4.6s", "--star-delay": "2.2s" } as CSSProperties} />
          {/* 胡须:猫形辨识度的最后一笔,从双颊向外各挑两根 */}
          <path
            d="M-23,-1 L-41,-6 M-22,4 L-39,7 M23,-1 L41,-6 M22,4 L39,7"
            stroke="var(--color-sora-blue)"
            strokeOpacity={0.14}
            strokeWidth={1}
            strokeLinecap="round"
          />
        </g>
      </svg>
    </div>
  );
}

/**
 * 移动端降级星图:横带构图,枢点压在底缘,单条轨道弧扫过顶部,
 * 一颗琥珀卫星 48s 公转一周。仅在 md 以下挂载(品牌区隐藏时补位),
 * 不做指针视差;reduced-motion 由全局媒体查询兜底。
 */
export function StarChartStrip() {
  const cx = 200;
  const cy = 168;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-44 overflow-hidden">
      <svg className="h-full w-full" viewBox="0 0 400 176" preserveAspectRatio="xMidYMid slice">
        <circle cx={cx} cy={cy} r={118} fill="none" stroke="var(--color-sora-blue)" strokeOpacity={0.12} strokeWidth={1} />
        <circle cx={cx} cy={cy} r={86} fill="none" stroke="var(--color-sora-blue)" strokeOpacity={0.08} strokeWidth={1} strokeDasharray="1.5 7" />
        {/* 枢点 + 十字压在底缘,只露上半截 */}
        <path d={`M${cx - 6},${cy} H${cx + 6} M${cx},${cy - 6} V${cy + 2}`} stroke="var(--color-space-ink)" strokeOpacity={0.25} strokeWidth={1} />
        <circle cx={cx} cy={cy} r={2} fill="var(--color-sora-blue)" fillOpacity={0.5} />
        <g className="orbit-spin" style={{ transformOrigin: `${cx}px ${cy}px`, animationDuration: "48s", animationDelay: "-36s" }}>
          <circle cx={cx + 118} cy={cy} r={3} fill="var(--color-neku-amber)" fillOpacity={0.7} />
        </g>
        {/* 两颗静星点缀左上 */}
        <circle cx={52} cy={34} r={1.4} fill="color-mix(in oklab, var(--color-sora-blue) 55%, var(--color-space-ink))" fillOpacity={0.4} className="star-twinkle" />
        <circle cx={92} cy={18} r={1.1} fill="color-mix(in oklab, var(--color-sora-blue) 55%, var(--color-space-ink))" fillOpacity={0.35} className="star-twinkle" style={{ "--star-delay": "1.8s" } as CSSProperties} />
      </svg>
    </div>
  );
}
