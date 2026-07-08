from collections import defaultdict

from gitph.domain.models import CommitSummary, GitRef, GraphEdge, GraphModel, GraphRow


class GitGraphBuilder:
    """Builds a render-neutral commit lane graph from topo-ordered commits."""

    def build(
        self,
        commits: tuple[CommitSummary, ...],
        refs: tuple[GitRef, ...],
    ) -> GraphModel:
        refs_by_oid: dict[str, list[GitRef]] = defaultdict(list)
        for ref in refs:
            refs_by_oid[ref.display_oid].append(ref)

        active_lanes: list[str | None] = []
        rows: list[GraphRow] = []
        max_lanes = 0

        for row_index, commit in enumerate(commits):
            lane = self._claim_lane(active_lanes, commit.oid)
            parents = commit.parents
            if parents:
                active_lanes[lane] = parents[0]
            else:
                active_lanes[lane] = None

            edges: list[GraphEdge] = []
            for parent_index, parent_oid in enumerate(parents):
                parent_lane = self._ensure_lane(active_lanes, parent_oid, preferred_lane=lane)
                edges.append(
                    GraphEdge(
                        from_oid=commit.oid,
                        to_oid=parent_oid,
                        from_lane=lane,
                        to_lane=parent_lane,
                        color_index=parent_lane % 8,
                        kind="merge" if parent_index > 0 else "parent",
                    )
                )

            self._trim_lanes(active_lanes)
            max_lanes = max(max_lanes, len(active_lanes), lane + 1)
            rows.append(
                GraphRow(
                    commit=commit,
                    row_index=row_index,
                    lane=lane,
                    refs=tuple(refs_by_oid.get(commit.oid, ())),
                    edges=tuple(edges),
                    active_lanes=tuple(active_lanes),
                )
            )

        return GraphModel(rows=tuple(rows), max_lanes=max_lanes)

    @staticmethod
    def _claim_lane(active_lanes: list[str | None], oid: str) -> int:
        if oid in active_lanes:
            return active_lanes.index(oid)
        for index, value in enumerate(active_lanes):
            if value is None:
                active_lanes[index] = oid
                return index
        active_lanes.append(oid)
        return len(active_lanes) - 1

    @staticmethod
    def _ensure_lane(active_lanes: list[str | None], oid: str, preferred_lane: int) -> int:
        if oid in active_lanes:
            return active_lanes.index(oid)
        if preferred_lane < len(active_lanes) and active_lanes[preferred_lane] == oid:
            return preferred_lane
        for index, value in enumerate(active_lanes):
            if value is None:
                active_lanes[index] = oid
                return index
        active_lanes.append(oid)
        return len(active_lanes) - 1

    @staticmethod
    def _trim_lanes(active_lanes: list[str | None]) -> None:
        while active_lanes and active_lanes[-1] is None:
            active_lanes.pop()
