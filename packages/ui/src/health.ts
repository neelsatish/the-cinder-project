export function isCinderHealthResponse(value: unknown): value is {
  ok: true;
  version: string;
} {
  if (!value || typeof value !== "object") return false;
  const health = value as { ok?: unknown; version?: unknown };
  return (
    health.ok === true &&
    typeof health.version === "string" &&
    health.version.trim().length > 0
  );
}
