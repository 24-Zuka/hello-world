//! JARVIS Cockpit — 共有コア（§1 薄いラッパーの「裏側」）。
//!
//! 旧 `src-tauri/src/*` の頭脳を Tauri から切り離した GUI 非依存クレート。
//! プロセス実行(exec)・Obsidian REST・Keychain・mock 縮退・§7.1 コマンド実装を持つ。
//!
//! トランスポートは外側に委ねる: イベント配信は [`EventSink`] 抽象を介し、
//! Tauri は `app.emit`、ブリッジは SSE ブロードキャストで実装する。

pub mod commands;
pub mod exec;
pub mod mock;
pub mod models;
pub mod obsidian;
pub mod secrets;
pub mod state;

pub use exec::EventSink;
pub use state::Cockpit;
