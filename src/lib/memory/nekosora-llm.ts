import { generateChat } from "@/lib/stream";
import type { IRMessage } from "@/lib/providers/types";

type LangChainMessage = {
  content?: unknown;
  role?: string;
  type?: string;
  _getType?: () => string;
};

type InvokeOptions = {
  response_format?: { type?: string };
};

function messageRole(message: LangChainMessage): IRMessage["role"] {
  const type = message.type ?? message._getType?.() ?? message.role ?? "user";
  if (type === "system") return "system";
  if (type === "ai" || type === "assistant") return "assistant";
  if (type === "tool") return "tool";
  return "user";
}

function messageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  return content == null ? "" : String(content);
}

export function toIRMessages(messages: LangChainMessage[]): IRMessage[] {
  return messages.map((message) => ({
    role: messageRole(message),
    content: messageContent(message.content),
  }));
}

export interface NekosoraLLMOptions {
  modelId: string;
  modelName: string;
}

/** Mem0 langchain provider 所需的最小 invoke() 模型适配器。 */
export function createNekosoraLLM({ modelId, modelName }: NekosoraLLMOptions) {
  return {
    modelId,
    model: modelName,
    response_format: true,
    async invoke(messages: LangChainMessage[], options?: InvokeOptions) {
      const result = await generateChat({
        ctx: { userId: "", keyKind: null, source: "chat" },
        modelId,
        taskKind: "memory",
        output: options?.response_format?.type === "json_object" ? "json" : "text",
        request: {
          model: modelName,
          messages: toIRMessages(messages),
          stream: false,
        },
      });
      if (result.error) throw new Error(result.error);
      return { content: result.text, role: "assistant" };
    },
  };
}
