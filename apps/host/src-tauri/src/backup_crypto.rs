//! Encryption for Host backups, which leave the building on USB drives.
//!
//! Every file in a backup is encrypted with one random backup key using
//! AES-256-GCM in the STREAM construction (64 KiB chunks, so a large database
//! never has to fit in memory). Each file's path is bound in as associated
//! data, so files cannot be swapped between names.
//!
//! The backup key is kept on the Host with `secure_store`, so scheduled backups
//! run without anyone typing a password. Each backup also carries the key
//! locked with the Host password and, when known, the recovery code (Argon2id
//! then AES-256-GCM), so a new Host computer can restore it.

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::Path;

use aes_gcm::aead::stream::{DecryptorBE32, EncryptorBE32};
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const KEY_SECRET: &str = "backup-key";
pub const CIPHER: &str = "aes-256-gcm-stream-64k";
const CHUNK: usize = 64 * 1024;
const TAG: usize = 16;
/// STREAM with a 12-byte GCM nonce leaves 7 bytes of random prefix.
const PREFIX: usize = 7;
const WRAP_AAD: &[u8] = b"cinder-backup-key-v1";

pub type BackupKey = [u8; 32];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyWrap {
    salt: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackupEncryption {
    pub cipher: String,
    #[serde(default)]
    pub password_wrap: Option<KeyWrap>,
    #[serde(default)]
    pub recovery_wrap: Option<KeyWrap>,
}

impl BackupEncryption {
    /// Unlocks the backup key with the password or recovery code in use when
    /// the backup was made.
    pub fn unlock(&self, secret: &str) -> Option<BackupKey> {
        [&self.password_wrap, &self.recovery_wrap]
            .into_iter()
            .flatten()
            .find_map(|wrap| unwrap(wrap, secret))
    }
}

pub fn new_key() -> BackupKey {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    key
}

fn key_encryption_key(secret: &str, salt: &[u8]) -> Result<BackupKey, String> {
    let mut out = [0u8; 32];
    argon2::Argon2::default()
        .hash_password_into(secret.as_bytes(), salt, &mut out)
        .map_err(|error| format!("Could not derive the backup key: {error}"))?;
    Ok(out)
}

pub fn wrap(key: &BackupKey, secret: &str) -> Result<KeyWrap, String> {
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce);
    let kek = key_encryption_key(secret, &salt)?;
    let ciphertext = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&kek))
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: key,
                aad: WRAP_AAD,
            },
        )
        .map_err(|_| "Could not lock the backup key.".to_owned())?;
    Ok(KeyWrap {
        salt: hex::encode(salt),
        nonce: hex::encode(nonce),
        ciphertext: hex::encode(ciphertext),
    })
}

pub fn unwrap(wrap: &KeyWrap, secret: &str) -> Option<BackupKey> {
    let salt = hex::decode(&wrap.salt).ok()?;
    let nonce = hex::decode(&wrap.nonce).ok()?;
    let ciphertext = hex::decode(&wrap.ciphertext).ok()?;
    if nonce.len() != 12 {
        return None;
    }
    let kek = key_encryption_key(secret, &salt).ok()?;
    Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&kek))
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: WRAP_AAD,
            },
        )
        .ok()?
        .try_into()
        .ok()
}

/// Reads until `buffer` is full or the input ends; returns bytes read.
fn read_full(reader: &mut impl Read, buffer: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..])? {
            0 => break,
            read => filled += read,
        }
    }
    Ok(filled)
}

