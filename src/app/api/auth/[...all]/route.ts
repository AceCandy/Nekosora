/** Better Auth route handler —— 所有 /api/auth/* 请求转给 Better Auth。 */
import { getAuth } from "@/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Better Auth 实例惰性初始化,handler 包装一层。
async function makeHandlers() {
  const auth = await getAuth();
  return toNextJsHandler(auth);
}

let _handlers: Awaited<ReturnType<typeof makeHandlers>> | null = null;
async function handlers() {
  if (!_handlers) _handlers = await makeHandlers();
  return _handlers;
}

export async function GET(req: Request) {
  const { GET } = await handlers();
  return GET(req);
}

export async function POST(req: Request) {
  const { POST } = await handlers();
  return POST(req);
}
