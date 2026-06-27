//! Obsidian Local REST API クライアント (§3.1, §4.4)。
//! 既定は HTTP 127.0.0.1:27123、Bearer 認証。トークンは Keychain から取得し平文保存しない（§9）。

use crate::models::{SearchHit, VaultNode};

pub struct Obsidian {
    base: String,
    token: Option<String>,
    http: reqwest::Client,
}

impl Obsidian {
    pub fn new(base: impl Into<String>, token: Option<String>) -> Self {
        Self {
            base: base.into(),
            token,
            http: reqwest::Client::new(),
        }
    }

    fn req(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let url = format!("{}/{}", self.base.trim_end_matches('/'), path.trim_start_matches('/'));
        let mut rb = self.http.request(method, url);
        if let Some(t) = &self.token {
            rb = rb.bearer_auth(t);
        }
        rb
    }

    /// GET /vault/<path> — ノート本文。
    pub async fn read(&self, path: &str) -> Result<String, String> {
        self.req(reqwest::Method::GET, &format!("vault/{path}"))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())
    }

    /// PUT /vault/<path> — 全置換。
    pub async fn write_replace(&self, path: &str, content: String) -> Result<(), String> {
        self.req(reqwest::Method::PUT, &format!("vault/{path}"))
            .header("Content-Type", "text/markdown")
            .body(content)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// PATCH /vault/<path> — heading 単位の外科的追記（§4.4, §14.4 アンカー保全）。
    pub async fn write_append(&self, path: &str, content: String, heading: &str) -> Result<(), String> {
        self.req(reqwest::Method::PATCH, &format!("vault/{path}"))
            .header("Content-Type", "text/markdown")
            .header("Operation", "append")
            .header("Target-Type", "heading")
            .header("Target", heading)
            .body(content)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// DELETE /vault/<path> — §9 の承認後のみ呼ばれる。
    pub async fn delete(&self, path: &str) -> Result<(), String> {
        self.req(reqwest::Method::DELETE, &format!("vault/{path}"))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 全文検索（将来 Smart Connections の意味検索に拡張）。
    pub async fn search(&self, query: &str) -> Result<Vec<SearchHit>, String> {
        let resp = self
            .req(reqwest::Method::POST, "search/simple/")
            .query(&[("query", query)])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let raw: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let hits = raw
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| {
                        Some(SearchHit {
                            path: v.get("filename")?.as_str()?.to_string(),
                            snippet: v
                                .get("matches")
                                .and_then(|m| m.as_array())
                                .and_then(|m| m.first())
                                .and_then(|m| m.get("context"))
                                .and_then(|c| c.as_str())
                                .unwrap_or("")
                                .to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(hits)
    }

    /// Vault のディレクトリツリー（§4.4 左ツリー）。
    pub async fn tree(&self, dir: &str) -> Result<Vec<VaultNode>, String> {
        let resp = self
            .req(reqwest::Method::GET, &format!("vault/{dir}"))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let raw: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let files = raw
            .get("files")
            .and_then(|f| f.as_array())
            .cloned()
            .unwrap_or_default();
        let nodes = files
            .iter()
            .filter_map(|v| v.as_str())
            .map(|name| {
                let is_dir = name.ends_with('/');
                VaultNode {
                    path: format!("{dir}{name}"),
                    kind: if is_dir { "dir".into() } else { "note".into() },
                    children: None,
                }
            })
            .collect();
        Ok(nodes)
    }

    /// 疎通確認（Settings の疎通テスト・health_check 用）。
    pub async fn ping(&self) -> bool {
        self.req(reqwest::Method::GET, "")
            .send()
            .await
            .map(|r| r.status().is_success() || r.status().as_u16() == 401)
            .unwrap_or(false)
    }
}
