from pathlib import Path

from textual.app import App

from gitph.ui.screens.main import MainScreen


class GitphApp(App[None]):
    """Textual application root for the gitph Git graph interface."""

    CSS_PATH = "ui/styles/app.tcss"
    TITLE = "gitph"
    SUB_TITLE = "git graph"

    def __init__(self, repo_path: Path) -> None:
        super().__init__()
        self.repo_path = repo_path

    async def on_mount(self) -> None:
        await self.push_screen(MainScreen(self.repo_path))
