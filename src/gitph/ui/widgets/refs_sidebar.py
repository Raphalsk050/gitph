from collections import defaultdict

from rich.text import Text
from textual import events
from textual.widgets import Tree

from gitph.domain.events import ContextMenuRequested, RefSelected
from gitph.domain.models import ActionPlan, GitRef, RefNode, RepositorySnapshot
from gitph.git.actions import GitActionService


class RefsSidebar(Tree[RefNode]):
    """Displays Git refs as an actionable tree."""

    def __init__(self, action_service: GitActionService) -> None:
        super().__init__("gitph", RefNode(kind="root", label="gitph"), id="refs-sidebar")
        self.action_service = action_service
        self.show_root = True

    def update_snapshot(self, snapshot: RepositorySnapshot) -> None:
        self.clear()
        self.root.set_label(self._root_label(snapshot))
        self.root.data = RefNode(kind="root", label=str(snapshot.identity.root))

        grouped: dict[str, list[GitRef]] = defaultdict(list)
        for ref in snapshot.refs:
            grouped[ref.kind].append(ref)

        sections = (
            ("LOCAL", "local_branch"),
            ("REMOTE", "remote_branch"),
            ("TAGS", "tag"),
            ("STASH", "stash"),
        )
        for title, kind in sections:
            refs = grouped.get(kind, [])
            node = self.root.add(
                Text.from_markup(f"[b]{title}[/] [dim]{len(refs)}[/]"),
                RefNode(kind="section", label=title),
                expand=True,
            )
            for ref in refs:
                marker = "● " if ref.is_head else "  "
                style = "bold cyan" if ref.is_head else "white"
                node.add(
                    Text(f"{marker}{ref.short_name}", style=style),
                    RefNode(kind=kind, label=ref.short_name, ref=ref),
                    allow_expand=False,
                )
        self.root.expand()

    def selected_ref(self) -> GitRef | None:
        node = self.cursor_node
        if node is None or node.data is None:
            return None
        return node.data.ref

    def plans_for_selection(self) -> tuple[ActionPlan, ...]:
        ref = self.selected_ref()
        if ref is None:
            return self.action_service.global_plans()
        return self.action_service.plans_for_ref(ref)

    def on_tree_node_selected(self, event: Tree.NodeSelected[RefNode]) -> None:
        event.stop()
        data = event.node.data
        if data is not None and data.ref is not None:
            self.post_message(RefSelected(data.ref))

    def on_mouse_down(self, event: events.MouseDown) -> None:
        if event.button != 3:
            return
        event.stop()
        plans = self.plans_for_selection()
        if plans:
            self.post_message(ContextMenuRequested(plans, "Ref actions"))

    @staticmethod
    def _root_label(snapshot: RepositorySnapshot) -> Text:
        dirty = " dirty" if snapshot.status.is_dirty else " clean"
        branch = snapshot.status.branch_name or snapshot.identity.head_ref or "detached"
        return Text.assemble(("gitph ", "bold"), (branch, "cyan"), (dirty, "yellow"))
