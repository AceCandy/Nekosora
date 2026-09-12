import type { Experimental_DownloadFunction } from "ai";
import { requestPublicResponse } from "../web-search/public-http";

/** 模型所需的远程文件只从已校验并固定 IP 的公网连接下载。 */
export function createModelDownload(signal?: AbortSignal): Experimental_DownloadFunction {
  return (downloads) => Promise.all(downloads.map(async ({ url, isUrlSupportedByModel }) => {
    if (isUrlSupportedByModel) return null;
    const response = await requestPublicResponse(url, {
      signal,
      // 保持 SDK 原有的单文件 100 MiB 上限。
      maxResponseBytes: 100 * 1024 * 1024,
    });
    if (response.status < 200 || response.status >= 300) throw new Error("图片下载失败");
    return { data: response.body, mediaType: response.headers["content-type"] };
  }));
}
