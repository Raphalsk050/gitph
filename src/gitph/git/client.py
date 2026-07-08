from pathlib import Path

from gitph.config import AppConfig
from gitph.domain.models import CommitDetails, CommitSummary, GitRef, RepoIdentity, StatusSnapshot
from gitph.git.errors import NotAGitRepositoryError
from gitph.git.parser import GitParser
from gitph.infra.subprocess_runner import GitCommandError, GitCommandRunner


class GitClient:
    """Loads repository data through the Git CLI without leaking subprocess details."""

    REF_FORMAT = (
        "%(refname)%00%(refname:short)%00%(objecttype)%00%(objectname)%00"
        "%(*objecttype)%00%(*objectname)%00%(HEAD)%00%(upstream)%00"
        "%(upstream:short)%00%(creatordate:unix)%00%(subject)%1e"
    )
    LOG_FORMAT = "%x1f%H%x00%P%x00%at%x00%ct%x00%an%x00%ae%x00%s%x1e"

    def __init__(
        self,
        runner: GitCommandRunner,
        parser: GitParser | None = None,
        config: AppConfig | None = None,
    ) -> None:
        self.runner = runner
        self.parser = parser or GitParser()
        self.config = config or AppConfig()

    async def discover(self, path: Path) -> RepoIdentity:
        try:
            rev_parse = await self.runner.run(
                [
                    "rev-parse",
                    "--path-format=absolute",
                    "--show-toplevel",
                    "--git-dir",
                    "--is-bare-repository",
                    "--is-inside-work-tree",
                ],
                repo=path,
            )
        except GitCommandError as exc:
            raise NotAGitRepositoryError(str(exc)) from exc

        head_ref = await self.runner.run(
            ["symbolic-ref", "-q", "--short", "HEAD"],
            repo=path,
            check=False,
        )
        head_oid = await self.runner.run(
            ["rev-parse", "--verify", "HEAD"],
            repo=path,
            check=False,
        )
        return self.parser.parse_repo_identity(
            path,
            rev_parse.stdout,
            head_ref.stdout if head_ref.exit_code == 0 else "",
            head_oid.stdout if head_oid.exit_code == 0 else "",
        )

    async def status(self, repo: Path) -> StatusSnapshot:
        result = await self.runner.run(
            ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=normal"],
            repo=repo,
        )
        return self.parser.parse_status(result.stdout)

    async def refs(self, repo: Path) -> tuple[GitRef, ...]:
        result = await self.runner.run(
            [
                "for-each-ref",
                "--sort=refname",
                f"--format={self.REF_FORMAT}",
                "refs/heads",
                "refs/remotes",
                "refs/tags",
                "refs/stash",
            ],
            repo=repo,
        )
        return self.parser.parse_refs(result.stdout)

    async def commits(self, repo: Path, max_count: int | None = None) -> tuple[CommitSummary, ...]:
        result = await self.runner.run(
            [
                "log",
                "--graph",
                "--topo-order",
                "--date-order",
                "--all",
                f"--max-count={max_count or self.config.max_commits}",
                f"--pretty=format:{self.LOG_FORMAT}",
            ],
            repo=repo,
            check=False,
        )
        if result.exit_code != 0:
            return ()
        return self.parser.parse_commits(result.stdout)

    async def commit_details(self, repo: Path, summary: CommitSummary) -> CommitDetails:
        body_result = await self.runner.run(
            ["show", "-s", "--format=%B", summary.oid],
            repo=repo,
            timeout_seconds=self.config.diff_timeout_seconds,
        )
        files_result = await self.runner.run(
            ["diff-tree", "--root", "-r", "-z", "-M", "--name-status", summary.oid],
            repo=repo,
            timeout_seconds=self.config.diff_timeout_seconds,
        )
        patch_result = await self.runner.run(
            [
                "show",
                "--format=",
                "--patch",
                "--find-renames",
                "--no-ext-diff",
                "--no-color",
                "--unified=3",
                summary.oid,
                "--",
            ],
            repo=repo,
            timeout_seconds=self.config.diff_timeout_seconds,
        )
        return CommitDetails(
            summary=summary,
            body=body_result.stdout.strip(),
            changed_files=self.parser.parse_changed_files(files_result.stdout),
            patch_text=patch_result.stdout,
        )
