export const GATEWAY_ROUTES = [
  { method: "GET", path: "/v1/models", handler: "v1Models" },
  { method: "POST", path: "/v1/chat/completions", handler: "v1ChatCompletions" },
  { method: "POST", path: "/v1/images/generations", handler: "v1ImageGenerations" },
  { method: "POST", path: "/v1/audio/speech", handler: "v1AudioSpeech" },
  { method: "POST", path: "/v1/audio/transcriptions", handler: "v1AudioTranscriptions" },
  { method: "GET", path: "/v1/mcp", handler: "v1McpGet" },
  { method: "POST", path: "/v1/mcp", handler: "v1McpPost" },
  { method: "POST", path: "/api/chat", handler: "apiChat" },
  { method: "POST", path: "/api/upload", handler: "apiUpload" },
  { method: "GET", path: "/api/files/:fileId", handler: "apiFile" },
  { method: "GET", path: "/api/images", handler: "apiImages" },
  { method: "POST", path: "/api/images/generate", handler: "apiImageGenerate" },
  { method: "POST", path: "/api/knowledge/search", handler: "apiKnowledgeSearch" },
  { method: "GET", path: "/metrics", handler: "metrics" },
] as const;

export type GatewayHandlerName = (typeof GATEWAY_ROUTES)[number]["handler"];

export const GATEWAY_PROXY_ROUTES = GATEWAY_ROUTES.map(({ path }) => path);
