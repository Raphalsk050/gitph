from pathlib import Path

from gitph.config import AppConfig
from gitph.domain.models import CommitDetails, RepositorySnapshot
from gitph.git.client import GitClient
from gitph.git.graph import GitGraphBuilder


class RepositoryService:
    """Coordinates Git reads and produces immutable snapshots for the UI."""

    def __init__(
        self,
        client: GitClient,
        graph_builder: GitGraphBuilder | None = None,
        config: AppConfig | None = None,
    ) -> None:
        self.client = client
        self.graph_builder = graph_builder or GitGraphBuilder()
        self.config = config or AppConfig()

    async def load_snapshot(self, path: Path) -> RepositorySnapshot:
        identity = await self.client.discover(path)
        repo = identity.root
        status = await self.client.status(repo)
        refs = await self.client.refs(repo)
        commits = await self.client.commits(repo, self.config.max_commits)
        graph = self.graph_builder.build(commits, refs)
        return RepositorySnapshot(
            identity=identity,
            status=status,
            refs=refs,
            graph=graph,
            commits={commit.oid: commit for commit in commits},
        )

    async def load_commit_details(
        self,
        snapshot: RepositorySnapshot,
        oid: str,
    ) -> CommitDetails | None:
        summary = snapshot.commits.get(oid)
        if summary is None:
            return None
        return await self.client.commit_details(snapshot.identity.root, summary)
