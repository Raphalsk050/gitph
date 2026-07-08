import argparse
import asyncio
from pathlib import Path

from gitph import __version__
from gitph.app import GitphApp
from gitph.config import AppConfig
from gitph.git.client import GitClient
from gitph.git.graph import GitGraphBuilder
from gitph.git.parser import GitParser
from gitph.infra.subprocess_runner import GitCommandRunner
from gitph.services.repository_service import RepositoryService


def main(argv: list[str] | None = None) -> int:
    """Entrypoint for the gitph command line."""

    parser = argparse.ArgumentParser(prog="gitph", description="Modern Textual Git graph TUI.")
    parser.add_argument("path", nargs="?", default=".", help="Repository path to open.")
    parser.add_argument("--version", action="version", version=f"gitph {__version__}")
    parser.add_argument("--smoke", action="store_true", help="Run non-interactive startup checks.")
    args = parser.parse_args(argv)

    repo_path = Path(args.path).expanduser().resolve()
    if args.smoke:
        return asyncio.run(_smoke(repo_path))

    GitphApp(repo_path).run()
    return 0


async def _smoke(path: Path) -> int:
    config = AppConfig()
    runner = GitCommandRunner(timeout_seconds=config.git_timeout_seconds)
    git_version = await runner.run(["--version"], read_only=True, repo=None, check=False)
    print(git_version.stdout.strip() or "git version unavailable")
    service = RepositoryService(
        GitClient(runner, GitParser(), config),
        GitGraphBuilder(),
        config,
    )
    try:
        snapshot = await service.load_snapshot(path)
    except Exception as exc:
        print(f"gitph smoke: recoverable repository error: {exc}")
        return 0
    print(f"gitph smoke: {snapshot.identity.root}")
    print(f"gitph smoke: {len(snapshot.graph.rows)} commits, {len(snapshot.refs)} refs")
    return 0
