"""星图 AI 服务的 HTTP 入口。

T02 只搭骨架：`/health` 通、`/v1/config/check` 返回**结构合法但恒为空**的结论，
不接规则包、不接模型。这样后续 T03–T07 补实现时，前端与契约都不用改。
"""

from __future__ import annotations

from fastapi import FastAPI

from . import __version__
from .schemas import CheckRequest, CheckResponse

NOT_WIRED = "规则包与模型尚未接入（T02 骨架），结论恒为空。"


def create_app() -> FastAPI:
    app = FastAPI(title="Xingtu AI", version=__version__)

    @app.get("/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/v1/config/check", response_model=CheckResponse)
    def config_check(request: CheckRequest) -> CheckResponse:
        return CheckResponse(
            mode=request.mode,
            catalogVersion=None,
            degraded=True,
            findings=[],
            missingInfo=[NOT_WIRED],
            notices=[f"收到 {len(request.files)} 份配置，仅校验请求结构"],
        )

    return app


app = create_app()
