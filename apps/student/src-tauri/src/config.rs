use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const FILE_NAME: &str = "config.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StudentConfig {
    pub host_url: Option<String>,
    pub device_label: Option<String>,
}

impl StudentConfig {
    fn path(data_dir: &Path) -> PathBuf {
        data_dir.join(FILE_NAME)
    }

    pub fn load(data_dir: &Path) -> Self {
        let path = Self::path(data_dir);
        std::fs::read_to_string(&path)
            .or_else(|_| std::fs::read_to_string(path.with_extension("json.bak")))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, data_dir: &Path) -> anyhow::Result<()> {
        std::fs::create_dir_all(data_dir)?;
        let path = Self::path(data_dir);
        let temporary = path.with_extension("json.tmp");
        let backup = path.with_extension("json.bak");
        std::fs::write(&temporary, serde_json::to_vec_pretty(self)?)?;
        let _ = std::fs::remove_file(&backup);
        if path.exists() {
            std::fs::rename(&path, &backup)?;
        }
        if let Err(error) = std::fs::rename(&temporary, &path) {
            let _ = std::fs::rename(&backup, &path);
            return Err(error.into());
        }
        let _ = std::fs::remove_file(backup);
        Ok(())
    }
}
