import {
  apiChat,
  apiFile,
  apiImageGenerate,
  apiImages,
  apiKnowledgeSearch,
  apiUpload,
  v1AudioSpeech,
  v1AudioTranscriptions,
  v1ChatCompletions,
  v1ImageGenerations,
  v1McpGet,
  v1McpPost,
  v1Models,
} from "@nekusora/core/http";
import { metricsEnabled, metricsOutput } from "@nekusora/observability";
import type { GatewayHandlerName } from "@nekusora/contracts/routes";

export type GatewayHandler = (
  request: Request,
  params: Readonly<Record<string, string>>,
) => Response | Promise<Response>;

async function getMetrics(): Promise<Response> {
  if (!metricsEnabled()) return new Response("metrics disabled", { status: 404 });
  return new Response(await metricsOutput(), {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const gatewayHandlers: Record<GatewayHandlerName, GatewayHandler> = {
  v1Models: (request) => v1Models(request),
  v1ChatCompletions: (request) => v1ChatCompletions(request),
  v1ImageGenerations: (request) => v1ImageGenerations(request),
  v1AudioSpeech: (request) => v1AudioSpeech(request),
  v1AudioTranscriptions: (request) => v1AudioTranscriptions(request),
  v1McpGet: () => v1McpGet(),
  v1McpPost: (request) => v1McpPost(request),
  apiChat: (request) => apiChat(request),
  apiUpload: (request) => apiUpload(request),
  apiFile: (request, params) => apiFile(request, { params: Promise.resolve({ fileId: params.fileId }) }),
  apiImages: (request) => apiImages(request),
  apiImageGenerate: (request) => apiImageGenerate(request),
  apiKnowledgeSearch: (request) => apiKnowledgeSearch(request),
  metrics: () => getMetrics(),
};
