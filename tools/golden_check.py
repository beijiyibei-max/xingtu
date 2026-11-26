#!/usr/bin/env python3
"""golden set 校验（任务 T01）。

只校验三件事：manifest 结构、样本原件存在且 sha256 对得上、标注卡必填项齐全。
**不校验答案对不对** —— 答案由人签字，AI 不许自签。

零依赖：只用标准库。门禁脚本不许依赖第三方包，否则就是第二个 rfc8785 事故
（契约校验器缺 rfc8785 时整条门禁静默失效，AI 会以为过了）。

用法：
  python tools/golden_check.py            # 日常：报进度；有错误才退出 1
  python tools/golden_check.py --strict   # 验收：5/5 ready 且 5/5 confirmed 才退出 0
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
GOLD = TOOLS / "golden"
MANIFEST = GOLD / "manifest.json"
LOCAL = GOLD / "fixtures.local.json"

EXPECTED_IDS = ["G-01", "G-02", "G-03", "G-04", "G-05"]
REQUIRED_CASE_FIELDS = [
    "id",
    "type",
    "source_ref",
    "expected_top1",
    "evidence_anchor",
    "false_positive_trap",
    "judge_command",
]


def read_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    # 输出常被管道捕获（hermes / CI）。Windows 默认 GBK，遇到非 GBK 字符会直接崩，
    # 让门禁看起来是"代码坏了"。这里统一按 UTF-8 输出，输出不了的字符替换掉即可。
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="校验 golden set")
    parser.add_argument("--strict", action="store_true", help="5/5 ready 且 5/5 confirmed 才算通过")
    args = parser.parse_args()

    errors: list[str] = []
    pending: list[str] = []
    todo: list[str] = []

    if not MANIFEST.exists():
        print(f"ERROR manifest 不存在: {MANIFEST}")
        return 1

    manifest = read_json(MANIFEST)
    cases = manifest.get("cases", [])
    ids = [c.get("id") for c in cases]

    if ids != EXPECTED_IDS:
        errors.append(f"manifest 用例不是 {EXPECTED_IDS}，实际 {ids}")

    local: dict = {}
    if LOCAL.exists():
        try:
            local = read_json(LOCAL)
        except json.JSONDecodeError as exc:
            errors.append(f"fixtures.local.json 解析失败: {exc}")
    else:
        todo.append("缺 fixtures.local.json（本地映射，不入仓）：样本路径与 sha256 无从校验")

    ready = confirmed = 0
    print(f"{'ID':<5} {'类型':<6} {'状态':<8} 说明")
    print("-" * 78)

    for case in cases:
        case_id = case.get("id", "?")
        status = case.get("status", "")
        kind = case.get("type", "")
        notes: list[str] = []

        case_path = GOLD / str(case.get("case", ""))
        if not case_path.exists():
            errors.append(f"{case_id}: 标注卡不存在 {case_path}")
            print(f"{case_id:<5} {kind:<6} {status:<8} 标注卡缺失")
            continue

        card = read_json(case_path)
        if card.get("id") != case_id:
            errors.append(f"{case_id}: 标注卡 id 不一致（{card.get('id')}）")

        if status == "pending":
            pending.append(f"{case_id}: {case.get('blocked_by', '未写 blocked_by')}")
            print(f"{case_id:<5} {kind:<6} {status:<8} 待原件 —— {case.get('blocked_by', '未写原因')}")
            continue

        if status != "ready":
            errors.append(f"{case_id}: status 只能是 ready / pending，实际 {status!r}")
            continue

        ready += 1

        for field in REQUIRED_CASE_FIELDS:
            if not str(card.get(field, "")).strip():
                errors.append(f"{case_id}: 标注卡缺 {field}")

        ref = case.get("fixture_ref")
        entry = local.get(ref) if ref else None
        if not entry:
            errors.append(f"{case_id}: fixtures.local.json 里没有 {ref} 的路径")
        else:
            fixture = Path(entry["path"])
            if not fixture.exists():
                errors.append(f"{case_id}: 原件不存在 {fixture}")
            else:
                actual = sha256_of(fixture)
                if entry.get("sha256") and actual != entry["sha256"]:
                    errors.append(f"{case_id}: sha256 不符，原件被改过（期望 {entry['sha256'][:12]}…，实际 {actual[:12]}…）")
                else:
                    notes.append("原件ok sha256ok")

        if card.get("confirmed") is True and str(card.get("confirmed_by", "")).strip():
            confirmed += 1
            notes.append("已签字")
        else:
            todo.append(f"{case_id}: 待你确认 expected_top1 并填 confirmed_by（AI 不许自签）")

        print(f"{case_id:<5} {kind:<6} {status:<8} {' · '.join(notes) or '—'}")

    print("-" * 78)
    for item in pending:
        print(f"待原件  {item}")
    for item in todo:
        print(f"待办    {item}")
    for item in errors:
        print(f"错误    {item}")

    schema = "ok" if not errors else f"ERROR({len(errors)})"
    print()
    print(f"golden: {ready}/5 ready, {confirmed}/5 confirmed, schema {schema}")

    if errors:
        return 1
    if args.strict and (ready != 5 or confirmed != 5):
        print("--strict 未通过：要求 5/5 ready 且 5/5 confirmed")
        return 1
    if not args.strict:
        print("（非 strict 模式：骨架可用，剩余待原件/待签字）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
