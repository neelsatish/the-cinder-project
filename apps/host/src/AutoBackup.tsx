import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";

type AutoBackupStatus = {
  folder: string | null;
  keep: number;
  last: string | null;
  last_error: string | null;
  ready: boolean;
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const when = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )
    : "Not yet";

/** Daily encrypted backups to a folder the school chooses, ideally another drive. */
export function AutoBackupCard({ token }: { token: string }) {
  const [status, setStatus] = useState<AutoBackupStatus | null>(null);
  const [keep, setKeep] = useState(14);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await invoke<AutoBackupStatus>("auto_backup_status", { token });
      setStatus(next);
      setKeep(next.keep);
    } catch (error) {
      setMessage(errorText(error));
    }
  }, [token]);
  useEffect(() => void load(), [load]);

  async function save(folder: string | null) {
    setMessage("");
    try {
      const next = await invoke<AutoBackupStatus>("save_auto_backup", { token, folder, keep });
      setStatus(next);
      setMessage(folder ? "Daily backups are on." : "Daily backups are off.");
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function chooseFolder() {
    const folder = await open({
      directory: true,
      multiple: false,
      title: "Choose where daily backups go",
    });
    if (typeof folder === "string") await save(folder);
  }

  return (
    <section className="card">
      <h2>Daily backups</h2>
      <p>
        Once a day while Cinder Host is open, an encrypted, verified copy of the school is saved,
        even while the server runs. The oldest are removed beyond the number kept.
      </p>
      {status && !status.ready && (
        <p className="warning">
          Lock and unlock Cinder Host with its password once so it can prepare encrypted backups.
        </p>
      )}
      <label>
        Keep this many
        <select value={keep} onChange={(event) => setKeep(Number(event.target.value))}>
          {[7, 14, 30, 60].map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
      </label>
      <small className="card-note">
        {status?.folder ? `Saving to ${status.folder}. ` : "Off. "}
        Last daily backup: {when(status?.last ?? null)}.
      </small>
      {status?.last_error && <p className="error">Last attempt failed: {status.last_error}</p>}
      <div className="card-actions">
        <button className="primary" onClick={() => void chooseFolder()}>
          {status?.folder ? "Change folder" : "Choose folder and turn on"}
        </button>
        {status?.folder && (
          <>
            <button className="secondary" onClick={() => void save(status.folder)}>
              Save number kept
            </button>
            <button className="secondary" onClick={() => void save(null)}>
              Turn off
            </button>
          </>
        )}
      </div>
      {message && <small className="card-note">{message}</small>}
    </section>
  );
}
