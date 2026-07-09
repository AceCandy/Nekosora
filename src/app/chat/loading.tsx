/**
 * chat 段导航取数期间的骨架(Suspense fallback)。
 *
 * 点击/切换会话 → 服务端取 RSC 期间,App Router 以此占位,掩盖取数等待(而非停在旧会话画面)。
 * 取数完成后由 ChatComposer 接管,其消息区另有 hide-until-settled 淡入。
 * 克制:冷调中性灰条 + pulse 呼吸,无投影、无彩色粗条(遵「星枢天流」)。
 */
export default function ChatLoading() {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center px-6">
      <div className="w-full max-w-md animate-pulse space-y-2.5">
        <div className="h-3 w-3/4 rounded bg-morning-mist dark:bg-deep-space/60" />
        <div className="h-3 w-full rounded bg-morning-mist dark:bg-deep-space/60" />
        <div className="h-3 w-5/6 rounded bg-morning-mist dark:bg-deep-space/60" />
      </div>
    </div>
  );
}
