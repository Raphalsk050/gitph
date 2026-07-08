from textual.widgets import Static


class GitphStatusBar(Static):
    """Displays concise repository loading and action feedback."""

    def __init__(self) -> None:
        super().__init__("Ready", id="gitph-status", markup=False)

    def set_status(self, message: str) -> None:
        self.update(message)
