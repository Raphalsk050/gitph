from dataclasses import replace
from pathlib import Path

from textual.app import ComposeResult
from textual.containers import Horizontal
from textual.screen import Screen
from textual.widgets import Footer, Header

from gitph.config import AppConfig
from gitph.domain.events import CommitSelected, ContextMenuRequested, GitActionRequested, RefSelected
from gitph.domain.models import ActionPlan, UiAction
from gitph.domain.state import GitWorkspaceState
from gitph.git.actions import GitActionService
from gitph.git.client import GitClient
from gitph.git.graph import GitGraphBuilder
from gitph.git.parser import GitParser
from gitph.infra.subprocess_runner import GitCommandError, GitCommandRunner
from gitph.services.action_service import ActionCoordinator
from gitph.services.repository_service import RepositoryService
from gitph.ui.screens.confirm import ConfirmGitActionScreen
from gitph.ui.screens.context_menu import ContextMenuScreen
from gitph.ui.screens.repo_picker import RepositoryPickerScreen
from gitph.ui.widgets import CommitGraphPane, DetailsPanel, GitphStatusBar, RefsSidebar


class MainScreen(Screen[None]):
    """Owns the main gitph workspace and coordinates UI with services."""

    BINDINGS = [
        ("r", "refresh", "Refresh"),
        ("f", "fetch", "Fetch"),
        ("m", "open_context_menu", "Menu"),
        ("q", "app.quit", "Quit"),
    ]

    def __init__(self, repo_path: Path, config: AppConfig | None = None) -> None:
        super().__init__()
        self.config = config or AppConfig()
        self.runner = GitCommandRunner(timeout_seconds=self.config.git_timeout_seconds)
        self.git_client = GitClient(self.runner, GitParser(), self.config)
        self.git_actions = GitActionService(self.runner)
        self.repository_service = RepositoryService(self.git_client, GitGraphBuilder(), self.config)
        self.action_coordinator = ActionCoordinator(self.git_actions)
        self.state = GitWorkspaceState(repo_path=repo_path)

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Horizontal(id="workspace"):
            yield RefsSidebar(self.git_actions)
            yield CommitGraphPane()
            yield DetailsPanel()
        yield GitphStatusBar()
        yield Footer()

    async def on_mount(self) -> None:
        await self.refresh_repository()

    async def action_refresh(self) -> None:
        await self.refresh_repository()

    async def action_fetch(self) -> None:
        plans = self.git_actions.global_plans()
        if plans:
            self.run_worker(
                self._confirm_and_execute(plans[0]),
                name="gitph-fetch",
                exclusive=True,
            )

    async def action_open_context_menu(self) -> None:
        plans = self._menu_choices(self.query_one(RefsSidebar).plans_for_selection())
        self._start_context_menu_flow(plans, "Git actions")

    async def on_ref_selected(self, message: RefSelected) -> None:
        message.stop()
        self.state = replace(self.state, selected_ref=message.ref)
        oid = message.ref.display_oid
        if self.state.snapshot is not None and oid in self.state.snapshot.commits:
            await self._select_commit(oid)

    async def on_commit_selected(self, message: CommitSelected) -> None:
        message.stop()
        await self._select_commit(message.oid)

    async def on_context_menu_requested(self, message: ContextMenuRequested) -> None:
        message.stop()
        self._start_context_menu_flow(self._menu_choices(message.plans), message.title)

    async def on_git_action_requested(self, message: GitActionRequested) -> None:
        message.stop()
        self.run_worker(
            self._confirm_and_execute(message.plan),
            name=f"gitph-action-{message.plan.id}",
            exclusive=True,
        )

    async def refresh_repository(self) -> None:
        status = self.query_one(GitphStatusBar)
        details = self.query_one(DetailsPanel)
        status.set_status("Loading repository...")
        self.state = replace(self.state, loading=True, error=None)
        try:
            snapshot = await self.repository_service.load_snapshot(self.state.repo_path)
        except Exception as exc:
            message = str(exc) or exc.__class__.__name__
            self.state = replace(self.state, snapshot=None, loading=False, error=message)
            status.set_status(f"Error: {message}")
            details.show_error(message)
            return

        selected_oid = self.state.selected_commit_oid
        if selected_oid not in snapshot.commits:
            selected_oid = snapshot.graph.rows[0].commit.oid if snapshot.graph.rows else None

        self.state = replace(
            self.state,
            snapshot=snapshot,
            selected_commit_oid=selected_oid,
            selected_details=None,
            loading=False,
            error=None,
        )
        self.query_one(RefsSidebar).update_snapshot(snapshot)
        self.query_one(CommitGraphPane).set_graph(snapshot.graph, selected_oid)
        details.show_snapshot(snapshot)
        status.set_status(
            f"{snapshot.identity.root} | {len(snapshot.graph.rows)} commits | "
            f"{len(snapshot.status.entries)} changed files"
        )
        if selected_oid is not None:
            await self._select_commit(selected_oid)

    async def _select_commit(self, oid: str) -> None:
        if self.state.snapshot is None:
            return
        status = self.query_one(GitphStatusBar)
        status.set_status(f"Loading commit {oid[:8]}...")
        self.query_one(CommitGraphPane).select(oid)
        try:
            details = await self.repository_service.load_commit_details(self.state.snapshot, oid)
        except GitCommandError as exc:
            self.query_one(DetailsPanel).show_error(str(exc))
            status.set_status(f"Failed to load commit {oid[:8]}")
            return
        if details is None:
            status.set_status(f"Commit {oid[:8]} not found in current graph")
            return
        self.state = replace(
            self.state,
            selected_commit_oid=oid,
            selected_details=details,
        )
        self.query_one(DetailsPanel).show_commit(details)
        status.set_status(f"Selected {oid[:8]}")

    def _menu_choices(self, plans: tuple[ActionPlan, ...]) -> tuple[UiAction | ActionPlan, ...]:
        return (
            UiAction(
                id="open_repository",
                label="Open repository...",
                target=str(self.state.repo_path),
            ),
            *plans,
        )

    def _start_context_menu_flow(self, plans: tuple[UiAction | ActionPlan, ...], title: str) -> None:
        if not plans:
            self.app.notify("No Git actions available for this target.", severity="warning")
            return
        self.run_worker(
            self._open_context_menu(plans, title),
            name="gitph-context-menu",
            exclusive=True,
        )

    async def _open_context_menu(self, plans: tuple[UiAction | ActionPlan, ...], title: str) -> None:
        choice = await self.app.push_screen(
            ContextMenuScreen(tuple(plans), title),
            wait_for_dismiss=True,
        )
        if choice is None:
            return
        if isinstance(choice, UiAction):
            await self._execute_ui_action(choice)
            return
        await self._confirm_and_execute(choice)

    async def _execute_ui_action(self, action: UiAction) -> None:
        if action.id != "open_repository":
            self.app.notify(f"Unknown UI action: {action.id}", severity="error")
            return
        selected_path = await self.app.push_screen(
            RepositoryPickerScreen(self.state.repo_path),
            wait_for_dismiss=True,
        )
        if selected_path is None:
            return
        self.state = replace(
            self.state,
            repo_path=selected_path,
            snapshot=None,
            selected_ref=None,
            selected_commit_oid=None,
            selected_file=None,
            selected_details=None,
            error=None,
        )
        await self.refresh_repository()

    async def _confirm_and_execute(self, plan: ActionPlan) -> None:
        if plan.requires_confirmation:
            confirmed = await self.app.push_screen(
                ConfirmGitActionScreen(plan),
                wait_for_dismiss=True,
            )
            if not confirmed:
                return
        if self.state.snapshot is None:
            self.app.notify("No repository snapshot is loaded.", severity="error")
            return
        status = self.query_one(GitphStatusBar)
        status.set_status(f"Running: git {' '.join(plan.argv)}")
        result = await self.action_coordinator.execute(
            self.state.snapshot.identity.root,
            plan,
            self.state.snapshot.status,
        )
        if result.exit_code == 0:
            self.app.notify(result.stdout.strip() or f"{plan.label} completed.")
            await self.refresh_repository()
            return
        message = result.stderr.strip() or result.stdout.strip() or f"{plan.label} failed."
        status.set_status(message)
        self.app.notify(message, severity="error")
