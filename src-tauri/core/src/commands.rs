//! コマンド実装 (§7.1)。各コマンドは「操作 → 裏側の対応」(§4) を実装し、
//! 実コマンド/REST を呼び、未接続・失敗時は mock へフォールバックする（§5 静かに壊れない）。
//!
//! トランスポート非依存: 状態は `&Cockpit`、ストリーム配信は `Arc<dyn EventSink>` を受け取る。
//! Tauri の `#[tauri::command]` ラッパとブリッジの HTTP ハンドラが同じ関数を呼ぶ。
//!
//! 「要承認」操作（git_merge / vault_delete 等）は、フロントが承認モーダル(§5,§14.3)を
//! 通したうえで呼ぶ契約。バックエンドは破壊操作の最終ゲートとして dcg を併用する。

use std::sync::Arc;

use crate::exec::{self, run_capture, EventSink};
use crate::mock;
use crate::models::*;
use crate::obsidian::Obsidian;
use crate::orchestrator::state_machine;
use crate::orchestrator::{artifacts, now_string, router};
use crate::secrets;
use crate::state::Cockpit;
use crate::store;

// ── ヘルス / 認証 / クォータ ────────────────────────────────────────────────

/// 3依存のヘルス（§4.1）。codex login / LM Studio /v1/models / Obsidian ping。
pub async fn health_check(state: &Cockpit) -> Result<Health, String> {
    let s = state.settings();

    // Codex: `codex login status`（auth.json 経路）。
    let codex = match run_capture(&svec(&["codex", "login", "status"]), None) {
        Ok(out) if out.to_lowercase().contains("logged in") || out.contains("chatgpt") => {
            Status::Ok
        }
        Ok(_) => Status::Warn,
        Err(_) => Status::Unknown,
    };

    // LM Studio: GET /v1/models。
    let lmstudio = if validate_local_endpoint(&s.lmstudio_endpoint).is_err() {
        Status::Warn
    } else {
        match reqwest::get(format!("{}/v1/models", s.lmstudio_endpoint)).await {
            Ok(r) if r.status().is_success() => Status::Ok,
            Ok(_) => Status::Warn,
            Err(_) => Status::Down,
        }
    };

    // Obsidian REST ping。
    let token = secrets::get("obsidian");
    let obsidian = if validate_local_endpoint(&s.obsidian_endpoint).is_ok()
        && Obsidian::new(&s.obsidian_endpoint, token).ping().await
    {
        Status::Ok
    } else {
        Status::Down
    };

    let note = match (codex, lmstudio, obsidian) {
        (Status::Down, _, _) | (Status::Unknown, _, _) => Some("Codex のログイン状態を確認できません。Settings から `codex login` を実行してください。".into()),
        (_, Status::Down, _) => Some("LM Studio (:1234) に接続できません。アプリ起動とモデルのロードを確認してください。".into()),
        (_, _, Status::Down) => Some("Obsidian Local REST API (:27123) に接続できません。プラグインとトークンを確認してください。".into()),
        _ => None,
    };

    Ok(Health {
        codex,
        lmstudio,
        obsidian,
        note,
    })
}

