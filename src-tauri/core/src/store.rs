//! AirFlow Store reader.
//!
//! The source of truth for dynamic tasks is Markdown with YAML front matter under
//! `~/Library/Application Support/AirFlow/tickets/*.md` (§4.2/§4.3). This module
//! keeps the parser intentionally small and dependency-free: it reads the fields
//! AirFlow needs for the cockpit JSON view and ignores unknown properties.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::models::TaskCard;

pub fn read_tickets(store_path: &str) -> Result<Vec<TaskCard>, String> {
    let dir = Path::new(store_path).join("tickets");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut tasks = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Some(task) = parse_ticket(&path, &raw) {
                tasks.push(task);
            }
        }
    }
    tasks.sort_by(|a, b| {
        let ak = (
            status_rank(&a.legacy_status),
            a.priority,
            a.due.clone().unwrap_or_default(),
            a.updated.clone(),
        );
        let bk = (
            status_rank(&b.legacy_status),
            b.priority,
            b.due.clone().unwrap_or_default(),
            b.updated.clone(),
        );
        ak.cmp(&bk)
    });
    Ok(tasks)
}

fn parse_ticket(path: &Path, raw: &str) -> Option<TaskCard> {
    let frontmatter = extract_frontmatter(raw)?;
    let map = parse_yaml_subset(frontmatter);
    let stem = file_stem(path);
    let id = str_field(&map, "id").unwrap_or_else(|| stem.clone());
    let task_id = str_field(&map, "task_id").unwrap_or_else(|| id.clone());
    let legacy_status = normalize_status(str_field(&map, "status").as_deref());
    let automation_status = match legacy_status.as_str() {
        "Today" => crate::models::TaskStatus::Ready,
        "Doing" => crate::models::TaskStatus::Running,
        "Waiting" => crate::models::TaskStatus::AwaitingApproval,
        "Done" => crate::models::TaskStatus::Completed,
        _ => crate::models::TaskStatus::Draft,
    };
    let priority = normalize_priority(str_field(&map, "priority").as_deref());
    let created = str_field(&map, "created").unwrap_or_default();
    let updated = str_field(&map, "updated").unwrap_or_default();
    let decision_required = bool_field(&map, "decision_required");
    Some(TaskCard {
        id,
        task_id,
        title: str_field(&map, "title").unwrap_or_else(|| first_heading(raw).unwrap_or(stem)),
        category: normalize_category(str_field(&map, "category").as_deref()),
        legacy_status,
        priority,
        assignee: normalize_assignee(str_field(&map, "assignee").as_deref()),
        risk_score: str_field(&map, "risk_score")
            .and_then(|v| v.parse().ok())
            .unwrap_or(1.0),
        created: created.clone(),
        updated: updated.clone(),
        due: str_field(&map, "due").filter(|v| !v.is_empty()),
        source: str_field(&map, "source").unwrap_or_else(|| "manual".into()),
        tier: str_field(&map, "tier")
            .and_then(|v| v.parse().ok())
            .filter(|v| (1..=3).contains(v))
            .unwrap_or(1),
        decision_required,
        dependencies: list_field(&map, "dependencies"),
        links: list_field(&map, "links"),
        log: list_field(&map, "log"),
        status: automation_status,
        task_priority: match priority {
            1 => crate::models::TaskPriority::High,
            3 => crate::models::TaskPriority::Low,
            _ => crate::models::TaskPriority::Medium,
        },
        requires_human_approval: decision_required,
        created_at: created,
        last_updated: updated,
        ..TaskCard::default()
    })
}

fn extract_frontmatter(raw: &str) -> Option<&str> {
    let rest = raw
        .strip_prefix("---\n")
        .or_else(|| raw.strip_prefix("---\r\n"))?;
    let end = rest.find("\n---").or_else(|| rest.find("\r\n---"))?;
    Some(&rest[..end])
}

