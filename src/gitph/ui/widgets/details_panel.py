from datetime import datetime

from rich.text import Text
from textual.containers import Vertical
from textual.widgets import DataTable, Static, TextArea

from gitph.domain.models import CommitDetails, RepositorySnapshot


class DetailsPanel(Vertical):
    """Shows selected commit metadata, changed files, and patch text."""

    def __init__(self) -> None:
        super().__init__(id="details-panel")
        self._table_ready = False

    def compose(self):
        yield Static("Select a commit", id="commit-summary")
        yield DataTable(id="changed-files", show_row_labels=False, zebra_stripes=True)
        yield TextArea(
            "",
            read_only=True,
            show_line_numbers=True,
            soft_wrap=False,
            id="diff-viewer",
        )

    def on_mount(self) -> None:
        table = self.query_one("#changed-files", DataTable)
        table.add_columns("Status", "Path")
        self._table_ready = True

    def show_snapshot(self, snapshot: RepositorySnapshot) -> None:
        summary = self.query_one("#commit-summary", Static)
        status = snapshot.status
        dirty = "dirty" if status.is_dirty else "clean"
        branch = status.branch_name or snapshot.identity.head_ref or "detached"
        summary.update(
            Text.assemble(
                ("Repository\n", "bold"),
                (str(snapshot.identity.root), "white"),
                ("\nBranch: ", "dim"),
                (branch, "cyan"),
                ("  Status: ", "dim"),
                (dirty, "yellow" if status.is_dirty else "green"),
                (f"  Ahead/Behind: +{status.ahead}/-{status.behind}", "dim"),
            )
        )
        self._clear_details()

    def show_commit(self, details: CommitDetails) -> None:
        summary = self.query_one("#commit-summary", Static)
        committed = datetime.fromtimestamp(details.summary.commit_time).strftime("%Y-%m-%d %H:%M")
        summary.update(
            Text.assemble(
                (details.summary.subject or "(no subject)", "bold white"),
                ("\n", ""),
                (details.summary.short_oid, "cyan"),
                (" by ", "dim"),
                (details.summary.author, "green"),
                (" at ", "dim"),
                (committed, "yellow"),
                ("\nParents: ", "dim"),
                (" ".join(parent[:8] for parent in details.summary.parents) or "none", "white"),
                ("\n\n", ""),
                (details.body, "white"),
            )
        )

        table = self.query_one("#changed-files", DataTable)
        table.clear(columns=False)
        for index, changed in enumerate(details.changed_files):
            status = changed.status
            path = changed.path
            if changed.original_path:
                path = f"{changed.original_path} -> {changed.path}"
            table.add_row(status, path, key=f"{index}:{path}")

        diff = self.query_one("#diff-viewer", TextArea)
        diff.load_text(details.patch_text or "No patch available for this commit.")

    def show_error(self, message: str) -> None:
        self.query_one("#commit-summary", Static).update(Text(message, style="bold red"))
        self._clear_details()

    def _clear_details(self) -> None:
        if self._table_ready:
            self.query_one("#changed-files", DataTable).clear(columns=False)
        self.query_one("#diff-viewer", TextArea).load_text("")
