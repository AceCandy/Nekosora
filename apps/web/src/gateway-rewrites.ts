import { GATEWAY_PROXY_ROUTES } from "@nekusora/contracts/routes";

export function buildGatewayRewrites(rawInternalUrl: string | undefined) {
  const gatewayInternalUrl = rawInternalUrl?.replace(/\/+$/, "");
  if (!gatewayInternalUrl) return [];

  return {
    beforeFiles: GATEWAY_PROXY_ROUTES.map((source) => ({
      source,
      destination: `${gatewayInternalUrl}${source}`,
    })),
    afterFiles: [],
    fallback: [],
  };
}