/// Encrypts `source` into `destination`, labelled with its path in the
/// backup. Returns the SHA-256 and size of the plaintext, so the caller can
/// check a stored file against its name while copying it.
pub fn encrypt_file(
    source: &Path,
    destination: &Path,
    key: &BackupKey,
    label: &str,
) -> Result<(String, u64), String> {
    let fail = |error: std::io::Error| format!("Encrypting {label} failed: {error}");
    let mut reader = BufReader::new(File::open(source).map_err(fail)?);
    let mut writer = BufWriter::new(File::create(destination).map_err(fail)?);
    let mut prefix = [0u8; PREFIX];
    rand::thread_rng().fill_bytes(&mut prefix);
    writer.write_all(&prefix).map_err(fail)?;
    let mut encryptor = EncryptorBE32::from_aead(
        Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key)),
        aes_gcm::aead::generic_array::GenericArray::from_slice(&prefix),
    );
    let mut hasher = Sha256::new();
    let mut size = 0u64;
    let mut current = vec![0u8; CHUNK];
    let mut next = vec![0u8; CHUNK];
    let mut current_len = read_full(&mut reader, &mut current).map_err(fail)?;
    loop {
        let next_len = if current_len == CHUNK {
            read_full(&mut reader, &mut next).map_err(fail)?
        } else {
            0
        };
        let chunk = &current[..current_len];
        hasher.update(chunk);
        size += current_len as u64;
        let payload = Payload {
            msg: chunk,
            aad: label.as_bytes(),
        };
        if next_len == 0 {
            let sealed = encryptor
                .encrypt_last(payload)
                .map_err(|_| format!("Encrypting {label} failed."))?;
            writer.write_all(&sealed).map_err(fail)?;
            break;
        }
        let sealed = encryptor
            .encrypt_next(payload)
            .map_err(|_| format!("Encrypting {label} failed."))?;
        writer.write_all(&sealed).map_err(fail)?;
        std::mem::swap(&mut current, &mut next);
        current_len = next_len;
    }
    writer.flush().map_err(fail)?;
    writer
        .into_inner()
        .map_err(|error| fail(error.into_error()))?
        .sync_all()
        .map_err(fail)?;
    Ok((hex::encode(hasher.finalize()), size))
}

/// Decrypts `source`, handing each plaintext chunk to `sink`. Fails on any
/// tampering, truncation, wrong key or wrong label.
fn decrypt_with(
    source: &Path,
    key: &BackupKey,
    label: &str,
    mut sink: impl FnMut(&[u8]) -> Result<(), String>,
) -> Result<(), String> {
    let damaged = || format!("{label} is damaged or was made with a different key.");
    let mut reader = BufReader::new(File::open(source).map_err(|_| damaged())?);
    let mut prefix = [0u8; PREFIX];
    if read_full(&mut reader, &mut prefix).map_err(|_| damaged())? != PREFIX {
        return Err(damaged());
    }
    let mut decryptor = DecryptorBE32::from_aead(
        Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key)),
        aes_gcm::aead::generic_array::GenericArray::from_slice(&prefix),
    );
    let block = CHUNK + TAG;
    let mut current = vec![0u8; block];
    let mut next = vec![0u8; block];
    let mut current_len = read_full(&mut reader, &mut current).map_err(|_| damaged())?;
    loop {
        let next_len = if current_len == block {
            read_full(&mut reader, &mut next).map_err(|_| damaged())?
        } else {
            0
        };
        let payload = Payload {
            msg: &current[..current_len],
            aad: label.as_bytes(),
        };
        if next_len == 0 {
            let plain = decryptor.decrypt_last(payload).map_err(|_| damaged())?;
            return sink(&plain);
        }
        let plain = decryptor.decrypt_next(payload).map_err(|_| damaged())?;
        sink(&plain)?;
        std::mem::swap(&mut current, &mut next);
        current_len = next_len;
    }
}

pub fn decrypt_file(
    source: &Path,
    destination: &Path,
    key: &BackupKey,
    label: &str,
) -> Result<(), String> {
    let fail = |error: std::io::Error| format!("Restoring {label} failed: {error}");
    let mut writer = BufWriter::new(File::create(destination).map_err(fail)?);
    decrypt_with(source, key, label, |chunk| {
        writer.write_all(chunk).map_err(fail)
    })?;
    writer.flush().map_err(fail)
}

