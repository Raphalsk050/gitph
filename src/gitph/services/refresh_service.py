from dataclasses import replace

from gitph.domain.state import GitWorkspaceState
from gitph.services.repository_service import RepositoryService


class RefreshService:
    """Refreshes workspace state without mutating previous state instances."""

    def __init__(self, repository_service: RepositoryService) -> None:
        self.repository_service = repository_service

    async def refresh(self, state: GitWorkspaceState) -> GitWorkspaceState:
        snapshot = await self.repository_service.load_snapshot(state.repo_path)
        return replace(
            state,
            snapshot=snapshot,
            selected_commit_oid=state.selected_commit_oid,
            selected_details=None,
            loading=False,
            error=None,
        )
