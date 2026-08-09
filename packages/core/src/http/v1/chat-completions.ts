import { handleProtocolRequest } from "@/lib/protocols/handler";
import { parseChatCompletions } from "@/lib/protocols/parsers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleProtocolRequest(
    request,
    "openai-chat",
    "/v1/chat/completions",
    parseChatCompletions,
  );
}
