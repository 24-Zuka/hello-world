use crate::models::TaskCard;

pub fn build(task: &TaskCard) -> String {
    format!(
        "# Task Identity\n- Task ID: {}\n- Title: {}\n- Task Type: {}\n\n# Objective\n{}\n\n# Instructions\n{}\n\n# Context\n{}\n\n# Input Sources\n{}\n\n# Constraints\n- 未確認情報を事実として断定しない\n- 実際に使用していない製品を使用済みと書かない\n- 外部投稿、送信、マージ、プッシュ、削除、購入を行わない\n- 個人情報や秘密情報を出力しない\n- 不明点は要確認として明示する\n\n# Required Output\n{}\n\n# Acceptance Criteria\n{}\n\n# Handoff Format\n- 実施したこと\n- 決定したこと\n- 未確認事項\n- 次の工程\n",
        task.task_id,
        task.title,
        task.task_type,
        task.objective,
        task.instructions,
        task.context,
        task.input_refs.iter().chain(task.source_urls.iter()).cloned().collect::<Vec<_>>().join("\n"),
        task.output_format,
        task.acceptance_criteria.join("\n"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_pack_contains_required_sections() {
        let task = TaskCard {
            task_id: "task-1".into(),
            title: "test".into(),
            ..TaskCard::default()
        };
        let prompt = build(&task);
        assert!(prompt.contains("# Task Identity"));
        assert!(prompt.contains("外部投稿"));
        assert!(prompt.contains("# Handoff Format"));
    }
}
