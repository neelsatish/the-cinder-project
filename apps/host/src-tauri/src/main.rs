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

mod backup_crypto;

const SESSION_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Serialize, Deserialize)]
struct HostConfig {
    data_dir: PathBuf,
    school_name: String,
    bind: IpAddr,
    port: u16,
    password_hash: String,
    recovery_hash: String,
    /// The backup key locked with the Host password and with the recovery
    /// code, so encrypted backups can be opened on a replacement Host.
    #[serde(default)]
    backup_password_wrap: Option<backup_crypto::KeyWrap>,
    #[serde(default)]
    backup_recovery_wrap: Option<backup_crypto::KeyWrap>,
    #[serde(default)]
    auto_backup: Option<AutoBackup>,
}

#[derive(Clone, Serialize, Deserialize)]
struct AutoBackup {
    folder: PathBuf,
    keep: u32,
}

#[derive(Serialize)]
struct AutoBackupStatus {
    folder: Option<String>,
    keep: u32,
    last: Option<String>,
    last_error: Option<String>,
    /// Whether this Host can make encrypted backups yet.
    ready: bool,
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
#[derive(Clone, Debug, Serialize, Deserialize)]
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
    #[serde(default)]
    database_sha256: Option<String>,
    #[serde(default)]
    encryption: Option<backup_crypto::BackupEncryption>,
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
    cinder_host::tls::load_or_create_identity(&host_dir(admin)?.join("tls"))
        .map_err(|e| e.to_string())
}
/// The Host app's own folder, apart from the school data.
fn host_dir(admin: &HostAdmin) -> Result<PathBuf, String> {
    admin
        .config_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Host configuration path has no parent.".to_owned())
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
    // The server may be writing at the same moment, e.g. during a scheduled backup.
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
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
    let mut config = HostConfig {
        data_dir: PathBuf::from(data_dir),
        school_name: school_name.trim().to_owned(),
        bind: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        port,
        password_hash: cinder_host::auth::hash_password(&password).map_err(|e| e.to_string())?,
        recovery_hash: cinder_host::auth::hash_password(&recovery_code)
            .map_err(|e| e.to_string())?,
        backup_password_wrap: None,
        backup_recovery_wrap: None,
        auto_backup: None,
    };
    prepare_backup_key(
        &host_dir(&admin)?,
        &mut config,
        &[],
        Some(&password),
        Some(&recovery_code),
    )?;
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
    // Unlocking is the one moment the password is known: make sure encrypted
    // backups can be opened with it. A failure here must not block the Host.
    if let (Ok(dir), Some(config)) = (host_dir(&admin), inner.config.as_mut()) {
        if let Ok(true) = prepare_backup_key(&dir, config, &[&password], Some(&password), None) {
            let _ = save_config(&admin.config_path, config);
        }
    }
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
    prepare_backup_key(
        &host_dir(&admin)?,
        config,
        &[&recovery_code],
        Some(&new_password),
        Some(&next),
    )?;
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
    if manifest.version != 1
        || manifest.encryption.is_some()
        || manifest.database != "cinder.db"
        || manifest.files_dir != "files"
    {
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
const AUTO_BACKUP_PREFIX: &str = "cinder-autobackup";
/// How often the scheduler looks; a backup runs once the last is a day old.
const AUTO_BACKUP_CHECK: Duration = Duration::from_secs(10 * 60);
const AUTO_BACKUP_EVERY_HOURS: i64 = 24;
const BACKUP_KEY_NOT_READY: &str =
    "Unlock Cinder Host with its password once so it can prepare encrypted backups.";

fn stored_backup_key(dir: &Path) -> Result<Option<backup_crypto::BackupKey>, String> {
    Ok(
        cinder_core::secure_store::load(dir, backup_crypto::KEY_SECRET)
            .map_err(|e| e.to_string())?
            .and_then(|bytes| bytes.as_slice().try_into().ok()),
    )
}

/// Makes sure this Host has a backup key and that it is locked with the
/// `password` and `recovery` code given. `known` are secrets that may open an
/// existing locked copy if this computer has lost its own. Returns whether
/// `config` changed and must be saved.
fn prepare_backup_key(
    dir: &Path,
    config: &mut HostConfig,
    known: &[&str],
    password: Option<&str>,
    recovery: Option<&str>,
) -> Result<bool, String> {
    let mut changed = false;
    let key = match stored_backup_key(dir)? {
        Some(key) => key,
        None => {
            let wraps = [&config.backup_password_wrap, &config.backup_recovery_wrap];
            let recovered = known.iter().find_map(|secret| {
                wraps
                    .iter()
                    .copied()
                    .flatten()
                    .find_map(|wrap| backup_crypto::unwrap(wrap, secret))
            });
            let key = match recovered {
                Some(key) => key,
                None => {
                    // A new key: locked copies of an old key would open the wrong one.
                    config.backup_password_wrap = None;
                    config.backup_recovery_wrap = None;
                    changed = true;
                    backup_crypto::new_key()
                }
            };
            cinder_core::secure_store::store(dir, backup_crypto::KEY_SECRET, &key)
                .map_err(|e| e.to_string())?;
            key
        }
    };
    if let Some(password) = password {
        let current = config
            .backup_password_wrap
            .as_ref()
            .and_then(|wrap| backup_crypto::unwrap(wrap, password));
        if current != Some(key) {
            config.backup_password_wrap = Some(backup_crypto::wrap(&key, password)?);
            changed = true;
        }
    }
    if let Some(recovery) = recovery {
        config.backup_recovery_wrap = Some(backup_crypto::wrap(&key, recovery)?);
        changed = true;
    }
    Ok(changed)
}

/// The key and the manifest entry for a new encrypted backup. Refuses to make
/// a backup that no password could open on another computer.
fn backup_encryption(
    dir: &Path,
    config: &HostConfig,
) -> Result<(backup_crypto::BackupKey, backup_crypto::BackupEncryption), String> {
    let key = stored_backup_key(dir)?.ok_or(BACKUP_KEY_NOT_READY)?;
    if config.backup_password_wrap.is_none() && config.backup_recovery_wrap.is_none() {
        return Err(BACKUP_KEY_NOT_READY.into());
    }
    Ok((
        key,
        backup_crypto::BackupEncryption {
            cipher: backup_crypto::CIPHER.into(),
            password_wrap: config.backup_password_wrap.clone(),
            recovery_wrap: config.backup_recovery_wrap.clone(),
        },
    ))
}

/// Writes an encrypted, verified backup of the school into a new folder in
/// `parent`. Safe while the Host is serving: the database is copied in one
/// consistent step and stored files never change once written.
fn create_backup(
    config: &HostConfig,
    parent: &Path,
    prefix: &str,
    key: &backup_crypto::BackupKey,
    encryption: &backup_crypto::BackupEncryption,
) -> Result<PathBuf, String> {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let live = fs::canonicalize(&config.data_dir).map_err(|e| e.to_string())?;
    let parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
    if parent.starts_with(&live) {
        return Err("Choose a backup folder outside the live school-data folder.".into());
    }
    let stamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let destination = parent.join(format!("{prefix}-{stamp}-{}", random_code(6)));
    fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
    let result = write_encrypted_backup(config, &live, &destination, key, encryption);
    if result.is_err() {
        // A half-written backup must never be mistaken for a good one.
        let _ = fs::remove_dir_all(&destination);
    }
    result.map(|()| destination)
}

fn write_encrypted_backup(
    config: &HostConfig,
    live: &Path,
    destination: &Path,
    key: &backup_crypto::BackupKey,
    encryption: &backup_crypto::BackupEncryption,
) -> Result<(), String> {
    // The plaintext snapshot stays on the Host's own disk, never the backup drive.
    let scratch = tempfile::tempdir_in(live.parent().unwrap_or(live)).map_err(|e| e.to_string())?;
    let snapshot = scratch.path().join("cinder.db");
    {
        let source = database(config)?;
        let mut target = Connection::open(&snapshot).map_err(|e| e.to_string())?;
        // All pages in one step: a consistent copy even while the Host serves.
        Backup::new(&source, &mut target)
            .map_err(|e| e.to_string())?
            .run_to_completion(i32::MAX, Duration::from_millis(10), None)
            .map_err(|e| e.to_string())?;
    }
    let (file_count, blobs) = {
        let conn = Connection::open(&snapshot).map_err(|e| e.to_string())?;
        let check: String = conn
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if check != "ok" {
            return Err(format!(
                "The school database failed its integrity check: {check}"
            ));
        }
        let file_count: u64 = conn
            .query_row("SELECT count(*) FROM files", [], |r| r.get(0))
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
        (file_count, blobs)
    };
    let (database_sha, _) =
        backup_crypto::encrypt_file(&snapshot, &destination.join("cinder.db"), key, "cinder.db")?;
    let live_files = live.join("files");
    let mut total_bytes = 0u64;
    for (sha, bytes) in &blobs {
        validate_sha(sha)?;
        let label = format!("files/{}/{sha}", &sha[..2]);
        let target = destination.join(&label);
        fs::create_dir_all(target.parent().ok_or("Backup path has no parent.")?)
            .map_err(|e| e.to_string())?;
        let (actual, size) =
            backup_crypto::encrypt_file(&blob_path(&live_files, sha), &target, key, &label)?;
        if &actual != sha || size != *bytes {
            return Err(format!("Stored file {sha} failed its hash or size check."));
        }
        total_bytes = total_bytes
            .checked_add(size)
            .ok_or("Backup size overflowed.")?;
    }
    let manifest = BackupManifest {
        version: 2,
        school_name: config.school_name.clone(),
        created_at: Utc::now().to_rfc3339(),
        database: "cinder.db".into(),
        files_dir: "files".into(),
        file_count,
        blob_count: blobs.len() as u64,
        total_bytes,
        database_sha256: Some(database_sha),
        encryption: Some(encryption.clone()),
    };
    fs::write(
        destination.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // Read everything back from the backup drive before calling it done.
    verify_encrypted(destination, &manifest, key)
}

fn read_manifest(path: &Path) -> Result<BackupManifest, String> {
    serde_json::from_slice(&fs::read(path.join("manifest.json")).map_err(|e| e.to_string())?)
        .map_err(|_| "This is not a supported Cinder Host backup.".to_owned())
}

/// Every stored file in a backup, as (label, path). Names are checked, so a
/// crafted backup cannot point outside its own folder.
fn backup_blob_files(backup: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    let mut found = Vec::new();
    let root = backup.join("files");
    if !root.exists() {
        return Ok(found);
    }
    for shard in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let shard = shard.map_err(|e| e.to_string())?;
        let shard_name = shard.file_name().to_string_lossy().into_owned();
        for blob in fs::read_dir(shard.path()).map_err(|e| e.to_string())? {
            let blob = blob.map_err(|e| e.to_string())?;
            let sha = blob.file_name().to_string_lossy().into_owned();
            validate_sha(&sha)?;
            if sha[..2] != shard_name {
                return Err(format!("Stored file {sha} is in the wrong folder."));
            }
            found.push((format!("files/{shard_name}/{sha}"), blob.path()));
        }
    }
    Ok(found)
}

/// Decrypts every file of an encrypted backup chunk by chunk and checks it
/// against the manifest and its own name.
fn verify_encrypted(
    path: &Path,
    manifest: &BackupManifest,
    key: &backup_crypto::BackupKey,
) -> Result<(), String> {
    let expected = manifest
        .database_sha256
        .as_deref()
        .ok_or("This backup has no database checksum.")?;
    let (actual, _) = backup_crypto::decrypted_sha(&path.join("cinder.db"), key, "cinder.db")?;
    if actual != expected {
        return Err("The backed-up database does not match its manifest.".into());
    }
    let blobs = backup_blob_files(path)?;
    let mut total_bytes = 0u64;
    for (label, file) in &blobs {
        let (sha, size) = backup_crypto::decrypted_sha(file, key, label)?;
        if !label.ends_with(&sha) {
            return Err(format!("{label} failed its hash check."));
        }
        total_bytes = total_bytes
            .checked_add(size)
            .ok_or("Backup size overflowed.")?;
    }
    if blobs.len() as u64 != manifest.blob_count || total_bytes != manifest.total_bytes {
        return Err("The backup's files do not match its manifest.".into());
    }
    Ok(())
}

/// Like `with_maintenance`, but a backup may run while the Host is serving.
fn with_backup_lock<T>(
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

fn record_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO school_settings(key,value,updated_at) VALUES(?1,?2,?3)",
        params![key, value, Utc::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn backup_school(
    admin: State<HostAdmin>,
    token: String,
    destination: String,
) -> Result<String, String> {
    let dir = host_dir(&admin)?;
    with_backup_lock(&admin, &token, |config| {
        let (key, encryption) = backup_encryption(&dir, config)?;
        let path = create_backup(
            config,
            Path::new(&destination),
            "cinder-backup",
            &key,
            &encryption,
        )?;
        let conn = database(config)?;
        record_setting(&conn, "last_backup", &Utc::now().to_rfc3339())?;
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

/// Deletes the oldest automatic backups in `folder` beyond `keep`. Only folders
/// this scheduler made are ever touched.
fn prune_auto_backups(folder: &Path, keep: u32) -> Result<(), String> {
    let prefix = format!("{AUTO_BACKUP_PREFIX}-");
    let mut found: Vec<PathBuf> = fs::read_dir(folder)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path.join("manifest.json").is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(&prefix))
        })
        .collect();
    // Names begin with the UTC time they were made, so they sort by age.
    found.sort();
    let excess = found.len().saturating_sub(keep.max(1) as usize);
    for old in found.into_iter().take(excess) {
        fs::remove_dir_all(&old).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Runs the daily automatic backup if one is due. Returns the new backup.
fn run_scheduled_backup(admin: &HostAdmin) -> Result<Option<PathBuf>, String> {
    let config = {
        let mut inner = admin
            .inner
            .lock()
            .map_err(|_| "Host state is unavailable.".to_owned())?;
        let Some(config) = inner.config.clone() else {
            return Ok(None);
        };
        if inner.maintenance || config.auto_backup.is_none() {
            return Ok(None);
        }
        inner.maintenance = true;
        config
    };
    let result: Result<Option<PathBuf>, String> = (|| {
        let schedule = config.auto_backup.as_ref().ok_or("No schedule.")?;
        let conn = database(&config)?;
        let last: Option<String> = conn
            .query_row(
                "SELECT value FROM school_settings WHERE key='last_auto_backup'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let due = last
            .and_then(|at| chrono::DateTime::parse_from_rfc3339(&at).ok())
            .is_none_or(|at| {
                Utc::now().signed_duration_since(at)
                    >= chrono::Duration::hours(AUTO_BACKUP_EVERY_HOURS)
            });
        if !due {
            return Ok(None);
        }
        let (key, encryption) = backup_encryption(&host_dir(admin)?, &config)?;
        let path = create_backup(
            &config,
            &schedule.folder,
            AUTO_BACKUP_PREFIX,
            &key,
            &encryption,
        )?;
        let now = Utc::now().to_rfc3339();
        record_setting(&conn, "last_auto_backup", &now)?;
        record_setting(&conn, "last_backup", &now)?;
        record_setting(&conn, "last_auto_backup_error", "")?;
        audit(
            &conn,
            "backup.auto",
            Some("backup"),
            None,
            &path.display().to_string(),
        )?;
        prune_auto_backups(&schedule.folder, schedule.keep)?;
        Ok(Some(path))
    })();
    if let Err(error) = &result {
        if let Ok(conn) = database(&config) {
            let _ = record_setting(&conn, "last_auto_backup_error", error);
        }
    }
    if let Ok(mut inner) = admin.inner.lock() {
        inner.maintenance = false;
    }
    result
}

#[tauri::command]
fn auto_backup_status(admin: State<HostAdmin>, token: String) -> Result<AutoBackupStatus, String> {
    let config = authorised_config(&admin, &token)?;
    let conn = database(&config)?;
    let setting = |key: &str| -> Result<Option<String>, String> {
        Ok(conn
            .query_row(
                "SELECT value FROM school_settings WHERE key=?1",
                [key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .filter(|value| !value.is_empty()))
    };
    Ok(AutoBackupStatus {
        folder: config
            .auto_backup
            .as_ref()
            .map(|schedule| schedule.folder.display().to_string()),
        keep: config
            .auto_backup
            .as_ref()
            .map_or(14, |schedule| schedule.keep),
        last: setting("last_auto_backup")?,
        last_error: setting("last_auto_backup_error")?,
        ready: backup_encryption(&host_dir(&admin)?, &config).is_ok(),
    })
}

/// Turns the daily automatic backup on (a folder) or off (no folder).
#[tauri::command]
fn save_auto_backup(
    admin: State<HostAdmin>,
    token: String,
    folder: Option<String>,
    keep: u32,
) -> Result<AutoBackupStatus, String> {
    if !(1..=90).contains(&keep) {
        return Err("Keep between 1 and 90 automatic backups.".into());
    }
    let folder = folder
        .map(|folder| folder.trim().to_owned())
        .filter(|folder| !folder.is_empty())
        .map(PathBuf::from);
    {
        let mut inner = admin
            .inner
            .lock()
            .map_err(|_| "Host state is unavailable.".to_owned())?;
        require_session(&mut inner, &token)?;
        let config = inner.config.as_mut().ok_or("Set up Cinder Host first.")?;
        if let Some(folder) = &folder {
            if !folder.is_absolute() || !folder.is_dir() {
                return Err("Choose an existing folder for automatic backups.".into());
            }
            let live = fs::canonicalize(&config.data_dir).map_err(|e| e.to_string())?;
            if fs::canonicalize(folder)
                .map_err(|e| e.to_string())?
                .starts_with(&live)
            {
                return Err("Choose a backup folder outside the live school-data folder.".into());
            }
        }
        config.auto_backup = folder.map(|folder| AutoBackup { folder, keep });
        save_config(&admin.config_path, config)?;
        let detail = match &config.auto_backup {
            Some(schedule) => format!(
                "Daily encrypted backups to {} keeping {keep}",
                schedule.folder.display()
            ),
            None => "Automatic backups turned off".to_owned(),
        };
        let conn = database(config)?;
        audit(&conn, "backup.schedule", Some("school"), None, &detail)?;
    }
    auto_backup_status(admin, token)
}

/// Copies a backup into a staging folder beside the live school data, ready to
/// swap in. Encrypted backups are opened with `secret`: the Host password or
/// recovery code in use when the backup was made.
fn stage_backup(config: &HostConfig, backup: &Path, secret: &str) -> Result<PathBuf, String> {
    let backup = fs::canonicalize(backup).map_err(|e| e.to_string())?;
    let manifest = read_manifest(&backup)?;
    let Some(encryption) = manifest.encryption.clone() else {
        return stage_plain_backup(config, &backup);
    };
    if encryption.cipher != backup_crypto::CIPHER {
        return Err("This backup was made by a newer Cinder Host.".into());
    }
    let key = encryption.unlock(secret).ok_or(
        "This backup is locked with a different password. Enter the Host password or recovery \
         code the school had when the backup was made.",
    )?;
    verify_encrypted(&backup, &manifest, &key)?;
    let parent = config
        .data_dir
        .parent()
        .ok_or("School data folder has no parent.")?;
    let stage = parent.join(format!(".cinder-stage-{}", random_code(12)));
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let result = (|| {
        backup_crypto::decrypt_file(
            &backup.join("cinder.db"),
            &stage.join("cinder.db"),
            &key,
            "cinder.db",
        )?;
        fs::create_dir_all(stage.join("files")).map_err(|e| e.to_string())?;
        for (label, file) in backup_blob_files(&backup)? {
            let target = stage.join(&label);
            fs::create_dir_all(target.parent().ok_or("Backup path has no parent.")?)
                .map_err(|e| e.to_string())?;
            backup_crypto::decrypt_file(&file, &target, &key, &label)?;
        }
        // Checked again as plain files, exactly like an unencrypted backup.
        let plain = BackupManifest {
            version: 1,
            database_sha256: None,
            encryption: None,
            ..manifest.clone()
        };
        fs::write(
            stage.join("manifest.json"),
            serde_json::to_vec_pretty(&plain).map_err(|e| e.to_string())?,
        )
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

/// Backups made before encryption (0.10.6 and earlier) restore as they were.
fn stage_plain_backup(config: &HostConfig, backup: &Path) -> Result<PathBuf, String> {
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
    backup_password: Option<String>,
) -> Result<String, String> {
    let dir = host_dir(&admin)?;
    with_maintenance(&admin, &token, |config| {
        if !cinder_host::auth::verify_password(&config.password_hash, &password) {
            return Err("The Host password is incorrect.".into());
        }
        // A backup from before a password change, or from another Host
        // computer, opens with the password or recovery code it was made with.
        let secret = backup_password
            .as_deref()
            .map(str::trim)
            .filter(|secret| !secret.is_empty())
            .unwrap_or(&password);
        let staged = stage_backup(config, Path::new(&backup), secret)?;
        let safety_root = config
            .data_dir
            .parent()
            .ok_or("School data folder has no parent.")?
            .join("Cinder recovery archives");
        let (key, encryption) = match backup_encryption(&dir, config) {
            Ok(keys) => keys,
            Err(error) => {
                let _ = fs::remove_dir_all(&staged);
                return Err(error);
            }
        };
        let safety = match create_backup(config, &safety_root, "cinder-archive", &key, &encryption)
        {
            Ok(safety) => safety,
            Err(error) => {
                let _ = fs::remove_dir_all(&staged);
                return Err(error);
            }
        };
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
    let dir = host_dir(&admin)?;
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
        let (key, encryption) = backup_encryption(&dir, config)?;
        let archive = create_backup(
            config,
            &parent.join("Cinder recovery archives"),
            "cinder-archive",
            &key,
            &encryption,
        )?;
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
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(AUTO_BACKUP_CHECK);
                let _ = run_scheduled_backup(&handle.state::<HostAdmin>());
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
            auto_backup_status,
            save_auto_backup,
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

    struct Fixture {
        root: PathBuf,
        config: HostConfig,
        /// Where this Host keeps its backup key (the Host app's own folder).
        keys: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    impl Fixture {
        fn backup(&self, parent: &Path, prefix: &str) -> Result<PathBuf, String> {
            let (key, encryption) = backup_encryption(&self.keys, &self.config)?;
            create_backup(&self.config, parent, prefix, &key, &encryption)
        }
    }

    fn fixture() -> Fixture {
        let root = std::env::temp_dir().join(format!("cinder-host-app-test-{}", random_code(12)));
        let data = root.join("school");
        let keys = root.join("admin");
        fs::create_dir_all(data.join("files")).unwrap();
        fs::create_dir_all(&keys).unwrap();
        let password_hash = cinder_host::auth::hash_password("host-pass").unwrap();
        let mut config = HostConfig {
            data_dir: data.clone(),
            school_name: "Test School".into(),
            bind: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            port: 7373,
            password_hash: password_hash.clone(),
            recovery_hash: password_hash,
            backup_password_wrap: None,
            backup_recovery_wrap: None,
            auto_backup: None,
        };
        prepare_backup_key(
            &keys,
            &mut config,
            &[],
            Some("host-pass"),
            Some("RECOVERYCODE"),
        )
        .unwrap();
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
        Fixture { root, config, keys }
    }

    fn users(config: &HostConfig) -> i64 {
        database(config)
            .unwrap()
            .query_row("SELECT count(*) FROM users", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn backups_are_encrypted_and_restore_with_the_password_or_recovery_code() {
        let fixture = fixture();
        let backup = fixture
            .backup(&fixture.root.join("backups"), "cinder-backup")
            .unwrap();
        let manifest = read_manifest(&backup).unwrap();
        assert_eq!(manifest.version, 2);
        assert!(manifest.encryption.is_some());
        // Nothing in the backup is readable as the school's data.
        let raw = fs::read(backup.join("cinder.db")).unwrap();
        assert!(!raw.starts_with(b"SQLite format 3"));
        assert!(Connection::open(backup.join("cinder.db"))
            .and_then(
                |conn| conn.query_row("SELECT count(*) FROM users", [], |r| { r.get::<_, i64>(0) })
            )
            .is_err());
        for blob in backup_blob_files(&backup).unwrap() {
            assert!(!fs::read(blob.1)
                .unwrap()
                .windows(8)
                .any(|window| window == b"verified"));
        }

        assert!(stage_backup(&fixture.config, &backup, "wrong password")
            .unwrap_err()
            .contains("different password"));
        for secret in ["host-pass", "RECOVERYCODE"] {
            let staged = stage_backup(&fixture.config, &backup, secret).unwrap();
            swap_data_dirs(&fixture.config.data_dir, &staged, false).unwrap();
            assert_eq!(users(&fixture.config), 1);
        }
    }

    #[test]
    fn a_tampered_or_incomplete_backup_is_refused() {
        let fixture = fixture();
        assert!(fixture
            .backup(&fixture.config.data_dir.join("bad-backup"), "cinder-backup")
            .is_err());
        let backup = fixture
            .backup(&fixture.root.join("backups"), "cinder-backup")
            .unwrap();
        let (label, file) = backup_blob_files(&backup).unwrap().remove(0);
        let mut sealed = fs::read(&file).unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 1;
        fs::write(&file, &sealed).unwrap();
        let error = stage_backup(&fixture.config, &backup, "host-pass").unwrap_err();
        assert!(error.contains(&label), "{error}");
        fs::remove_file(&file).unwrap();
        assert!(stage_backup(&fixture.config, &backup, "host-pass").is_err());
    }

    #[test]
    fn backups_made_before_encryption_still_restore() {
        let fixture = fixture();
        let old = fixture.root.join("old-backup");
        fs::create_dir_all(&old).unwrap();
        {
            let source = database(&fixture.config).unwrap();
            let mut target = Connection::open(old.join("cinder.db")).unwrap();
            Backup::new(&source, &mut target)
                .unwrap()
                .run_to_completion(i32::MAX, Duration::from_millis(10), None)
                .unwrap();
        }
        copy_tree(&fixture.config.data_dir.join("files"), &old.join("files")).unwrap();
        let manifest = serde_json::json!({
            "version": 1, "school_name": "Test School", "created_at": Utc::now().to_rfc3339(),
            "database": "cinder.db", "files_dir": "files", "file_count": 1, "blob_count": 1,
            "total_bytes": b"verified school file".len(),
        });
        fs::write(old.join("manifest.json"), manifest.to_string()).unwrap();
        let staged = stage_backup(&fixture.config, &old, "ignored for old backups").unwrap();
        swap_data_dirs(&fixture.config.data_dir, &staged, false).unwrap();
        assert_eq!(users(&fixture.config), 1);
    }

    #[test]
    fn failed_swap_rolls_live_school_back_automatically() {
        let fixture = fixture();
        let backup = fixture
            .backup(&fixture.root.join("backups"), "cinder-backup")
            .unwrap();
        let staged = stage_backup(&fixture.config, &backup, "host-pass").unwrap();
        let error = swap_data_dirs(&fixture.config.data_dir, &staged, true).unwrap_err();
        assert!(error.contains("Injected"));
        assert_eq!(users(&fixture.config), 1);
        assert!(
            staged.exists(),
            "staged data remains available after rollback"
        );
    }

    #[test]
    fn a_lost_local_key_is_taken_back_from_its_locked_copy() {
        let mut fixture = fixture();
        let original = stored_backup_key(&fixture.keys).unwrap().unwrap();
        cinder_core::secure_store::delete(&fixture.keys, backup_crypto::KEY_SECRET).unwrap();
        assert!(backup_encryption(&fixture.keys, &fixture.config).is_err());
        prepare_backup_key(
            &fixture.keys,
            &mut fixture.config,
            &["host-pass"],
            Some("host-pass"),
            None,
        )
        .unwrap();
        assert_eq!(stored_backup_key(&fixture.keys).unwrap(), Some(original));

        // With no way to recover it, a new key replaces every stale locked copy.
        cinder_core::secure_store::delete(&fixture.keys, backup_crypto::KEY_SECRET).unwrap();
        prepare_backup_key(&fixture.keys, &mut fixture.config, &[], None, None).unwrap();
        assert_ne!(stored_backup_key(&fixture.keys).unwrap(), Some(original));
        assert!(fixture.config.backup_password_wrap.is_none());
        assert!(fixture.config.backup_recovery_wrap.is_none());
        assert!(backup_encryption(&fixture.keys, &fixture.config).is_err());
    }

    #[test]
    fn only_the_oldest_automatic_backups_are_pruned() {
        let fixture = fixture();
        let folder = fixture.root.join("usb");
        let manual = fixture.backup(&folder, "cinder-backup").unwrap();
        let mut automatic = Vec::new();
        for _ in 0..3 {
            automatic.push(fixture.backup(&folder, AUTO_BACKUP_PREFIX).unwrap());
            // Names carry the second they were made in.
            std::thread::sleep(Duration::from_millis(1_100));
        }
        prune_auto_backups(&folder, 2).unwrap();
        assert!(manual.exists(), "a manual backup is never pruned");
        assert!(!automatic[0].exists());
        assert!(automatic[1].exists() && automatic[2].exists());
    }

    #[test]
    fn config_replacement_is_readable_and_valid() {
        let mut fixture = fixture();
        let path = fixture.root.join("admin").join("host-admin.json");
        save_config(&path, &fixture.config).unwrap();
        fixture.config.school_name = "Changed School".into();
        save_config(&path, &fixture.config).unwrap();
        let loaded: HostConfig = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        validate_config(&loaded).unwrap();
        assert_eq!(loaded.school_name, "Changed School");
        assert!(loaded.backup_password_wrap.is_some());
    }

    #[test]
    fn configs_saved_before_encryption_still_load() {
        let old = r#"{"data_dir":"C:/school","school_name":"Old","bind":"0.0.0.0","port":7373,
            "password_hash":"x","recovery_hash":"y"}"#;
        let loaded: HostConfig = serde_json::from_str(old).unwrap();
        assert!(loaded.backup_password_wrap.is_none() && loaded.auto_backup.is_none());
    }
}
