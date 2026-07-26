//! Application use-case boundary.
//!
//! Tauri commands adapt transport concerns and delegate reusable serialization
//! and orchestration logic to modules in this layer.

pub(crate) mod result_export;
pub(crate) mod workspace_export;
