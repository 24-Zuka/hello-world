use crate::models::{QualityReview, TaskCard};

pub fn review(task: &TaskCard, output: &str) -> QualityReview {
    let empty = output.trim().is_empty();
    let factuality = if !task.source_urls.is_empty() { 30 } else { 18 };
    let objective = if empty {
        0
    } else if task.objective.is_empty() {
        15
    } else {
        20
    };
    let structure = if output.contains('#') || output.lines().count() >= 3 {
        15
    } else {
        8
    };
    let originality = if output.len() >= 120 {
        15
    } else if empty {
        0
    } else {
        8
    };
    let medium_fit = if output_matches(task, output) { 10 } else { 5 };
    let readability = if empty {
        0
    } else if output.len() <= 200_000 {
        10
    } else {
        4
    };
    let score = factuality + objective + structure + originality + medium_fit + readability;
    let mut warnings: Vec<String> = Vec::new();
    if empty {
        warnings.push("成果物が空です".into());
    }
    if task.source_urls.is_empty() && factual_task(task) {
        warnings.push("事実確認用の情報源がありません".into());
    }
    let decision = if warnings.iter().any(|w| w.contains("成果物が空")) {
        "AWAITING_APPROVAL"
    } else if score >= 85 {
        "PASS"
    } else if score >= 75 {
        "REVISE"
    } else if score >= 60 {
        "ESCALATE"
    } else {
        "AWAITING_INPUT"
    };
    QualityReview {
        score,
        factuality,
        objective,
        structure,
        originality,
        medium_fit,
        readability,
        warnings,
        decision: decision.into(),
    }
}

fn factual_task(task: &TaskCard) -> bool {
    ["research", "news", "compare", "fact"]
        .iter()
        .any(|k| task.task_type.to_lowercase().contains(k))
}

fn output_matches(task: &TaskCard, output: &str) -> bool {
    match task.output_format.to_lowercase().as_str() {
        "json" => serde_json::from_str::<serde_json::Value>(output).is_ok(),
        _ => !output.trim().is_empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_output_never_passes() {
        let review = review(&TaskCard::default(), "");
        assert_ne!(review.decision, "PASS");
    }
}
