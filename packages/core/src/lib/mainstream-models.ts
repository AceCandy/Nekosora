/** 自动收录的主流模型家族；新增家族只需扩展此表。 */
export const MAINSTREAM_MODEL_FAMILIES = [
  { family: "gpt", provider: "openai", prefix: "gpt-" },
  { family: "claude", provider: "anthropic", prefix: "claude-" },
  { family: "gemini", provider: "google", prefix: "gemini-" },
  { family: "glm", provider: "zai", prefix: "glm-" },
  { family: "minimax", provider: "minimax", prefix: "minimax-" },
  { family: "kimi", provider: "moonshotai", prefix: "kimi-" },
  { family: "mimo", provider: "xiaomi", prefix: "mimo-" },
  { family: "grok", provider: "xai", prefix: "grok-" },
  { family: "qwen", provider: "qwen-token-plan", prefix: "qwen" },
  { family: "deepseek", provider: "deepseek", prefix: "deepseek-" },
] as const;

export type MainstreamModelFamily = typeof MAINSTREAM_MODEL_FAMILIES[number];

const SPECIALIZED_MARKERS = [
  "-batch",
  "-live",
  "-image",
  "-customtools",
  "-computer-use",
  "-highspeed",
  "-robotics",
  "-realtime",
];
const DATE_SNAPSHOT = /-(?:20\d{6}|20\d{2}-\d{2}-\d{2}|\d{2}-20\d{2})$/;

/** 仅把官方主 Provider 下的通用型号识别为自动新增候选。 */
export function getMainstreamModelFamily(
  provider: string,
  modelId: string,
): MainstreamModelFamily | null {
  const id = modelId.trim().toLowerCase();
  const family = MAINSTREAM_MODEL_FAMILIES.find((entry) =>
    entry.provider === provider && id.startsWith(entry.prefix));
  if (!family) return null;
  if (id.endsWith("-latest") || DATE_SNAPSHOT.test(id)) return null;
  if (SPECIALIZED_MARKERS.some((marker) => id.includes(marker))) return null;
  return family;
}
