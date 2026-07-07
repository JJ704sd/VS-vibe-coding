"""
C-12: `/api/ecg/analyze` route tests (MiniMax proxy).

Audit `2026-07-07-track-C-assistant-training-minimax.md` §4.1 found that
the frontend `analyzeViaProxy` always 404'd because the FastAPI sidecar
did not implement the route. The fix adds a same-process proxy inside
`proxy-server/main.py`. These tests pin the contract:

* `MINIMAX_API_KEY` unset → 503 (with a friendly message).
* `signalData` missing/empty → 400.
* Successful upstream → 200 with `{predictions, model}`.
* Upstream 4xx/5xx → 502 (sanitized).
* Upstream transport failure → 502.
* Upstream returns an empty/missing predictions payload → 502.
* `output_text` and `choices[0].message.content` JSON are both accepted.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

import main


class _FakeResponse:
    def __init__(
        self,
        status_code: int,
        json_body: Any = None,
        text: str = "",
    ) -> None:
        self.status_code = status_code
        self._json = json_body
        self.text = text or (json.dumps(json_body) if json_body is not None else "")

    def json(self) -> Any:
        if self._json is None:
            raise ValueError("no JSON body")
        return self._json


class _FakeAsyncClient:
    """Drop-in replacement for `httpx.AsyncClient` that captures requests."""

    def __init__(self, response: _FakeResponse, *, transport_error: Exception | None = None) -> None:
        self._response = response
        self._transport_error = transport_error
        self.calls: list[dict] = []

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def post(self, url: str, *, json: dict, headers: dict) -> _FakeResponse:
        self.calls.append({"url": url, "json": json, "headers": headers})
        if self._transport_error is not None:
            raise self._transport_error
        return self._response


def _patch_client(monkeypatch, response: _FakeResponse, transport_error: Exception | None = None) -> _FakeAsyncClient:
    """Patch `httpx.AsyncClient` inside `main` to a controllable fake."""
    fake = _FakeAsyncClient(response, transport_error=transport_error)
    monkeypatch.setattr(main.httpx, "AsyncClient", lambda timeout: fake)
    return fake


def _payload(signal: list[list[float]] | None = None, model: str = "abab6.5s-chat") -> dict:
    return {
        "model": model,
        "signalData": signal if signal is not None else [[0.1, 0.2], [0.3, 0.4]],
        "_startTime": 0,
    }


# ── Happy path ─────────────────────────────────────────────────────────────


def test_analyze_returns_predictions_when_upstream_succeeds(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-test")
    response = _FakeResponse(
        200,
        json_body={
            "predictions": [
                {"className": "正常", "probability": 0.7},
                {"className": "房颤", "probability": 0.3},
            ],
        },
    )
    fake = _patch_client(monkeypatch, response)
    client = TestClient(main.app)

    result = client.post("/api/ecg/analyze", json=_payload())

    assert result.status_code == 200
    body = result.json()
    assert body["model"] == "abab6.5s-chat"
    assert [p["className"] for p in body["predictions"]] == ["正常", "房颤"]

    # Upstream was called with the bearer token + the proxied payload.
    assert fake.calls, "AsyncClient.post was not invoked"
    call = fake.calls[0]
    assert call["url"] == main.MINIMAX_UPSTREAM_URL
    assert call["headers"]["Authorization"] == "Bearer sk-test"
    assert call["headers"]["Content-Type"] == "application/json"
    assert call["json"]["model"] == "abab6.5s-chat"
    assert call["json"]["messages"][1]["role"] == "user"


def test_analyze_parses_predictions_from_output_text(monkeypatch):
    """`output_text` containing JSON is unwrapped into predictions."""
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-test")
    embedded = json.dumps(
        {
            "predictions": [
                {"className": "室性心动过速", "probability": 0.6},
                {"className": "停搏", "probability": 0.4},
            ],
        },
        ensure_ascii=False,
    )
    response = _FakeResponse(
        200,
        json_body={"output_text": f"Here is the analysis: {embedded} -- end"},
    )
    _patch_client(monkeypatch, response)
    client = TestClient(main.app)

    result = client.post("/api/ecg/analyze", json=_payload())
    assert result.status_code == 200
    classes = [p["className"] for p in result.json()["predictions"]]
    assert classes == ["室性心动过速", "停搏"]


def test_analyze_parses_predictions_from_choices_message(monkeypatch):
    """`choices[0].message.content` JSON is also unwrapped."""
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-test")
    embedded = json.dumps(
        {"predictions": [{"className": "房颤", "probability": 1.0}]},
        ensure_ascii=False,
    )
    response = _FakeResponse(
        200,
        json_body={"choices": [{"message": {"content": embedded}}]},
    )
    _patch_client(monkeypatch, response)
    client = TestClient(main.app)

    result = client.post("/api/ecg/analyze", json=_payload())
    assert result.status_code == 200
    assert result.json()["predictions"][0]["className"] == "房颤"


# ── Configuration errors ──────────────────────────────────────────────────


def test_analyze_returns_503_when_minimax_api_key_missing(monkeypatch):
    monkeypatch.delenv("MINIMAX_API_KEY", raising=False)
    client = TestClient(main.app)

    result = client.post("/api/ecg/analyze", json=_payload())
    assert result.status_code == 503
    assert "MINIMAX_API_KEY" in result.json()["detail"]


def test_analyze_returns_503_when_minimax_api_key_blank(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "   ")
    client = TestClient(main.app)

    result = client.post("/api/ecg/analyze", json=_payload())
    assert result.status_code == 503


# ── Malformed requests ────────────────────────────────────────────────────


def test_analyze_returns_400_when_signal_data_missing(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-test")
    client = TestClient(main.app)

    result = client.post("/api/ecg/analyze", json={"model": "m"})
    assert result.status_code == 400
    assert "signalData" in result.json()["detail"]


def test_analyze_returns_400_when_signal_data_empty(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-test")
    client = TestClient(main.app)

    result = client.post("/api/ecg/analyze", json={"model": "m", "signalData": []})
    assert result.status_code == 400


# ── Upstream error paths ─────────────────────────────────────────────────


def test_analyze_returns_502_on_upstream_4xx(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-test")
    response = _FakeResponse(401, json_body={"error": "invalid api key"})
    _patch_client(monkeypatch, response)
    client = TestClient(main.app)

    result = client.post("/api/ecg/analyze", json=_payload())
    assert result.status_code == 502
    assert "401" in result.json()["detail"]


def test_analyze_returns_502_on_upstream_5xx(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-test")
    response = _FakeResponse(500, text="internal error")
    _patch_client(monkeypatch, response)
    client = TestClient(main.app)

    result = client.post("/api/ecg/analyze", json=_payload())
    assert result.status_code == 502
    assert "500" in result.json()["detail"]


def test_analyze_returns_502_on_upstream_transport_error(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-test")
    _patch_client(
        monkeypatch,
        _FakeResponse(200, json_body={"predictions": []}),
        transport_error=httpx.ConnectError("network unreachable"),
    )
    client = TestClient(main.app)

    result = client.post("/api/ecg/analyze", json=_payload())
    assert result.status_code == 502
    assert "Upstream Minimax request failed" in result.json()["detail"]


def test_analyze_returns_502_when_upstream_body_is_not_json(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-test")

    class _BadJSONResponse(_FakeResponse):
        def json(self) -> Any:
            raise ValueError("not json")

    _patch_client(monkeypatch, _BadJSONResponse(200, text="<html>error</html>"))
    client = TestClient(main.app)

    result = client.post("/api/ecg/analyze", json=_payload())
    assert result.status_code == 502
    assert "not valid JSON" in result.json()["detail"]


def test_analyze_returns_502_when_upstream_has_no_predictions(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-test")
    response = _FakeResponse(200, json_body={"unrelated": "payload"})
    _patch_client(monkeypatch, response)
    client = TestClient(main.app)

    result = client.post("/api/ecg/analyze", json=_payload())
    assert result.status_code == 502
    assert "parseable predictions" in result.json()["detail"]


# ── Helper-level coverage (C-12) ──────────────────────────────────────────


def test_build_minimax_payload_handles_classes_override():
    """`classes` from the request overrides the default class list."""
    body = {
        "model": "minimax-text-01",
        "signalData": [[1.0, 2.0]],
        "classes": ["A", "B"],
    }
    payload = main._build_minimax_payload(body)
    assert payload is not None
    assert payload["model"] == "minimax-text-01"
    user_msg = payload["messages"][1]["content"]
    parsed = json.loads(user_msg)
    assert parsed["classes"] == ["A", "B"]
    assert parsed["signal"] == [[1.0, 2.0]]


def test_build_minimax_payload_returns_none_for_bad_input():
    assert main._build_minimax_payload({}) is None
    assert main._build_minimax_payload({"signalData": []}) is None
    assert main._build_minimax_payload({"signalData": "not-a-list"}) is None


def test_extract_minimax_predictions_handles_label_and_score():
    """`label`/`score` keys (instead of `className`/`probability`) are normalised."""
    raw = {"predictions": [{"label": "正常", "score": 1}]}
    out = main._extract_minimax_predictions(raw)
    assert out == [{"className": "正常", "probability": 1.0}]


def test_extract_minimax_predictions_returns_empty_list_for_unparseable():
    assert main._extract_minimax_predictions({}) == []
    assert main._extract_minimax_predictions("not a dict") == []
    assert main._extract_minimax_predictions({"output_text": "no json here"}) == []


def test_first_json_object_handles_nested_braces():
    text = 'prefix {"a": 1, "b": {"c": 2}} trailing'
    assert main._first_json_object(text) == '{"a": 1, "b": {"c": 2}}'


def test_first_json_object_handles_strings_with_braces():
    text = '{"a": "}", "b": "}"}'
    # The function should return the full JSON object, not stop at the
    # first `}` inside a string.
    result = main._first_json_object(text)
    parsed = json.loads(result)
    assert parsed == {"a": "}", "b": "}"}


def test_first_json_object_returns_none_when_no_object():
    assert main._first_json_object("plain text") is None
    assert main._first_json_object("{ unbalanced") is None


# Sanity: the route is reachable from the sidecar router.
def test_route_is_registered_in_app_routes():
    paths = {route.path for route in main.app.routes if hasattr(route, "path")}
    assert "/api/ecg/analyze" in paths
