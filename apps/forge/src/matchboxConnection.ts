function isLocalNetworkHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return true;

  const ipv4 = host.split(".").map(Number);
  if (
    ipv4.length === 4 &&
    ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return (
      ipv4[0] === 127 ||
      ipv4[0] === 10 ||
      (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
      (ipv4[0] === 192 && ipv4[1] === 168) ||
      (ipv4[0] === 169 && ipv4[1] === 254)
    );
  }

  if (host === "::1") return true;
  if (!host.includes(":")) return false;
  const firstIpv6Group = Number.parseInt(host.split(":", 1)[0] || "0", 16);
  return (
    (firstIpv6Group & 0xfe00) === 0xfc00 ||
    (firstIpv6Group & 0xffc0) === 0xfe80
  );
}

export function normalizeMatchboxHostAddress(value: string) {
  const input = value.trim();
  if (!/^https?:\/\//i.test(input))
    throw new Error("The Host address must start with http:// or https://.");

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid Cinder Host address.");
  }
  if (!url.hostname) throw new Error("The Host address has no host.");
  if (url.username || url.password || input.includes("?") || input.includes("#"))
    throw new Error("The Host address cannot contain credentials or parameters.");
  if (url.pathname !== "/")
    throw new Error("The Host address cannot contain an extra path.");
  if (url.protocol === "http:" && !isLocalNetworkHost(url.hostname))
    throw new Error("Use HTTPS when connecting outside the local school network.");
  return url.origin;
}

export function isCurrentMatchboxSessionGeneration(
  requestGeneration: number,
  currentGeneration: number,
) {
  return requestGeneration === currentGeneration;
}
