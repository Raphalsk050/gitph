from textual.message import Message

from gitph.domain.models import ActionPlan, GitRef


class RefSelected(Message):
    """Message emitted when the user selects a Git ref."""

    def __init__(self, ref: GitRef) -> None:
        super().__init__()
        self.ref = ref


class CommitSelected(Message):
    """Message emitted when the user selects a commit in the graph."""

    def __init__(self, oid: str) -> None:
        super().__init__()
        self.oid = oid


class FileSelected(Message):
    """Message emitted when the user selects a changed file."""

    def __init__(self, path: str) -> None:
        super().__init__()
        self.path = path


class GitActionRequested(Message):
    """Message emitted when the user requests a prepared Git action."""

    def __init__(self, plan: ActionPlan) -> None:
        super().__init__()
        self.plan = plan


class ContextMenuRequested(Message):
    """Message emitted when the user requests a menu of available actions."""

    def __init__(self, plans: tuple[ActionPlan, ...], title: str = "Git actions") -> None:
        super().__init__()
        self.plans = plans
        self.title = title


class GraphRangeRequested(Message):
    """Message emitted when the graph needs more rows."""

    def __init__(self, start: int, count: int) -> None:
        super().__init__()
        self.start = start
        self.count = count
