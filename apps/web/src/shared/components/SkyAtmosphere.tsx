import { clsx } from "clsx";
import type { CSSProperties } from "react";

/**
 * 品牌门面天空氛围层:天幕洗色 + 双晖光晕(halo-drift 漂移) + 星点阵(star-twinkle) + 可选流星(shooting-star)。
 *
 * 仅登录页与聊天首屏空会话欢迎区允许使用(DESIGN.md 双晖光晕规则 / 门面限定规则);
 * 工作区与管理界面禁止引入。种子化伪随机保证 SSR 与客户端 hydration 输出一致;
 * 整层 pointer-events: none + aria-hidden,纯视觉不拦截交互;动效受全局 reduced-motion 兜底。
 */

/** 种子化伪随机:确定性输出,SSR/客户端一致。 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Star {
  left: number;
  top: number;
  size: number;
  opacity: number;
  duration: number;
  delay: number;
  twinkle: boolean;
}

/** 生成星点阵:集中在上半部天空,约六成带错峰闪烁,其余静止(低透明度)。 */
function makeStars(count: number, seed: number): Star[] {
  const rng = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    left: rng() * 100,
    top: rng() * 58,
    size: rng() < 0.7 ? 1 : 2,
    opacity: 0.16 + rng() * 0.3,
    duration: 2.8 + rng() * 3.4,
    delay: rng() * 4,
    twinkle: rng() < 0.6,
  }));
}

export interface SkyAtmosphereProps {
  /** 星点数量,0 则关闭星点阵。 */
  stars?: number;
  /** 星点阵随机种子,不同门面用不同种子避免构图雷同。 */
  seed?: number;
  /** 是否渲染偶发流星(约每 14s 划过 1.4s)。 */
  shootingStar?: boolean;
  /**
   * 光晕构图:
   * - `corner`(默认):左上蓝晖 + 右下金晖,适合登录页这类半幅构图;
   * - `skyline`:光晕横贯视口顶部、整体向下消散,适合全宽门面(聊天欢迎区),避免左右区域色温差出接缝。
   */
  composition?: "corner" | "skyline";
  className?: string;
}

export default function SkyAtmosphere({ stars = 24, seed = 20260821, shootingStar = false, composition = "corner", className }: SkyAtmosphereProps) {
  const starList = stars > 0 ? makeStars(stars, seed) : [];
  const wash = composition === "skyline"
    ? "linear-gradient(to bottom, color-mix(in oklab, var(--color-sora-blue) 6%, transparent), transparent 52%)"
    : "linear-gradient(to bottom, color-mix(in oklab, var(--color-sora-blue) 5%, transparent), transparent 42%)";
  const halos = composition === "skyline"
    ? "radial-gradient(85% 60% at 50% -8%, color-mix(in oklab, var(--color-sora-blue) 7%, transparent), transparent 100%)," +
      "radial-gradient(48% 40% at 86% 96%, color-mix(in oklab, var(--color-neku-amber) 5%, transparent), transparent 100%)"
    : "radial-gradient(48% 42% at 24% 12%, color-mix(in oklab, var(--color-sora-blue) 8%, transparent), transparent 100%)," +
      "radial-gradient(42% 38% at 78% 90%, color-mix(in oklab, var(--color-neku-amber) 6%, transparent), transparent 100%)";
  return (
    <div aria-hidden="true" className={clsx("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {/* 天幕洗色:顶部极淡天空蓝,向下消散,奠定「天空」基调 */}
      <div
        className="absolute inset-0"
        style={{ background: wash }}
      />
      {/* 双晖光晕:corner=左上蓝晖+右下金晖;skyline=顶部横贯天幕,慢速漂移呼吸 */}
      <div
        className="halo-drift absolute inset-0"
        style={{ background: halos }}
      />
      {starList.map((star, i) => (
        <span
          key={i}
          className={star.twinkle ? "star-twinkle absolute rounded-full" : "absolute rounded-full"}
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: star.size,
            height: star.size,
            opacity: star.opacity,
            background: "color-mix(in oklab, var(--color-sora-blue) 55%, var(--color-space-ink))",
            ...(star.twinkle
              ? ({ "--star-duration": `${star.duration}s`, "--star-delay": `${star.delay}s` } as CSSProperties)
              : null),
          }}
        />
      ))}
      {shootingStar && <span className="shooting-star" />}
    </div>
  );
}
