"use client";

import { clsx } from "clsx";
import SkyAtmosphere from "@/shared/components/SkyAtmosphere";
import { useChatStreamStore } from "@/features/chat/store/chatStreamStore";

/**
 * 视口级品牌天幕:仅空会话欢迎态可见(welcomeMode 由 ChatComposer 同步)。
 * fixed 铺满整个聊天页视口、置于内容层之下(z-0),覆盖侧栏与消息区,
 * 消除「侧栏白底 vs 主区天幕」的色块接缝;退场时 atmosphere-fade 淡出后隐藏。
 */
export default function ChatAtmosphere() {
  const welcomeMode = useChatStreamStore((s) => s.welcomeMode);
  return (
    <div className={clsx("atmosphere-fade pointer-events-none fixed inset-0 z-0", !welcomeMode && "atmosphere-hidden")}>
      <SkyAtmosphere stars={18} seed={20260822} shootingStar composition="skyline" />
    </div>
  );
}
