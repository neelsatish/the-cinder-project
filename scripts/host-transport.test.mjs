import assert from "node:assert/strict";
import test from "node:test";

// Stand in for the installed apps' webview: every request goes to the native
// "host_request" command. The framing here mirrors cinder_core::host_client.
let handler;
globalThis.window = globalThis;
globalThis.__TAURI_INTERNALS__ = {
  invoke: (command, payload, options) => handler(command, payload, options),
};
const { hostFetch, HostTransportError } = await import(
  "../packages/ui/src/hostTransport.ts"
);
const { clearSessionValue } = await import("../packages/ui/src/session.ts");

const HOST = "http://192.168.1.20:7373";

function unpack(framed) {
  const view = new DataView(framed.buffer, framed.byteOffset, framed.byteLength);
  const length = view.getUint32(0);
  return {
    meta: JSON.parse(new TextDecoder().decode(framed.subarray(4, 4 + length))),
    body: framed.subarray(4 + length),
  };
}

function pack(status, headers, body = new Uint8Array()) {
  const head = new TextEncoder().encode(JSON.stringify({ status, headers }));
  const framed = new Uint8Array(4 + head.length + body.length);
  new DataView(framed.buffer).setUint32(0, head.length);
  framed.set(head, 4);
  framed.set(body, 4 + head.length);
  return framed.buffer;
}

test("a binary multipart upload reaches the native side intact", async () => {
  let seen;
  handler = async (command, payload) => {
    assert.equal(command, "host_request");
    seen = unpack(payload);
    return pack(
      201,
      [["content-type", "application/json"]],
      new TextEncoder().encode('{"id":"n1"}'),
    );
  };
  const form = new FormData();
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0a]);
  form.append("file", new Blob([pdf], { type: "application/pdf" }), "paper.pdf");

  const response = await hostFetch(
    `${HOST}/api/files`,
    { method: "POST", body: form, headers: { Authorization: "Bearer t" } },
    10_000,
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: "n1" });
  assert.equal(seen.meta.url, `${HOST}/api/files`);
  assert.equal(seen.meta.method, "POST");
  assert.equal(seen.meta.timeoutMs, 12_000);
  const header = (name) => seen.meta.headers.find(([key]) => key === name)?.[1];
  assert.equal(header("authorization"), "Bearer t");
  assert.match(header("content-type"), /^multipart\/form-data; boundary=/);
  assert.ok(Buffer.from(seen.body).includes(Buffer.from(pdf)));
});

test("binary replies and empty replies come back as real Responses", async () => {
  const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
  handler = async () => pack(200, [["content-type", "application/pdf"]], bytes);
  const download = await hostFetch(`${HOST}/api/files/x`, {}, 1_000);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
  assert.equal(download.headers.get("content-type"), "application/pdf");

  handler = async () => pack(204, []);
  const empty = await hostFetch(`${HOST}/api/cards/x`, { method: "DELETE" }, 1_000);
  assert.equal(empty.status, 204);
  assert.equal(await empty.text(), "");

  handler = async () =>
    pack(426, [["content-type", "application/json"]], new TextEncoder().encode('{"error":"upgrade_required"}'));
  const refused = await hostFetch(`${HOST}/api/health`, {}, 1_000);
  assert.equal(refused.ok, false);
  assert.equal((await refused.json()).error, "upgrade_required");
});

test("named native failures reach the page; others stay connection errors", async () => {
  for (const code of ["host_untrusted", "host_identity_changed", "host_outdated"]) {
    handler = async () => {
      throw `${code}: Explained for the person.`;
    };
    await assert.rejects(
      hostFetch(`${HOST}/api/health`, {}, 1_000),
      (error) =>
        error instanceof HostTransportError &&
        error.code === code &&
        error.message === "Explained for the person.",
    );
  }
  handler = async () => {
    throw "offline: The Host is currently unreachable.";
  };
  await assert.rejects(
    hostFetch(`${HOST}/api/health`, {}, 1_000),
    (error) => !(error instanceof HostTransportError),
  );
});

test("replacing a Host cannot proceed if the saved session cannot be cleared", async () => {
  handler = async (command) => {
    assert.equal(command, "clear_secure_session");
    throw new Error("secure storage unavailable");
  };
  await assert.rejects(clearSessionValue(["test-session"], true), /secure storage unavailable/);
});

test("the page's own timeout wins over a request that never answers", async () => {
  handler = () => new Promise(() => {});
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(
    hostFetch(`${HOST}/api/health`, { signal: controller.signal }, 1_000),
    { name: "AbortError" },
  );
});

test("an outdated Host is recognised from page and raw native errors", async () => {
  const { isHostOutdated } = await import("../packages/ui/src/hostTransport.ts");
  assert.equal(isHostOutdated(new HostTransportError("host_outdated", "Update Host.")), true);
  assert.equal(isHostOutdated("host_outdated: Update Host."), true);
  assert.equal(isHostOutdated(new HostTransportError("host_untrusted", "Check the code.")), false);
  assert.equal(isHostOutdated("offline"), false);
  assert.equal(isHostOutdated(null), false);
});

test("the shown Host address matches the HTTPS address the native side uses", async () => {
  const { hostAddressLabel } = await import("../packages/ui/src/hostTransport.ts");
  assert.equal(hostAddressLabel(HOST), "https://192.168.1.20:7373");
  assert.equal(hostAddressLabel("http://[fd00::5]:7373"), "https://[fd00::5]:7373");
  // An implicit port 80 stays 80, as in cinder_core::host_client::https_url.
  assert.equal(hostAddressLabel("http://school.local"), "https://school.local:80");
  assert.equal(hostAddressLabel("https://host.example.org:7373"), "https://host.example.org:7373");
  assert.equal(hostAddressLabel("not an address"), "not an address");
  // A plain browser (development only) really does use HTTP.
  const internals = globalThis.__TAURI_INTERNALS__;
  delete globalThis.__TAURI_INTERNALS__;
  try {
    assert.equal(hostAddressLabel(HOST), HOST);
  } finally {
    globalThis.__TAURI_INTERNALS__ = internals;
  }
});
