class GitphError(RuntimeError):
    """Base error for recoverable gitph failures."""


class NotAGitRepositoryError(GitphError):
    """Raised when the selected path is not inside a Git repository."""
