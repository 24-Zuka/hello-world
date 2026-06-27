//! 実依存未接続時の縮退/モックデータ (§5「静かに壊れない」)。
//! 実コマンドが失敗したとき、クラッシュせず「不明/未接続」を正直に返すための土台。

use crate::models::*;

pub fn quota_unknown() -> Quota {
    // §12: 取得不能時は source=unknown で「不明」を返す（誤った安心を与えない）。
    Quota {
        window_used: 0,
        window_limit: 0,
        resets_at: None,
        weekly: None,
        source: QuotaSource::Unknown,
    }
}

pub fn health_all_unknown(note: &str) -> Health {
    Health {
        codex: Status::Unknown,
        lmstudio: Status::Unknown,
        obsidian: Status::Unknown,
        note: Some(note.to_string()),
    }
}

pub fn worktrees_empty() -> Vec<Worktree> {
    Vec::new()
}

pub fn mcp_empty() -> Vec<McpServer> {
    Vec::new()
}

pub fn schedule_empty() -> Vec<ScheduleJob> {
    Vec::new()
}
