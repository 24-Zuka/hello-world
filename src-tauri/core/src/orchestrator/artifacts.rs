use std::fs;
use std::path::{Path, PathBuf};

use crate::models::{TaskArtifact, TaskCard};
use crate::orchestrator::now_string;

const MAX_ARTIFACT_BYTES: usize = 5 * 1024 * 1024;

pub fn validate_task_id(task_id: &str) -> Result<(), String> {
    if task_id.is_empty()
        || task_id.len() > 128
        || !task_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("task_id must contain only ASCII letters, digits, '-' or '_'".into());
    }
    Ok(())
}

pub fn task_dir(root: &Path, task_id: &str) -> Result<PathBuf, String> {
    validate_task_id(task_id)?;
    Ok(root.join(task_id))
}

pub fn prepare(root: &Path, task: &TaskCard, prompt: &str) -> Result<PathBuf, String> {
    let dir = task_dir(root, &task.task_id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_bounded(
        &dir.join("task.json"),
        &serde_json::to_string_pretty(task).map_err(|e| e.to_string())?,
    )?;
    write_bounded(&dir.join("context.md"), &task.context)?;
    write_bounded(&dir.join("prompt.md"), prompt)?;
    Ok(dir)
}

pub fn save(
    root: &Path,
    task_id: &str,
    name: &str,
    kind: &str,
    content: &str,
) -> Result<TaskArtifact, String> {
    if !matches!(
        name,
        "output.md" | "review.json" | "run.jsonl" | "work-package.md" | "final-review-package.md"
    ) {
        return Err("artifact filename is not allowlisted".into());
    }
    let dir = task_dir(root, task_id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    write_bounded(&path, content)?;
    Ok(TaskArtifact {
        artifact_id: uuid::Uuid::new_v4().to_string(),
        task_id: task_id.into(),
        kind: kind.into(),
        path: path.to_string_lossy().into_owned(),
        media_type: if name.ends_with(".json") {
            "application/json"
        } else {
            "text/markdown"
        }
        .into(),
        size_bytes: content.len() as u64,
        created_at: now_string(),
    })
}

pub fn read(root: &Path, task_id: &str, path: &str) -> Result<String, String> {
    let dir = task_dir(root, task_id)?;
    let requested = Path::new(path);
    let name = requested
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("invalid artifact path")?;
    let full = dir.join(name);
    if !full.starts_with(&dir) {
        return Err("artifact path escaped task directory".into());
    }
    fs::read_to_string(full).map_err(|e| e.to_string())
}

fn write_bounded(path: &Path, content: &str) -> Result<(), String> {
    if content.len() > MAX_ARTIFACT_BYTES {
        return Err("artifact exceeds 5 MiB limit".into());
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal_task_ids() {
        assert!(task_dir(Path::new("/tmp/tasks"), "../../etc").is_err());
    }
}
