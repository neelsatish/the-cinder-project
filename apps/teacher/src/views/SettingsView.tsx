import { useCallback, useEffect, useState } from "react";
import {
  AppUpdater,
  Badge,
  Button,
  PageHeader,
  Panel,
  PromptDialog,
  ThemePicker,
  hostAddressLabel,
  type CinderApi,
  type TeacherInvitePin,
  type User,
} from "@cinder/ui";
import { errorText, formatDate } from "../teacherFiles";

export function SettingsView({
  api,
  baseUrl,
  user,
  online,
  onOpenConnection,
  onCurrentDeleted,
  onForgetAccount,
  onUserChanged,
}: {
  api: CinderApi;
  baseUrl: string;
  user: User;
  online: boolean;
  onOpenConnection: () => void;
  onCurrentDeleted: () => void;
  onForgetAccount: (username: string) => void;
  onUserChanged: (user: User) => void;
}) {
  const [teachers, setTeachers] = useState<User[]>([]);
  const [invite, setInvite] = useState<TeacherInvitePin | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"password" | "delete" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadTeachers = useCallback(async () => {
    try { setTeachers(await api.teacherAccounts()); }
    catch (failure) { setError(errorText(failure, "Teacher accounts could not be loaded.")); }
  }, [api]);
  useEffect(() => { void loadTeachers(); }, [loadTeachers]);

  return (
    <div className="workspace">
      <div className="page">
        <PageHeader title="Settings" />
        {message ? <p className="form-success" role="status">{message}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <Panel title="Account" className="panel-flush">
          <div className="settings-list">
            <div className="settings-row">
              <div><strong>{user.display_name}</strong><small>@{user.username}</small></div>
              <Button onClick={() => setDialog("password")}>Change password</Button>
            </div>
            <div className="settings-row">
              <div><strong>School connection</strong><small>{hostAddressLabel(baseUrl)}</small></div>
              <span className="panel-actions">
                <Badge tone={online ? "good" : "warning"}>{online ? "Connected" : "Reconnecting"}</Badge>
                <Button onClick={onOpenConnection}>Change</Button>
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="Appearance" className="panel-flush">
          <div className="settings-list">
            <div className="settings-row"><div><strong>Theme</strong></div><ThemePicker /></div>
          </div>
        </Panel>

        <Panel
          title="Teachers at this school"
          className="panel-flush"
          action={
            <Button
              size="small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try { setInvite(await api.generateTeacherInvite()); }
                catch (failure) { setError(errorText(failure, "An invite PIN could not be created.")); }
                finally { setBusy(false); }
              }}
            >
              {invite ? "New invite PIN" : "Invite a teacher"}
            </Button>
          }
        >
          {invite ? (
            <div className="panel-body">
              <div className="credential-box">
                <span className="muted">Invite PIN, for one new teacher</span>
                <code className="credential-code">{invite.invite_pin}</code>
                <small className="muted">The new teacher chooses Join an existing school when signing in. Expires {formatDate(invite.expires_at)}; a new PIN replaces this one.</small>
              </div>
            </div>
          ) : null}
          <div className="list">
            {teachers.map((teacher) => (
              <div className="list-item" key={teacher.id}>
                <span className="account-initial" aria-hidden="true">{teacher.display_name.slice(0, 1).toUpperCase()}</span>
                <span className="list-copy"><strong>{teacher.display_name}</strong><span>@{teacher.username}{teacher.id === user.id ? " · You" : ""}</span></span>
              </div>
            ))}
          </div>
        </Panel>

        <AppUpdater appName="Cinder Teacher" />

        <Panel title="Delete account" className="panel-flush">
          <div className="settings-list">
            <div className="settings-row">
              <div><strong>Delete your teacher account</strong><small>You are signed out everywhere. Classrooms, work and marks are kept.</small></div>
              <Button variant="danger" onClick={() => setDialog("delete")}>Delete…</Button>
            </div>
          </div>
        </Panel>
      </div>

      {dialog === "password" ? (
        <PromptDialog
          title="Change password"
          fields={[
            { name: "current", label: "Current password", type: "password", required: true },
            { name: "next", label: "New password", type: "password", required: true, hint: "At least 8 characters." },
            { name: "confirm", label: "Confirm new password", type: "password", required: true },
          ]}
          submitLabel="Change password"
          onSubmit={async (values) => {
            if (values.next.length < 8) throw new Error("Use at least 8 characters.");
            if (values.next !== values.confirm) throw new Error("The new passwords do not match.");
            onUserChanged(await api.changePassword(values.current, values.next));
            setMessage("Password changed.");
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "delete" ? (
        <PromptDialog
          title="Delete your teacher account?"
          description="This signs you out everywhere. Classroom data is kept."
          fields={[{ name: "password", label: "Your password", type: "password", required: true }]}
          submitLabel="Delete account"
          danger
          onSubmit={async (values) => {
            const result = await api.deleteTeacher(user.id, values.password);
            onForgetAccount(user.username);
            if (result.deleted_current) onCurrentDeleted();
            else await loadTeachers();
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
