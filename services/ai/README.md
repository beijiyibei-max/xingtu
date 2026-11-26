# 星图 AI 服务（T02 骨架）

配置体检、日志归因、知识问答的 Python 侧实现。**只读文本、给结论、给依据**；不执行命令、不持有集群凭据。

## 运行

```bash
python -m pip install -r services/ai/requirements.txt
cd services/ai && python -m uvicorn app.main:app --port 8100
curl http://127.0.0.1:8100/health          # → {"ok":true}
```

## 测试

```bash
pytest services/ai/tests -q                # 仓根执行
```

## 当前状态（T02）

| 项 | 状态 |
|---|---|
| `GET /health` | 可用 |
| `POST /v1/config/check` | 结构合法、**结论恒为空**，`degraded=true` 且 `missingInfo` 明说规则未接入 |
| 规则包 / 模型 | 未接入（T04、T07） |

空结果不是敷衍：前端、契约、校验链路先固定下来，后面补实现时不改结构。

## 契约（不可协商）

结论分两层，由 `app/schemas.py::Finding` 在**校验期**强制：

- **事实层** `kind=fact`：必须带 `locator.file + locator.line`，否则抛 `ValidationError`；
- **推断层** `kind=inference`：必须至少引用一条事实（`basis` 非空）并给出 `confidence`。

违反的结论进不了响应。这是「无据不出结论」的落地位置——靠类型，不靠提示词。

## 依赖边界

只允许 `fastapi`、`uvicorn`、`pydantic`、`httpx`、`jsonschema`、`rfc8785`。
禁止 LangChain / LlamaIndex / ORM；存储用 SQLite（`sqlite3` + FTS5 + `sqlite-vec`），不引 PostgreSQL、不引 Redis。