/// 認証経路（§4.7）。ChatGPTログインか、APIキー検出か。
pub fn codex_auth_status() -> Result<AuthStatus, String> {
    // 従量課金系APIキーがあれば警告対象（赤旗は Quota 画面で表示）。
    let api_key = ["OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]
        .iter()
        .any(|name| std::env::var(name).ok().filter(|v| !v.is_empty()).is_some());
    match run_capture(&svec(&["codex", "login", "status"]), None) {
        Ok(out) if out.to_lowercase().contains("logged in") => Ok(AuthStatus {
            logged_in: true,
            method: AuthMethod::Chatgpt,
        }),
        _ if api_key => Ok(AuthStatus {
            logged_in: true,
            method: AuthMethod::Api,
        }),
        _ => Ok(AuthStatus {
            logged_in: false,
            method: AuthMethod::None,
        }),
    }
}

/// `codex login` を起動（§4.8）。
pub async fn codex_login(sink: Arc<dyn EventSink>) -> Result<String, String> {
    let job = exec::next_job_id();
    exec::spawn_streamed(sink, job.clone(), svec(&["codex", "login"]), None)
        .await
        .map_err(|e| e.to_string())?;
    Ok(job)
}

/// Plus 残量（§12: 公式API無し・ベストエフォート）。取得不能時は source=unknown。
pub fn quota_status(_state: &Cockpit) -> Result<Quota, String> {
    // `codex` セッションの `/status` 出力をパースする想定。非対話では取得困難なため、
    // 現状は unknown を正直に返す（誤った安心を与えない）。Mac実機でパーサを差し込む。
    Ok(mock::quota_unknown())
}

/// AirFlow動的タスク（§4.2/§4.3）。正データはMarkdownだが、GUIはJSONビューで読む。
/// Store未接続・空の場合だけMockへ縮退する。
pub fn task_list(state: &Cockpit) -> Result<Vec<TaskCard>, String> {
    let repository = state.repository();
    let persisted = repository.list()?;
    if !persisted.is_empty() {
        return Ok(persisted);
    }
    if let Ok(tasks) = store::read_tickets(&state.settings().airflow_store_path) {
        for task in tasks {
            repository.upsert(&task)?;
        }
    }
    repository.list()
}

pub fn task_get(state: &Cockpit, task_id: String) -> Result<TaskCard, String> {
    state
        .repository()
        .get(&task_id)?
        .ok_or_else(|| "task not found".into())
}

pub fn task_create(state: &Cockpit, task: TaskCard) -> Result<TaskCard, String> {
    let task = state.repository().create(task)?;
    Ok(task)
}

pub fn task_update(state: &Cockpit, task: TaskCard) -> Result<TaskCard, String> {
    if let Some(current) = state.repository().get(&task.task_id)? {
        state_machine::transition(current.status, task.status)?;
    }
    state.repository().update(&task)?;
    Ok(task)
}

pub fn task_import(state: &Cockpit, payload: String) -> Result<Vec<TaskCard>, String> {
    if payload.len() > 2 * 1024 * 1024 {
        return Err("import payload exceeds 2 MiB".into());
    }
    let mut tasks = if let Ok(tasks) = serde_json::from_str::<Vec<TaskCard>>(&payload) {
        tasks
    } else if let Ok(task) = serde_json::from_str::<TaskCard>(&payload) {
        vec![task]
    } else {
        let title = payload
            .lines()
            .find_map(|line| line.strip_prefix("# "))
            .unwrap_or("Imported task")
            .trim();
        vec![TaskCard {
            title: title.into(),
            description: payload,
            task_type: "imported_markdown".into(),
            ..TaskCard::default()
        }]
    };
    let repository = state.repository();
    let mut created = Vec::new();
    for mut task in tasks.drain(..) {
        if !task.task_id.is_empty() && repository.get(&task.task_id)?.is_some() {
            continue;
        }
        task.source_urls = task
            .source_urls
            .into_iter()
            .map(normalize_source_url)
            .collect::<Result<Vec<_>, _>>()?;
        created.push(repository.create(task)?);
    }
    Ok(created)
}

fn normalize_source_url(raw: String) -> Result<String, String> {
    let mut url =
        reqwest::Url::parse(raw.trim()).map_err(|_| format!("invalid source URL: {raw}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("source URL must use http or https: {raw}"));
    }
    url.set_fragment(None);
    Ok(url.to_string())
}

pub fn task_archive(state: &Cockpit, task_id: String) -> Result<TaskCard, String> {
    state.repository().archive(&task_id)
}

pub fn task_route_preview(state: &Cockpit, task_id: String) -> Result<RoutingDecision, String> {
    let task = task_get(state, task_id)?;
    Ok(router::route(&task, &state.settings()))
}

pub fn task_enqueue(state: &Cockpit, task_id: String) -> Result<TaskCard, String> {
    let mut task = task_get(state, task_id)?;
    if task.requires_human_approval || router::requires_approval(&task) {
        task.status = TaskStatus::AwaitingApproval;
        task.auto_run = false;
    } else {
        if task.status == TaskStatus::Draft {
            task.status = TaskStatus::Ready;
        }
        state_machine::transition(task.status, TaskStatus::Queued)?;
        task.status = TaskStatus::Queued;
        task.legacy_status = "Today".into();
        task.auto_run = true;
        task.queued_at = Some(now_string());
    }
    task.last_updated = now_string();
    state.repository().update(&task)?;
    Ok(task)
}

pub async fn task_run_now(
    sink: Arc<dyn EventSink>,
    state: &Cockpit,
    task_id: String,
) -> Result<Option<TaskCard>, String> {
    let task = task_enqueue(state, task_id.clone())?;
    if task.status == TaskStatus::AwaitingApproval {
        return Ok(Some(task));
    }
    let orchestrator = state.orchestrator();
    let settings = state.settings();
    tokio::spawn(async move {
        let _ = orchestrator.run_once(settings, sink, Some(task_id)).await;
    });
    Ok(Some(task))
}

pub fn task_cancel(state: &Cockpit, task_id: String) -> Result<TaskCard, String> {
    let running = state.orchestrator().cancel(&task_id);
    let mut task = task_get(state, task_id)?;
    if !running {
        state_machine::transition(task.status, TaskStatus::Cancelled)?;
        task.status = TaskStatus::Cancelled;
        task.auto_run = false;
        task.lease_owner = None;
        task.lease_expires_at = None;
        state.repository().update(&task)?;
    }
    Ok(task)
}

pub fn task_retry(state: &Cockpit, task_id: String) -> Result<TaskCard, String> {
    let mut task = task_get(state, task_id)?;
    if task.attempt_count >= task.max_attempts {
        return Err("task reached max_attempts".into());
    }
    state_machine::transition(task.status, TaskStatus::Queued)?;
    task.status = TaskStatus::Queued;
    task.auto_run = true;
    task.error_message = None;
    task.queued_at = Some(now_string());
    state.repository().update(&task)?;
    Ok(task)
}

pub fn task_approve(
    state: &Cockpit,
    task_id: String,
    feedback: Option<String>,
) -> Result<TaskCard, String> {
    let mut task = task_get(state, task_id.clone())?;
    task.requires_human_approval = false;
    task.decision_required = false;
    task.status = TaskStatus::Queued;
    task.auto_run = true;
    state.repository().add_approval(&ApprovalDecision {
        approval_id: uuid::Uuid::new_v4().to_string(),
        task_id,
        decision: "approved".into(),
        feedback,
        actor: "human".into(),
        created_at: now_string(),
    })?;
    state.repository().update(&task)?;
    Ok(task)
}

pub fn task_reject(
    state: &Cockpit,
    task_id: String,
    feedback: Option<String>,
) -> Result<TaskCard, String> {
    let mut task = task_get(state, task_id.clone())?;
    task.status = TaskStatus::Cancelled;
    task.auto_run = false;
    state.repository().add_approval(&ApprovalDecision {
        approval_id: uuid::Uuid::new_v4().to_string(),
        task_id,
        decision: "rejected".into(),
        feedback,
        actor: "human".into(),
        created_at: now_string(),
    })?;
    state.repository().update(&task)?;
    Ok(task)
}

pub fn task_feedback(
    state: &Cockpit,
    task_id: String,
    feedback: String,
) -> Result<TaskCard, String> {
    let mut task = task_get(state, task_id.clone())?;
    task.status = TaskStatus::AwaitingInput;
    task.auto_run = false;
    task.error_message = Some(feedback.clone());
    state.repository().add_approval(&ApprovalDecision {
        approval_id: uuid::Uuid::new_v4().to_string(),
        task_id,
        decision: "feedback".into(),
        feedback: Some(feedback),
        actor: "human".into(),
        created_at: now_string(),
    })?;
    state.repository().update(&task)?;
    Ok(task)
}

pub fn task_artifacts(state: &Cockpit, task_id: String) -> Result<Vec<TaskArtifact>, String> {
    state.repository().artifacts(&task_id)
}

pub fn task_artifact_read(
    state: &Cockpit,
    task_id: String,
    path: String,
) -> Result<String, String> {
    artifacts::read(
        std::path::Path::new(&state.settings().artifact_root),
        &task_id,
        &path,
    )
}

pub fn task_artifact_open(state: &Cockpit, task_id: String) -> Result<(), String> {
    let dir = artifacts::task_dir(
        std::path::Path::new(&state.settings().artifact_root),
        &task_id,
    )?;
    run_capture(&["open".into(), dir.to_string_lossy().into_owned()], None)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn orchestrator_status(state: &Cockpit) -> Result<OrchestratorStatus, String> {
    Ok(state.orchestrator().status())
}
pub fn orchestrator_start(
    sink: Arc<dyn EventSink>,
    state: &Cockpit,
) -> Result<OrchestratorStatus, String> {
    Ok(state.orchestrator().start(state.settings(), sink))
}
pub fn orchestrator_pause(state: &Cockpit) -> Result<OrchestratorStatus, String> {
    state.orchestrator().pause()
}
pub fn orchestrator_resume(state: &Cockpit) -> Result<OrchestratorStatus, String> {
    state.orchestrator().resume()
}
pub fn orchestrator_stop(state: &Cockpit) -> Result<OrchestratorStatus, String> {
    Ok(state.orchestrator().stop())
}
pub async fn orchestrator_run_once(
    sink: Arc<dyn EventSink>,
    state: &Cockpit,
) -> Result<Option<TaskCard>, String> {
    let orchestrator = state.orchestrator();
    let settings = state.settings();
    tokio::spawn(async move {
        let _ = orchestrator.run_once(settings, sink, None).await;
    });
    Ok(None)
}
pub async fn worker_health(state: &Cockpit) -> Result<Vec<WorkerHealth>, String> {
    Ok(state.orchestrator().worker_health(&state.settings()).await)
}
pub async fn model_capabilities(state: &Cockpit) -> Result<Vec<ModelCapability>, String> {
    Ok(state
        .orchestrator()
        .model_capabilities(&state.settings())
        .await)
}
pub async fn model_refresh(state: &Cockpit) -> Result<Vec<ModelCapability>, String> {
    model_capabilities(state).await
}

// ── MCP ─────────────────────────────────────────────────────────────────────

pub fn mcp_list() -> Result<Vec<McpServer>, String> {
    match run_capture(&svec(&["codex", "mcp", "list", "--json"]), None) {
        Ok(out) => Ok(parse_mcp(&out)),
        Err(_) => Ok(mock::mcp_empty()),
    }
}

pub fn mcp_toggle(name: String, enabled: bool) -> Result<(), String> {
    let sub = if enabled { "enable" } else { "disable" };
    run_capture(&svec(&["codex", "mcp", sub, &name]), None)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ── Build / Worktree / git ──────────────────────────────────────────────────

pub fn worktree_list(_state: &Cockpit, repo: String) -> Result<Vec<Worktree>, String> {
    match run_capture(
        &svec(&["git", "worktree", "list", "--porcelain"]),
        Some(&repo),
    ) {
        Ok(out) => Ok(parse_worktrees(&out, &repo)),
        Err(_) => Ok(mock::worktrees_empty()),
    }
}

pub fn worktree_create(state: &Cockpit, repo: String, feature: String) -> Result<Worktree, String> {
    let s = state.settings();
    // scripts/worktree_new.sh <repo> <feature>（§4.3）。
    let script = format!("{}/worktree_new.sh", s.scripts_path);
    run_capture(&svec(&["bash", &script, &repo, &feature]), None).map_err(|e| e.to_string())?;
    Ok(Worktree {
        repo,
        path: feature.to_string(),
        branch: feature.clone(),
        dirty: false,
    })
}

/// ビルド実行（§4.3）。scripts/codex_build.sh 経由で codex exec --json を起動しストリーム。
/// 退避モード時は profile を local_review に強制（§4.7）。
pub async fn codex_build(
    sink: Arc<dyn EventSink>,
    state: &Cockpit,
    worktree: String,
    prompt: String,
    profile: Option<String>,
) -> Result<String, String> {
    let s = state.settings();
    let profile = if s.retreat_mode {
        "local_review".to_string()
    } else {
        profile.unwrap_or_else(|| "default".to_string())
    };
    let script = format!("{}/codex_build.sh", s.scripts_path);
    let job = exec::next_job_id();
    exec::spawn_streamed(
        sink,
        job.clone(),
        svec(&["bash", &script, &worktree, &prompt, &profile]),
        Some(worktree.clone()),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(job)
}

pub async fn local_review(
    sink: Arc<dyn EventSink>,
    state: &Cockpit,
    worktree: String,
    base: String,
) -> Result<String, String> {
    let s = state.settings();
    let script = format!("{}/local_review.sh", s.scripts_path);
    let job = exec::next_job_id();
    exec::spawn_streamed(
        sink,
        job.clone(),
        svec(&["bash", &script, &worktree, &base]),
        Some(worktree.clone()),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(job)
}

pub fn git_diff(worktree: String, base: String) -> Result<String, String> {
    run_capture(&svec(&["git", "diff", &base]), Some(&worktree)).map_err(|e| e.to_string())
}

/// main へのマージ（§4.3, §9: 要承認）。フロントが承認モーダルを通したうえで呼ぶ契約。
pub fn git_merge(worktree: String, base: String) -> Result<(), String> {
    run_capture(&svec(&["git", "merge", &base]), Some(&worktree))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ── Memory / Vault ──────────────────────────────────────────────────────────

fn vault(state: &Cockpit) -> Obsidian {
    let s = state.settings();
    Obsidian::new(s.obsidian_endpoint, secrets::get("obsidian"))
}

pub async fn vault_tree(state: &Cockpit) -> Result<Vec<VaultNode>, String> {
    vault(state).tree("").await
}

pub async fn vault_read(state: &Cockpit, path: String) -> Result<String, String> {
    vault(state).read(&path).await
}

/// 追記/編集（§4.4）。mode=append は heading 単位の外科的 PATCH、replace は PUT。
pub async fn vault_write(
    state: &Cockpit,
    path: String,
    content: String,
    mode: String,
    heading: Option<String>,
) -> Result<(), String> {
    let v = vault(state);
    if mode == "append" {
        // §14.4: AI_Handoff.md は ANCHOR 直下に時系列降順で挿入。
        v.write_append(&path, content, heading.as_deref().unwrap_or(""))
            .await
    } else {
        v.write_replace(&path, content).await
    }
}

/// 削除（§4.4, §9: 要承認 + ゴミ箱経由）。フロントが承認モーダルを通す契約。
pub async fn vault_delete(state: &Cockpit, path: String) -> Result<(), String> {
    vault(state).delete(&path).await
}

pub async fn vault_search(state: &Cockpit, query: String) -> Result<Vec<SearchHit>, String> {
    vault(state).search(&query).await
}

// ── Schedule / launchd ──────────────────────────────────────────────────────

pub fn launchd_list() -> Result<Vec<ScheduleJob>, String> {
    match run_capture(&svec(&["launchctl", "list"]), None) {
        Ok(out) => Ok(parse_launchd(&out)),
        Err(_) => Ok(mock::schedule_empty()),
    }
}

pub fn launchd_toggle(label: String, on: bool) -> Result<(), String> {
    let sub = if on { "load" } else { "unload" };
    run_capture(&svec(&["launchctl", sub, &label]), None)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub async fn launchd_run_now(
    sink: Arc<dyn EventSink>,
    state: &Cockpit,
    label: String,
) -> Result<String, String> {
    let s = state.settings();
    // 朝会など（§4.5）。代表として morning_meeting.sh を起動。
    let _ = label;
    let script = format!("{}/morning_meeting.sh", s.scripts_path);
    let job = exec::next_job_id();
    exec::spawn_streamed(sink, job.clone(), svec(&["bash", &script]), None)
        .await
        .map_err(|e| e.to_string())?;
    Ok(job)
}

pub fn launchd_set_time(label: String, hour: u8, minute: u8) -> Result<(), String> {
    // plist の StartCalendarInterval 編集 → reload（§4.5）。実機で plist を編集する。
    let _ = (label, hour, minute);
    Ok(())
}

// ── Research ────────────────────────────────────────────────────────────────

pub async fn research_scan(
    sink: Arc<dyn EventSink>,
    state: &Cockpit,
    topic: String,
) -> Result<String, String> {
    let s = state.settings();
    let script = format!("{}/research_scan.sh", s.scripts_path);
    let job = exec::next_job_id();
    exec::spawn_streamed(sink, job.clone(), svec(&["bash", &script, &topic]), None)
        .await
        .map_err(|e| e.to_string())?;
    Ok(job)
}

// ── Config / Settings / Secrets ─────────────────────────────────────────────

pub fn config_get_model(state: &Cockpit) -> Result<String, String> {
    Ok(state.settings().default_model)
}

/// 既定モデル切替（§4.7, §9: 要確認）。~/.codex/config.toml の model を編集する想定。
pub fn config_set_model(state: &Cockpit, model: String) -> Result<(), String> {
    state.update(|s| s.default_model = model.clone());
    Ok(())
}

/// Keychain 保存（§9）。値はフロントに残さない。
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    secrets::set(&key, &value)
}

pub fn settings_get(state: &Cockpit) -> Result<AppSettings, String> {
    Ok(state.settings())
}

pub fn settings_set(state: &Cockpit, patch: serde_json::Value) -> Result<AppSettings, String> {
    for key in ["lmstudio_endpoint", "obsidian_endpoint"] {
        if let Some(endpoint) = patch.get(key).and_then(|v| v.as_str()) {
            validate_local_endpoint(endpoint)?;
        }
    }
    if let Some(root) = patch.get("artifact_root").and_then(|v| v.as_str()) {
        let path = std::path::Path::new(root);
        if !path.is_absolute() || path == std::path::Path::new("/") {
            return Err("artifact_root must be an absolute non-root path".into());
        }
    }
    state.update(|s| {
        if let Some(v) = patch.get("airflow_store_path").and_then(|v| v.as_str()) {
            s.airflow_store_path = v.into();
        }
        if let Some(v) = patch.get("vault_path").and_then(|v| v.as_str()) {
            s.vault_path = v.into();
        }
        if let Some(v) = patch.get("repos_parent").and_then(|v| v.as_str()) {
            s.repos_parent = v.into();
        }
        if let Some(v) = patch.get("scripts_path").and_then(|v| v.as_str()) {
            s.scripts_path = v.into();
        }
        if let Some(v) = patch.get("workspace_root").and_then(|v| v.as_str()) {
            s.workspace_root = v.into();
        }
        if let Some(v) = patch.get("lmstudio_endpoint").and_then(|v| v.as_str()) {
            s.lmstudio_endpoint = v.into();
        }
        if let Some(v) = patch.get("obsidian_endpoint").and_then(|v| v.as_str()) {
            s.obsidian_endpoint = v.into();
        }
        if let Some(v) = patch.get("retreat_mode").and_then(|v| v.as_bool()) {
            s.retreat_mode = v;
        }
        if let Some(v) = patch.get("orchestrator_enabled").and_then(|v| v.as_bool()) {
            s.orchestrator_enabled = v;
        }
        if let Some(v) = patch
            .get("orchestrator_auto_start")
            .and_then(|v| v.as_bool())
        {
            s.orchestrator_auto_start = v;
        }
        if let Some(v) = patch.get("poll_interval_seconds").and_then(|v| v.as_u64()) {
            s.poll_interval_seconds = v.clamp(1, 300);
        }
        if let Some(v) = patch.get("max_concurrency").and_then(|v| v.as_u64()) {
            s.max_concurrency = (v as usize).clamp(1, 4);
        }
        if let Some(v) = patch.get("codex_concurrency").and_then(|v| v.as_u64()) {
            s.codex_concurrency = (v as usize).clamp(1, 2);
        }
        if let Some(v) = patch.get("lmstudio_concurrency").and_then(|v| v.as_u64()) {
            s.lmstudio_concurrency = (v as usize).clamp(1, 2);
        }
        if let Some(v) = patch.get("luna_model").and_then(|v| v.as_str()) {
            s.luna_model = v.into();
        }
        if let Some(v) = patch.get("terra_model").and_then(|v| v.as_str()) {
            s.terra_model = v.into();
        }
        if let Some(v) = patch.get("sol_model").and_then(|v| v.as_str()) {
            s.sol_model = v.into();
        }
        if let Some(v) = patch.get("lmstudio_default_model").and_then(|v| v.as_str()) {
            s.lmstudio_default_model = v.into();
        }
        if let Some(v) = patch.get("auto_escalation").and_then(|v| v.as_bool()) {
            s.auto_escalation = v;
        }
        if let Some(v) = patch.get("quality_threshold").and_then(|v| v.as_u64()) {
            s.quality_threshold = (v as u8).clamp(50, 100);
        }
        if let Some(v) = patch.get("max_retries").and_then(|v| v.as_u64()) {
            s.max_retries = (v as u32).clamp(1, 10);
        }
        if let Some(v) = patch.get("artifact_root").and_then(|v| v.as_str()) {
            s.artifact_root = v.into();
        }
        if let Some(v) = patch.get("log_retention_days").and_then(|v| v.as_u64()) {
            s.log_retention_days = (v as u32).clamp(1, 365);
        }
    });
    Ok(state.settings())
}

// ── parsing helpers ─────────────────────────────────────────────────────────

fn svec(s: &[&str]) -> Vec<String> {
    s.iter().map(|x| x.to_string()).collect()
}

fn validate_local_endpoint(raw: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(raw).map_err(|e| format!("invalid endpoint: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("endpoint must use http or https".into());
    }
    if !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1")) {
        return Err(
            "endpoint must use loopback; non-local services require explicit approval".into(),
        );
    }
    Ok(())
}

/// `git worktree list --porcelain` を Worktree[] に。
fn parse_worktrees(out: &str, repo: &str) -> Vec<Worktree> {
    let mut res = Vec::new();
    let mut path = String::new();
    let mut branch = String::new();
    for line in out.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            path = p.to_string();
        } else if let Some(b) = line.strip_prefix("branch ") {
            branch = b.rsplit('/').next().unwrap_or(b).to_string();
        } else if line.is_empty() && !path.is_empty() {
            res.push(Worktree {
                repo: repo.into(),
                path: std::mem::take(&mut path),
                branch: std::mem::take(&mut branch),
                dirty: false,
            });
        }
    }
    if !path.is_empty() {
        res.push(Worktree {
            repo: repo.into(),
            path,
            branch,
            dirty: false,
        });
    }
    res
}

fn parse_mcp(out: &str) -> Vec<McpServer> {
    serde_json::from_str::<serde_json::Value>(out)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    Some(McpServer {
                        name: v.get("name")?.as_str()?.to_string(),
                        enabled: v.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true),
                        transport: v
                            .get("transport")
                            .and_then(|t| t.as_str())
                            .unwrap_or("stdio")
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_launchd(out: &str) -> Vec<ScheduleJob> {
    out.lines()
        .skip(1)
        .filter_map(|line| {
            let mut cols = line.split_whitespace();
            let _pid = cols.next()?;
            let status = cols.next()?;
            let label = cols.next()?;
            if !label.contains("jarvis") {
                return None;
            }
            Some(ScheduleJob {
                label: label.to_string(),
                next_run: None,
                loaded: true,
                last_result: Some(format!("exit {status}")),
            })
        })
        .collect()
}
