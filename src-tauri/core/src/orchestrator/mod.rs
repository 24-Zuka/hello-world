pub mod artifacts;
pub mod prompt_builder;
pub mod quality;
pub mod repository;
pub mod router;
pub mod service;
pub mod state_machine;
pub mod workers;

pub use repository::TaskRepository;
pub use service::Orchestrator;

pub fn now_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn now_string() -> String {
    now_epoch().to_string()
}
