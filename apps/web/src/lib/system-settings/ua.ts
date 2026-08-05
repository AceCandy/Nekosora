/**
 * User-Agent 配置 -- 从 system_settings 读取 chat / gateway 转发 UA。
 *
 * chat UA:chat 工作台转发 + 副任务(标题/摘要/记忆)+ 检测(probe)。
 * gateway UA:API 网关(/v1)转发。
 * 未配置时回退 Nekusora/{version}。保存后调 resetUAConfig 清缓存即时生效。
 */
import { getSetting } from "./service";
import pkg from "../../../package.json";

const DEFAULT_UA = `Nekusora/${pkg.version}`;

let chatUA: string | undefined;
let gatewayUA: string | undefined;
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  try {
    const [chat, gateway] = await Promise.all([
      getSetting("gateway", "chat_ua"),
      getSetting("gateway", "gateway_ua"),
    ]);
    chatUA = chat || undefined;
    gatewayUA = gateway || undefined;
  } catch {
    // DB 不可用(测试 / 启动早期)时降级默认 UA,不阻断转发与检测。
    chatUA = undefined;
    gatewayUA = undefined;
  }
  loaded = true;
}

/** chat 工作台转发 + 副任务 + 检测 用的 UA。 */
export async function getChatUA(): Promise<string> {
  await ensureLoaded();
  return chatUA ?? DEFAULT_UA;
}

/** API 网关转发用的 UA。 */
export async function getGatewayUA(): Promise<string> {
  await ensureLoaded();
  return gatewayUA ?? DEFAULT_UA;
}

/** 设置保存后清缓存,下次读取重新查库。 */
export function resetUAConfig(): void {
  chatUA = undefined;
  gatewayUA = undefined;
  loaded = false;
}

/** 检测请求 headers(含 user-agent=聊天 UA);probe 调用方传入,probeProviderKey 两条路径共用。 */
export async function getProbeHeaders(): Promise<Record<string, string>> {
  return { "user-agent": await getChatUA() };
}
