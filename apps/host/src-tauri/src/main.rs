#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use chrono::Utc;
use rand::{distributions::Alphanumeric, Rng};
use rusqlite::{backup::Backup, params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Manager, State};
use tokio::{sync::oneshot, task::JoinHandle};

const SESSION_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Serialize, Deserialize)]
struct HostConfig {
    data_dir: PathBuf,
    school_name: String,
    bind: IpAddr,
    port: u16,
    password_hash: String,
    recovery_hash: String,
}

struct AdminSession {
    token: String,
    touched: Instant,
}
struct ServerHandle {
    stop: oneshot::Sender<()>,
    task: JoinHandle<()>,
}
struct Inner {
    config: Option<HostConfig>,
    config_error: Option<String>,
    session: Option<AdminSession>,
    server: Option<ServerHandle>,
    maintenance: bool,
    bootstrap_pin: Option<String>,
    failed_logins: u8,
    blocked_until: Option<Instant>,
}
struct HostAdmin {
    config_path: PathBuf,
    inner: Mutex<Inner>,
}

#[derive(Serialize)]
struct PublicState {
    configured: bool,
    config_error: Option<String>,
    running: bool,
    school_name: Option<String>,
    data_dir: Option<String>,
    port: Option<u16>,
}
#[derive(Serialize)]
struct SetupResult {
    recovery_code: String,
    bootstrap_pin: Option<String>,
}
#[derive(Serialize)]
struct Dashboard {
    running: bool,
    school_name: String,
    lan_url: String,
    data_dir: String,
    database_bytes: u64,
    files_bytes: u64,
    teachers: i64,
    students: i64,
    classrooms: i64,
    files: i64,
    trashed_files: i64,
    missing_blobs: i64,
    orphaned_blobs: i64,
    duplicate_references: i64,
    last_backup: Option<String>,
    bootstrap_pin: Option<String>,
    /// Short form of the Host certificate fingerprint that apps pin.
    security_code: Option<String>,
}
#[derive(Serialize)]
struct Person {
    id: String,
    username: String,
    display_name: String,
    role: String,
    disabled_at: Option<String>,
    last_login: Option<String>,
    classrooms: String,
}
#[derive(Serialize)]
struct StoredFile {
    node_id: String,
    display_name: String,
    original_name: String,
    mime: String,
    bytes: i64,
    sha256: String,
    owner: Option<String>,
    classroom: Option<String>,
    created_at: String,
    references: i64,
    trashed_at: Option<String>,
    missing: bool,
}
#[derive(Serialize)]
struct CredentialResult {
    temporary_password: String,
    recovery_code: String,
}
#[derive(Serialize)]
struct AuditEntry {
    id: i64,
    action: String,
    target_type: Option<String>,
    target_id: Option<String>,
    detail: String,
    created_at: String,
}
#[derive(Default, Serialize)]
struct AiUsageSummary {
    requests: i64,
    input_tokens: i64,
    output_tokens: i64,
    lifetime_requests: i64,
    lifetime_input_tokens: i64,
    lifetime_output_tokens: i64,
    /// Input plus output tokens allowed per calendar month; `None` is no limit.
    monthly_token_limit: Option<i64>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BackupManifest {
    version: u32,
    school_name: String,
    created_at: String,
    database: String,
    files_dir: String,
    file_count: u64,
    blob_count: u64,
    total_bytes: u64,
}

fn random_code(length: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}
/// The TLS identity lives beside the Host's own settings, not in the school
/// data folder, so a school reset or restore does not change it and every app
/// that already trusts this Host keeps trusting it.
fn tls_identity(admin: &HostAdmin) -> Result<cinder_host::tls::TlsIdentity, String> {
    let dir = admin
        .config_path
        .parent()
        .ok_or("Host configuration path has no parent.")?
        .join("tls");
    cinder_host::tls::load_or_create_identity(&dir).map_err(|e| e.to_string())
}
fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("host-admin.json"))
        .map_err(|e| e.to_string())
}
fn save_config(path: &Path, config: &HostConfig) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("Host configuration path has no parent.")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary
        .write_all(&serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.error.to_string())?;
    Ok(())
}

fn validate_config(config: &HostConfig) -> Result<(), String> {
    if config.school_name.trim().is_empty()
        || !config.data_dir.is_absolute()
        || !(1024..=65535).contains(&config.port)
        || !config.password_hash.starts_with("$argon2")
        || !config.recovery_hash.starts_with("$argon2")
    {
        return Err("The saved Host configuration is invalid. Restore host-admin.json from backup or remove it deliberately to set up a new Host.".into());
    }
    Ok(())
}

fn validate_password(password: &str) -> Result<(), String> {
    let length = password.chars().count();
    if !(8..=cinder_host::auth::MAX_PASSWORD_CHARS).contains(&length) {
        return Err("The Host password must contain between 8 and 1,024 characters.".into());
    }
    Ok(())
}
fn require_session(inner: &mut Inner, token: &str) -> Result<(), String> {
    let Some(session) = inner.session.as_mut() else {
        return Err("Unlock Cinder Host first.".into());
    };
    if session.token != token || session.touched.elapsed() > SESSION_TTL {
        inner.session = None;
        return Err("Cinder Host locked after 15 minutes. Unlock it again.".into());
    }
    session.touched = Instant::now();
    Ok(())
}
fn authorised_config(admin: &HostAdmin, token: &str) -> Result<HostConfig, String> {
    let mut inner = admin
        .inner
        .lock()
        .map_err(|_| "Host state is unavailable.".to_owned())?;
    require_session(&mut inner, token)?;
    inner
        .config
        .clone()
        .ok_or_else(|| "Set up Cinder Host first.".to_owned())
}

fn with_maintenance<T>(
    admin: &HostAdmin,
    token: &str,
    operation: impl FnOnce(&HostConfig) -> Result<T, String>,
) -> Result<T, String> {
    let config = {
        let mut inner = admin
            .inner
            .lock()
            .map_err(|_| "Host state is unavailable.".to_owned())?;
        require_session(&mut inner, token)?;
        if inner.maintenance {
            return Err("Host maintenance is already in progress.".into());
        }
        if inner
            .server
            .as_ref()
            .is_some_and(|server| !server.task.is_finished())
        {
            return Err("Stop the Host before changing school storage or settings.".into());
        }
        let config = inner.config.clone().ok_or("Set up Cinder Host first.")?;
        inner.maintenance = true;
        config
    };
    let result = operation(&config);
    if let Ok(mut inner) = admin.inner.lock() {
        inner.maintenance = false;
    }
    result
}
fn database(config: &HostConfig) -> Result<Connection, String> {
    let conn = Connection::open(config.data_dir.join("cinder.db")).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}
