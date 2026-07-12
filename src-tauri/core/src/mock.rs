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

pub fn task_cards() -> Vec<TaskCard> {
    vec![
        TaskCard {
            id: "TKT-20260701-001".into(),
            task_id: "TASK-2026-0701A".into(),
            title: "AirFlow完全版仕様書をアプリ実装へ反映する".into(),
            category: "Engineering".into(),
            legacy_status: "Doing".into(),
            priority: 1,
            risk_score: 2.4,
            created: "2026-07-01T09:00:00+09:00".into(),
            updated: "2026-07-01T13:30:00+09:00".into(),
            due: Some("2026-07-01".into()),
            source: "manual".into(),
            assignee: "codex".into(),
            tier: 3,
            decision_required: false,
            dependencies: vec![],
            links: vec!["[[01_Projects/AirFlow AI自動化タスクボード 完全版仕様書]]".into()],
            log: vec!["Design Spec v1.0 をUIトークンへ反映中".into()],
            status: TaskStatus::Running,
            task_priority: TaskPriority::High,
            worker_type: Some(WorkerType::Codex),
            auto_run: true,
            instructions: "AirFlow仕様を実装し、検証結果を返す".into(),
            created_at: "2026-07-01T09:00:00+09:00".into(),
            last_updated: "2026-07-01T13:30:00+09:00".into(),
            ..TaskCard::default()
        },
        TaskCard {
            id: "TKT-20260701-002".into(),
            task_id: "TASK-2026-0701B".into(),
            title: "OPENAI/GEMINI APIキー検出時の赤旗を確認する".into(),
            category: "Business".into(),
            legacy_status: "Waiting".into(),
            priority: 1,
            risk_score: 3.2,
            created: "2026-07-01T09:30:00+09:00".into(),
            updated: "2026-07-01T12:10:00+09:00".into(),
            due: Some("2026-07-01".into()),
            source: "ai".into(),
            assignee: "human".into(),
            tier: 2,
            decision_required: true,
            dependencies: vec!["TASK-2026-0701A".into()],
            links: vec!["[[04_Context/AI秘書システム]]".into()],
            log: vec!["risk_score >= 3.0 のため承認モーダル対象".into()],
            status: TaskStatus::AwaitingApproval,
            task_priority: TaskPriority::High,
            worker_type: Some(WorkerType::Human),
            requires_human_approval: true,
            created_at: "2026-07-01T09:30:00+09:00".into(),
            last_updated: "2026-07-01T12:10:00+09:00".into(),
            ..TaskCard::default()
        },
    ]
}
