import { handleProtocolRequest } from "@/lib/protocols/handler";
import { parseGeminiGenerateContent } from "@/lib/protocols/parsers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function generateContent(request: Request, model: string) {
  return handleProtocolRequest(
    request,
    "gemini",
    "/v1beta/models/:model:generateContent",
    (body) => parseGeminiGenerateContent(body, model, false),
  );
}

export function streamGenerateContent(request: Request, model: string) {
  return handleProtocolRequest(
    request,
    "gemini",
    "/v1beta/models/:model:streamGenerateContent",
    (body) => parseGeminiGenerateContent(body, model, true),
  );
}