fn audit(
    conn: &Connection,
    action: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
    detail: &str,
) -> Result<(), String> {
    conn.execute("INSERT INTO operator_audit(action,target_type,target_id,detail,created_at) VALUES(?1,?2,?3,?4,?5)", params![action,target_type,target_id,detail,Utc::now().to_rfc3339()]).map_err(|e| e.to_string())?;
    Ok(())
}
fn data_size(path: &Path) -> u64 {
    let Ok(meta) = fs::metadata(path) else {
        return 0;
    };
    if meta.is_file() {
        return meta.len();
    }
    fs::read_dir(path)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| data_size(&entry.path()))
        .sum()
}
fn lan_url(bind: IpAddr, port: u16) -> String {
    let ip = if bind.is_unspecified() {
        UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
            .ok()
            .and_then(|s| {
                s.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
                s.local_addr().ok().map(|a| a.ip())
            })
            .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST))
    } else {
        bind
    };
    format!("https://{ip}:{port}")
}
fn blob_path(root: &Path, sha: &str) -> PathBuf {
    root.join(&sha[..2]).join(sha)
}

fn validate_sha(sha: &str) -> Result<(), String> {
    if sha.len() != 64
        || !sha
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("The backup contains an invalid stored-file hash.".into());
    }
    Ok(())
}

fn file_sha(path: &Path) -> Result<(String, u64), String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        total += read as u64;
    }
    Ok((hex::encode(hasher.finalize()), total))
}

#[tauri::command]
fn public_state(admin: State<HostAdmin>) -> PublicState {
    let inner = admin.inner.lock().expect("host state");
    PublicState {
        configured: inner.config.is_some() || inner.config_error.is_some(),
        config_error: inner.config_error.clone(),
        running: inner.server.as_ref().is_some_and(|s| !s.task.is_finished()),
        school_name: inner.config.as_ref().map(|c| c.school_name.clone()),
        data_dir: inner
            .config
            .as_ref()
            .map(|c| c.data_dir.display().to_string()),
        port: inner.config.as_ref().map(|c| c.port),
    }
}

#[tauri::command]
fn setup_host(
    admin: State<HostAdmin>,
    data_dir: String,
    school_name: String,
    password: String,
    port: u16,
) -> Result<SetupResult, String> {
    if school_name.trim().is_empty() {
        return Err("Enter the school name.".into());
    }
    if !(1024..=65535).contains(&port) {
        return Err("Choose a port from 1024 to 65535.".into());
    }
    validate_password(&password)?;
    if !Path::new(&data_dir).is_absolute() {
        return Err("Choose an absolute school-data folder.".into());
    }
    let mut inner = admin
        .inner
        .lock()
        .map_err(|_| "Host state is unavailable.".to_owned())?;
    if inner.config.is_some() {
        return Err("Cinder Host is already set up.".into());
    }
    let recovery_code = random_code(24);
    let config = HostConfig {
        data_dir: PathBuf::from(data_dir),
        school_name: school_name.trim().to_owned(),
        bind: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        port,
        password_hash: cinder_host::auth::hash_password(&password).map_err(|e| e.to_string())?,
        recovery_hash: cinder_host::auth::hash_password(&recovery_code)
            .map_err(|e| e.to_string())?,
    };
    let state = cinder_host::AppState::open(&config.data_dir, cinder_ai::Ai::disabled())
        .map_err(|e| e.to_string())?;
    let bootstrap_pin =
        cinder_host::routes::auth::prepare_bootstrap_pin(&state.pool).map_err(|e| e.to_string())?;
    {
        let conn = state.pool.get().map_err(|e| e.to_string())?;
        conn.execute("INSERT OR REPLACE INTO school_settings(key,value,updated_at) VALUES('school_name',?1,?2)", params![config.school_name,Utc::now().to_rfc3339()]).map_err(|e| e.to_string())?;
        audit(&conn, "host.setup", Some("school"), None, "Host configured")?;
    }
    save_config(&admin.config_path, &config)?;
    inner.config = Some(config);
    Ok(SetupResult {
        recovery_code,
        bootstrap_pin,
    })
}

#[tauri::command]
fn unlock(admin: State<HostAdmin>, password: String) -> Result<String, String> {
    let mut inner = admin
        .inner
        .lock()
        .map_err(|_| "Host state is unavailable.".to_owned())?;
    if inner
        .blocked_until
        .is_some_and(|until| until > Instant::now())
    {
        return Err("Too many attempts. Wait 30 seconds and try again.".into());
    }
    let config = inner
        .config
        .as_ref()
        .ok_or_else(|| "Set up Cinder Host first.".to_owned())?;
    if !cinder_host::auth::verify_password(&config.password_hash, &password) {
        inner.failed_logins += 1;
        if inner.failed_logins >= 5 {
            inner.failed_logins = 0;
            inner.blocked_until = Some(Instant::now() + Duration::from_secs(30));
        }
        return Err("The Host password is incorrect.".into());
    }
    inner.failed_logins = 0;
    inner.blocked_until = None;
    let token = random_code(48);
    inner.session = Some(AdminSession {
        token: token.clone(),
        touched: Instant::now(),
    });
    Ok(token)
}

#[tauri::command]
fn unlock_with_recovery(
    admin: State<HostAdmin>,
    recovery_code: String,
    new_password: String,
) -> Result<SetupResult, String> {
    validate_password(&new_password)?;
    let mut inner = admin
        .inner
        .lock()
        .map_err(|_| "Host state is unavailable.".to_owned())?;
    let config = inner
        .config
        .as_mut()
        .ok_or_else(|| "Set up Cinder Host first.".to_owned())?;
    if !cinder_host::auth::verify_password(&config.recovery_hash, &recovery_code) {
        return Err("The Host recovery code is not valid.".into());
    }
    let next = random_code(24);
    config.password_hash =
        cinder_host::auth::hash_password(&new_password).map_err(|e| e.to_string())?;
    config.recovery_hash = cinder_host::auth::hash_password(&next).map_err(|e| e.to_string())?;
    save_config(&admin.config_path, config)?;
    Ok(SetupResult {
        recovery_code: next,
        bootstrap_pin: None,
    })
}

