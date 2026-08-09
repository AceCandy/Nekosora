import { handleProtocolRequest } from "@/lib/protocols/handler";
import { parseResponses } from "@/lib/protocols/parsers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleProtocolRequest(request, "openai-responses", "/v1/responses", parseResponses);
}
