//! JARVIS Bridge — ローカル仲介サーバー（ハイブリッド構成の要）。
//!
//! 公開Webアプリ（GitHub Pages）はユーザーの localhost に直接届かない。本ブリッジを
//! Mac 上で起動すると、§7 の IPC 契約を `http://127.0.0.1:8787` 上の HTTP/SSE として公開し、
//! `jarvis_cockpit_core` 経由で実 Codex / Obsidian / LM Studio / Keychain に接続する。
//!
//! セキュリティ（ローカルでシェルを起動するため厳格に）:
//! - **127.0.0.1 のみ bind**（外部公開しない）。
//! - **Bearer トークン**必須（起動時生成・標準エラーに表示）。`/events` は `?token=` も可。
//! - **Origin allowlist**（公開Webオリジン + ローカル開発のみ）。
//! - **CORS + Private Network Access**（https→localhost をブラウザで成立させる）。
//! - シェル起動は core の allowlist + dcg を必ず通過（`rm -rf /` 等は exit 2 で遮断）。
//! - 秘密（Obsidian トークン等）は Keychain に留まり、フロントへは渡さない。

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    body::{Body, Bytes},
    extract::{Path, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use futures_util::StreamExt;
use jarvis_cockpit_core as core;
use jarvis_cockpit_core::{Cockpit, EventSink};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;

/// ブリッジの EventSink: core の job:* / health:tick 等を SSE ブロードキャストへ流す。
struct BridgeSink(broadcast::Sender<String>);

impl EventSink for BridgeSink {
    fn emit(&self, event: &str, payload: Value) {
        // 1 行 = 1 イベント（{event, payload}）。購読者ゼロでも send のエラーは無視。
        let _ = self.0.send(json!({ "event": event, "payload": payload }).to_string());
    }
}

#[derive(Clone)]
struct AppState {
    cockpit: Arc<Cockpit>,
    tx: broadcast::Sender<String>,
    token: Arc<String>,
    origins: Arc<Vec<String>>,
}

impl AppState {
    fn sink(&self) -> Arc<dyn EventSink> {
        Arc::new(BridgeSink(self.tx.clone()))
    }
}

#[tokio::main]
async fn main() {
    let token = std::env::var("JARVIS_BRIDGE_TOKEN")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(gen_token);
    let addr = std::env::var("JARVIS_BRIDGE_ADDR").unwrap_or_else(|_| "127.0.0.1:8787".into());
    let origins: Vec<String> = std::env::var("JARVIS_BRIDGE_ORIGINS")
        .ok()
        .map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect())
        .unwrap_or_else(default_origins);

    let (tx, _rx) = broadcast::channel::<String>(512);
    let state = AppState {
        cockpit: Arc::new(Cockpit::new()),
        tx: tx.clone(),
        token: Arc::new(token.clone()),
        origins: Arc::new(origins.clone()),
    };

    // health:tick / quota:tick を 5 秒間隔で SSE 配信（§7.2）。
    {
        let st = state.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(5));
            loop {
                ticker.tick().await;
                let sink = st.sink();
                if let Ok(h) = core::commands::health_check(st.cockpit.as_ref()).await {
                    if let Ok(v) = serde_json::to_value(h) {
                        sink.emit("health:tick", v);
                    }
                }
                if let Ok(q) = core::commands::quota_status(st.cockpit.as_ref()) {
                    if let Ok(v) = serde_json::to_value(q) {
                        sink.emit("quota:tick", v);
                    }
                }
            }
        });
    }

    let app = Router::new()
        .route("/health", get(health))
        .route("/invoke/:cmd", post(invoke))
        .route("/events", get(events))
        .layer(middleware::from_fn_with_state(state.clone(), cors_mw))
        .with_state(state);

    let listener = TcpListener::bind(&addr).await.expect("bind 127.0.0.1:8787");
    eprintln!("\n  JARVIS Bridge — 実連携の仲介サーバー");
    eprintln!("  ───────────────────────────────────────────");
    eprintln!("  Listening : http://{addr}");
    eprintln!("  Token     : {token}");
    eprintln!("  Origins   : {}", origins.join(", "));
    eprintln!("  使い方: 公開アプリの Settings →「ブリッジ接続」に URL とこの Token を貼り付け。");
    eprintln!("  （Token は本セッション限り。流出時は再起動で無効化されます）\n");

    axum::serve(listener, app).await.expect("serve");
}

