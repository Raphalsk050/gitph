from rich.text import Text
from textual.widgets import OptionList
from textual.widgets._option_list import Option

from gitph.domain.events import CommitSelected
from gitph.domain.models import GraphModel, GraphRow


class CommitGraphPane(OptionList):
    """Renders the commit graph as native selectable one-line rows."""

    PALETTE = (
        "turquoise2",
        "dodger_blue1",
        "magenta1",
        "orange1",
        "green3",
        "red1",
        "yellow2",
        "purple3",
    )

    def __init__(self) -> None:
        super().__init__(id="commit-graph", compact=True)
        self.graph = GraphModel()
        self.selected_oid: str | None = None
        self._oid_by_option_id: dict[str, str] = {}
        self._option_index_by_oid: dict[str, int] = {}
        self._graph_prefix_width = 2

    def set_graph(self, graph: GraphModel, selected_oid: str | None = None) -> None:
        self.graph = graph
        self.selected_oid = selected_oid
        self._rebuild_options()

    def select(self, oid: str | None) -> None:
        self.selected_oid = oid
        if oid is None:
            self.highlighted = None
            return
        option_index = self._option_index_by_oid.get(oid)
        if option_index is not None:
            self.highlighted = option_index

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        event.stop()
        if event.option_id is None:
            return
        oid = self._oid_by_option_id.get(event.option_id)
        if oid is not None:
            self.post_message(CommitSelected(oid))

    def _rebuild_options(self) -> None:
        self.clear_options()
        self._oid_by_option_id.clear()
        self._option_index_by_oid.clear()
        if not self.graph.rows:
            self.add_option(Option(Text("No commits found.", style="dim", no_wrap=True, end=""), id="empty"))
            return

        self._graph_prefix_width = self._measure_graph_prefix_width()
        selected_index: int | None = None
        for index, row in enumerate(self.graph.rows):
            option_id = f"commit-{index}"
            self._oid_by_option_id[option_id] = row.commit.oid
            self._option_index_by_oid[row.commit.oid] = self.option_count
            self.add_option(Option(self._render_row(row), id=option_id))
            if row.commit.oid == self.selected_oid:
                selected_index = self._option_index_by_oid[row.commit.oid]
        self.highlighted = selected_index

    def _render_row(self, row: GraphRow, graph_prefix: str | None = None) -> Text:
        text = Text(no_wrap=True, overflow="ellipsis", end="")
        prefix = _graph_commit_prefix(row.commit.graph_prefix) if graph_prefix is None else graph_prefix
        if prefix:
            self._append_native_graph(text, prefix)
        else:
            self._append_fallback_lanes(text, row)
        refs = self._format_refs(row)
        subject = _squash(row.commit.subject or "(no subject)", 46)
        author = _abbreviate_name(row.commit.author)
        text.append(f" {row.commit.short_oid} ", style="bold white")
        if refs:
            text.append(f"{refs} ", style="bold black on cyan")
        text.append(subject, style="white")
        if author:
            text.append(f"  {author}", style="dim")
        return text

    def _measure_graph_prefix_width(self) -> int:
        prefixes = [
            len(_graph_commit_prefix(row.commit.graph_prefix))
            for row in self.graph.rows
            if _graph_commit_prefix(row.commit.graph_prefix)
        ]
        if not prefixes:
            lane_width = max(1, min(max(self.graph.max_lanes, 1), 10)) * 2
            return lane_width
        return min(max(max(prefixes), 2), 28)

    def _append_native_graph(self, text: Text, graph_prefix: str) -> None:
        prefix = graph_prefix[: self._graph_prefix_width]
        for column, char in enumerate(prefix):
            if char == " ":
                text.append(" ")
                continue
            style = f"bold {self.PALETTE[(column // 2) % len(self.PALETTE)]}"
            text.append(_graph_glyph(char), style=style)
        if len(prefix) < self._graph_prefix_width:
            text.append(" " * (self._graph_prefix_width - len(prefix)))
        text.append(" ")

    def _append_fallback_lanes(self, text: Text, row: GraphRow) -> None:
        lane_count = max(1, min(max(self.graph.max_lanes, 1), 10))
        target_lanes = {edge.to_lane for edge in row.edges if edge.to_lane != row.lane}
        bridge_min: int | None = None
        bridge_max: int | None = None
        if target_lanes:
            bridge_min = min(row.lane, *target_lanes)
            bridge_max = max(row.lane, *target_lanes)

        for lane in range(lane_count):
            color = self.PALETTE[lane % len(self.PALETTE)]
            glyph = self._lane_glyph(row, lane, bridge_min, bridge_max, target_lanes)
            text.append(glyph, style=f"bold {color}")
        fallback_width = lane_count * 2
        if fallback_width < self._graph_prefix_width:
            text.append(" " * (self._graph_prefix_width - fallback_width))
        text.append(" ")

    @staticmethod
    def _lane_glyph(
        row: GraphRow,
        lane: int,
        bridge_min: int | None,
        bridge_max: int | None,
        target_lanes: set[int],
    ) -> str:
        if lane == row.lane:
            return "●─" if row.commit.parents else "● "
        if lane in target_lanes:
            return "╯ " if lane < row.lane else "╰ "
        if bridge_min is not None and bridge_max is not None and bridge_min < lane < bridge_max:
            return "──"
        if lane < len(row.active_lanes) and row.active_lanes[lane]:
            return "│ "
        return "  "

    @staticmethod
    def _format_refs(row: GraphRow) -> str:
        if not row.refs:
            return ""
        labels = [_short_ref(ref.short_name) for ref in row.refs[:1]]
        if len(row.refs) > 1:
            labels.append(f"+{len(row.refs) - 1}")
        return " ".join(labels)


def _squash(value: str, limit: int) -> str:
    compact = " ".join(value.split())
    if len(compact) <= limit:
        return compact
    return compact[: max(0, limit - 1)] + "…"


def _abbreviate_name(value: str) -> str:
    parts = [part for part in " ".join(value.split()).split(" ") if part]
    if not parts:
        return ""
    if len(parts) == 1:
        return _squash(parts[0], 10)
    return f"{parts[0][0]}. {_squash(parts[-1], 12)}"


def _short_ref(value: str) -> str:
    compact = " ".join(value.split())
    if compact.startswith("origin/"):
        compact = "o/" + compact.removeprefix("origin/")
    if "/" in compact:
        parts = [part for part in compact.split("/") if part]
        if len(parts) > 2:
            compact = f"{parts[0]}/{parts[-1]}"
    return _squash(compact, 18)


def _graph_glyph(char: str) -> str:
    return {
        "*": "●",
        "|": "│",
        "/": "╱",
        "\\": "╲",
        "_": "─",
        "-": "─",
    }.get(char, char)


def _graph_prefix_lines(value: str) -> list[str]:
    lines = [line.rstrip() for line in value.splitlines() if line.strip()]
    if lines:
        return lines
    return [""]


def _graph_commit_prefix(value: str) -> str:
    return _graph_prefix_lines(value)[-1]