/// SHA-256 and size of the plaintext inside an encrypted backup file.
pub fn decrypted_sha(source: &Path, key: &BackupKey, label: &str) -> Result<(String, u64), String> {
    let mut hasher = Sha256::new();
    let mut size = 0u64;
    decrypt_with(source, key, label, |chunk| {
        hasher.update(chunk);
        size += chunk.len() as u64;
        Ok(())
    })?;
    Ok((hex::encode(hasher.finalize()), size))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(size: usize) {
        let dir = tempfile::tempdir().unwrap();
        let plain: Vec<u8> = (0..size).map(|index| (index % 251) as u8).collect();
        let (source, sealed, opened) = (
            dir.path().join("plain"),
            dir.path().join("sealed"),
            dir.path().join("opened"),
        );
        std::fs::write(&source, &plain).unwrap();
        let key = new_key();
        let (sha, bytes) = encrypt_file(&source, &sealed, &key, "files/ab/abc").unwrap();
        assert_eq!(sha, hex::encode(Sha256::digest(&plain)));
        assert_eq!(bytes, size as u64);
        assert_ne!(
            std::fs::read(&sealed).unwrap().get(PREFIX..),
            Some(&plain[..])
        );
        assert_eq!(
            decrypted_sha(&sealed, &key, "files/ab/abc").unwrap(),
            (sha, size as u64)
        );
        decrypt_file(&sealed, &opened, &key, "files/ab/abc").unwrap();
        assert_eq!(std::fs::read(&opened).unwrap(), plain);

        // Wrong key, wrong name, flipped bit and truncation are all refused.
        assert!(decrypted_sha(&sealed, &new_key(), "files/ab/abc").is_err());
        assert!(decrypted_sha(&sealed, &key, "cinder.db").is_err());
        let mut tampered = std::fs::read(&sealed).unwrap();
        let middle = tampered.len() / 2;
        tampered[middle] ^= 1;
        std::fs::write(&sealed, &tampered).unwrap();
        assert!(decrypted_sha(&sealed, &key, "files/ab/abc").is_err());
        tampered[middle] ^= 1;
        tampered.truncate(tampered.len() - 1);
        std::fs::write(&sealed, &tampered).unwrap();
        assert!(decrypted_sha(&sealed, &key, "files/ab/abc").is_err());
    }

    #[test]
    fn files_of_every_size_round_trip_and_resist_tampering() {
        for size in [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK, 3 * CHUNK + 17] {
            round_trip(size);
        }
    }

    #[test]
    fn a_chunk_cannot_be_dropped_from_the_end() {
        let dir = tempfile::tempdir().unwrap();
        let (source, sealed) = (dir.path().join("plain"), dir.path().join("sealed"));
        std::fs::write(&source, vec![7u8; 2 * CHUNK + 5]).unwrap();
        let key = new_key();
        encrypt_file(&source, &sealed, &key, "cinder.db").unwrap();
        let bytes = std::fs::read(&sealed).unwrap();
        // Keep the prefix and the first two sealed chunks only.
        std::fs::write(&sealed, &bytes[..PREFIX + 2 * (CHUNK + TAG)]).unwrap();
        assert!(decrypted_sha(&sealed, &key, "cinder.db").is_err());
    }

    #[test]
    fn the_key_unlocks_with_the_password_or_the_recovery_code_only() {
        let key = new_key();
        let encryption = BackupEncryption {
            cipher: CIPHER.into(),
            password_wrap: Some(wrap(&key, "host password").unwrap()),
            recovery_wrap: Some(wrap(&key, "RECOVERYCODE123").unwrap()),
        };
        assert_eq!(encryption.unlock("host password"), Some(key));
        assert_eq!(encryption.unlock("RECOVERYCODE123"), Some(key));
        assert_eq!(encryption.unlock("wrong"), None);
    }
}
