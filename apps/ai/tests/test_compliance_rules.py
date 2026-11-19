"""The base rules every task and agent gets carry the compliance limits (docs/compliance/AI-ACT.md)."""

from levuvo_ai.tasks import BASE_RULES


def test_base_rules_cover_compliance_limits() -> None:
    for phrase in (
        "<untrusted_data>",
        "Never rate, rank or profile people",
        "job applicants",
        "emotions",
        "only as far as the task needs it",
        "marked as AI-generated",
        "never pretend to be a human",
        "legal, tax or medical advice",
        "offer a lawful alternative",
        "Never report or record the user's request",
    ):
        assert phrase in BASE_RULES, phrase


def test_presend_knows_the_legal_kind() -> None:
    from levuvo_ai.tasks import PresendIssue

    assert PresendIssue(kind="legal", message="x").kind == "legal"
