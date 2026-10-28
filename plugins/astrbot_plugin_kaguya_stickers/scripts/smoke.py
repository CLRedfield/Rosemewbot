"""Optional live-model check with an isolated catalog and mocked QQ delivery.

Uses one explicitly selected, already configured provider. Never sends QQ messages.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import shutil
import sys
import tempfile
from collections import Counter
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


class IsolatedEvent:
    def __init__(self, session):
        self.unified_msg_origin = "kaguya-smoke:FriendMessage:" + session
        self.extra = {}
        self.send = AsyncMock()
        self.response = None

    def get_extra(self, key, default=None):
        return self.extra.get(key, default)

    def set_extra(self, key, value):
        self.extra[key] = value

    def get_platform_name(self):
        return "aiocqhttp"

    def get_result(self):
        return self.response


async def run(args, isolated):
    from openai import AsyncOpenAI
    from astrbot.core.provider.register import llm_tools
    from astrbot_plugin_kaguya_stickers import main
    from astrbot_plugin_kaguya_stickers.catalog import inspect_image
    from astrbot.core.message.message_event_result import MessageEventResult, ResultContentType

    data = Path(args.data_root)
    config = json.loads((data / "cmd_config.json").read_text(encoding="utf-8-sig"))
    persona = json.loads(Path(args.persona).read_text(encoding="utf-8"))
    provider = next(p for p in config["provider"] if p["id"] == args.provider and p.get("enable"))
    source = next(s for s in config["provider_sources"] if s["id"] == provider["provider_source_id"])
    key = source["key"][0] if isinstance(source["key"], list) else source["key"]
    shutil.copytree(data / "plugin_data" / "astrbot_plugin_kaguya_stickers",
                    Path(isolated) / "astrbot_plugin_kaguya_stickers")
    context = MagicMock()
    context.get_config.return_value = config
    context.persona_manager.resolve_selected_persona = AsyncMock(return_value=(main.PERSONA, persona, None, False))
    with patch.object(main, "get_astrbot_plugin_data_path", return_value=isolated):
        plugin = main.KaguyaStickersPlugin(context)
    # Exercise the real local selection/sending functions; online discovery has separate tests.
    plugin._find_online = AsyncMock(return_value="本次隔离验证使用已有素材。")
    counts = Counter(i["pack_id"] or i["source"] for i in plugin.catalog.items.values())
    animated = 0
    for item in plugin.catalog.items.values():
        blob = plugin.catalog.file_for(item).read_bytes()
        assert hashlib.sha256(blob).hexdigest() == item["sha256"]
        info = inspect_image(blob)
        assert all(item[k] == info[k] for k in ("width", "height", "frames"))
        animated += info["frames"] > 1
    print("ASSETS", json.dumps(dict(counts), ensure_ascii=False), "animated=" + str(animated), flush=True)
    tools = [t for t in llm_tools.get_func_desc_openai_style() if t["function"]["name"] in main.TOOLS]
    assert len(tools) == 2
    cases = [
        ("happy", "辉夜，今天终于把项目做完啦！", "reaction"),
        ("curious", "诶？刚刚发生什么了，我完全没看懂。", "reaction"),
        ("affection", "辉夜，好想你，抱抱我嘛。", "reaction"),
        ("tired", "今天累趴了，先让我躺一会儿。", "reaction"),
        ("image-only", "给我一张超时空辉夜姬开心表情，只要图。", "image"),
        ("caption", "用卡拉彼丘表情配一句短话，祝我项目终于完工。", "caption"),
        ("text", "Python 列表和元组的主要区别是什么？只用文字，简短说。", "text"),
    ]
    if args.casual:
        cases = [
            ("group-review", "评价一下那个总拿隔壁机器人和你比的群友。", "reaction"),
            ("tease", "听说隔壁比你可爱哦。", "reaction"),
            ("guess", "猜猜我今天最想见谁。", "reaction"),
            ("boast", "哟，这么有自信啊？", "reaction"),
            ("praise", "辉夜今天超厉害！", "reaction"),
            ("miss", "刚回来，你有没有想我呀。", "reaction"),
            ("huh", "啊？你刚刚说啥？", "reaction"),
            ("tired", "累了，过来陪我趴一会。", "reaction"),
            ("show", "你能发表情吗？", "reaction"),
            ("image-only", "来一张辉夜开心的图，不要配文。", "image"),
            ("technical", "Python 字典怎么读取不存在的键并提供默认值？简短解释。", "text"),
            ("no-image", "今天好开心，夸我一句，这次只用文字，别发图。", "text"),
            ("literal", "解释一下 😏 这个表情是什么意思，保留原符号方便对照。", "text"),
        ]
    history = [
        {"role": "user", "content": "辉夜在吗？"},
        {"role": "assistant", "content": "辉夜一直在线啦，彩叶是不是偷偷想我了？😏"},
        {"role": "user", "content": "有人夸隔壁机器人可爱。"},
        {"role": "assistant", "content": "论可爱程度是排不到我前面的，不过彩叶可不能冷落我哦！😌"},
        {"role": "user", "content": "你可真自信。"},
        {"role": "assistant", "content": "哼哼，那是当然，彩叶的眼光可是很好的！😎"},
        {"role": "user", "content": "来点反应嘛。"},
        {"role": "assistant", "content": "嘿嘿，是不是又想看我撒娇了？🥰"},
    ] if args.casual else []
    semaphore = asyncio.Semaphore(3)
    async with AsyncOpenAI(api_key=key, base_url=source["api_base"], timeout=45, max_retries=0) as client:
        async def check(name, prompt, expected):
            async with semaphore:
                event = IsolatedEvent(name)
                event.message_str = prompt
                req = SimpleNamespace(conversation=None, func_tool=MagicMock(), system_prompt=persona["system_prompt"], prompt=prompt, contexts=history)
                with patch.object(main, "SkillManager") as manager:
                    manager.return_value.list_skills.return_value = [SimpleNamespace(name=main.SKILL)]
                    await plugin.prepare(event, req)
                messages = [{"role": "system", "content": req.system_prompt}, *req.contexts, {"role": "user", "content": prompt}]
                calls = []
                visible_intermediate = []
                for step in range(5):
                    completion = await client.chat.completions.create(
                        model=provider["model"], messages=messages, tools=tools,
                        max_tokens=1200, temperature=0.5 if args.casual else 0.2, extra_body=provider.get("custom_extra_body") or {})
                    answer = completion.choices[0].message
                    if answer.tool_calls:
                        if answer.content:
                            event.response = MessageEventResult(chain=[main.Plain(answer.content)], result_content_type=ResultContentType.LLM_RESULT)
                            await plugin.suppress_decorated_followup(event)
                            visible_intermediate.append(event.response.get_plain_text())
                        messages.append(answer.model_dump(exclude_none=True))
                        for call in answer.tool_calls:
                            arguments = json.loads(call.function.arguments)
                            calls.append({"name": call.function.name, "arguments": arguments})
                            handler = {"kaguya_find_sticker": plugin.find_sticker, "kaguya_send_sticker": plugin.send_sticker}[call.function.name]
                            tool_result = await handler(event, **arguments)
                            messages.append({"role": "tool", "tool_call_id": call.id, "content": tool_result})
                    else:
                        response = SimpleNamespace(completion_text=answer.content or "", result_chain=None, reasoning_content="")
                        await plugin.suppress_followup(event, response)
                        event.response = MessageEventResult(chain=[main.Plain(response.completion_text)], result_content_type=ResultContentType.LLM_RESULT)
                        await plugin.suppress_decorated_followup(event)
                        sent_id = event.get_extra(main.SENT)
                        delivered = [call.args[0].chain for call in event.send.await_args_list]
                        chain = [component for message in delivered for component in message]
                        captions = [c.text for c in chain if isinstance(c, main.Plain)]
                        assert event.send.await_count <= 2, name
                        assert sum(isinstance(c, main.Image) for c in chain) <= 1, name
                        if sent_id:
                            expected_types = [[main.Plain], [main.Image]] if captions else [[main.Image]]
                            assert [[type(c) for c in message] for message in delivered] == expected_types, name
                        if expected == "text":
                            assert not chain and response.completion_text, name
                        elif expected == "image":
                            assert sent_id and not captions and not response.completion_text, name
                        elif expected == "caption":
                            assert sent_id and captions and not response.completion_text, name
                        report = {"case": name, "sent": bool(sent_id),
                                  "source": plugin.catalog.items[sent_id]["source"] if sent_id else None,
                                  "sticker": plugin.catalog.items[sent_id]["name"] if sent_id else None,
                                  "caption": captions, "text": event.response.get_plain_text(), "calls": calls,
                                  "message_types": [[type(c).__name__ for c in message] for message in delivered],
                                  "intermediate": [t for t in visible_intermediate if t]}
                        print("CASE", json.dumps(report, ensure_ascii=False), flush=True)
                        return report
                raise AssertionError(name + ": model did not finish within five steps")
        reports = await asyncio.gather(*(check(*case) for case in cases))
    reactions = reports[:9] if args.casual else reports[:4]
    if not args.casual:
        assert {r["source"] for r in reactions if r["sent"]} == {"strinova", "kaguya"}, "Both sources should be used proactively"
    if args.report:
        Path(args.report).write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    print("REACTION_STICKERS", sum(r["sent"] for r in reactions), "/", len(reactions), flush=True)
    print("SMOKE_OK", len(reports), flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--persona", required=True, help="Saved persona.after.json from installation")
    parser.add_argument("--provider", required=True, help="ID of an existing enabled provider")
    parser.add_argument("--casual", action="store_true", help="Replay banter with an emoji-heavy old history")
    parser.add_argument("--report", help="Save test outputs without provider credentials")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="kaguya-smoke-") as isolated:
        os.environ["ASTRBOT_ROOT"] = str(Path(isolated) / "runtime")
        asyncio.run(run(args, isolated))
