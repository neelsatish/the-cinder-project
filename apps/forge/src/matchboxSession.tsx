import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  ApiError,
  CinderApi,
  Field,
  LoginScreen,
  Modal,
  PasswordChange,
  clearSessionValue,
  loadSessionValue,
  probeHost,
  saveSessionValue,
  type User,
} from "@cinder/ui";
import {
  isCurrentMatchboxSessionGeneration,
  normalizeMatchboxHostAddress,
} from "./matchboxConnection";

type MatchboxConfig = { host_url: string | null; device_label: string | null };
type StoredSession = { baseUrl: string; token: string; user: User };

export type MatchboxSession = {
  user: User;
  api: CinderApi;
  baseUrl: string;
  token: string;
  online: boolean;
  refresh: () => Promise<boolean>;
  switchAccount: () => Promise<void>;
  openConnection: () => void;
};

const SESSION_KEY = "cinder.matchbox.session";
const LEGACY_SESSION_KEY = "cinder.student.session";
const SESSION_KEYS = [SESSION_KEY, LEGACY_SESSION_KEY] as const;
const KNOWN_ACCOUNTS_KEY = "cinder.matchbox.known-accounts";
const DEV_HOST = "http://127.0.0.1:7373";

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

async function readStoredSession(): Promise<StoredSession | null> {
  const raw = await loadSessionValue(SESSION_KEYS);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof session.baseUrl !== "string" || typeof session.token !== "string" || session.user?.role !== "student") {
      throw new Error("Invalid session");
    }
    return session as StoredSession;
  } catch {
    await clearSessionValue(SESSION_KEYS);
    return null;
  }
}

async function normalizeHostAddress(value: string) {
  const normalized = normalizeMatchboxHostAddress(value);
  return isTauri()
    ? invoke<string>("validate_host_address", { baseUrl: normalized })
    : normalized;
}

