export type StoredTeacherSession<T extends { role: string }> = {
  baseUrl: string;
  token: string;
  user: T;
};

export function parseStoredTeacherSession<T extends { role: string }>(
  raw: string,
  fallbackBaseUrl: string,
): StoredTeacherSession<T> | null {
  try {
    const value = JSON.parse(raw) as Partial<StoredTeacherSession<T>>;
    if (
      typeof value.token !== "string" ||
      !value.token ||
      !value.user ||
      value.user.role !== "teacher"
    ) {
      return null;
    }
    return {
      baseUrl:
        typeof value.baseUrl === "string" && value.baseUrl
          ? value.baseUrl
          : fallbackBaseUrl,
      token: value.token,
      user: value.user,
    };
  } catch {
    return null;
  }
}

export function teacherStartupView(
  needsSetup: boolean | null,
  signedIn: boolean,
) {
  if (signedIn) return "workspace" as const;
  return needsSetup ? ("create-school" as const) : ("sign-in" as const);
}

export function teacherReconnectDelay(online: boolean, signedIn: boolean) {
  return signedIn && !online ? 20_000 : null;
}

export function resetTeacherWorkspaceState(generation: number) {
  return {
    generation: generation + 1,
    stats: {
      students: 0,
      classrooms: 0,
      pending_submissions: 0,
      ungraded_submissions: 0,
      present_today: 0,
    },
    students: [],
    classrooms: [],
    assignments: [],
  };
}

export function isCurrentTeacherWorkspaceGeneration(
  requestGeneration: number,
  currentGeneration: number,
) {
  return requestGeneration === currentGeneration;
}

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

export function normalizeTeacherHostAddress(value: string) {
  const input = value.trim();
  if (!/^https?:\/\//i.test(input)) {
    throw new Error("The Host address must start with http:// or https://.");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid Cinder Host address.");
  }
  if (!url.hostname) throw new Error("The Host address has no host.");
  if (url.username || url.password || input.includes("?") || input.includes("#")) {
    throw new Error("The Host address cannot contain credentials or parameters.");
  }
  if (url.pathname !== "/") {
    throw new Error("The Host address cannot contain an extra path.");
  }
  if (url.protocol === "http:" && !isLocalNetworkHost(url.hostname)) {
    throw new Error("Use HTTPS when connecting outside the local school network.");
  }
  return url.origin;
}
