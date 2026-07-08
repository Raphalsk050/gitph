from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AppConfig:
    """Runtime configuration shared by services and UI."""

    max_commits: int = 500
    git_timeout_seconds: float = 30.0
    diff_timeout_seconds: float = 20.0
