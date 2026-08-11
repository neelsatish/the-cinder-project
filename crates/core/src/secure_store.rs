//! Small, native secret storage used by both desktop apps.
//!
//! Windows data is protected with current-user DPAPI. Linux uses AES-256-GCM
//! with an owner-only random key because Matchbox must keep working on machines
//! where a Secret Service daemon is not installed. Neither mechanism is meant
//! to protect secrets after the signed-in OS account itself is compromised.

use std::io::Write;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::{rngs::OsRng, RngCore};

const WINDOWS_HEADER: &[u8] = b"CINDER-DPAPI-V1\0";
const PORTABLE_HEADER: &[u8] = b"CINDER-AESGCM-V1\0";
const NONCE_BYTES: usize = 12;
const MASTER_KEY_BYTES: usize = 32;
const MAX_SECRET_BYTES: usize = 256 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum SecureStoreError {
    #[error("secret storage failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("the protected data is corrupt or belongs to another OS account")]
    InvalidData,
    #[error("the secret is too large")]
    TooLarge,
}

pub type Result<T> = std::result::Result<T, SecureStoreError>;

/// Stores one opaque value under the app's private data directory.
pub fn store(data_dir: &Path, name: &str, plaintext: &[u8]) -> Result<()> {
    validate_name(name)?;
    if plaintext.len() > MAX_SECRET_BYTES {
        return Err(SecureStoreError::TooLarge);
    }
    std::fs::create_dir_all(data_dir)?;
    let protected = protect(data_dir, plaintext)?;
    write_private_atomic(&secret_path(data_dir, name), &protected)
}

/// Reads and decrypts one opaque value. Missing values are not errors.
pub fn load(data_dir: &Path, name: &str) -> Result<Option<Vec<u8>>> {
    validate_name(name)?;
    let path = secret_path(data_dir, name);
    let bytes = match read_with_backup(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if bytes.len() > MAX_SECRET_BYTES + 4096 {
        return Err(SecureStoreError::TooLarge);
    }
    unprotect(data_dir, &bytes).map(Some)
}

pub fn delete(data_dir: &Path, name: &str) -> Result<()> {
    validate_name(name)?;
    for path in [
        secret_path(data_dir, name),
        secret_path(data_dir, name).with_extension("secure.bak"),
    ] {
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

/// Loads an existing 32-byte application key or creates one. On Windows the
/// key file itself is DPAPI-protected; existing raw keys are migrated in place.
pub fn load_or_create_key(path: &Path) -> Result<[u8; MASTER_KEY_BYTES]> {
    let primary_was_present = path.exists();
    match read_with_backup(path) {
        Ok(bytes) => {
            let loaded_path = if primary_was_present {
                path.to_path_buf()
            } else {
                path.with_extension("secure.bak")
            };
            tighten_private_permissions(&loaded_path)?;
            #[cfg(windows)]
            let decoded = if bytes.starts_with(WINDOWS_HEADER) {
                dpapi_unprotect(&bytes[WINDOWS_HEADER.len()..])?
            } else {
                // No Windows build was publicly released before this mechanism,
                // but accepting and immediately migrating a raw key is safer for
                // developer machines and pre-release testers.
                bytes.clone()
            };
            #[cfg(not(windows))]
            let decoded = bytes.clone();

            let key: [u8; MASTER_KEY_BYTES] = decoded
                .try_into()
                .map_err(|_| SecureStoreError::InvalidData)?;
            #[cfg(windows)]
            if !primary_was_present || !bytes.starts_with(WINDOWS_HEADER) {
                let mut protected = WINDOWS_HEADER.to_vec();
                protected.extend(dpapi_protect(&key)?);
                write_private_atomic(path, &protected)?;
            }
            #[cfg(not(windows))]
            if !primary_was_present {
                write_private_atomic(path, &bytes)?;
            }
            Ok(key)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => create_key(path),
        Err(error) => Err(error.into()),
    }
}

fn create_key(path: &Path) -> Result<[u8; MASTER_KEY_BYTES]> {
    let mut key = [0u8; MASTER_KEY_BYTES];
    OsRng.fill_bytes(&mut key);
    #[cfg(windows)]
    let stored = {
        let mut value = WINDOWS_HEADER.to_vec();
        value.extend(dpapi_protect(&key)?);
        value
    };
    #[cfg(not(windows))]
    let stored = key.to_vec();
    write_private_atomic(path, &stored)?;
    Ok(key)
}

#[cfg(unix)]
fn tighten_private_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn tighten_private_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

fn validate_name(name: &str) -> Result<()> {
    if name.is_empty()
        || name.len() > 64
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(SecureStoreError::InvalidData);
    }
    Ok(())
}

fn secret_path(data_dir: &Path, name: &str) -> PathBuf {
    data_dir.join(format!("{name}.secure"))
}

#[cfg(windows)]
fn protect(_data_dir: &Path, plaintext: &[u8]) -> Result<Vec<u8>> {
    let mut value = WINDOWS_HEADER.to_vec();
    value.extend(dpapi_protect(plaintext)?);
    Ok(value)
}

#[cfg(windows)]
fn unprotect(_data_dir: &Path, protected: &[u8]) -> Result<Vec<u8>> {
    let payload = protected
        .strip_prefix(WINDOWS_HEADER)
        .ok_or(SecureStoreError::InvalidData)?;
    dpapi_unprotect(payload)
}

#[cfg(not(windows))]
fn protect(data_dir: &Path, plaintext: &[u8]) -> Result<Vec<u8>> {
    let key = load_or_create_key(&data_dir.join("local-secrets.key"))?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| SecureStoreError::InvalidData)?;
    let mut nonce = [0u8; NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| SecureStoreError::InvalidData)?;
    let mut value = PORTABLE_HEADER.to_vec();
    value.extend(nonce);
    value.extend(ciphertext);
    Ok(value)
}

#[cfg(not(windows))]
fn unprotect(data_dir: &Path, protected: &[u8]) -> Result<Vec<u8>> {
    let payload = protected
        .strip_prefix(PORTABLE_HEADER)
        .ok_or(SecureStoreError::InvalidData)?;
    if payload.len() <= NONCE_BYTES {
        return Err(SecureStoreError::InvalidData);
    }
    let key = load_or_create_key(&data_dir.join("local-secrets.key"))?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| SecureStoreError::InvalidData)?;
    cipher
        .decrypt(
            Nonce::from_slice(&payload[..NONCE_BYTES]),
            &payload[NONCE_BYTES..],
        )
        .map_err(|_| SecureStoreError::InvalidData)
}

#[cfg(windows)]
fn dpapi_protect(plaintext: &[u8]) -> Result<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: plaintext
            .len()
            .try_into()
            .map_err(|_| SecureStoreError::TooLarge)?,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let success = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if success == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let value =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(value)
}

