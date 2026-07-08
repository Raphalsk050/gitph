from textual.app import ComposeResult
from textual.containers import Container, Horizontal
from textual.screen import ModalScreen
from textual.widgets import Button, Static

from gitph.domain.models import ActionPlan


class ConfirmGitActionScreen(ModalScreen[bool]):
    """Confirms every mutating Git action before execution."""

    BINDINGS = [("escape", "cancel", "Cancel")]

    def __init__(self, plan: ActionPlan) -> None:
        super().__init__()
        self.plan = plan

    def compose(self) -> ComposeResult:
        risk = "High risk" if self.plan.risk_level != "normal" else "Confirmation required"
        with Container(id="confirm-dialog"):
            yield Static(risk, id="confirm-title")
            yield Static(self.plan.label, id="confirm-label")
            yield Static(f"Target: {self.plan.target}", id="confirm-target")
            yield Static("Command: git " + " ".join(self.plan.argv), id="confirm-command")
            with Horizontal(id="confirm-buttons"):
                yield Button("Cancel", id="cancel")
                yield Button("Run", id="confirm", variant="primary")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        event.stop()
        self.dismiss(event.button.id == "confirm")

    def action_cancel(self) -> None:
        self.dismiss(False)
