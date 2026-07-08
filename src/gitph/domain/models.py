from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True, slots=True)
class RepoIdentity:
    """Identifies a Git repository and its current HEAD state."""

    root: Path
    git_dir: Path
    is_bare: bool
    head_oid: str | None
    head_ref: str | None


@dataclass(frozen=True, slots=True)
class GitRef:
    """Represents a branch, remote branch, tag, or stash ref."""

    full_name: str
    short_name: str
    kind: str
    target_oid: str
    peeled_oid: str | None
    upstream: str | None
    is_head: bool = False
    subject: str = ""

    @property
    def display_oid(self) -> str:
        return self.peeled_oid or self.target_oid


@dataclass(frozen=True, slots=True)
class StatusEntry:
    """Represents one parseable status entry from porcelain v2 output."""

    path: str
    index_status: str
    worktree_status: str
    original_path: str | None = None


@dataclass(frozen=True, slots=True)
class StatusSnapshot:
    """Captures branch tracking and worktree status for the current repo."""

    branch_name: str | None
    branch_oid: str | None
    upstream: str | None
    ahead: int = 0
    behind: int = 0
    entries: tuple[StatusEntry, ...] = ()

    @property
    def is_dirty(self) -> bool:
        return bool(self.entries)


@dataclass(frozen=True, slots=True)
class CommitSummary:
    """Stores commit metadata needed for the graph and commit list."""

    oid: str
    parents: tuple[str, ...]
    author: str
    author_email: str
    author_time: int
    commit_time: int
    subject: str
    graph_prefix: str = ""

    @property
    def short_oid(self) -> str:
        return self.oid[:8]


@dataclass(frozen=True, slots=True)
class GraphEdge:
    """Describes a lane connection from one commit row to a parent lane."""

    from_oid: str
    to_oid: str
    from_lane: int
    to_lane: int
    color_index: int
    kind: str = "parent"


@dataclass(frozen=True, slots=True)
class GraphRow:
    """Places a commit on a graph row with lanes, refs, and parent edges."""

    commit: CommitSummary
    row_index: int
    lane: int
    refs: tuple[GitRef, ...] = ()
    edges: tuple[GraphEdge, ...] = ()
    active_lanes: tuple[str | None, ...] = ()


@dataclass(frozen=True, slots=True)
class GraphModel:
    """Contains the render-neutral commit graph layout."""

    rows: tuple[GraphRow, ...] = ()
    max_lanes: int = 0


@dataclass(frozen=True, slots=True)
class ChangedFile:
    """Represents a file touched by a commit or status operation."""

    path: str
    status: str
    original_path: str | None = None


@dataclass(frozen=True, slots=True)
class CommitDetails:
    """Holds lazy-loaded commit metadata, changed files, and patch text."""

    summary: CommitSummary
    body: str
    changed_files: tuple[ChangedFile, ...]
    patch_text: str


@dataclass(frozen=True, slots=True)
class ActionPlan:
    """Describes a safe Git operation prepared before user confirmation."""

    id: str
    label: str
    argv: tuple[str, ...]
    target: str
    requires_confirmation: bool = True
    requires_clean_tree: bool = False
    risk_level: str = "normal"


@dataclass(frozen=True, slots=True)
class UiAction:
    """Describes an application action that is not executed by Git."""

    id: str
    label: str
    target: str = ""


@dataclass(frozen=True, slots=True)
class ActionResult:
    """Captures the result of an executed Git action."""

    plan: ActionPlan
    exit_code: int
    stdout: str
    stderr: str


@dataclass(frozen=True, slots=True)
class RefNode:
    """Stores typed data attached to a Textual tree node."""

    kind: str
    label: str
    ref: GitRef | None = None


@dataclass(frozen=True, slots=True)
class RepositorySnapshot:
    """Immutable repository snapshot consumed by the Textual UI."""

    identity: RepoIdentity
    status: StatusSnapshot
    refs: tuple[GitRef, ...]
    graph: GraphModel
    commits: dict[str, CommitSummary] = field(default_factory=dict)
