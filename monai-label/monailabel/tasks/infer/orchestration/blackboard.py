"""Thread-safe shared memory ("blackboard") for multi-agent coordination.

Agents read a shared snapshot before responding and write their conclusions
back, enabling cross-agent / cross-round information sharing without a central
orchestrator relaying every message (the Blackboard orchestration pattern).
"""
from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional


class Blackboard:
    """A minimal shared-memory store with per-key history.

    All reads/writes are guarded by a re-entrant lock so parallel agent
    branches can safely share state.
    """

    def __init__(self) -> None:
        self._data: Dict[str, Any] = {}
        self._lock = threading.RLock()
        self.history: List[Dict[str, Any]] = []

    def read(self, key: Optional[str] = None) -> Any:
        with self._lock:
            if key is None:
                return dict(self._data)
            return self._data.get(key)

    def write(self, key: str, value: Any) -> None:
        with self._lock:
            self._data[key] = value
            self.history.append({"key": key, "value": value})

    def snapshot_text(self, max_chars: int = 6000) -> str:
        """Render the current board as a compact text block for prompt context."""
        with self._lock:
            if not self._data:
                return ""
            parts: List[str] = []
            for key, value in self._data.items():
                text = str(value)
                if len(text) > max_chars:
                    text = text[:max_chars] + "…"
                parts.append(f"[{key}]\n{text}")
            return "\n\n".join(parts)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
            self.history.clear()
