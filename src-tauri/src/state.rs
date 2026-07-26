use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde_json::Value;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

use crate::{
    api,
    diagnostics::DiagnosticCache,
    models::CommandError,
    runtime_log::{self, LogLevel},
};

pub(crate) struct AppState {
    pub(crate) app_data_dir: PathBuf,
    pub(crate) log_lock: Mutex<()>,
    pub(crate) settings_lock: Mutex<()>,
    pub(crate) storage_lock: Arc<Mutex<()>>,
    pub(crate) cancellations: Mutex<HashMap<String, CancellationToken>>,
    pub(crate) diagnostics: Mutex<DiagnosticCache>,
    pub(crate) http_client: reqwest::Client,
    pub(crate) request_slots: Semaphore,
}

impl AppState {
    pub(crate) fn new(app_data_dir: PathBuf) -> Result<Self, CommandError> {
        Ok(Self {
            app_data_dir,
            log_lock: Mutex::new(()),
            settings_lock: Mutex::new(()),
            storage_lock: Arc::new(Mutex::new(())),
            cancellations: Mutex::new(HashMap::new()),
            diagnostics: Mutex::new(DiagnosticCache::default()),
            http_client: api::build_client()?,
            request_slots: Semaphore::new(2),
        })
    }

    pub(crate) fn settings_path(&self) -> PathBuf {
        self.app_data_dir.join("settings.json")
    }

    pub(crate) fn history_path(&self) -> PathBuf {
        self.app_data_dir.join("history.json")
    }

    pub(crate) fn log_path(&self) -> PathBuf {
        self.app_data_dir.join("runtime.jsonl")
    }

    pub(crate) fn originals_path(&self) -> PathBuf {
        self.app_data_dir.join("originals")
    }

    pub(crate) fn original_staging_path(&self) -> PathBuf {
        self.app_data_dir.join("original-staging")
    }

    pub(crate) fn log(
        &self,
        level: LogLevel,
        category: &str,
        event: &str,
        message: &str,
        details: Value,
    ) {
        if let Ok(_guard) = self.log_lock.lock() {
            let _ = runtime_log::append(&self.log_path(), level, category, event, message, details);
        }
    }

    pub(crate) fn attach_diagnostic(
        &self,
        interaction_id: &str,
        mut error: CommandError,
    ) -> CommandError {
        error.interaction_id = Some(interaction_id.to_owned());
        if let Ok(mut cache) = self.diagnostics.lock() {
            error.diagnostic_id = cache.insert(interaction_id, &error);
        }
        error.diagnostic_payload = None;
        error
    }

    pub(crate) fn cancel_all_requests(&self) -> usize {
        let Ok(mut requests) = self.cancellations.lock() else {
            return 0;
        };
        let count = requests.len();
        for cancellation in requests.values() {
            cancellation.cancel();
        }
        requests.clear();
        count
    }
}
