from dataclasses import dataclass
from pathlib import Path

from gitph.domain.models import CommitDetails, GitRef, RepositorySnapshot


@dataclass(frozen=True, slots=True)
class GitWorkspaceState:
    """Keeps UI selection state separate from repository snapshots."""

    repo_path: Path
    snapshot: RepositorySnapshot | None = None
    selected_ref: GitRef | None = None
    selected_commit_oid: str | None = None
    selected_file: str | None = None
    selected_details: CommitDetails | None = None
    loading: bool = False
    error: str | None = None
