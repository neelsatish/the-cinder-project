/**
 * How the apps reach Cinder Host.
 *
 * In the installed apps every request goes through the native side, which
 * speaks HTTPS pinned to the Host's certificate (see
 * `cinder_core::host_client`); page script cannot reach the network itself.
 * In a plain browser (local development only) it is an ordinary fetch, which
 * Host answers over HTTP for this computer only.
 */

/** A failure the native side named: a changed certificate, an outdated Host. */
export class HostTransportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "HostTransportError";
  }
}

const NAMED_FAILURES = ["host_identity_changed", "host_outdated", "invalid"];

function inTauri() {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

/** 4-byte big-endian length, a JSON header, then the raw body. */
function frame(head: unknown, body: Uint8Array) {
  const encoded = new TextEncoder().encode(JSON.stringify(head));
  const framed = new Uint8Array(4 + encoded.length + body.length);
  new DataView(framed.buffer).setUint32(0, encoded.length);
  framed.set(encoded, 4);
  framed.set(body, 4 + encoded.length);
  return framed;
}

function unframe(raw: ArrayBuffer) {
  const bytes = new Uint8Array(raw);
  const headLength = new DataView(raw).getUint32(0);
  const head = JSON.parse(
    new TextDecoder().decode(bytes.subarray(4, 4 + headLength)),
  ) as { status: number; headers: [string, string][] };
  return { head, body: bytes.slice(4 + headLength) };
}

export async function hostFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (!inTauri()) return fetch(url, init);
  // A Request serialises any body, including FormData with its boundary.
  const request = new Request(url, { ...init, signal: undefined });
  const headers: [string, string][] = [];
  request.headers.forEach((value, name) => headers.push([name, value]));
  const body = new Uint8Array(await request.arrayBuffer());
  const framed = frame(
    // The native limit is a little longer, so the page's own timer decides
    // and reports a timeout rather than a lost connection.
    { url, method: request.method, headers, timeoutMs: timeoutMs + 2_000 },
    body,
  );

  const { invoke } = await import("@tauri-apps/api/core");
  const sent = invoke<ArrayBuffer>("host_request", framed);
  const aborted = new Promise<never>((_, reject) => {
    init.signal?.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError")),
    );
  });
  let raw: ArrayBuffer;
  try {
    raw = await Promise.race([sent, aborted]);
  } catch (error) {
    // The native side reports "code: message".
    const text = String(error);
    const code = NAMED_FAILURES.find((known) => text.startsWith(`${known}:`));
    if (code) throw new HostTransportError(code, text.slice(code.length + 1).trim());
    throw error;
  }
  const { head, body: responseBody } = unframe(raw);
  const nullBody = [101, 204, 205, 304].includes(head.status);
  return new Response(nullBody ? null : responseBody, {
    status: head.status,
    headers: head.headers,
  });
}
