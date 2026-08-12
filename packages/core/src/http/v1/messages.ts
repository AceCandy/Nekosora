import { handleProtocolRequest } from "@/lib/protocols/handler";
import { parseAnthropicMessages } from "@/lib/protocols/parsers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleProtocolRequest(request, "anthropic", "/v1/messages", parseAnthropicMessages);
}
