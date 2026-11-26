"""T02 验收：骨架能起、空结构合法、两层 evidence 规则真的会拒绝坏数据。

验收命令：`pytest services/ai/tests -q`（仓根执行）。
"""

from __future__ import annotations

import jsonschema
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.schemas import CheckResponse, Finding

client = TestClient(app)


def test_health_exact_payload() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_config_check_returns_empty_but_valid_result() -> None:
    response = client.post(
        "/v1/config/check",
        json={"files": [{"name": "values.yaml", "sha256": "0" * 64}], "mode": "L0"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["schemaVersion"] == "ai-findings/1"
    assert body["mode"] == "L0"
    assert body["findings"] == []
    assert body["degraded"] is True
    assert body["missingInfo"], "骨架期必须明说没接规则，不能假装检查过了"


def test_config_check_rejects_empty_file_list() -> None:
    response = client.post("/v1/config/check", json={"files": []})
    assert response.status_code == 422


def test_fact_without_locator_is_rejected() -> None:
    with pytest.raises(ValidationError, match="locator"):
        Finding(
            id="F-1",
            kind="fact",
            severity="risk",
            category="placeholder",
            title="占位符未替换",
            source={"type": "rule", "id": "R-001"},
        )


def test_inference_without_basis_or_confidence_is_rejected() -> None:
    base = dict(
        id="I-1",
        kind="inference",
        severity="suggestion",
        category="semantic",
        title="超时配置可能互相矛盾",
        source={"type": "model", "id": "deepseek@v1"},
    )
    with pytest.raises(ValidationError, match="basis"):
        Finding(**base)

    with pytest.raises(ValidationError, match="confidence"):
        Finding(**base, basis=["F-1"])


def test_response_matches_its_own_json_schema() -> None:
    """响应模型本身就是对外契约：实例必须能过它导出的 JSON Schema。"""
    finding = Finding(
        id="F-1",
        kind="fact",
        severity="blocker",
        category="placeholder",
        title="数据库密码仍为默认值",
        detail="与模板默认值一致",
        locator={"file": "values.yaml", "line": 42, "key": "global.db.password"},
        source={"type": "rule", "id": "R-002", "version": "catalog-1"},
    )
    payload = CheckResponse(mode="L0", findings=[finding]).model_dump(mode="json")
    jsonschema.validate(instance=payload, schema=CheckResponse.model_json_schema())
