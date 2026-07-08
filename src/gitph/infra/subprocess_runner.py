import asyncio
import os
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Sequence


@dataclass(frozen=True, slots=True)
class CommandResult:
    """Stores decoded output from a completed subprocess."""

    argv: tuple[str, ...]
    exit_code: int
    stdout: str
    stderr: str


class GitCommandError(RuntimeError):
    """Raised when a Git command exits unsuccessfully."""

    def __init__(self, result: CommandResult) -> None:
        self.result = result
        message = result.stderr.strip() or result.stdout.strip() or "Git command failed."
        super().__init__(message)


class GitCommandRunner:
    """Runs Git commands with explicit argv, cwd, timeout, and decoding policy."""

    def __init__(self, timeout_seconds: float = 30.0) -> None:
        self.timeout_seconds = timeout_seconds

    async def run(
        self,
        args: Sequence[str],
        *,
        repo: Path | None = None,
        timeout_seconds: float | None = None,
        read_only: bool = True,
        check: bool = True,
    ) -> CommandResult:
        argv = self._build_argv(args, repo=repo, read_only=read_only)
        env = os.environ.copy()
        if read_only:
            env["GIT_OPTIONAL_LOCKS"] = "0"
        process = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        try:
            stdout_raw, stderr_raw = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout_seconds or self.timeout_seconds,
            )
        except TimeoutError as exc:
            process.kill()
            await process.communicate()
            result = CommandResult(argv, -1, "", f"Git command timed out: {' '.join(argv)}")
            raise GitCommandError(result) from exc

        result = CommandResult(
            argv=argv,
            exit_code=process.returncode or 0,
            stdout=stdout_raw.decode("utf-8", errors="surrogateescape"),
            stderr=stderr_raw.decode("utf-8", errors="surrogateescape"),
        )
        if check and result.exit_code != 0:
            raise GitCommandError(result)
        return result

    @staticmethod
    def _build_argv(
        args: Sequence[str],
        *,
        repo: Path | None,
        read_only: bool,
    ) -> tuple[str, ...]:
        argv: list[str] = ["git"]
        if read_only:
            argv.append("--no-optional-locks")
        if repo is not None:
            argv.extend(("-C", str(repo)))
        argv.extend(str(arg) for arg in args)
        return tuple(argv)
