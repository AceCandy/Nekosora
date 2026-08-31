export const BROWSER_OFFLINE_REASON = "browser_offline";

/** 仅将浏览器明确报告的离线状态视为离线；SSR 与未知状态继续尝试请求。 */
export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
