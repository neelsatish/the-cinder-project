import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, formatDateTime, Panel } from "@cinder/ui";
import { useCallback, useEffect, useState } from "react";

type AutoBackupStatus = {
  folder: string | null;
  keep: number;
  last: string | null;
  last_error: string | null;
  ready: boolean;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

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

  async function save(folder: string | null, nextKeep = keep) {
    setMessage("");
    try {
      const next = await invoke<AutoBackupStatus>("save_auto_backup", { token, folder, keep: nextKeep });
      setStatus(next);
      setMessage(folder ? "Daily backups are on." : "Daily backups are off.");
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function chooseFolder() {
    const folder = await open({ directory: true, multiple: false, title: "Choose where daily backups go" });
    if (typeof folder === "string") await save(folder);
  }

  return (
    <Panel title="Daily backups" className="panel-flush">
      <div className="settings-list">
        <div className="settings-row">
          <div>
            <strong>{status?.folder ? "On" : "Off"}</strong>
            <small>
              {status?.folder ? `Saving to ${status.folder}. ` : "Once a day while Cinder Host is open, an encrypted, checked copy is saved. "}
              Last daily backup: {formatDateTime(status?.last ?? null, "not yet")}.
            </small>
          </div>
          <span className="panel-actions">
            {status?.folder ? <Button variant="ghost" onClick={() => void save(null)}>Turn off</Button> : null}
            <Button variant={status?.folder ? "secondary" : "primary"} onClick={() => void chooseFolder()}>{status?.folder ? "Change folder…" : "Choose folder…"}</Button>
          </span>
        </div>
        <div className="settings-row">
          <div><strong>Copies to keep</strong><small>Older daily copies are removed beyond this number.</small></div>
          <select
            className="toolbar-select"
            aria-label="Copies to keep"
            value={keep}
            onChange={(event) => {
              const next = Number(event.target.value);
              setKeep(next);
              if (status?.folder) void save(status.folder, next);
            }}
          >
            {[7, 14, 30, 60].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </div>
      </div>
      {status && !status.ready ? <p className="notice notice-warning panel-inset">Lock and unlock Cinder Host with its password once so it can prepare encrypted backups.</p> : null}
      {status?.last_error ? <p className="form-error panel-inset" role="alert">The last daily backup failed: {status.last_error}</p> : null}
      {message ? <p className="form-hint panel-inset" role="status">{message}</p> : null}
    </Panel>
  );
}