// ── ハンドラ ─────────────────────────────────────────────────────────────────

/// 無認証の liveness。フロントの接続検出用（バージョンのみ）。
async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "service": "jarvis-bridge", "version": env!("CARGO_PKG_VERSION") }))
}

#[derive(Deserialize)]
struct EventsQuery {
    token: Option<String>,
}

/// SSE: job:log / job:event / job:done / health:tick / quota:tick / notify を配信。
async fn events(
    State(st): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<EventsQuery>,
) -> Response {
    if !check_token(&headers, &st, q.token.as_deref()) {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    let rx = st.tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| async move {
        match msg {
            Ok(data) => Some(Ok::<Event, Infallible>(Event::default().data(data))),
            Err(_) => None, // lagged: 取りこぼし行はスキップ
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}

/// `POST /invoke/:cmd` — body=引数JSON。core::commands を呼び結果JSONを返す。
async fn invoke(
    State(st): State<AppState>,
    Path(cmd): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !check_token(&headers, &st, None) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" }))).into_response();
    }
    let args: Value = if body.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&body).unwrap_or_else(|_| json!({}))
    };
    match dispatch(&st, &cmd, &args).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

// ── ディスパッチ（§7.1 の全コマンド） ────────────────────────────────────────

async fn dispatch(st: &AppState, cmd: &str, a: &Value) -> Result<Value, String> {
    let cx = st.cockpit.as_ref();
    let v = match cmd {
        "health_check" => to_v(core::commands::health_check(cx).await?)?,
        "codex_auth_status" => to_v(core::commands::codex_auth_status()?)?,
        "codex_login" => to_v(core::commands::codex_login(st.sink()).await?)?,
        "quota_status" => to_v(core::commands::quota_status(cx)?)?,

        "mcp_list" => to_v(core::commands::mcp_list()?)?,
        "mcp_toggle" => {
            core::commands::mcp_toggle(s(a, "name")?, b(a, "enabled")?)?;
            Value::Null
        }

        "worktree_list" => to_v(core::commands::worktree_list(cx, s(a, "repo")?)?)?,
        "worktree_create" => to_v(core::commands::worktree_create(cx, s(a, "repo")?, s(a, "feature")?)?)?,
        "codex_build" => to_v(
            core::commands::codex_build(st.sink(), cx, s(a, "worktree")?, s(a, "prompt")?, opt_s(a, "profile")).await?,
        )?,
        "local_review" => {
            to_v(core::commands::local_review(st.sink(), cx, s(a, "worktree")?, s(a, "base")?).await?)?
        }
        "git_diff" => to_v(core::commands::git_diff(s(a, "worktree")?, s(a, "base")?)?)?,
        "git_merge" => {
            core::commands::git_merge(s(a, "worktree")?, s(a, "base")?)?;
            Value::Null
        }

        "vault_tree" => to_v(core::commands::vault_tree(cx).await?)?,
        "vault_read" => to_v(core::commands::vault_read(cx, s(a, "path")?).await?)?,
        "vault_write" => {
            core::commands::vault_write(cx, s(a, "path")?, s(a, "content")?, s(a, "mode")?, opt_s(a, "heading")).await?;
            Value::Null
        }
        "vault_delete" => {
            core::commands::vault_delete(cx, s(a, "path")?).await?;
            Value::Null
        }
        "vault_search" => to_v(core::commands::vault_search(cx, s(a, "query")?).await?)?,

        "launchd_list" => to_v(core::commands::launchd_list()?)?,
        "launchd_toggle" => {
            core::commands::launchd_toggle(s(a, "label")?, b(a, "on")?)?;
            Value::Null
        }
        "launchd_run_now" => to_v(core::commands::launchd_run_now(st.sink(), cx, s(a, "label")?).await?)?,
        "launchd_set_time" => {
            core::commands::launchd_set_time(s(a, "label")?, u8n(a, "hour")?, u8n(a, "minute")?)?;
            Value::Null
        }

        "research_scan" => to_v(core::commands::research_scan(st.sink(), cx, s(a, "topic")?).await?)?,

        "config_get_model" => to_v(core::commands::config_get_model(cx)?)?,
        "config_set_model" => {
            core::commands::config_set_model(cx, s(a, "model")?)?;
            Value::Null
        }
        "secret_set" => {
            core::commands::secret_set(s(a, "key")?, s(a, "value")?)?;
            Value::Null
        }
        "settings_get" => to_v(core::commands::settings_get(cx)?)?,
        "settings_set" => to_v(core::commands::settings_set(cx, a.get("patch").cloned().unwrap_or(Value::Null))?)?,

        other => return Err(format!("unknown command: {other}")),
    };
    Ok(v)
}

// ── セキュリティ: トークン + Origin allowlist + CORS/PNA ─────────────────────

fn check_token(headers: &HeaderMap, st: &AppState, query_token: Option<&str>) -> bool {
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string());
    let provided = bearer.or_else(|| query_token.map(|s| s.to_string()));
    matches!(provided, Some(p) if p == *st.token.as_ref())
}

