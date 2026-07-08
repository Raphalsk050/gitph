from pathlib import Path

from gitph.domain.models import (
    ChangedFile,
    CommitSummary,
    GitRef,
    RepoIdentity,
    StatusEntry,
    StatusSnapshot,
)


class GitParser:
    """Parses stable Git plumbing and porcelain output into domain models."""

    @staticmethod
    def parse_repo_identity(
        path: Path,
        rev_parse_output: str,
        head_ref_output: str,
        head_oid_output: str,
    ) -> RepoIdentity:
        lines = [line.strip() for line in rev_parse_output.splitlines()]
        root = Path(lines[0]) if len(lines) > 0 and lines[0] else path.resolve()
        git_dir = Path(lines[1]) if len(lines) > 1 and lines[1] else root / ".git"
        if not git_dir.is_absolute():
            git_dir = root / git_dir
        is_bare = len(lines) > 2 and lines[2].lower() == "true"
        head_ref = head_ref_output.strip() or None
        head_oid = head_oid_output.strip() or None
        return RepoIdentity(
            root=root,
            git_dir=git_dir,
            is_bare=is_bare,
            head_oid=head_oid,
            head_ref=head_ref,
        )

    @staticmethod
    def parse_status(output: str) -> StatusSnapshot:
        branch_name: str | None = None
        branch_oid: str | None = None
        upstream: str | None = None
        ahead = 0
        behind = 0
        entries: list[StatusEntry] = []

        for record in output.split("\0"):
            if not record:
                continue
            if record.startswith("# branch.head "):
                value = record.removeprefix("# branch.head ").strip()
                branch_name = None if value == "(detached)" else value
            elif record.startswith("# branch.oid "):
                value = record.removeprefix("# branch.oid ").strip()
                branch_oid = None if value == "(initial)" else value
            elif record.startswith("# branch.upstream "):
                upstream = record.removeprefix("# branch.upstream ").strip() or None
            elif record.startswith("# branch.ab "):
                parts = record.removeprefix("# branch.ab ").split()
                for part in parts:
                    if part.startswith("+"):
                        ahead = _parse_int(part[1:])
                    elif part.startswith("-"):
                        behind = _parse_int(part[1:])
            elif record.startswith("? "):
                entries.append(StatusEntry(path=record[2:], index_status="?", worktree_status="?"))
            elif record.startswith("! "):
                entries.append(StatusEntry(path=record[2:], index_status="!", worktree_status="!"))
            elif record.startswith("1 ") or record.startswith("u "):
                parts = record.split(" ", 8)
                if len(parts) >= 9:
                    xy = parts[1]
                    entries.append(
                        StatusEntry(
                            path=parts[8],
                            index_status=xy[:1],
                            worktree_status=xy[1:2],
                        )
                    )
            elif record.startswith("2 "):
                parts = record.split(" ", 9)
                if len(parts) >= 10:
                    xy = parts[1]
                    entries.append(
                        StatusEntry(
                            path=parts[9],
                            original_path=None,
                            index_status=xy[:1],
                            worktree_status=xy[1:2],
                        )
                    )

        return StatusSnapshot(
            branch_name=branch_name,
            branch_oid=branch_oid,
            upstream=upstream,
            ahead=ahead,
            behind=behind,
            entries=tuple(entries),
        )

    @staticmethod
    def parse_refs(output: str) -> tuple[GitRef, ...]:
        refs: list[GitRef] = []
        for record in output.split("\x1e"):
            record = record.strip("\n")
            if not record:
                continue
            fields = record.split("\0")
            if len(fields) < 11:
                continue
            (
                full_name,
                short_name,
                object_type,
                object_name,
                peeled_type,
                peeled_name,
                head_marker,
                upstream,
                upstream_short,
                _creator_date,
                subject,
            ) = fields[:11]
            kind = _ref_kind(full_name)
            if kind is None:
                continue
            peeled_oid = peeled_name if peeled_type == "commit" and peeled_name else None
            target_oid = object_name if object_type else peeled_name
            if not target_oid:
                continue
            refs.append(
                GitRef(
                    full_name=full_name,
                    short_name=short_name,
                    kind=kind,
                    target_oid=target_oid,
                    peeled_oid=peeled_oid,
                    upstream=upstream_short or upstream or None,
                    is_head=head_marker == "*",
                    subject=subject,
                )
            )
        return tuple(refs)

    @staticmethod
    def parse_commits(output: str) -> tuple[CommitSummary, ...]:
        commits: list[CommitSummary] = []
        for record in output.split("\x1e"):
            record = record.strip("\n")
            if not record:
                continue
            graph_prefix = ""
            payload = record
            if "\x1f" in record:
                graph_prefix, payload = record.split("\x1f", 1)
            fields = payload.split("\0", 6)
            if len(fields) < 7:
                continue
            oid, parents, author_time, commit_time, author, author_email, subject = fields
            commits.append(
                CommitSummary(
                    oid=oid,
                    parents=tuple(parent for parent in parents.split(" ") if parent),
                    author=author,
                    author_email=author_email,
                    author_time=_parse_int(author_time),
                    commit_time=_parse_int(commit_time),
                    subject=subject.strip(),
                    graph_prefix=graph_prefix.rstrip(),
                )
            )
        return tuple(commits)

    @staticmethod
    def parse_changed_files(output: str) -> tuple[ChangedFile, ...]:
        tokens = [token for token in output.split("\0") if token]
        if tokens and _looks_like_object_id(tokens[0]):
            tokens = tokens[1:]
        files: list[ChangedFile] = []
        index = 0
        while index < len(tokens):
            status = tokens[index]
            index += 1
            if not status:
                continue
            if status.startswith(("R", "C")) and index + 1 < len(tokens):
                original = tokens[index]
                path = tokens[index + 1]
                index += 2
                files.append(ChangedFile(path=path, status=status, original_path=original))
            elif index < len(tokens):
                path = tokens[index]
                index += 1
                files.append(ChangedFile(path=path, status=status))
        return tuple(files)


def _parse_int(value: str) -> int:
    try:
        return int(value)
    except ValueError:
        return 0


def _ref_kind(full_name: str) -> str | None:
    if full_name.startswith("refs/heads/"):
        return "local_branch"
    if full_name.startswith("refs/remotes/"):
        return "remote_branch"
    if full_name.startswith("refs/tags/"):
        return "tag"
    if full_name == "refs/stash":
        return "stash"
    return None


def _looks_like_object_id(value: str) -> bool:
    return len(value) in {40, 64} and all(char in "0123456789abcdefABCDEF" for char in value)