#[cfg(windows)]
fn dpapi_unprotect(protected: &[u8]) -> Result<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: protected
            .len()
            .try_into()
            .map_err(|_| SecureStoreError::TooLarge)?,
        pbData: protected.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let success = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if success == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let value =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(value)
}

fn read_with_backup(path: &Path) -> std::io::Result<Vec<u8>> {
    match std::fs::read(path) {
        Ok(value) => Ok(value),
        Err(primary) => {
            let backup = path.with_extension("secure.bak");
            std::fs::read(backup).map_err(|_| primary)
        }
    }
}

fn write_private_atomic(path: &Path, contents: &[u8]) -> Result<()> {
    let temporary = path.with_extension("secure.tmp");
    let backup = path.with_extension("secure.bak");
    let _ = std::fs::remove_file(&temporary);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    file.write_all(contents)?;
    file.sync_all()?;
    drop(file);

    let _ = std::fs::remove_file(&backup);
    if path.exists() {
        std::fs::rename(path, &backup)?;
    }
    if let Err(error) = std::fs::rename(&temporary, path) {
        let _ = std::fs::rename(&backup, path);
        return Err(error.into());
    }
    let _ = std::fs::remove_file(backup);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secure_values_round_trip_and_are_not_plaintext() {
        let root = std::env::temp_dir().join(format!("cinder-secrets-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        store(&root, "session", b"teacher-token-123").unwrap();
        let stored = std::fs::read(root.join("session.secure")).unwrap();
        assert!(!stored
            .windows(17)
            .any(|window| window == b"teacher-token-123"));
        assert_eq!(
            load(&root, "session").unwrap().unwrap(),
            b"teacher-token-123"
        );
        delete(&root, "session").unwrap();
        assert!(load(&root, "session").unwrap().is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_secret_names_are_rejected() {
        let root = std::env::temp_dir();
        assert!(store(&root, "../session", b"nope").is_err());
    }

    #[test]
    fn application_key_recovers_from_an_interrupted_replace() {
        let root = std::env::temp_dir().join(format!("cinder-key-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("ai-key-secret.bin");
        let original = load_or_create_key(&path).unwrap();
        std::fs::rename(&path, path.with_extension("secure.bak")).unwrap();

        let recovered = load_or_create_key(&path).unwrap();

        assert_eq!(recovered, original);
        assert!(path.exists());
        assert!(!path.with_extension("secure.bak").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
