"""AI 服务的请求与响应模型。

结论分两层，对齐 deploy-copilot 现行 PRD 第 7 节：

- **事实层**（fact）：必须能定位到文件行号或文档章节，否则不进响应；
- **推断层**（inference）：必须至少引用一条事实，并给出置信度。

违反任一条的结论在校验期就被拒绝，不会流到页面。这是「无据不出结论」的
落地位置——不是靠提示词，是靠类型。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

Severity = Literal["blocker", "risk", "suggestion"]
FindingKind = Literal["fact", "inference"]
SourceKind = Literal["rule", "catalog", "doc", "log", "baseline", "model"]
RunMode = Literal["L0", "L1", "L2"]


class Locator(BaseModel):
    """结论在原件上的落点。行号从 1 开始，与 `grep -n` 一致。"""

    file: str = Field(min_length=1)
    line: int = Field(ge=1)
    key: str | None = None
    section: str | None = None


class Source(BaseModel):
    """结论的出处：哪条判据、哪份基线、哪一版文档、哪个模型。"""

    type: SourceKind
    id: str = Field(min_length=1)
    version: str | None = None


class Finding(BaseModel):
    """一条体检结论。"""

    id: str = Field(min_length=1)
    kind: FindingKind
    severity: Severity
    category: str = Field(min_length=1)
    title: str = Field(min_length=1)
    detail: str = ""
    locator: Locator | None = None
    source: Source
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    basis: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _evidence_rule(self) -> "Finding":
        if self.kind == "fact" and self.locator is None:
            raise ValueError(f"{self.id}: 事实层结论必须带 locator(file + line)")
        if self.kind == "inference":
            if not self.basis:
                raise ValueError(f"{self.id}: 推断层结论必须引用至少一条事实(basis)")
            if self.confidence is None:
                raise ValueError(f"{self.id}: 推断层结论必须给出 confidence")
        return self


class ConfigFile(BaseModel):
    """参与体检的一份配置。T02 只收等价于清单的元信息，不收正文。"""

    name: str = Field(min_length=1)
    sha256: str | None = None


class CheckRequest(BaseModel):
    files: list[ConfigFile] = Field(min_length=1)
    mode: RunMode = "L0"


class CheckResponse(BaseModel):
    """配置体检响应。空结果也必须是合法结构，前端才能统一渲染。"""

    schemaVersion: Literal["ai-findings/1"] = "ai-findings/1"
    mode: RunMode
    catalogVersion: str | None = None
    degraded: bool = False
    findings: list[Finding] = Field(default_factory=list)
    missingInfo: list[str] = Field(default_factory=list)
    notices: list[str] = Field(default_factory=list)
