import { unstable_rethrow } from "next/navigation";

/** 聊天读取边界：保留框架控制流，日志不携带查询参数或原始异常。 */
export async function loadChatData<T>(
  operation: string,
  request: Promise<T>,
  fallback?: () => T,
): Promise<T> {
  try {
    return await request;
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[chat-load] ${operation} failed`);
    if (fallback) return fallback();
    throw new Error("Chat data could not be loaded");
  }
}
