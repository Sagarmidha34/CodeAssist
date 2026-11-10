const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function hasValidSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || request.headers.get("host") || requestUrl.host;
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const protocol = forwardedProto ? `${forwardedProto}:` : requestUrl.protocol;

    if (originUrl.protocol !== protocol) return false;
    if (originUrl.host.toLowerCase() === host.toLowerCase() || originUrl.host.toLowerCase() === requestUrl.host.toLowerCase()) return true;

    // Local development may be opened through either loopback hostname.
    return process.env.NODE_ENV !== "production"
      && loopbackHosts.has(originUrl.hostname)
      && (loopbackHosts.has(new URL(`http://${host}`).hostname) || loopbackHosts.has(requestUrl.hostname))
      && originUrl.port === (new URL(`http://${host}`).port || requestUrl.port);
  } catch {
    return false;
  }
}
