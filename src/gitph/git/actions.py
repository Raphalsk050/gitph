from pathlib import Path

from gitph.domain.models import ActionPlan, ActionResult, GitRef, StatusSnapshot
from gitph.infra.subprocess_runner import GitCommandRunner


class GitActionService:
    """Prepares and executes the limited set of safe mutating Git actions."""

    def __init__(self, runner: GitCommandRunner) -> None:
        self.runner = runner

    def plans_for_ref(self, ref: GitRef) -> tuple[ActionPlan, ...]:
        plans: list[ActionPlan] = []
        if ref.kind in {"local_branch", "remote_branch"}:
            plans.append(
                ActionPlan(
                    id="switch_branch",
                    label=f"Switch to {ref.short_name}",
                    argv=("switch", ref.short_name),
                    target=ref.short_name,
                    requires_confirmation=True,
                    requires_clean_tree=True,
                )
            )
        if ref.kind == "remote_branch" and "/" in ref.short_name:
            remote, _, branch = ref.short_name.partition("/")
            plans.append(
                ActionPlan(
                    id="fetch_remote",
                    label=f"Fetch {remote}",
                    argv=("fetch", "--prune", "--tags", remote),
                    target=remote,
                    requires_confirmation=True,
                )
            )
            plans.append(
                ActionPlan(
                    id="create_tracking_branch",
                    label=f"Create local branch {branch}",
                    argv=("switch", "--track", ref.short_name),
                    target=ref.short_name,
                    requires_confirmation=True,
                    requires_clean_tree=True,
                )
            )
        return tuple(plans)

    def global_plans(self) -> tuple[ActionPlan, ...]:
        return (
            ActionPlan(
                id="fetch_all",
                label="Fetch all remotes",
                argv=("fetch", "--all", "--prune", "--tags"),
                target="all remotes",
                requires_confirmation=True,
            ),
        )

    def plan_stage(self, path: str) -> ActionPlan:
        return ActionPlan(
            id="stage_file",
            label=f"Stage {path}",
            argv=("add", "--", path),
            target=path,
            requires_confirmation=True,
        )

    def plan_unstage(self, path: str) -> ActionPlan:
        return ActionPlan(
            id="unstage_file",
            label=f"Unstage {path}",
            argv=("restore", "--staged", "--", path),
            target=path,
            requires_confirmation=True,
        )

    async def execute(
        self,
        repo: Path,
        plan: ActionPlan,
        status: StatusSnapshot | None = None,
    ) -> ActionResult:
        if plan.requires_clean_tree and status is not None and status.is_dirty:
            return ActionResult(
                plan=plan,
                exit_code=2,
                stdout="",
                stderr="Working tree has changes. Commit, stage, or stash before this action.",
            )
        result = await self.runner.run(plan.argv, repo=repo, read_only=False, check=False)
        return ActionResult(
            plan=plan,
            exit_code=result.exit_code,
            stdout=result.stdout,
            stderr=result.stderr,
        )
