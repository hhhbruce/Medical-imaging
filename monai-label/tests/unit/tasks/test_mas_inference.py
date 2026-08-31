from types import SimpleNamespace

from monailabel.tasks.infer.mas_inference import run_workflow


class _FakeCompletions:
    def __init__(self):
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        number = len(self.calls)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=f"answer-{number}"))],
            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5),
        )


class _FakeClient:
    def __init__(self):
        self.chat = SimpleNamespace(completions=_FakeCompletions())


def test_single_workflow_uses_one_multimodal_request():
    client = _FakeClient()
    answer, stats, metadata = run_workflow(
        client=client,
        model="test-model",
        strategy="single",
        question="What is shown?",
        initial_content=[
            {"type": "text", "text": "What is shown?"},
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,test"}},
        ],
    )

    assert answer == "answer-1"
    assert stats == {"num_llm_calls": 1, "prompt_tokens": 10, "completion_tokens": 5}
    assert metadata["agent_count"] == 1
    assert client.chat.completions.calls[0]["messages"][0]["content"][1]["type"] == "image_url"


def test_clinical_panel_synthesizes_specialist_reports():
    client = _FakeClient()
    answer, stats, metadata = run_workflow(
        client=client,
        model="test-model",
        strategy="clinical-panel",
        question="What is the next step?",
        initial_content=[{"type": "text", "text": "case"}],
    )

    assert answer == "answer-5"
    assert stats["num_llm_calls"] == 5
    assert stats["prompt_tokens"] == 50
    assert stats["completion_tokens"] == 25
    assert metadata["agent_count"] == 5
    assert "Primary Care Physician" in client.chat.completions.calls[-1]["messages"][1]["content"]
