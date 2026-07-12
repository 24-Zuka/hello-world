use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};

use crate::models::{ApprovalDecision, TaskArtifact, TaskCard, TaskEvent, TaskRun, TaskStatus};
use crate::orchestrator::artifacts::validate_task_id;
use crate::orchestrator::{now_epoch, now_string};

pub struct TaskRepository {
    connection: Mutex<Connection>,
}

impl TaskRepository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let connection = Connection::open(path).map_err(|e| e.to_string())?;
        Self::configure(&connection, true)?;
        let repo = Self {
            connection: Mutex::new(connection),
        };
        repo.migrate()?;
        Ok(repo)
    }

    pub fn memory() -> Result<Self, String> {
        let connection = Connection::open_in_memory().map_err(|e| e.to_string())?;
        Self::configure(&connection, false)?;
        let repo = Self {
            connection: Mutex::new(connection),
        };
        repo.migrate()?;
        Ok(repo)
    }

    fn configure(connection: &Connection, wal: bool) -> Result<(), String> {
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| e.to_string())?;
        if wal {
            connection
                .execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn migrate(&self) -> Result<(), String> {
        self.connection.lock().map_err(|_| "database lock poisoned")?.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS tasks(
               task_id TEXT PRIMARY KEY,
               status TEXT NOT NULL,
               auto_run INTEGER NOT NULL,
               attempt_count INTEGER NOT NULL,
               max_attempts INTEGER NOT NULL,
               lease_owner TEXT,
               lease_expires_epoch INTEGER,
               updated_epoch INTEGER NOT NULL,
               payload_json TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_tasks_queue ON tasks(status, auto_run, updated_epoch);
             CREATE TABLE IF NOT EXISTS task_runs(
               run_id TEXT PRIMARY KEY,
               task_id TEXT NOT NULL,
               payload_json TEXT NOT NULL,
               FOREIGN KEY(task_id) REFERENCES tasks(task_id)
             );
             CREATE TABLE IF NOT EXISTS task_artifacts(
               artifact_id TEXT PRIMARY KEY,
               task_id TEXT NOT NULL,
               path TEXT NOT NULL,
               payload_json TEXT NOT NULL,
               FOREIGN KEY(task_id) REFERENCES tasks(task_id)
             );
             CREATE TABLE IF NOT EXISTS approvals(
               approval_id TEXT PRIMARY KEY,
               task_id TEXT NOT NULL,
               payload_json TEXT NOT NULL,
               FOREIGN KEY(task_id) REFERENCES tasks(task_id)
             );
             CREATE TABLE IF NOT EXISTS task_events(
               event_id TEXT PRIMARY KEY,
               task_id TEXT NOT NULL,
               payload_json TEXT NOT NULL,
               FOREIGN KEY(task_id) REFERENCES tasks(task_id)
             );
             INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, strftime('%s','now'));"
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn create(&self, mut task: TaskCard) -> Result<TaskCard, String> {
        if task.task_id.is_empty() {
            task.task_id = format!("task-{}", uuid::Uuid::new_v4().simple());
        }
        validate_task_id(&task.task_id)?;
        if task.id.is_empty() {
            task.id = task.task_id.clone();
        }
        let now = now_string();
        if task.created_at.is_empty() {
            task.created_at = now.clone();
        }
        task.last_updated = now.clone();
        task.created = task.created_at.clone();
        task.updated = now;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "database lock poisoned")?;
        save_task(&conn, &task, false)?;
        Ok(task)
    }

    pub fn upsert(&self, task: &TaskCard) -> Result<(), String> {
        validate_task_id(&task.task_id)?;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "database lock poisoned")?;
        save_task(&conn, task, true)
    }

    pub fn get(&self, task_id: &str) -> Result<Option<TaskCard>, String> {
        validate_task_id(task_id)?;
        let conn = self
            .connection
            .lock()
            .map_err(|_| "database lock poisoned")?;
        conn.query_row(
            "SELECT payload_json FROM tasks WHERE task_id=?1",
            [task_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string()))
        .transpose()
    }

    pub fn list(&self) -> Result<Vec<TaskCard>, String> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "database lock poisoned")?;
        let mut stmt = conn
            .prepare("SELECT payload_json FROM tasks ORDER BY updated_epoch DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|row| {
            let raw = row.map_err(|e| e.to_string())?;
            serde_json::from_str(&raw).map_err(|e| e.to_string())
        })
        .collect()
    }

    pub fn update(&self, task: &TaskCard) -> Result<(), String> {
        if self.get(&task.task_id)?.is_none() {
            return Err("task not found".into());
        }
        self.upsert(task)
    }

    pub fn archive(&self, task_id: &str) -> Result<TaskCard, String> {
        let mut task = self.get(task_id)?.ok_or("task not found")?;
        task.status = TaskStatus::Archived;
        task.auto_run = false;
        task.last_updated = now_string();
        self.update(&task)?;
        Ok(task)
    }

    pub fn dependencies_complete(&self, task: &TaskCard) -> Result<bool, String> {
        for dependency in &task.dependencies {
            if self.get(dependency)?.map(|t| t.status) != Some(TaskStatus::Completed) {
                return Ok(false);
            }
        }
        Ok(true)
    }

    pub fn claim_next(&self, owner: &str, lease_seconds: u64) -> Result<Option<TaskCard>, String> {
        let mut conn = self
            .connection
            .lock()
            .map_err(|_| "database lock poisoned")?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let now = now_epoch();
        let candidates = {
            let mut stmt = tx
                .prepare(
                    "SELECT payload_json FROM tasks
                 WHERE status IN ('READY','QUEUED') AND auto_run=1
                   AND attempt_count < max_attempts
                   AND (lease_expires_epoch IS NULL OR lease_expires_epoch < ?1)
                 ORDER BY updated_epoch ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([now], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        for raw in candidates {
            let mut task: TaskCard = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            if !dependencies_complete_tx(&tx, &task)? || task.requires_human_approval {
                continue;
            }
            task.status = TaskStatus::Running;
            task.legacy_status = "Doing".into();
            task.lease_owner = Some(owner.into());
            task.lease_expires_at = Some((now + lease_seconds as i64).to_string());
            task.started_at = Some(now.to_string());
            task.attempt_count += 1;
            task.last_updated = now.to_string();
            save_task_tx(&tx, &task, true)?;
            tx.commit().map_err(|e| e.to_string())?;
            return Ok(Some(task));
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(None)
    }

    pub fn claim_task(
        &self,
        task_id: &str,
        owner: &str,
        lease_seconds: u64,
    ) -> Result<TaskCard, String> {
        let mut conn = self
            .connection
            .lock()
            .map_err(|_| "database lock poisoned")?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let raw = tx
            .query_row(
                "SELECT payload_json FROM tasks WHERE task_id=?1",
                [task_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or("task not found")?;
        let mut task: TaskCard = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if !matches!(
            task.status,
            TaskStatus::Ready | TaskStatus::Queued | TaskStatus::Failed
        ) {
            return Err("task is not runnable".into());
        }
        if !dependencies_complete_tx(&tx, &task)? {
            return Err("task dependencies are incomplete".into());
        }
        if task.attempt_count >= task.max_attempts {
            return Err("task reached max_attempts".into());
        }
        let now = now_epoch();
        task.status = TaskStatus::Running;
        task.legacy_status = "Doing".into();
        task.lease_owner = Some(owner.into());
        task.lease_expires_at = Some((now + lease_seconds as i64).to_string());
        task.started_at = Some(now.to_string());
        task.attempt_count += 1;
        task.last_updated = now.to_string();
        save_task_tx(&tx, &task, true)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(task)
    }

    pub fn release_expired_leases(&self) -> Result<usize, String> {
        let now = now_epoch();
        let mut tasks = self.list()?;
        let mut released = 0;
        for task in &mut tasks {
            let expired = task
                .lease_expires_at
                .as_deref()
                .and_then(|v| v.parse::<i64>().ok())
                .is_some_and(|v| v < now);
            if task.status == TaskStatus::Running && expired {
                task.status = TaskStatus::Queued;
                task.legacy_status = "Today".into();
                task.lease_owner = None;
                task.lease_expires_at = None;
                task.error_message = Some("expired lease recovered".into());
                self.update(task)?;
                released += 1;
            }
        }
        Ok(released)
    }

    pub fn add_run(&self, run: &TaskRun) -> Result<(), String> {
        insert_payload(
            &self.connection,
            "task_runs",
            "run_id",
            &run.run_id,
            &run.task_id,
            run,
        )
    }

    pub fn add_artifact(&self, artifact: &TaskArtifact) -> Result<(), String> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "database lock poisoned")?;
        conn.execute(
            "INSERT OR REPLACE INTO task_artifacts(artifact_id,task_id,path,payload_json) VALUES(?1,?2,?3,?4)",
            params![artifact.artifact_id, artifact.task_id, artifact.path, serde_json::to_string(artifact).map_err(|e| e.to_string())?],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn artifacts(&self, task_id: &str) -> Result<Vec<TaskArtifact>, String> {
        payloads_for::<TaskArtifact>(&self.connection, "task_artifacts", task_id)
    }

    pub fn add_event(&self, event: &TaskEvent) -> Result<(), String> {
        insert_payload(
            &self.connection,
            "task_events",
            "event_id",
            &event.event_id,
            &event.task_id,
            event,
        )
    }

    pub fn add_approval(&self, approval: &ApprovalDecision) -> Result<(), String> {
        insert_payload(
            &self.connection,
            "approvals",
            "approval_id",
            &approval.approval_id,
            &approval.task_id,
            approval,
        )
    }
}

fn save_task(conn: &Connection, task: &TaskCard, replace: bool) -> Result<(), String> {
    let sql = if replace {
        "INSERT INTO tasks(task_id,status,auto_run,attempt_count,max_attempts,lease_owner,lease_expires_epoch,updated_epoch,payload_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(task_id) DO UPDATE SET status=excluded.status,auto_run=excluded.auto_run,attempt_count=excluded.attempt_count,max_attempts=excluded.max_attempts,lease_owner=excluded.lease_owner,lease_expires_epoch=excluded.lease_expires_epoch,updated_epoch=excluded.updated_epoch,payload_json=excluded.payload_json"
    } else {
        "INSERT INTO tasks(task_id,status,auto_run,attempt_count,max_attempts,lease_owner,lease_expires_epoch,updated_epoch,payload_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)"
    };
    conn.execute(sql, rusqlite::params_from_iter(task_params(task)?))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn save_task_tx(tx: &Transaction<'_>, task: &TaskCard, replace: bool) -> Result<(), String> {
    let sql = if replace {
        "INSERT INTO tasks(task_id,status,auto_run,attempt_count,max_attempts,lease_owner,lease_expires_epoch,updated_epoch,payload_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(task_id) DO UPDATE SET status=excluded.status,auto_run=excluded.auto_run,attempt_count=excluded.attempt_count,max_attempts=excluded.max_attempts,lease_owner=excluded.lease_owner,lease_expires_epoch=excluded.lease_expires_epoch,updated_epoch=excluded.updated_epoch,payload_json=excluded.payload_json"
    } else {
        "INSERT INTO tasks(task_id,status,auto_run,attempt_count,max_attempts,lease_owner,lease_expires_epoch,updated_epoch,payload_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)"
    };
    tx.execute(sql, rusqlite::params_from_iter(task_params(task)?))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn task_params(task: &TaskCard) -> Result<Vec<rusqlite::types::Value>, String> {
    Ok(vec![
        task.task_id.clone().into(),
        status_string(task.status).to_string().into(),
        (task.auto_run as i64).into(),
        (task.attempt_count as i64).into(),
        (task.max_attempts as i64).into(),
        task.lease_owner.clone().into(),
        task.lease_expires_at
            .as_deref()
            .and_then(|v| v.parse::<i64>().ok())
            .into(),
        now_epoch().into(),
        serde_json::to_string(task)
            .map_err(|e| e.to_string())?
            .into(),
    ])
}

fn status_string(status: TaskStatus) -> &'static str {
    use TaskStatus::*;
    match status {
        Draft => "DRAFT",
        Ready => "READY",
        Queued => "QUEUED",
        Routing => "ROUTING",
        Running => "RUNNING",
        AiReview => "AI_REVIEW",
        AwaitingInput => "AWAITING_INPUT",
        AwaitingApproval => "AWAITING_APPROVAL",
        Completed => "COMPLETED",
        Failed => "FAILED",
        Cancelled => "CANCELLED",
        Archived => "ARCHIVED",
    }
}

fn dependencies_complete_tx(tx: &Transaction<'_>, task: &TaskCard) -> Result<bool, String> {
    for dependency in &task.dependencies {
        let status = tx
            .query_row(
                "SELECT status FROM tasks WHERE task_id=?1",
                [dependency],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if status.as_deref() != Some("COMPLETED") {
            return Ok(false);
        }
    }
    Ok(true)
}

fn insert_payload<T: serde::Serialize>(
    connection: &Mutex<Connection>,
    table: &str,
    id_column: &str,
    id: &str,
    task_id: &str,
    payload: &T,
) -> Result<(), String> {
    let allowed = matches!(
        (table, id_column),
        ("task_runs", "run_id") | ("task_events", "event_id") | ("approvals", "approval_id")
    );
    if !allowed {
        return Err("invalid repository table".into());
    }
    let conn = connection.lock().map_err(|_| "database lock poisoned")?;
    let sql = format!(
        "INSERT OR REPLACE INTO {table}({id_column},task_id,payload_json) VALUES(?1,?2,?3)"
    );
    conn.execute(
        &sql,
        params![
            id,
            task_id,
            serde_json::to_string(payload).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn payloads_for<T: serde::de::DeserializeOwned>(
    connection: &Mutex<Connection>,
    table: &str,
    task_id: &str,
) -> Result<Vec<T>, String> {
    if table != "task_artifacts" {
        return Err("invalid repository table".into());
    }
    let conn = connection.lock().map_err(|_| "database lock poisoned")?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT payload_json FROM {table} WHERE task_id=?1"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([task_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};
    use std::thread;

    use super::*;

    fn ready_task(id: &str) -> TaskCard {
        TaskCard {
            task_id: id.into(),
            title: "test".into(),
            status: TaskStatus::Ready,
            auto_run: true,
            ..TaskCard::default()
        }
    }

    #[test]
    fn persists_task() {
        let repo = TaskRepository::memory().unwrap();
        repo.create(ready_task("task-1")).unwrap();
        assert_eq!(repo.get("task-1").unwrap().unwrap().title, "test");
    }

    #[test]
    fn auto_run_off_is_not_claimed() {
        let repo = TaskRepository::memory().unwrap();
        let mut task = ready_task("task-1");
        task.auto_run = false;
        repo.create(task).unwrap();
        assert!(repo.claim_next("worker", 30).unwrap().is_none());
    }

    #[test]
    fn waits_for_dependencies() {
        let repo = TaskRepository::memory().unwrap();
        repo.create(ready_task("task-a")).unwrap();
        let mut dependent = ready_task("task-b");
        dependent.dependencies = vec!["task-a".into()];
        repo.create(dependent).unwrap();
        let first = repo.claim_next("worker", 30).unwrap().unwrap();
        assert_eq!(first.task_id, "task-a");
        assert!(repo.claim_next("worker-2", 30).unwrap().is_none());
    }

    #[test]
    fn concurrent_claim_returns_task_once() {
        let path = std::env::temp_dir().join(format!("jarvis-{}.sqlite3", uuid::Uuid::new_v4()));
        let repo = Arc::new(TaskRepository::open(&path).unwrap());
        repo.create(ready_task("task-1")).unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let mut handles = Vec::new();
        for n in 0..2 {
            let repo = repo.clone();
            let barrier = barrier.clone();
            handles.push(thread::spawn(move || {
                barrier.wait();
                repo.claim_next(&format!("worker-{n}"), 30)
                    .unwrap()
                    .is_some()
            }));
        }
        barrier.wait();
        let claimed = handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .filter(|claimed| *claimed)
            .count();
        assert_eq!(claimed, 1);
        let _ = std::fs::remove_file(path);
    }
}