/// Origin 検査 + CORS/PNA ヘッダ付与 + プリフライト応答。
async fn cors_mw(State(st): State<AppState>, req: Request, next: Next) -> Response {
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let method = req.method().clone();

    // Origin が付与され、かつ allowlist 外なら拒否（ブラウザ経由の他オリジンを遮断）。
    // Origin なし（curl 等のネイティブ）はトークンで別途ゲートするため通す。
    if let Some(o) = &origin {
        if !st.origins.iter().any(|a| a == o) {
            return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
        }
    }

    if method == Method::OPTIONS {
        let mut res = Response::new(Body::empty());
        *res.status_mut() = StatusCode::NO_CONTENT;
        add_cors(res.headers_mut(), origin.as_deref());
        return res;
    }

    let mut res = next.run(req).await;
    add_cors(res.headers_mut(), origin.as_deref());
    res
}

fn add_cors(h: &mut HeaderMap, origin: Option<&str>) {
    let allow = origin.unwrap_or("*");
    if let Ok(v) = HeaderValue::from_str(allow) {
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
    }
    h.insert(header::VARY, HeaderValue::from_static("Origin"));
    h.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, OPTIONS"));
    h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("authorization, content-type"));
    // Private Network Access: https ページ→localhost のプリフライトを通すために必須。
    h.insert("access-control-allow-private-network", HeaderValue::from_static("true"));
    h.insert(header::ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("600"));
}

// ── ヘルパ ───────────────────────────────────────────────────────────────────

fn to_v<T: serde::Serialize>(x: T) -> Result<Value, String> {
    serde_json::to_value(x).map_err(|e| e.to_string())
}

fn s(a: &Value, k: &str) -> Result<String, String> {
    a.get(k).and_then(|v| v.as_str()).map(|s| s.to_string()).ok_or_else(|| format!("missing arg: {k}"))
}

fn opt_s(a: &Value, k: &str) -> Option<String> {
    a.get(k).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn b(a: &Value, k: &str) -> Result<bool, String> {
    a.get(k).and_then(|v| v.as_bool()).ok_or_else(|| format!("missing arg: {k}"))
}

fn u8n(a: &Value, k: &str) -> Result<u8, String> {
    a.get(k).and_then(|v| v.as_u64()).map(|n| n as u8).ok_or_else(|| format!("missing arg: {k}"))
}

fn gen_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..32).map(|_| format!("{:02x}", rng.gen::<u8>())).collect()
}

fn default_origins() -> Vec<String> {
    vec![
        "https://24-zuka.github.io".into(),
        "http://localhost:5180".into(),
        "http://127.0.0.1:5180".into(),
        "http://localhost:4173".into(),
        "http://localhost:5173".into(),
    ]
}
