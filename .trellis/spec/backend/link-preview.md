# Link Preview

## 1. Scope / Trigger

Apply this contract when changing chat Markdown link metadata previews, bare image URL MIME probes, or remote preview image proxying. The authenticated `/api/link-preview` route owns the server boundary. Every remote request must use the restricted public HTTP layer instead of calling `fetch(hostname)` directly.

## 2. Signatures

- `GET /api/link-preview?mode=probe|metadata|image&url=<absolute-http-url>`
- `probeLink(input, signal): Promise<LinkPreviewData>`
- `fetchLinkMetadata(input, signal): Promise<LinkPreviewData>`
- `fetchLinkPreviewImage(input, signal): Promise<{ body; contentType }>`
- `requestPublicResponse(input, options): Promise<PublicHttpResponse>`
- `resolvePublicHttpUrl(input, resolver?, signal?): Promise<{ url; address }>`

`LinkPreviewData.kind` is `html | image | other`. Metadata fields are nullable `title`, `description`, `siteName`, `imageUrl`, and `iconUrl` values.

## 3. Contracts

- Authenticate the session before parsing `mode` and the URL, which is limited to 4096 characters.
- The total request timeout is six seconds. The same `AbortSignal` must cover DNS waiting, the initial connection, body reads, and every redirect hop. If the DNS API has no native signal support, race it against abort and remove the listener after settlement.
- Accept only credential-free, fragment-free public HTTP/HTTPS targets. Reject the entire lookup if any DNS result is non-public. Connect to the validated IP while preserving the original Host/SNI, and resolve and validate every redirect again.
- Keep `198.18.0.0/15` blocked. When every system DNS answer is in that Fake-IP range, resolve A/AAAA through HTTPS pinned to the public `1.1.1.1` endpoint, validate every returned address, and connect to the validated real IP. Never connect to the Fake-IP itself.
- `probe` uses HEAD first and falls back to a bodyless GET for any non-2xx response; if GET also fails, surface an upstream failure instead of caching an `other` result.
- `metadata` parses only HTML/XHTML and reads at most the first 256 KiB. Truncate a large page prefix for parsing instead of rejecting it from the complete `Content-Length` before reading.
- A non-2xx metadata response is an upstream failure, not a successful empty preview. This keeps the client failure cache retryable on the next hover.
- Use a structured HTML parser for title, description, Open Graph/Twitter images, and icons. Resolve relative resources against the final page URL.
- `image` reads at most 3 MiB, proxies only AVIF/GIF/JPEG/PNG/WebP and favicon MIME types, and returns `nosniff`. Never proxy SVG or other response types.
- `probe`, `metadata`, and `image` use the same browser-compatible User-Agent and Accept-Language headers so ordinary anti-hotlink rules do not reject the server request solely as an unidentified Node client. Never forward the user's Cookie, Authorization, or Referer headers to the target.
- `mode=image` serves both metadata card assets and Markdown body images. The browser, image modal, and download action must request this authenticated same-origin endpoint instead of loading the remote URL directly.
- Never expose remote response bodies, internal addresses, credentials, low-level errors, or stacks through the API response.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Missing session | Standard API authentication error |
| Invalid mode or URL | `request.invalid_json` with the link-preview parameter message |
| Private, loopback, credential URL, or redirect to a non-public target | `request.invalid_json` with the non-previewable link message |
| Every system DNS answer is Fake-IP and DoH returns public addresses | Continue with the validated real IP |
| DoH returns any non-public address | Reject before the target connection |
| DNS, connection, or body read exceeds six seconds | `gateway.timeout` |
| HTML or image exceeds its configured limit | `request.payload_too_large` |
| Remote failure or unsupported MIME | `gateway.upstream_error` |
| Valid response without metadata | Return nullable fields; the UI falls back to domain and URL |

## 5. Good / Base / Bad Cases

- Good: a public GitHub page reads only a bounded HTML prefix and returns a title, description, and safely proxied icon; clicking the link still uses the existing confirmation flow.
- Good: an extensionless CDN URL probes as `image/png`, so the client promotes it to standard Markdown image syntax.
- Base: a page has no Open Graph metadata, so the API returns the final URL with null metadata and the client displays the domain and full URL.
- Bad: the browser loads an arbitrary OG image URL declared by a page, bypassing server-side public-address validation.
- Bad: the signal reaches only the HTTP request, so a stuck DNS resolver outlives the API timeout.
- Bad: use an iframe, a third-party screenshot service, or user cookies to load the remote page.

## 6. Tests Required

- Public HTTP: private IPv4/IPv6, DNS rebinding, redirect hops, response limits, HTML prefix truncation, and transport abort.
- DNS abort: keep the resolver pending forever, abort the request, assert rejection, and assert that neither HTTP nor HTTPS transport starts.
- Fake-IP: assert pinned DoH fallback, real-IP target connection, non-public DoH rejection, and abort propagation.
- Metadata: Open Graph/Twitter/HTML precedence, relative image/icon URLs, and missing fields.
- Images: extensionless MIME probe, HEAD 405/501 fallback, valid raster body pass-through, and SVG/error/oversize rejection.
- Request compatibility: assert browser-compatible headers are applied to probe, metadata, and image requests while credentials and Referer are absent.
- API: authentication, invalid parameters, timeout mapping, and sanitized security failures.

## 7. Wrong vs Correct

Wrong:

```ts
const response = await fetch(url, { signal });
```

Correct:

```ts
const response = await requestPublicResponse(url, {
  signal,
  maxResponseBytes: HTML_LIMIT,
  truncateBody: true,
});
```

The first form can resolve an unpinned hostname and does not guarantee public-address validation on every redirect. The shared restricted request owns DNS checks, fixed-IP connections, redirects, cancellation, and response limits.
