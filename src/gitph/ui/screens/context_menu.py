from textual.app import ComposeResult
from textual.containers import Container
from textual.screen import ModalScreen
from textual.widgets import OptionList, Static
from textual.widgets._option_list import Option

from gitph.domain.models import ActionPlan, UiAction

MenuChoice = ActionPlan | UiAction


class ContextMenuScreen(ModalScreen[MenuChoice | None]):
    """Modal action picker used by right-click and keyboard fallback."""

    BINDINGS = [("escape", "cancel", "Cancel")]

    def __init__(self, plans: tuple[MenuChoice, ...], title: str = "Git actions") -> None:
        super().__init__()
        self.plans = plans
        self.title = title
        self._plans_by_id = {plan.id: plan for plan in plans}

    def compose(self) -> ComposeResult:
        options = [Option(plan.label, id=plan.id) for plan in self.plans]
        with Container(id="context-menu"):
            yield Static(self.title, id="context-title")
            yield OptionList(*options, id="context-options")

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        event.stop()
        if event.option_id is None:
            self.dismiss(None)
            return
        self.dismiss(self._plans_by_id.get(event.option_id))

    def action_cancel(self) -> None:
        self.dismiss(None)
