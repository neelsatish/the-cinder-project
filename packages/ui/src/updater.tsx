import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Panel } from "./components";

const RELEASE_URL =
  "https://github.com/Alfie3542/the-cinder-project/releases/tag/matchbox-latest";

function isTauri() {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

export function AppUpdater({ appName }: { appName: string }) {
  const [currentVersion, setCurrentVersion] = useState("");
  const [available, setAvailable] = useState<Update | null>(null);
  const [status, setStatus] = useState("Checking for updates…");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const checked = useRef(false);

  const checkForUpdates = useCallback(async () => {
    if (!isTauri()) {
      setStatus("Update checks are available in the installed app.");
      return;
    }
    setBusy(true);
    setProgress(null);
    setStatus("Checking GitHub Releases…");
    try {
      setCurrentVersion(await getVersion());
      const next = await check({ timeout: 15_000 });
      setAvailable(next);
      setStatus(
        next
          ? `${appName} ${next.version} is ready to install.`
          : "You have the latest version.",
      );
    } catch (failure) {
      setStatus(
        failure instanceof Error
          ? failure.message
          : "The update service could not be reached.",
      );
    } finally {
      setBusy(false);
    }
  }, [appName]);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    void checkForUpdates();
  }, [checkForUpdates]);

  const install = async () => {
    if (!available) return;
    setBusy(true);
    setStatus("Downloading the signed update…");
    let received = 0;
    let total = 0;
    try {
      await available.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          received = 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          setProgress(total ? Math.min(100, (received / total) * 100) : null);
        } else {
          setProgress(100);
        }
      });
      setStatus("Update installed. Restarting Cinder…");
      await relaunch();
    } catch (failure) {
      setStatus(
        failure instanceof Error
          ? `${failure.message} You can install the latest package manually below.`
          : "The update could not be installed. Use the manual download below.",
      );
      setBusy(false);
    }
  };

  const openDownloads = async () => {
    if (isTauri()) await openUrl(RELEASE_URL);
    else window.open(RELEASE_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <Panel title="App updates" eyebrow="GitHub Releases">
      <div className="updater-card">
        <div>
          <strong>{appName}</strong>
          <span>
            {currentVersion ? `Installed version ${currentVersion}` : "Installed app"}
          </span>
        </div>
        <p>{status}</p>
        {progress !== null ? (
          <div
            className="updater-progress"
            role="progressbar"
            aria-label="Update download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        ) : null}
        <div className="panel-actions">
          {available ? (
            <Button variant="primary" onClick={() => void install()} disabled={busy}>
              {busy ? "Installing…" : `Install ${available.version}`}
            </Button>
          ) : (
            <Button onClick={() => void checkForUpdates()} disabled={busy}>
              {busy ? "Checking…" : "Check for updates"}
            </Button>
          )}
          <Button variant="ghost" onClick={() => void openDownloads()}>
            Manual downloads
          </Button>
        </div>
        <small>
          Windows setup and AppImage installations update in place. Linux
          package-manager installs may ask you to download the newest .deb manually.
        </small>
      </div>
    </Panel>
  );
}
