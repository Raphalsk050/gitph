from pathlib import Path

from gitph.domain.models import ActionPlan, ActionResult, StatusSnapshot
from gitph.git.actions import GitActionService


class ActionCoordinator:
    """Executes confirmed Git actions and returns user-facing results."""

    def __init__(self, action_service: GitActionService) -> None:
        self.action_service = action_service

    async def execute(
        self,
        repo: Path,
        plan: ActionPlan,
        status: StatusSnapshot | None,
    ) -> ActionResult:
        return await self.action_service.execute(repo, plan, status=status)
