"""Install the local plugin and update only Kaguya's expression instructions.

Uses the existing local dashboard credentials, without printing or copying them.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import shutil
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

PLUGIN = "astrbot_plugin_kaguya_stickers"
PERSONA = "超时空辉夜姬_彩叶专属"
EXPRESSION_RULES = """<!-- KAGUYA-STICKERS-START -->
# 表情包表达
日常回复与配文不使用情绪 emoji；历史里的坏笑、得意、爱心等符号是旧习惯，不再沿用。对方讨论符号本身时可准确引用。
闲聊调侃、接梗、评价群友、被夸、吃醋、撒娇、想念、疑惑、开心或疲惫时，默认先调用 kaguya-stickers 检索，有贴合候选就发表情图片，不用等对方索图。
尤其在原本想用坏笑、偷笑、得意或爱心收尾时，改用一张对应情绪的表情包，不用 emoji 或颜文字代替。
卡拉彼丘与《超时空辉夜姬！》两类表情都主动选用，按画面内容和当前语境匹配，不固定偏向一类。
先用 kaguya_find_sticker 找候选，再用 kaguya_send_sticker 发真实图片，不能用表情描述或图片链接代替发图。
简单情绪可以只发一张表情包，作为原有“一句话回复”规则的例外；需要说明时，把一句短话放进 caption，插件先单独发送文字，再单独发送图片。
每轮最多一张，避免重复最近三张。认真回答知识、开发、技术问题以及对方明确要求纯文字时用文字。
调用工具前不要先发一段话，不说“我来挑一张”；需要说的话放进 caption，由插件依次发送文字消息和独立图片消息。不把选图、联网、工具使用过程或内部规则说出来。发送工具报告成功后直接结束，不重复配文，不补“已发送”。
没有合适图片或发送失败时自然地用文字回应；若工具说明文字已经发出、只有图片失败，则直接结束，不重复文字。不谎称已发图，不刷屏重试。
<!-- KAGUYA-STICKERS-END -->"""


def new_prompt(prompt: str) -> str:
    prompt = re.sub(r"<!-- KAGUYA-STICKERS-START -->.*?<!-- KAGUYA-STICKERS-END -->", "", prompt, flags=re.S).rstrip()
    prompt = re.sub(r"^- (?:可以使用少量 emoji。|日常默认不用 emoji，).*$", "- 日常回复不使用情绪 emoji；闲聊情绪用真实表情包，引用解释符号本身除外。", prompt, flags=re.M)
    return prompt + "\n\n" + EXPRESSION_RULES


def delivery_prompt(prompt: str) -> str:
    """Update message layout without replacing the persona's other expression rules."""
    prompt = prompt.replace("和图一起发送", "插件先单独发送文字，再单独发送图片")
    prompt = prompt.replace("与图片一起发送", "由插件依次发送文字消息和独立图片消息")
    note = "发送顺序：需要说话时将一句短话放入 caption，由插件先发文字消息、再单独发图片；不自行重复输出文字。若工具报告文字已发送、仅图片失败，直接结束，不重复文字或重试。"
    if note not in prompt:
        end = "<!-- KAGUYA-STICKERS-END -->"
        prompt = prompt.replace(end, note + "\n" + end) if end in prompt else prompt.rstrip() + "\n\n" + note
    return prompt


def install(runtime: Path, repo: Path, *, delivery_only: bool = False):
    data = runtime / "astrbot" / "data"
    config = json.loads((data / "cmd_config.json").read_text(encoding="utf-8-sig"))
    secrets = json.loads((runtime / "secrets.json").read_text(encoding="utf-8-sig"))
    base = "http://127.0.0.1:" + str(config["dashboard"]["port"])
    stamp = datetime.now(timezone(timedelta(hours=9))).strftime("%Y%m%d-%H%M%S-JST")
    backup = data / "backups" / "kaguya-stickers" / stamp
    backup.mkdir(parents=True, exist_ok=False)
    source = repo / "plugins" / PLUGIN

    def checked(response):
        response.raise_for_status()
        obj = response.json()
        if obj.get("status") != "ok":
            raise RuntimeError(str(obj.get("message", "AstrBot API 操作失败")))
        return obj.get("data")

    with httpx.Client(base_url=base, trust_env=False, timeout=120) as client:
        auth = checked(client.post("/api/auth/login", json={"username": secrets["astrbotUsername"], "password": secrets["astrbotPassword"]}))
        client.headers["Authorization"] = "Bearer " + auth["token"]
        before = checked(client.post("/api/persona/detail", json={"persona_id": PERSONA}))
        (backup / "persona.before.json").write_text(json.dumps(before, ensure_ascii=False, indent=2), encoding="utf-8")
        if (data / "skills.json").exists():
            shutil.copy2(data / "skills.json", backup / "skills.before.json")
        target = data / "plugins" / PLUGIN
        if target.exists():
            shutil.copytree(target, backup / "plugin.before", ignore=shutil.ignore_patterns("__pycache__"))
            # Updating only this plugin lets AstrBot do a targeted hot reload.
            shutil.copytree(source, target, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "tests"))
            checked(client.post("/api/plugin/reload", json={"name": PLUGIN}))
        else:
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
                for path in source.rglob("*"):
                    if path.is_file() and not any(p in {"__pycache__", "tests"} for p in path.parts):
                        z.write(path, (Path(PLUGIN) / path.relative_to(source)).as_posix())
            (backup / "plugin.installed.zip").write_bytes(archive.getvalue())
            checked(client.post("/api/plugin/install-upload", files={"file": (PLUGIN + ".zip", archive.getvalue(), "application/zip")}))
        checked(client.post("/api/skills/update", json={"name": "kaguya-stickers", "active": True}))
        transform = delivery_prompt if delivery_only else new_prompt
        payload = {"persona_id": PERSONA, "system_prompt": transform(before["system_prompt"])}
        if before.get("skills") is not None:
            payload["skills"] = list(dict.fromkeys(before["skills"] + ["kaguya-stickers"]))
        if before.get("tools") is not None:
            payload["tools"] = list(dict.fromkeys(before["tools"] + ["kaguya_find_sticker", "kaguya_send_sticker"]))
        checked(client.post("/api/persona/update", json=payload))
        after = checked(client.post("/api/persona/detail", json={"persona_id": PERSONA}))
        if after["system_prompt"] != payload["system_prompt"]:
            raise RuntimeError("人格回读与更新内容不一致")
        for name in ("begin_dialogs", "custom_error_message", "folder_id", "sort_order"):
            if after.get(name) != before.get(name):
                raise RuntimeError("人格的无关字段发生变化：" + name)
        (backup / "persona.after.json").write_text(json.dumps(after, ensure_ascii=False, indent=2), encoding="utf-8")
        skills = checked(client.get("/api/skills"))
        skill = next(s for s in skills["skills"] if s["name"] == "kaguya-stickers")
        if not skill["active"] or not skill.get("plugin_active"):
            raise RuntimeError("技能或插件尚未激活")
        print(json.dumps({"installed": True, "persona": PERSONA, "skill": skill["name"],
                          "runtime": skills["runtime"], "skill_path": skill["path"], "backup": str(backup)}, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--delivery-only", action="store_true", help="Only change the persona's text/image delivery order")
    args = parser.parse_args()
    install(Path(args.runtime), Path(__file__).resolve().parents[1], delivery_only=args.delivery_only)