#[tauri::command]
fn lock(admin: State<HostAdmin>) -> Result<(), String> {
    let mut inner = admin
        .inner
        .lock()
        .map_err(|_| "Host state is unavailable.".to_owned())?;
    inner.session = None;
    Ok(())
}

#[tauri::command]
fn current_bootstrap_pin(admin: State<HostAdmin>, token: String) -> Result<Option<String>, String> {
    let mut inner = admin
        .inner
        .lock()
        .map_err(|_| "Host state is unavailable.".to_owned())?;
    require_session(&mut inner, &token)?;
    Ok(inner.bootstrap_pin.clone())
}

#[tauri::command]
async fn start_server(admin: State<'_, HostAdmin>, token: String) -> Result<(), String> {
    let mut inner = admin
        .inner
        .lock()
        .map_err(|_| "Host state is unavailable.".to_owned())?;
    require_session(&mut inner, &token)?;
    if inner.maintenance {
        return Err("Host maintenance is in progress.".into());
    }
    let config = inner.config.clone().ok_or("Set up Cinder Host first.")?;
    if inner.server.as_ref().is_some_and(|s| !s.task.is_finished()) {
        return Ok(());
    }
    let state = cinder_host::AppState::open(&config.data_dir, cinder_ai::Ai::disabled())
        .map_err(|e| e.to_string())?;
    let bootstrap_pin =
        cinder_host::routes::auth::prepare_bootstrap_pin(&state.pool).map_err(|e| e.to_string())?;
    let identity = tls_identity(&admin)?;
    let listener =
        cinder_host::bind(SocketAddr::new(config.bind, config.port)).map_err(|e| e.to_string())?;
    let (stop, stopped) = oneshot::channel();
    let task = tokio::spawn(async move {
        let advertised = cinder_host::discovery::advertise(config.port, &config.school_name).ok();
        let _ = cinder_host::serve_on_with_shutdown(state, listener, identity, async {
            let _ = stopped.await;
        })
        .await;
        if let Some(daemon) = advertised {
            let _ = daemon.shutdown();
        }
    });
    inner.server = Some(ServerHandle { stop, task });
    inner.bootstrap_pin = bootstrap_pin;
    Ok(())
}

#[tauri::command]
async fn stop_server(admin: State<'_, HostAdmin>, token: String) -> Result<(), String> {
    let server = {
        let mut inner = admin
            .inner
            .lock()
            .map_err(|_| "Host state is unavailable.".to_owned())?;
        require_session(&mut inner, &token)?;
        if inner.maintenance {
            return Err("Host maintenance is in progress.".into());
        }
        inner.server.take()
    };
    if let Some(server) = server {
        let _ = server.stop.send(());
        let _ = server.task.await;
    }
    Ok(())
}

#[tauri::command]
fn dashboard(admin: State<HostAdmin>, token: String) -> Result<Dashboard, String> {
    let config = authorised_config(&admin, &token)?;
    let conn = database(&config)?;
    let count = |sql| {
        conn.query_row(sql, [], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())
    };
    let files_dir = config.data_dir.join("files");
    let mut missing = 0;
    let mut known = std::collections::HashSet::new();
    {
        let mut stmt = conn
            .prepare("SELECT DISTINCT sha256 FROM files")
            .map_err(|e| e.to_string())?;
        for sha in stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
        {
            let sha = sha.map_err(|e| e.to_string())?;
            if !blob_path(&files_dir, &sha).exists() {
                missing += 1;
            }
            known.insert(sha);
        }
    }
    let mut disk = Vec::new();
    collect_blob_names(&files_dir, &mut disk);
    let orphaned = disk.iter().filter(|sha| !known.contains(*sha)).count() as i64;
    let running = admin
        .inner
        .lock()
        .map_err(|_| "Host state is unavailable.".to_owned())?
        .server
        .as_ref()
        .is_some_and(|s| !s.task.is_finished());
    let bootstrap_pin = admin
        .inner
        .lock()
        .map_err(|_| "Host state is unavailable.".to_owned())?
        .bootstrap_pin
        .clone();
    Ok(Dashboard { running, school_name: config.school_name.clone(), lan_url: lan_url(config.bind,config.port), data_dir: config.data_dir.display().to_string(), database_bytes: data_size(&config.data_dir.join("cinder.db")), files_bytes: data_size(&files_dir), teachers: count("SELECT count(*) FROM users WHERE role='teacher' AND disabled_at IS NULL")?, students: count("SELECT count(*) FROM users WHERE role='student' AND disabled_at IS NULL")?, classrooms: count("SELECT count(*) FROM classrooms WHERE archived_at IS NULL")?, files: count("SELECT count(*) FROM files")?, trashed_files: count("SELECT count(*) FROM trashed_files")?, missing_blobs: missing, orphaned_blobs: orphaned, duplicate_references: count("SELECT COALESCE(sum(n-1),0) FROM (SELECT count(*) n FROM files GROUP BY sha256 HAVING n>1)")?, last_backup: conn.query_row("SELECT value FROM school_settings WHERE key='last_backup'",[],|r|r.get(0)).optional().map_err(|e|e.to_string())?, bootstrap_pin, security_code: tls_identity(&admin).ok().map(|identity| identity.display_fingerprint()) })
}
fn collect_blob_names(path: &Path, out: &mut Vec<String>) {
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                collect_blob_names(&p, out)
            } else if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if name.len() == 64 {
                    out.push(name.to_owned())
                }
            }
        }
    }
}

