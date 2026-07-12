use crate::models::TaskStatus;

pub fn can_transition(from: TaskStatus, to: TaskStatus) -> bool {
    use TaskStatus::*;
    matches!(
        (from, to),
        (Draft, Ready | Archived)
            | (
                Ready,
                Queued | Routing | AwaitingApproval | Cancelled | Archived
            )
            | (
                Queued,
                Routing | Running | AwaitingApproval | Cancelled | Failed
            )
            | (
                Routing,
                Queued | Running | AwaitingInput | AwaitingApproval | Failed | Cancelled
            )
            | (
                Running,
                AiReview | AwaitingInput | AwaitingApproval | Completed | Failed | Cancelled
            )
            | (
                AiReview,
                Running | Completed | AwaitingApproval | Failed | Cancelled
            )
            | (AwaitingInput, Ready | Cancelled | Archived)
            | (AwaitingApproval, Ready | Queued | Cancelled | Archived)
            | (Failed, Queued | Cancelled | Archived)
            | (Cancelled, Ready | Archived)
            | (Completed, Archived)
    ) || from == to
}

pub fn transition(from: TaskStatus, to: TaskStatus) -> Result<TaskStatus, String> {
    if can_transition(from, to) {
        Ok(to)
    } else {
        Err(format!("invalid task transition: {from:?} -> {to:?}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_execution_lifecycle() {
        assert!(can_transition(TaskStatus::Ready, TaskStatus::Queued));
        assert!(can_transition(TaskStatus::Queued, TaskStatus::Running));
        assert!(can_transition(TaskStatus::Running, TaskStatus::AiReview));
        assert!(can_transition(TaskStatus::AiReview, TaskStatus::Completed));
    }

    #[test]
    fn rejects_completed_to_running() {
        assert!(transition(TaskStatus::Completed, TaskStatus::Running).is_err());
    }
}
