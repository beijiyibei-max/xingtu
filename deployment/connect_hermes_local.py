"""Prepare a separate advice-only Hermes profile; never print or ship credentials."""
import argparse
import os
from pathlib import Path
import secrets
import yaml
from dotenv import dotenv_values


def prepare(home, destination):
    config = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    if config.get("model", {}).get("provider") != "deepseek":
        raise ValueError("当前一键连接支持已安装的 DeepSeek Hermes，请先核对其他模型的配置")
    environment = dotenv_values(home / ".env")
    if not environment.get("DEEPSEEK_API_KEY"):
        raise ValueError("Hermes 模型密钥尚未配置")
    destination.mkdir(parents=True, exist_ok=True)
    key_file = destination / "api-key.txt"
    if not key_file.exists():
        key_file.write_text(secrets.token_urlsafe(36), encoding="utf-8")
    settings = {
        "model": config["model"],
        "platform_toolsets": {"api_server": []},
        "mcp_servers": {},
        "memory": {"memory_enabled": False, "user_profile_enabled": False},
        "agent": {"max_turns": 2},
    }
    (destination / "config.yaml").write_text(yaml.safe_dump(settings, allow_unicode=True), encoding="utf-8")
    (destination / "SOUL.md").write_text("你是星图部署问答助手，只根据本次请求的通用步骤知识回答，不调用工具。", encoding="utf-8")
    values = {key: environment[key] for key in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL") if environment.get(key)}
    values.update(API_SERVER_ENABLED="true", API_SERVER_KEY=key_file.read_text().strip(),
                  API_SERVER_HOST="127.0.0.1", API_SERVER_PORT="8643")
    lines = []
    for name, value in values.items():
        if "\n" in value or "\r" in value:
            raise ValueError("模型配置含不支持的换行，请检查本机配置")
        lines.append(name + "='" + value.replace("\\", "\\\\").replace("'", "\\'") + "'")
    (destination / ".env").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("独立问答配置已准备：仅本机 8643，工具与记忆关闭；原 Hermes 配置未修改。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    prepare(args.home, args.destination)
