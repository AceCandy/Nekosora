/** Next.js Instrumentation 入口。Node 专用初始化放在独立模块,避免进入 Edge 依赖图。 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeInstrumentation } = await import("./instrumentation.node");
    await registerNodeInstrumentation();
  }
}