#[tauri::command]
fn list_people(
    admin: State<HostAdmin>,
    token: String,
    search: String,
    role: Option<String>,
) -> Result<Vec<Person>, String> {
    let config = authorised_config(&admin, &token)?;
    let conn = database(&config)?;
    let needle = format!("%{}%", search.trim());
    let role = role.unwrap_or_default();
    let mut stmt=conn.prepare("SELECT u.id,u.username,u.display_name,u.role,u.disabled_at,(SELECT max(created_at) FROM sessions s WHERE s.user_id=u.id),COALESCE((SELECT group_concat(c.name, ', ') FROM classrooms c LEFT JOIN classroom_enrolments e ON e.classroom_id=c.id WHERE (u.role='student' AND e.student_id=u.id) OR (u.role='teacher' AND c.owner_teacher_id=u.id)), '') FROM users u WHERE (?1='' OR u.username LIKE ?1 OR u.display_name LIKE ?1) AND (?2='' OR u.role=?2) ORDER BY u.role DESC, lower(u.display_name)").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map(params![needle, role], |r| {
            Ok(Person {
                id: r.get(0)?,
                username: r.get(1)?,
                display_name: r.get(2)?,
                role: r.get(3)?,
                disabled_at: r.get(4)?,
                last_login: r.get(5)?,
                classrooms: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
fn update_person(
    admin: State<HostAdmin>,
    token: String,
    id: String,
    username: String,
    display_name: String,
) -> Result<(), String> {
    let config = authorised_config(&admin, &token)?;
    if username.trim().is_empty() || display_name.trim().is_empty() {
        return Err("Name and username are required.".into());
    }
    let conn = database(&config)?;
    conn.execute(
        "UPDATE users SET username=?2,display_name=?3 WHERE id=?1",
        params![id, username.trim(), display_name.trim()],
    )
    .map_err(|e| e.to_string())?;
    audit(
        &conn,
        "person.update",
        Some("user"),
        Some(&id),
        "Name or username changed",
    )
}

#[tauri::command]
fn reset_person_credentials(
    admin: State<HostAdmin>,
    token: String,
    id: String,
    admin_password: String,
) -> Result<CredentialResult, String> {
    let config = authorised_config(&admin, &token)?;
    if !cinder_host::auth::verify_password(&config.password_hash, &admin_password) {
        return Err("The Host password is incorrect.".into());
    }
    let mut conn = database(&config)?;
    let role: String = conn
        .query_row("SELECT role FROM users WHERE id=?1", [&id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let password = random_code(12);
    let recovery = random_code(20);
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("UPDATE users SET pw_hash=?2,must_change_password=1,failed_login_attempts=0,login_blocked_until=NULL WHERE id=?1",params![id,cinder_host::auth::hash_password(&password).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    let table = if role == "teacher" {
        "teacher_recovery"
    } else {
        "student_recovery"
    };
    tx.execute(&format!("INSERT INTO {table}(user_id,recovery_hash,created_at,rotated_at) VALUES(?1,?2,?3,?3) ON CONFLICT(user_id) DO UPDATE SET recovery_hash=excluded.recovery_hash,rotated_at=excluded.rotated_at"),params![id,cinder_host::auth::hash_password(&recovery).map_err(|e|e.to_string())?,now]).map_err(|e|e.to_string())?;
    tx.execute("DELETE FROM sessions WHERE user_id=?1", [&id])
        .map_err(|e| e.to_string())?;
    audit(&tx, "person.credentials_reset", Some("user"), Some(&id), "")?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(CredentialResult {
        temporary_password: password,
        recovery_code: recovery,
    })
}

#[tauri::command]
fn set_person_disabled(
    admin: State<HostAdmin>,
    token: String,
    id: String,
    disabled: bool,
    transfer_to: Option<String>,
) -> Result<(), String> {
    let config = authorised_config(&admin, &token)?;
    let mut conn = database(&config)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if disabled {
        let owned: i64 = tx
            .query_row(
                "SELECT count(*) FROM classrooms WHERE owner_teacher_id=?1 AND archived_at IS NULL",
                [&id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if owned > 0 {
            let target = transfer_to
                .as_deref()
                .ok_or("Transfer this teacher's classrooms before disabling the account.")?;
            let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM users WHERE id=?1 AND role='teacher' AND disabled_at IS NULL)",[target],|r|r.get(0)).map_err(|e|e.to_string())?;
            if !valid {
                return Err("Choose an active teacher for the transfer.".into());
            }
            tx.execute(
                "UPDATE classrooms SET owner_teacher_id=?2 WHERE owner_teacher_id=?1",
                params![id, target],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "UPDATE users SET disabled_at=?2 WHERE id=?1",
            params![id, Utc::now().to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM sessions WHERE user_id=?1", [&id])
            .map_err(|e| e.to_string())?;
    } else {
        tx.execute("UPDATE users SET disabled_at=NULL WHERE id=?1", [&id])
            .map_err(|e| e.to_string())?;
    }
    audit(
        &tx,
        if disabled {
            "person.disable"
        } else {
            "person.restore"
        },
        Some("user"),
        Some(&id),
        "",
    )?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
fn list_files(
    admin: State<HostAdmin>,
    token: String,
    search: String,
    trashed_only: bool,
) -> Result<Vec<StoredFile>, String> {
    let config = authorised_config(&admin, &token)?;
    let conn = database(&config)?;
    let needle = format!("%{}%", search.trim());
    let mut stmt=conn.prepare("SELECT f.node_id,n.name,f.orig_name,f.mime,f.bytes,f.sha256,u.display_name,c.name,f.created_at,(SELECT count(*) FROM files x WHERE x.sha256=f.sha256),t.trashed_at FROM files f JOIN nodes n ON n.id=f.node_id LEFT JOIN users u ON u.id=n.owner_id LEFT JOIN classrooms c ON c.id=n.classroom_id LEFT JOIN trashed_files t ON t.node_id=f.node_id WHERE (?1='' OR n.name LIKE ?1 OR f.orig_name LIKE ?1 OR u.display_name LIKE ?1 OR c.name LIKE ?1) AND ((?2=1 AND t.node_id IS NOT NULL) OR (?2=0 AND t.node_id IS NULL)) ORDER BY f.created_at DESC").map_err(|e|e.to_string())?;
    let root = config.data_dir.join("files");
    let rows = stmt
        .query_map(params![needle, trashed_only], |r| {
            let sha: String = r.get(5)?;
            Ok(StoredFile {
                node_id: r.get(0)?,
                display_name: r.get(1)?,
                original_name: r.get(2)?,
                mime: r.get(3)?,
                bytes: r.get(4)?,
                missing: !blob_path(&root, &sha).exists(),
                sha256: sha,
                owner: r.get(6)?,
                classroom: r.get(7)?,
                created_at: r.get(8)?,
                references: r.get(9)?,
                trashed_at: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
fn read_file(admin: State<HostAdmin>, token: String, node_id: String) -> Result<Vec<u8>, String> {
    let config = authorised_config(&admin, &token)?;
    let conn = database(&config)?;
    let (sha, bytes, mime): (String, u64, String) = conn
        .query_row(
            "SELECT sha256,bytes,mime FROM files WHERE node_id=?1",
            [node_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    if bytes > 20 * 1024 * 1024 {
        return Err("Preview is limited to files up to 20 MB. Download this file instead.".into());
    }
    if mime != "application/pdf" && !mime.starts_with("image/") {
        return Err("This file type cannot be previewed.".into());
    }
    validate_sha(&sha)?;
    fs::read(blob_path(&config.data_dir.join("files"), &sha)).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_file(
    admin: State<HostAdmin>,
    token: String,
    node_id: String,
    destination: String,
) -> Result<(), String> {
    let config = authorised_config(&admin, &token)?;
    let conn = database(&config)?;
    let sha: String = conn
        .query_row(
            "SELECT sha256 FROM files WHERE node_id=?1",
            [node_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    validate_sha(&sha)?;
    fs::copy(blob_path(&config.data_dir.join("files"), &sha), destination)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn trash_file(
    admin: State<HostAdmin>,
    token: String,
    node_id: String,
    restore: bool,
) -> Result<(), String> {
    let config = authorised_config(&admin, &token)?;
    let conn = database(&config)?;
    if restore {
        conn.execute("DELETE FROM trashed_files WHERE node_id=?1", [&node_id])
            .map_err(|e| e.to_string())?;
    } else {
        conn.execute("INSERT OR REPLACE INTO trashed_files(node_id,trashed_at,trashed_by) VALUES(?1,?2,'host-admin')",params![node_id,Utc::now().to_rfc3339()]).map_err(|e|e.to_string())?;
    }
    audit(
        &conn,
        if restore {
            "file.restore"
        } else {
            "file.trash"
        },
        Some("file"),
        Some(&node_id),
        "",
    )
}

#[tauri::command]
fn rename_file(
    admin: State<HostAdmin>,
    token: String,
    node_id: String,
    name: String,
) -> Result<(), String> {
    let config = authorised_config(&admin, &token)?;
    if name.trim().is_empty() {
        return Err("Enter a file name.".into());
    }
    let conn = database(&config)?;
    conn.execute("UPDATE nodes SET name=?2,updated_at=?3 WHERE id=?1 AND EXISTS(SELECT 1 FROM files WHERE node_id=?1)",params![node_id,name.trim(),Utc::now().to_rfc3339()]).map_err(|e|e.to_string())?;
    audit(
        &conn,
        "file.rename",
        Some("file"),
        Some(&node_id),
        name.trim(),
    )
}

#[tauri::command]
fn empty_trash(admin: State<HostAdmin>, token: String, password: String) -> Result<u64, String> {
    let config = authorised_config(&admin, &token)?;
    if !cinder_host::auth::verify_password(&config.password_hash, &password) {
        return Err("The Host password is incorrect.".into());
    }
    let mut conn = database(&config)?;
    let rows: Vec<(String, String)> = {
        let mut s=conn.prepare("SELECT f.node_id,f.sha256 FROM files f JOIN trashed_files t ON t.node_id=f.node_id").map_err(|e|e.to_string())?;
        let found = s
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        found
    };
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (node, _) in &rows {
        tx.execute("DELETE FROM nodes WHERE id=?1", [node])
            .map_err(|e| e.to_string())?;
    }
    audit(
        &tx,
        "trash.empty",
        Some("file"),
        None,
        &format!("{} files", rows.len()),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    for (_, sha) in &rows {
        let referenced: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM files WHERE sha256=?1)",
                [sha],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !referenced {
            let _ = fs::remove_file(blob_path(&config.data_dir.join("files"), sha));
        }
    }
    Ok(rows.len() as u64)
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let to = destination.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &to)?
        } else if !to.exists()
            || fs::metadata(&to).map(|m| m.len()).unwrap_or(0)
                != entry.metadata().map(|m| m.len()).unwrap_or(u64::MAX)
        {
            fs::copy(entry.path(), to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
fn verify_backup(path: &Path) -> Result<BackupManifest, String> {
    let manifest: BackupManifest =
        serde_json::from_slice(&fs::read(path.join("manifest.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if manifest.version != 1 || manifest.database != "cinder.db" || manifest.files_dir != "files" {
        return Err("This is not a supported Cinder Host backup.".into());
    }
    let conn = Connection::open(path.join("cinder.db")).map_err(|e| e.to_string())?;
    let check: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err(format!("Backup database failed integrity check: {check}"));
    }
    let file_count: u64 = conn
        .query_row("SELECT count(*) FROM files", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if file_count != manifest.file_count {
        return Err("Backup file count does not match its manifest.".into());
    }
    let mut stmt = conn
        .prepare("SELECT sha256, min(bytes), max(bytes) FROM files GROUP BY sha256")
        .map_err(|e| e.to_string())?;
    let blobs = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, u64>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if blobs.len() as u64 != manifest.blob_count {
        return Err("Backup blob count does not match its manifest.".into());
    }
    let mut total_bytes = 0u64;
    for (sha, minimum, maximum) in blobs {
        validate_sha(&sha)?;
        if minimum != maximum {
            return Err(format!("Stored file {sha} has conflicting sizes."));
        }
        let stored_path = blob_path(&path.join("files"), &sha);
        let (actual_sha, actual_bytes) =
            file_sha(&stored_path).map_err(|_| format!("Backup is missing stored file {sha}."))?;
        if actual_sha != sha || actual_bytes != maximum {
            return Err(format!(
                "Stored file {sha} failed hash or size verification."
            ));
        }
        total_bytes = total_bytes
            .checked_add(actual_bytes)
            .ok_or("Backup size overflowed.")?;
    }
    if total_bytes != manifest.total_bytes {
        return Err("Backup byte total does not match its manifest.".into());
    }
    Ok(manifest)
}
fn create_backup(config: &HostConfig, parent: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let live = fs::canonicalize(&config.data_dir).map_err(|e| e.to_string())?;
    let parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
    if parent.starts_with(&live) {
        return Err("Choose a backup folder outside the live school-data folder.".into());
    }
    let stamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let destination = parent.join(format!("cinder-backup-{stamp}-{}", random_code(6)));
    fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
    let source = database(config)?;
    source
        .execute_batch("PRAGMA wal_checkpoint(FULL);")
        .map_err(|e| e.to_string())?;
    let mut target = Connection::open(destination.join("cinder.db")).map_err(|e| e.to_string())?;
    Backup::new(&source, &mut target)
        .map_err(|e| e.to_string())?
        .run_to_completion(32, Duration::from_millis(10), None)
        .map_err(|e| e.to_string())?;
    drop(target);
    copy_tree(&config.data_dir.join("files"), &destination.join("files"))?;
    let conn = database(config)?;
    let file_count = conn
        .query_row("SELECT count(*) FROM files", [], |r| r.get::<_, u64>(0))
        .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT sha256, max(bytes) FROM files GROUP BY sha256")
        .map_err(|e| e.to_string())?;
    let blobs = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let total_bytes = blobs.iter().try_fold(0u64, |total, (sha, bytes)| {
        validate_sha(sha)?;
        total
            .checked_add(*bytes)
            .ok_or_else(|| "Backup size overflowed.".to_owned())
    })?;
    let manifest = BackupManifest {
        version: 1,
        school_name: config.school_name.clone(),
        created_at: Utc::now().to_rfc3339(),
        database: "cinder.db".into(),
        files_dir: "files".into(),
        file_count,
        blob_count: blobs.len() as u64,
        total_bytes,
    };
    fs::write(
        destination.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    verify_backup(&destination)?;
    Ok(destination)
}

#[tauri::command]
fn backup_school(
    admin: State<HostAdmin>,
    token: String,
    destination: String,
) -> Result<String, String> {
    with_maintenance(&admin, &token, |config| {
        let path = create_backup(config, Path::new(&destination))?;
        let conn = database(config)?;
        let now = Utc::now().to_rfc3339();
        conn.execute("INSERT OR REPLACE INTO school_settings(key,value,updated_at) VALUES('last_backup',?1,?1)", [&now]).map_err(|e| e.to_string())?;
        audit(
            &conn,
            "backup.create",
            Some("backup"),
            None,
            &path.display().to_string(),
        )?;
        Ok(path.display().to_string())
    })
}

fn stage_backup(config: &HostConfig, backup: &Path) -> Result<PathBuf, String> {
    let backup = fs::canonicalize(backup).map_err(|e| e.to_string())?;
    verify_backup(&backup)?;
    let parent = config
        .data_dir
        .parent()
        .ok_or("School data folder has no parent.")?;
    let stage = parent.join(format!(".cinder-stage-{}", random_code(12)));
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let result = (|| {
        fs::copy(backup.join("cinder.db"), stage.join("cinder.db")).map_err(|e| e.to_string())?;
        copy_tree(&backup.join("files"), &stage.join("files"))?;
        fs::copy(backup.join("manifest.json"), stage.join("manifest.json"))
            .map_err(|e| e.to_string())?;
        verify_backup(&stage)?;
        let conn = Connection::open(stage.join("cinder.db")).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM sessions", [])
            .map_err(|e| e.to_string())?;
        fs::remove_file(stage.join("manifest.json")).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&stage);
        return Err(error);
    }
    Ok(stage)
}

fn swap_data_dirs(live: &Path, staged: &Path, inject_failure: bool) -> Result<(), String> {
    let parent = live.parent().ok_or("School data folder has no parent.")?;
    let rollback = parent.join(format!(".cinder-rollback-{}", random_code(12)));
    fs::rename(live, &rollback).map_err(|e| format!("Could not prepare school-data swap: {e}"))?;
    let install = if inject_failure {
        Err("Injected install failure.".to_owned())
    } else {
        fs::rename(staged, live).map_err(|e| format!("Could not install staged school data: {e}"))
    };
    if let Err(error) = install {
        fs::rename(&rollback, live).map_err(|rollback_error| {
            format!("{error} Automatic rollback also failed: {rollback_error}")
        })?;
        return Err(error);
    }
    let _ = fs::remove_dir_all(rollback);
    Ok(())
}

#[tauri::command]
fn restore_school(
    admin: State<HostAdmin>,
    token: String,
    password: String,
    backup: String,
) -> Result<String, String> {
    with_maintenance(&admin, &token, |config| {
        if !cinder_host::auth::verify_password(&config.password_hash, &password) {
            return Err("The Host password is incorrect.".into());
        }
        let safety_root = config
            .data_dir
            .parent()
            .ok_or("School data folder has no parent.")?
            .join("Cinder recovery archives");
        let safety = create_backup(config, &safety_root)?;
        let staged = stage_backup(config, Path::new(&backup))?;
        {
            let conn = Connection::open(staged.join("cinder.db")).map_err(|e| e.to_string())?;
            audit(&conn, "school.restore", Some("backup"), None, &backup)?;
        }
        swap_data_dirs(&config.data_dir, &staged, false)?;
        Ok(safety.display().to_string())
    })
}

#[tauri::command]
fn reset_school(
    admin: State<HostAdmin>,
    token: String,
    password: String,
    typed_school_name: String,
) -> Result<SetupResult, String> {
    with_maintenance(&admin, &token, |config| {
        if typed_school_name.trim() != config.school_name {
            return Err("Type the school name exactly to confirm reset.".into());
        }
        if !cinder_host::auth::verify_password(&config.password_hash, &password) {
            return Err("The Host password is incorrect.".into());
        }
        let parent = config
            .data_dir
            .parent()
            .ok_or("School data folder has no parent.")?;
        let archive = create_backup(config, &parent.join("Cinder recovery archives"))?;
        let staged = parent.join(format!(".cinder-stage-{}", random_code(12)));
        fs::create_dir(&staged).map_err(|e| e.to_string())?;
        fs::create_dir(staged.join("files")).map_err(|e| e.to_string())?;
        let pool = cinder_host::db::open(&staged.join("cinder.db")).map_err(|e| e.to_string())?;
        let pin =
            cinder_host::routes::auth::prepare_bootstrap_pin(&pool).map_err(|e| e.to_string())?;
        {
            let conn = pool.get().map_err(|e| e.to_string())?;
            conn.execute("INSERT OR REPLACE INTO school_settings(key,value,updated_at) VALUES('school_name',?1,?2)", params![config.school_name,Utc::now().to_rfc3339()]).map_err(|e| e.to_string())?;
            audit(
                &conn,
                "school.reset",
                Some("backup"),
                None,
                &archive.display().to_string(),
            )?;
        }
        drop(pool);
        swap_data_dirs(&config.data_dir, &staged, false)?;
        Ok(SetupResult {
            recovery_code: archive.display().to_string(),
            bootstrap_pin: pin,
        })
    })
}

#[tauri::command]
fn save_settings(
    admin: State<HostAdmin>,
    token: String,
    school_name: String,
    port: u16,
) -> Result<(), String> {
    if school_name.trim().is_empty() || !(1024..=65535).contains(&port) {
        return Err("Enter a school name and a port from 1024 to 65535.".into());
    }
    with_maintenance(&admin, &token, |current| {
        let mut next = current.clone();
        next.school_name = school_name.trim().into();
        next.port = port;
        save_config(&admin.config_path, &next)?;
        let conn = database(&next)?;
        conn.execute("INSERT OR REPLACE INTO school_settings(key,value,updated_at) VALUES('school_name',?1,?2)", params![next.school_name,Utc::now().to_rfc3339()]).map_err(|e| e.to_string())?;
        audit(
            &conn,
            "settings.update",
            Some("school"),
            None,
            "School name or port changed",
        )?;
        let mut inner = admin
            .inner
            .lock()
            .map_err(|_| "Host state is unavailable.".to_owned())?;
        inner.config = Some(next);
        Ok(())
    })
}

/// The same machine-local key the running server uses, so a key saved here can
/// be decrypted by the server and vice versa.
fn ai_secret(config: &HostConfig) -> Result<[u8; 32], String> {
    cinder_core::secure_store::load_or_create_key(&config.data_dir.join("ai-key-secret.bin"))
        .map_err(|e| e.to_string())
}

/// Reads the stored AI configuration. The rusqlite connection is dropped before
/// any await: it is not Send, and the reachability probe is async.
fn stored_ai(admin: &HostAdmin, token: &str) -> Result<cinder_host::routes::ai::StoredAi, String> {
    let config = authorised_config(admin, token)?;
    let secret = ai_secret(&config)?;
    let conn = database(&config)?;
    cinder_host::routes::ai::load_ai(&conn, &secret).map_err(|e| e.to_string())
}

#[tauri::command]
async fn ai_settings(
    admin: State<'_, HostAdmin>,
    token: String,
) -> Result<cinder_core::AiSettings, String> {
    let stored = stored_ai(&admin, &token)?;
    Ok(cinder_host::routes::ai::visible_settings(stored).await)
}

#[tauri::command]
async fn save_ai_settings(
    admin: State<'_, HostAdmin>,
    token: String,
    settings: cinder_core::SaveAiSettings,
) -> Result<cinder_core::AiSettings, String> {
    {
        let config = authorised_config(&admin, &token)?;
        let secret = ai_secret(&config)?;
        let conn = database(&config)?;
        let describe = format!(
            "AI provider updated: model {}, Google model {}",
            if settings.model.trim().is_empty() {
                "unset"
            } else {
                settings.model.trim()
            },
            settings.google_model.as_deref().unwrap_or("unset"),
        );
        cinder_host::routes::ai::store_ai(&conn, &secret, settings).map_err(|e| e.to_string())?;
        // The audit line records that keys changed, never their values.
        audit(&conn, "ai.settings", Some("school"), None, &describe)?;
    }
    let stored = stored_ai(&admin, &token)?;
    Ok(cinder_host::routes::ai::visible_settings(stored).await)
}

#[tauri::command]
async fn google_models(
    admin: State<'_, HostAdmin>,
    token: String,
) -> Result<Vec<cinder_core::GoogleModel>, String> {
    let key = stored_ai(&admin, &token)?
        .google_key
        .ok_or_else(|| "Save a Google key first, then choose a model.".to_owned())?;
    cinder_ai::google::GoogleClient::new(&key, "")
        .list_models()
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn ai_usage(admin: State<HostAdmin>, token: String) -> Result<AiUsageSummary, String> {
    let config = authorised_config(&admin, &token)?;
    let conn = database(&config)?;
    usage_summary(&conn)
}

#[tauri::command]
fn save_ai_limit(
    admin: State<HostAdmin>,
    token: String,
    limit: Option<i64>,
) -> Result<AiUsageSummary, String> {
    let config = authorised_config(&admin, &token)?;
    let conn = database(&config)?;
    cinder_host::routes::ai::set_monthly_token_limit(&conn, limit).map_err(|e| e.to_string())?;
    let describe = match limit.filter(|limit| *limit > 0) {
        Some(limit) => format!("Monthly AI allowance set to {limit} tokens"),
        None => "Monthly AI allowance removed".to_owned(),
    };
    audit(&conn, "ai.limit", Some("school"), None, &describe)?;
    usage_summary(&conn)
}

fn usage_summary(conn: &Connection) -> Result<AiUsageSummary, String> {
    let monthly_token_limit =
        cinder_host::routes::ai::monthly_token_limit(conn).map_err(|e| e.to_string())?;
    let table_exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_usage')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !table_exists {
        return Ok(AiUsageSummary {
            monthly_token_limit,
            ..AiUsageSummary::default()
        });
    }
    conn.query_row(
        "SELECT
            COALESCE(sum(CASE WHEN substr(created_at, 1, 7) = strftime('%Y-%m', 'now') THEN 1 ELSE 0 END), 0),
            COALESCE(sum(CASE WHEN substr(created_at, 1, 7) = strftime('%Y-%m', 'now') THEN input_tokens ELSE 0 END), 0),
            COALESCE(sum(CASE WHEN substr(created_at, 1, 7) = strftime('%Y-%m', 'now') THEN output_tokens ELSE 0 END), 0),
            count(*), COALESCE(sum(input_tokens), 0), COALESCE(sum(output_tokens), 0)
         FROM ai_usage",
        [],
        |row| {
            Ok(AiUsageSummary {
                requests: row.get(0)?,
                input_tokens: row.get(1)?,
                output_tokens: row.get(2)?,
                lifetime_requests: row.get(3)?,
                lifetime_input_tokens: row.get(4)?,
                lifetime_output_tokens: row.get(5)?,
                monthly_token_limit,
            })
        },
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_audit(admin: State<HostAdmin>, token: String) -> Result<Vec<AuditEntry>, String> {
    let config = authorised_config(&admin, &token)?;
    let conn = database(&config)?;
    let mut stmt=conn.prepare("SELECT id,action,target_type,target_id,detail,created_at FROM operator_audit ORDER BY id DESC LIMIT 100").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AuditEntry {
                id: r.get(0)?,
                action: r.get(1)?,
                target_type: r.get(2)?,
                target_id: r.get(3)?,
                detail: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let path = config_path(app.handle())?;
            let (config, config_error) = match fs::read(&path) {
                Ok(bytes) => match serde_json::from_slice::<HostConfig>(&bytes)
                    .map_err(|e| e.to_string())
                    .and_then(|config| {
                        validate_config(&config)?;
                        Ok(config)
                    }) {
                    Ok(config) => (Some(config), None),
                    Err(error) => (
                        None,
                        Some(format!("Host configuration could not be loaded: {error}")),
                    ),
                },
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (None, None),
                Err(error) => (
                    None,
                    Some(format!("Host configuration could not be read: {error}")),
                ),
            };
            app.manage(HostAdmin {
                config_path: path,
                inner: Mutex::new(Inner {
                    config,
                    config_error,
                    session: None,
                    server: None,
                    maintenance: false,
                    bootstrap_pin: None,
                    failed_logins: 0,
                    blocked_until: None,
                }),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            public_state,
            setup_host,
            unlock,
            unlock_with_recovery,
            lock,
            current_bootstrap_pin,
            start_server,
            stop_server,
            dashboard,
            list_people,
            update_person,
            reset_person_credentials,
            set_person_disabled,
            list_files,
            read_file,
            export_file,
            trash_file,
            rename_file,
            empty_trash,
            backup_school,
            restore_school,
            reset_school,
            save_settings,
            ai_settings,
            save_ai_settings,
            google_models,
            ai_usage,
            save_ai_limit,
            list_audit
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cinder Host")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, HostConfig) {
        let root = std::env::temp_dir().join(format!("cinder-host-app-test-{}", random_code(12)));
        let data = root.join("school");
        fs::create_dir_all(data.join("files")).unwrap();
        let password_hash = cinder_host::auth::hash_password("host-pass").unwrap();
        let config = HostConfig {
            data_dir: data.clone(),
            school_name: "Test School".into(),
            bind: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            port: 7373,
            password_hash: password_hash.clone(),
            recovery_hash: password_hash,
        };
        let pool = cinder_host::db::open(&data.join("cinder.db")).unwrap();
        let conn = pool.get().unwrap();
        conn.execute("INSERT INTO users(id,username,display_name,pw_hash,role,created_at) VALUES('u1','teacher','Teacher','hash','teacher',?1)",[Utc::now().to_rfc3339()]).unwrap();
        let bytes = b"verified school file";
        let sha = hex::encode(Sha256::digest(bytes));
        let node = "11111111-1111-4111-8111-111111111111";
        conn.execute("INSERT INTO nodes(id,owner_id,name,kind,position,created_at,updated_at) VALUES(?1,'u1','File','pdf',0,?2,?2)", params![node,Utc::now().to_rfc3339()]).unwrap();
        conn.execute("INSERT INTO files(node_id,sha256,orig_name,bytes,mime,created_at) VALUES(?1,?2,'file.pdf',?3,'application/pdf',?4)",params![node,sha,bytes.len() as u64,Utc::now().to_rfc3339()]).unwrap();
        let path = blob_path(&data.join("files"), &sha);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
        drop(conn);
        drop(pool);
        (root, config)
    }

    #[test]
    fn backup_is_verified_and_restorable() {
        let (root, config) = fixture();
        let backups = root.join("backups");
        let backup = create_backup(&config, &backups).unwrap();
        assert_eq!(verify_backup(&backup).unwrap().school_name, "Test School");
        let staged = stage_backup(&config, &backup).unwrap();
        swap_data_dirs(&config.data_dir, &staged, false).unwrap();
        let restored = database(&config)
            .unwrap()
            .query_row("SELECT count(*) FROM users", [], |r| r.get::<_, i64>(0))
            .unwrap();
        assert_eq!(restored, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn failed_swap_rolls_live_school_back_automatically() {
        let (root, config) = fixture();
        let backup = create_backup(&config, &root.join("backups")).unwrap();
        let staged = stage_backup(&config, &backup).unwrap();
        let error = swap_data_dirs(&config.data_dir, &staged, true).unwrap_err();
        assert!(error.contains("Injected"));
        assert_eq!(
            database(&config)
                .unwrap()
                .query_row("SELECT count(*) FROM users", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(
            staged.exists(),
            "staged data remains available after rollback"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn backup_rejects_live_data_descendants_and_tampered_blobs() {
        let (root, config) = fixture();
        assert!(create_backup(&config, &config.data_dir.join("bad-backup")).is_err());
        let backup = create_backup(&config, &root.join("backups")).unwrap();
        let manifest = verify_backup(&backup).unwrap();
        let conn = Connection::open(backup.join("cinder.db")).unwrap();
        let sha: String = conn
            .query_row("SELECT sha256 FROM files LIMIT 1", [], |row| row.get(0))
            .unwrap();
        fs::write(
            blob_path(&backup.join(manifest.files_dir), &sha),
            b"tampered",
        )
        .unwrap();
        assert!(verify_backup(&backup).unwrap_err().contains("hash or size"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn config_replacement_is_readable_and_valid() {
        let (root, mut config) = fixture();
        let path = root.join("admin").join("host-admin.json");
        save_config(&path, &config).unwrap();
        config.school_name = "Changed School".into();
        save_config(&path, &config).unwrap();
        let loaded: HostConfig = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        validate_config(&loaded).unwrap();
        assert_eq!(loaded.school_name, "Changed School");
        let _ = fs::remove_dir_all(root);
    }
}