fn parse_yaml_subset(yaml: &str) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    let mut current_key: Option<String> = None;
    for line in yaml.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(item) = trimmed.strip_prefix("- ") {
            if let Some(key) = &current_key {
                map.entry(key.clone()).or_default().push(clean_scalar(item));
            }
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let key = key.trim().to_string();
        let value = value.trim();
        current_key = Some(key.clone());
        if value.is_empty() {
            map.entry(key).or_default();
        } else if value.starts_with('[') && value.ends_with(']') {
            let items = value
                .trim_start_matches('[')
                .trim_end_matches(']')
                .split(',')
                .map(clean_scalar)
                .filter(|v| !v.is_empty())
                .collect::<Vec<_>>();
            map.insert(key, items);
        } else {
            map.insert(key, vec![clean_scalar(value)]);
        }
    }
    map
}

fn str_field(map: &HashMap<String, Vec<String>>, key: &str) -> Option<String> {
    map.get(key).and_then(|v| v.first()).map(|v| v.to_string())
}

fn list_field(map: &HashMap<String, Vec<String>>, key: &str) -> Vec<String> {
    map.get(key).cloned().unwrap_or_default()
}

fn bool_field(map: &HashMap<String, Vec<String>>, key: &str) -> bool {
    matches!(
        str_field(map, key).as_deref(),
        Some("true" | "True" | "TRUE" | "yes" | "1")
    )
}

fn clean_scalar(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("untitled")
        .to_string()
}

fn first_heading(raw: &str) -> Option<String> {
    raw.lines()
        .find_map(|line| line.strip_prefix("# ").map(|h| h.trim().to_string()))
        .filter(|h| !h.is_empty())
}

fn normalize_category(value: Option<&str>) -> String {
    match value {
        Some("Business") | Some("Engineering") | Some("Content") => value.unwrap().to_string(),
        _ => "Business".into(),
    }
}

fn normalize_status(value: Option<&str>) -> String {
    match value {
        Some("Inbox" | "Today" | "Doing" | "Waiting" | "Done") => value.unwrap().to_string(),
        Some("TODO") => "Inbox".into(),
        Some("IN_PROGRESS") => "Doing".into(),
        Some("AWAITING_DECISION" | "PENDING_REVIEW") => "Waiting".into(),
        Some("DONE") => "Done".into(),
        _ => "Inbox".into(),
    }
}

fn normalize_priority(value: Option<&str>) -> u8 {
    match value {
        Some("1" | "HIGH" | "CRITICAL") => 1,
        Some("2" | "MEDIUM") => 2,
        Some("3" | "LOW") => 3,
        _ => 2,
    }
}

fn normalize_assignee(value: Option<&str>) -> String {
    match value {
        Some("codex" | "lmstudio" | "gemini" | "human") => value.unwrap().to_string(),
        Some(v) if !v.is_empty() => v.to_string(),
        _ => "lmstudio".into(),
    }
}

fn status_rank(status: &str) -> u8 {
    match status {
        "Waiting" => 0,
        "Today" => 1,
        "Doing" => 2,
        "Inbox" => 3,
        "Done" => 4,
        _ => 5,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn parses_airflow_ticket_frontmatter() {
        let raw = r#"---
id: TKT-20260701-001
task_id: TASK-2026-0701A
title: AirFlowを作る
category: Engineering
status: Waiting
priority: 1
risk_score: 3.2
created: 2026-07-01T09:00:00+09:00
updated: 2026-07-01T10:00:00+09:00
due: 2026-07-01
source: manual
assignee: codex
tier: 3
decision_required: true
dependencies:
  - TASK-2026-0701B
links:
  - "[[仕様書]]"
log:
  - "created"
---

# Body
"#;
        let task = parse_ticket(&PathBuf::from("ticket.md"), raw).unwrap();
        assert_eq!(task.id, "TKT-20260701-001");
        assert_eq!(task.legacy_status, "Waiting");
        assert_eq!(task.status, crate::models::TaskStatus::AwaitingApproval);
        assert_eq!(task.priority, 1);
        assert!(task.decision_required);
        assert_eq!(task.dependencies, vec!["TASK-2026-0701B"]);
        assert_eq!(task.links, vec!["[[仕様書]]"]);
    }
}
