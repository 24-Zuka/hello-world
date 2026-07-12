use crate::models::{AppSettings, ReasoningLevel, RoutingDecision, TaskCard, WorkerType};

const APPROVAL_TERMS: &[&str] = &[
    "post",
    "publish",
    "email",
    "message",
    "merge",
    "push",
    "delete",
    "purchase",
    "credential",
    "api key",
    "投稿",
    "送信",
    "マージ",
    "プッシュ",
    "削除",
    "購入",
    "契約",
];

pub fn requires_approval(task: &TaskCard) -> bool {
    let text = format!(
        "{} {} {} {}",
        task.title, task.description, task.objective, task.instructions
    )
    .to_lowercase();
    task.requires_human_approval
        || task.decision_required
        || task.risk_score >= 3.0
        || APPROVAL_TERMS.iter().any(|term| text.contains(term))
}

pub fn route(task: &TaskCard, settings: &AppSettings) -> RoutingDecision {
    if requires_approval(task) {
        return RoutingDecision {
            worker_type: WorkerType::Human,
            model: None,
            reasoning: task.requested_reasoning.unwrap_or(ReasoningLevel::High),
            reason: "外部操作・破壊操作・高リスク条件を検出したため、人間承認へ送ります。".into(),
            estimated_size: estimate_size(task),
            escalation_condition: "承認後に明示的に再キューしてください。".into(),
            requires_human_approval: true,
        };
    }

    if let Some(worker) = task.worker_type {
        return decision_for(worker, task, settings, "ユーザー指定ワーカーを使用します。");
    }

    let kind = task.task_type.to_lowercase();
    let worker = if kind.contains("work") {
        WorkerType::WorkManual
    } else if ["class", "tag", "extract", "format", "summary", "summar"]
        .iter()
        .any(|key| kind.contains(key))
    {
        WorkerType::LocalLlm
    } else {
        WorkerType::Codex
    };
    decision_for(
        worker,
        task,
        settings,
        "タスク種別と規模に基づく最低コストのルール判定です。",
    )
}

fn decision_for(
    worker: WorkerType,
    task: &TaskCard,
    settings: &AppSettings,
    reason: &str,
) -> RoutingDecision {
    let size = estimate_size(task);
    let reasoning = task.requested_reasoning.unwrap_or_else(|| match worker {
        WorkerType::LocalLlm | WorkerType::Mock => ReasoningLevel::Low,
        WorkerType::WorkManual | WorkerType::Human => ReasoningLevel::Medium,
        WorkerType::Codex if size == "large" || task.risk_score >= 2.5 => ReasoningLevel::High,
        WorkerType::Codex => ReasoningLevel::Medium,
    });
    let model = task.requested_model.clone().or_else(|| match worker {
        WorkerType::LocalLlm => nonempty(&settings.lmstudio_default_model),
        WorkerType::Codex => Some(select_codex_model(task, settings, reasoning)),
        _ => None,
    });
    RoutingDecision {
        worker_type: worker,
        model,
        reasoning,
        reason: reason.into(),
        estimated_size: size,
        escalation_condition: "品質75点未満または実行失敗時に一段上げ、最大試行回数で停止します。"
            .into(),
        requires_human_approval: false,
    }
}

fn select_codex_model(
    task: &TaskCard,
    settings: &AppSettings,
    reasoning: ReasoningLevel,
) -> String {
    let sources = task.source_urls.len() + task.input_refs.len();
    if matches!(
        reasoning,
        ReasoningLevel::VeryHigh | ReasoningLevel::Max | ReasoningLevel::Ultra
    ) || task.risk_score >= 2.8
    {
        nonempty(&settings.sol_model).unwrap_or_else(|| settings.default_model.clone())
    } else if sources >= 2 || task.instructions.len() > 4_000 {
        nonempty(&settings.terra_model).unwrap_or_else(|| settings.default_model.clone())
    } else {
        nonempty(&settings.luna_model).unwrap_or_else(|| settings.default_model.clone())
    }
}

fn nonempty(value: &str) -> Option<String> {
    (!value.trim().is_empty()).then(|| value.to_string())
}

fn estimate_size(task: &TaskCard) -> String {
    let total = task.description.len() + task.instructions.len() + task.context.len();
    if total > 8_000 || task.source_urls.len() > 5 {
        "large"
    } else if total > 2_000 || task.source_urls.len() > 1 {
        "medium"
    } else {
        "small"
    }
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Cockpit;

    #[test]
    fn routes_short_summary_to_local_llm() {
        let task = TaskCard {
            task_type: "summary".into(),
            ..TaskCard::default()
        };
        let decision = route(&task, &Cockpit::memory().settings());
        assert_eq!(decision.worker_type, WorkerType::LocalLlm);
        assert_eq!(decision.reasoning, ReasoningLevel::Low);
    }

    #[test]
    fn gates_external_actions() {
        let task = TaskCard {
            instructions: "GitHubへpushする".into(),
            ..TaskCard::default()
        };
        assert!(route(&task, &Cockpit::memory().settings()).requires_human_approval);
    }
}
