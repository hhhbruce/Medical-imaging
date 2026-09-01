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
    assert "全科医生" in client.chat.completions.calls[-1]["messages"][1]["content"]


def test_all_strategy_specs_execute_with_mock_agent():
    """Every registered strategy (including the MedMASLab ports) must be a
    valid orchestration graph that runs end-to-end with MockAgent."""
    from monailabel.tasks.infer.mas_inference import _STRATEGY_META, _STRATEGY_SPECS
    from monailabel.tasks.infer.orchestration import MockAgent, RuntimeEngine

    assert set(_STRATEGY_META) == set(_STRATEGY_SPECS)
    for sid, builder in _STRATEGY_SPECS.items():
        spec = builder(2) if sid == "discussion" else builder()
        spec.validate()
        result = RuntimeEngine(spec, MockAgent()).run("test question")
        assert result.final_answer.strip(), f"strategy '{sid}' produced an empty answer"
        assert result.trace.events, f"strategy '{sid}' produced no trace events"


def test_message_text_strips_replacement_characters():
    """U+FFFD arriving from relays that corrupt multi-byte UTF-8 must be
    stripped before the text enters the workflow."""
    from monailabel.tasks.infer.mas_inference import _message_text

    response = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content="气管周围软组织对称\ufffd、无肿块")
            )
        ]
    )
    assert _message_text(response) == "气管周围软组织对称、无肿块"


def test_orchestrated_llm_call_appends_chinese_output_rules():
    """The Chinese-only output rules must ride on every orchestrated call,
    even when the node has no system prompt of its own."""
    from monailabel.tasks.infer.mas_inference import (
        _OUTPUT_RULES,
        _make_orchestrated_llm_call,
    )

    captured = []

    def fake_call_agent(client, model, msgs, stats, temperature=0.1):
        captured.append(msgs)
        return "答复"

    import monailabel.tasks.infer.mas_inference as mi

    original = mi._call_agent
    mi._call_agent = fake_call_agent
    try:
        llm_call = _make_orchestrated_llm_call(object(), "m", [])
        text_with_role = llm_call(
            [{"role": "system", "content": "你是放射科医生。"}, {"role": "user", "content": "问题"}],
            images=None,
            temperature=None,
        )
        text_without_role = llm_call(
            [{"role": "user", "content": "问题"}],
            images=None,
            temperature=None,
        )
    finally:
        mi._call_agent = original

    assert text_with_role[0] == "答复"
    assert text_without_role[0] == "答复"

    # With a node role prompt, the rules are appended to it.
    system_msg = captured[0][0]
    assert system_msg["role"] == "system"
    assert "你是放射科医生。" in system_msg["content"]
    assert _OUTPUT_RULES in system_msg["content"]

    # With no system prompt at all, the rules become the system message.
    assert captured[1][0]["content"].strip() == _OUTPUT_RULES


def test_message_text_strips_think_blocks():
    """Reasoning models may inline <think> blocks into content; they must never
    reach the user as part of the answer."""
    from monailabel.tasks.infer.mas_inference import _message_text

    closed = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content="<think>先看肺窗再纵隔窗。</think>双肺未见明显实变。",
                    reasoning_content=None,
                )
            )
        ]
    )
    assert _message_text(closed) == "双肺未见明显实变。"

    # Unclosed <think> (budget cut mid-thinking): everything from the tag on is
    # reasoning, so the extracted final text is empty.
    unclosed = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content="<think>先看肺窗", reasoning_content=None)
            )
        ]
    )
    assert _message_text(unclosed) == ""


def _ReasoningClient(sequence):
    """Fake OpenAI client returning scripted responses in order."""
    calls = []

    class _Completions:
        def create(self, **kwargs):
            calls.append(kwargs["max_tokens"])
            content, reasoning = sequence[min(len(calls), len(sequence)) - 1]
            message = SimpleNamespace(content=content, reasoning_content=reasoning)
            return SimpleNamespace(
                choices=[SimpleNamespace(message=message)],
                usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1),
            )

    class _Client:
        chat = SimpleNamespace(completions=_Completions())
        completions_calls = calls

    return _Client()


def test_call_agent_retries_with_larger_budget_on_reasoning_only_response():
    """An empty final content must trigger a larger-budget retry instead of
    surfacing raw chain-of-thought as the answer."""
    import time as _time

    import monailabel.tasks.infer.mas_inference as mi
    from monailabel.tasks.infer.mas_inference import _call_agent

    client = _ReasoningClient([("", "隐藏推理"), ("最终结论", None)])
    original_sleep = mi.time.sleep
    mi.time.sleep = lambda seconds: None
    try:
        answer = _call_agent(
            client, "m", [{"role": "user", "content": "q"}], mi.WorkflowStats()
        )
    finally:
        mi.time.sleep = original_sleep

    assert answer == "最终结论"
    assert client.completions_calls == [1536, 4096]


def test_call_agent_reasoning_is_last_resort_only():
    """When no final content ever arrives, the reasoning text is surfaced as a
    fallback (after all retries), not on the first attempt."""
    import time as _time

    import monailabel.tasks.infer.mas_inference as mi
    from monailabel.tasks.infer.mas_inference import _call_agent

    client = _ReasoningClient([("", "第一段推理"), ("", "第二段推理"), ("", "第三段推理")])
    original_sleep = mi.time.sleep
    mi.time.sleep = lambda seconds: None
    try:
        answer = _call_agent(
            client, "m", [{"role": "user", "content": "q"}], mi.WorkflowStats()
        )
    finally:
        mi.time.sleep = original_sleep

    assert answer == "第三段推理"
    assert client.completions_calls == [1536, 4096, 4096]
