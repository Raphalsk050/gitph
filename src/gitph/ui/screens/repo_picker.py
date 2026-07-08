from pathlib import Path

from textual.app import ComposeResult
from textual.containers import Container, Horizontal
from textual.screen import ModalScreen
from textual.widgets import Button, DirectoryTree, Input, Static


class RepositoryPickerScreen(ModalScreen[Path | None]):
    """Lets the user choose the Git project directory used by gitph."""

    BINDINGS = [("escape", "cancel", "Cancel")]

    def __init__(self, current_path: Path) -> None:
        super().__init__()
        self.current_path = current_path
        self.selected_path = current_path
        self.start_path = current_path if current_path.is_dir() else current_path.parent

    def compose(self) -> ComposeResult:
        with Container(id="repo-picker"):
            yield Static("Open Git project", id="repo-picker-title")
            with Horizontal(id="repo-path-row"):
                yield Button("Up", id="repo-up")
                yield Input(
                    str(self.current_path),
                    placeholder="Repository folder path",
                    id="repo-path-input",
                )
            yield DirectoryTree(self.start_path, id="repo-directory-tree")
            with Horizontal(id="repo-picker-buttons"):
                yield Button("Cancel", id="repo-cancel")
                yield Button("Open", id="repo-open", variant="primary")

    def on_mount(self) -> None:
        self.query_one("#repo-path-input", Input).focus()

    def on_directory_tree_directory_selected(self, event: DirectoryTree.DirectorySelected) -> None:
        event.stop()
        self._set_selected(event.path)

    def on_input_changed(self, event: Input.Changed) -> None:
        if event.input.id != "repo-path-input":
            return
        self.selected_path = Path(event.value).expanduser()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        if event.input.id != "repo-path-input":
            return
        event.stop()
        self.selected_path = Path(event.value).expanduser()
        self._dismiss_selected()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        event.stop()
        if event.button.id == "repo-up":
            self._move_up()
            return
        if event.button.id == "repo-open":
            self._dismiss_selected()
            return
        self.dismiss(None)

    def action_cancel(self) -> None:
        self.dismiss(None)

    def _set_selected(self, path: Path) -> None:
        self.selected_path = path
        self.query_one("#repo-path-input", Input).value = str(path)

    def _move_up(self) -> None:
        input_widget = self.query_one("#repo-path-input", Input)
        current = Path(input_widget.value or str(self.selected_path)).expanduser()
        current = current if current.is_dir() else current.parent
        parent = current.parent
        if parent == current:
            self.app.notify("Already at the filesystem root.", severity="warning")
            return
        self._set_selected(parent)
        tree = self.query_one("#repo-directory-tree", DirectoryTree)
        if parent.exists() and parent.is_dir():
            tree.path = parent

    def _dismiss_selected(self) -> None:
        self.dismiss(self.selected_path.expanduser().resolve())