function readKnownAccounts() {
  try {
    const saved = JSON.parse(localStorage.getItem(KNOWN_ACCOUNTS_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function MatchboxSessionGate({ children }: { children: (session: MatchboxSession) => ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState(DEV_HOST);
  const [deviceLabel, setDeviceLabel] = useState("Student device");
  const [api, setApi] = useState(() => new CinderApi(DEV_HOST));
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [knownAccounts, setKnownAccounts] = useState(readKnownAccounts);
  const sessionGeneration = useRef(0);
  const refreshInFlight = useRef<{
    generation: number;
    promise: Promise<boolean>;
  } | null>(null);

  const refresh = useCallback(() => {
    const generation = sessionGeneration.current;
    if (refreshInFlight.current?.generation === generation)
      return refreshInFlight.current.promise;
    if (!user || !token) return Promise.resolve(false);

    const activeApi = api;
    const activeBaseUrl = baseUrl;
    let tracked: Promise<boolean>;
    tracked = (async () => {
      try {
        const current = await activeApi.me();
        if (
          !isCurrentMatchboxSessionGeneration(
            generation,
            sessionGeneration.current,
          )
        )
          return false;
        const identityChanged = JSON.stringify(current) !== JSON.stringify(user);
        if (identityChanged) {
          await saveSessionValue(
            SESSION_KEYS,
            JSON.stringify({ baseUrl: activeBaseUrl, token, user: current }),
          );
          if (
            !isCurrentMatchboxSessionGeneration(
              generation,
              sessionGeneration.current,
            )
          )
            return false;
        }
        if (identityChanged) setUser(current);
        setOnline(true);
        return true;
      } catch (failure) {
        if (
          !isCurrentMatchboxSessionGeneration(
            generation,
            sessionGeneration.current,
          )
        )
          return false;
        if (failure instanceof ApiError && failure.offline) {
          setOnline(false);
          return false;
        }
        sessionGeneration.current += 1;
        refreshInFlight.current = null;
        activeApi.setToken(null);
        setToken(null);
        setUser(null);
        setTemporaryPassword("");
        await clearSessionValue(SESSION_KEYS);
        return false;
      }
    })().finally(() => {
      if (refreshInFlight.current?.promise === tracked)
        refreshInFlight.current = null;
    });
    refreshInFlight.current = { generation, promise: tracked };
    return tracked;
  }, [api, baseUrl, token, user]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = isTauri()
          ? await invoke<MatchboxConfig>("load_config").catch(() => ({ host_url: DEV_HOST, device_label: "Student device" }))
          : { host_url: DEV_HOST, device_label: "Student device" };
        let stored = await readStoredSession();
        let nextUrl = stored?.baseUrl ?? config.host_url ?? DEV_HOST;
        try {
          nextUrl = await normalizeHostAddress(nextUrl);
        } catch {
          if (stored) await clearSessionValue(SESSION_KEYS);
          stored = null;
          try {
            nextUrl = await normalizeHostAddress(config.host_url ?? DEV_HOST);
          } catch {
            nextUrl = DEV_HOST;
          }
        }
        const nextApi = new CinderApi(nextUrl, stored?.token ?? null);
        if (cancelled) return;
        setBaseUrl(nextUrl);
        setDeviceLabel(config.device_label ?? "Student device");
        setApi(nextApi);
        if (stored) {
          setUser(stored.user);
          setToken(stored.token);
          try {
            const current = await nextApi.me();
            if (cancelled) return;
            setUser(current);
            setOnline(true);
            await saveSessionValue(SESSION_KEYS, JSON.stringify({ ...stored, user: current }));
          } catch (failure) {
            if (failure instanceof ApiError && !failure.offline) {
              sessionGeneration.current += 1;
              refreshInFlight.current = null;
              nextApi.setToken(null);
              await clearSessionValue(SESSION_KEYS);
              if (!cancelled) {
                setUser(null);
                setToken(null);
              }
            } else if (!cancelled) {
              // A valid saved account keeps its local workspace available away from school.
              setOnline(false);
            }
          }
        } else {
          setOnline(await probeHost(nextUrl));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user || !token) return;
    const timer = window.setInterval(
      () => void refresh(),
      online ? 30_000 : 20_000,
    );
    return () => window.clearInterval(timer);
  }, [online, refresh, token, user]);

  async function login(username: string, password: string) {
    const generation = sessionGeneration.current + 1;
    sessionGeneration.current = generation;
    refreshInFlight.current = null;
    const activeApi = api;
    const activeBaseUrl = baseUrl;
    const result = await activeApi.login(username, password, "student", deviceLabel);
    if (
      !isCurrentMatchboxSessionGeneration(
        generation,
        sessionGeneration.current,
      )
    )
      throw new Error("The Cinder Host changed. Sign in again.");
    const saved = await saveSessionValue(
      SESSION_KEYS,
      JSON.stringify({
        baseUrl: activeBaseUrl,
        token: result.token,
        user: result.user,
      }),
    );
    if (
      !isCurrentMatchboxSessionGeneration(
        generation,
        sessionGeneration.current,
      )
    )
      throw new Error("The Cinder Host changed. Sign in again.");
    if (!saved) throw new Error("Cinder could not secure this session on the device.");
    activeApi.setToken(result.token);
    setToken(result.token);
    setUser(result.user);
    setTemporaryPassword(result.user.must_change_password ? password : "");
    setOnline(true);
    const nextAccounts = [result.user.username, ...knownAccounts.filter((name) => name !== result.user.username)].slice(0, 12);
    setKnownAccounts(nextAccounts);
    localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(nextAccounts));
  }

  async function switchAccount() {
    const remoteLogout = online
      ? api.logout().catch(() => undefined)
      : Promise.resolve(undefined);
    sessionGeneration.current += 1;
    refreshInFlight.current = null;
    api.setToken(null);
    setToken(null);
    setUser(null);
    setTemporaryPassword("");
    await clearSessionValue(SESSION_KEYS);
    void remoteLogout;
  }

  async function saveConnection(nextUrl: string, nextLabel: string) {
    const normalized = await normalizeHostAddress(nextUrl);
    // Saving the address is the one deliberate way to trust a Host again, for
    // example after the school replaces its Host computer.
    if (isTauri()) await invoke("forget_host_identity", { baseUrl: normalized });
    if (!(await probeHost(normalized))) throw new Error("No Cinder Host answered at that address.");
    const label = nextLabel.trim() || "Student device";
    if (isTauri()) await invoke("save_config", { config: { host_url: normalized, device_label: label } });
    if (normalized === baseUrl) {
      setDeviceLabel(label);
      setOnline(true);
      setConnectionOpen(false);
      return;
    }

    setLoading(true);
    const remoteLogout = user && online
      ? api.logout().catch(() => undefined)
      : Promise.resolve(undefined);
    sessionGeneration.current += 1;
    refreshInFlight.current = null;
    api.setToken(null);
    setToken(null);
    setUser(null);
    setTemporaryPassword("");
    await clearSessionValue(SESSION_KEYS);

    const nextApi = new CinderApi(normalized);
    setBaseUrl(normalized);
    setDeviceLabel(label);
    setApi(nextApi);
    setOnline(true);
    setConnectionOpen(false);
    setLoading(false);
    void remoteLogout;
  }

  if (loading) return <div className="matchbox-boot">Starting Cinder Student…</div>;
  if (!user) return (
    <>
      <LoginScreen
        role="student"
        subtitle="Your classes and writing workspace, together in Cinder Student."
        helper="Sign in with the account created by your teacher."
        onSubmit={login}
        rememberedUsernames={knownAccounts}
        offlineHint={online ? `Connected to ${baseUrl}` : "Teacher computer not found. Check the school connection before signing in."}
      />
      <button type="button" className="matchbox-connection-button" onClick={() => setConnectionOpen(true)}>School connection</button>
      {connectionOpen ? <ConnectionModal baseUrl={baseUrl} deviceLabel={deviceLabel} onClose={() => setConnectionOpen(false)} onSave={saveConnection} /> : null}
    </>
  );

  return (
    <>
      {children({
        user,
        api,
        baseUrl,
        token: token ?? "",
        online,
        refresh,
        switchAccount,
        openConnection: () => setConnectionOpen(true),
      })}
      {user.must_change_password ? (
        <PasswordChange currentPassword={temporaryPassword} onChange={async (current, next) => {
          const generation = sessionGeneration.current;
          const activeApi = api;
          const activeBaseUrl = baseUrl;
          const activeToken = token;
          const updated = await activeApi.changePassword(current, next);
          if (!isCurrentMatchboxSessionGeneration(generation, sessionGeneration.current)) return;
          if (activeToken) {
            await saveSessionValue(
              SESSION_KEYS,
              JSON.stringify({ baseUrl: activeBaseUrl, token: activeToken, user: updated }),
            );
          }
          if (!isCurrentMatchboxSessionGeneration(generation, sessionGeneration.current)) return;
          setUser(updated);
          setTemporaryPassword("");
        }} />
      ) : null}
      {connectionOpen ? <ConnectionModal baseUrl={baseUrl} deviceLabel={deviceLabel} onClose={() => setConnectionOpen(false)} onSave={saveConnection} /> : null}
    </>
  );
}

function ConnectionModal({ baseUrl, deviceLabel, onClose, onSave }: {
  baseUrl: string;
  deviceLabel: string;
  onClose: () => void;
  onSave: (url: string, label: string) => Promise<void>;
}) {
  const [url, setUrl] = useState(baseUrl);
  const [label, setLabel] = useState(deviceLabel);
  const [found, setFound] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function discover() {
    setBusy(true);
    setError("");
    try {
      const hosts = isTauri() ? await invoke<string[]>("discover_hosts") : [DEV_HOST];
      setFound(hosts);
      if (hosts[0]) setUrl(hosts[0]);
      if (!hosts.length) setError("No teacher app was found automatically. Enter its address below.");
    } catch {
      setError("Automatic discovery was unavailable. Enter the address manually.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="School connection" description="Connect to the Cinder Teacher app on the school network." onClose={onClose}>
      <form className="form-stack" onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try { await onSave(url, label); }
        catch (failure) { setError(failure instanceof Error ? failure.message : "Connection failed."); }
        finally { setBusy(false); }
      }}>
        <Button type="button" onClick={() => void discover()} disabled={busy}>Find teacher computer</Button>
        {found.length > 1 ? <div className="host-list">{found.map((host) => <button type="button" key={host} onClick={() => setUrl(host)}>{host}</button>)}</div> : null}
        <Field label="Teacher app address" hint="Example: http://192.168.1.20:7373"><input value={url} onChange={(event) => setUrl(event.target.value)} /></Field>
        <Field label="This device name"><input value={label} onChange={(event) => setLabel(event.target.value)} /></Field>
        {error ? <p className="form-error">{error}</p> : null}
        <Button variant="primary" type="submit" disabled={busy || !url.trim()}>{busy ? "Checking…" : "Save connection"}</Button>
      </form>
    </Modal>
  );
}
