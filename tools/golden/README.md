# tools/golden · 评测集

T01 的产物。用途：给后面 17 个会话一把尺子——没有它，"Top1 命中率 ≥70%" 是无意义的数字。

## 结构

```
tools/golden/
  manifest.json          5 条用例清单（进仓）
  cases/G-0X.json        标注卡，人填（进仓）
  fixtures.local.json    原件绝对路径 + sha256（**不进仓**）
  *.log / *.yaml         样本原件（**不进仓**，.gitignore 的 *.log 已覆盖）
```

客户日志原文一律不进仓：`*.log` 已被 `.gitignore` 排除，`fixtures.local.json` 也单独排除。

## 加一条用例

1. 原件放哪都行（建议与复盘记录放一起），算出 sha256：
   `sha256sum <原件>`
2. 在 `fixtures.local.json` 加 `{"G-0X": {"path": "...", "bytes": N, "sha256": "..."}}`
3. 在 `manifest.json` 把该条的 `status` 改成 `ready`
4. 填 `cases/G-0X.json`：`evidence_anchor` 必须用 `grep -n` 核过行号
5. `python tools/golden_check.py` → 该条显示 `原件✓ sha256✓`

## 两条规矩

- **`confirmed: true` 只能由人填**，并写 `confirmed_by`。AI 自签等于这条用例作废。
- 原件被改动（换行符、截断、脱敏）会让 sha256 失配——这是故意的，样本必须是稳定输入。

## 基线

先测"无 AI"基线（人 + 现有判据），再测加 AI 后。`--strict` 模式只用于 T18 收口验收。
