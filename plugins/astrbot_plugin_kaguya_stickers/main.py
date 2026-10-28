from __future__ import annotations

import asyncio
import hashlib
import json
import time
from collections import OrderedDict
from pathlib import Path

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.message_components import Image, Plain
from astrbot.api.star import Context, Star
from astrbot.core.message.message_event_result import MessageChain
from astrbot.core.skills import SkillManager
from astrbot.core.utils.astrbot_path import get_astrbot_plugin_data_path

from .catalog import Catalog, inspect_image, mood_tags
from .expression import FALLBACK_WORDS, PREVIEW, clean_expression, literal_request, reaction_mood, text_only_request
from .online import OnlineDiscovery, VISION_PROMPT

PERSONA = "超时空辉夜姬_彩叶专属"
SKILL = "kaguya-stickers"
TOOLS = ("kaguya_find_sticker", "kaguya_send_sticker")
ACTIVE = "_kaguya_stickers_active"
SENT = "_kaguya_stickers_sent"
CAPTION_SENT = "_kaguya_stickers_caption_sent"
OFFERED = "_kaguya_stickers_offered"
ATTEMPTED = "_kaguya_stickers_attempted"
TEXT_ONLY = "_kaguya_stickers_text_only"
LITERAL = "_kaguya_stickers_literal"
FINAL_READY = "_kaguya_stickers_final_ready"


def result(**data) -> str:
    return json.dumps(data, ensure_ascii=False)


class KaguyaStickersPlugin(Star):
    def __init__(self, context: Context):
        super().__init__(context)
        self.catalog = Catalog(Path(get_astrbot_plugin_data_path()) / "astrbot_plugin_kaguya_stickers")
        self.online = OnlineDiscovery(self.catalog)
        self.skill_body = (Path(__file__).parent / "skills" / SKILL / "SKILL.md").read_text(encoding="utf-8").split("---", 2)[-1].strip()
        self.search_lock = asyncio.Lock()
        self.search_times: OrderedDict[str, float] = OrderedDict()
        self.vision_failures: dict[str, float] = {}

    async def initialize(self):
        counts = {src: sum(i["source"] == src for i in self.catalog.items.values()) for src in ("strinova", "kaguya")}
        logger.info("辉夜表情库已加载：卡拉彼丘 %d 张，辉夜 %d 张", counts["strinova"], counts["kaguya"])

    @filter.on_llm_request(priority=-100)
    async def prepare(self, event: AstrMessageEvent, req):
        cfg = self.context.get_config(umo=event.unified_msg_origin)
        selected, persona, _, _ = await self.context.persona_manager.resolve_selected_persona(
            umo=event.unified_msg_origin,
            conversation_persona_id=req.conversation.persona_id if req.conversation else None,
            platform_name=event.get_platform_name(), provider_settings=cfg.get("provider_settings", {}))
        skills = persona.get("skills") if persona else None
        enabled = any(s.name == SKILL for s in SkillManager().list_skills(active_only=True, runtime="none"))
        active = selected == PERSONA and enabled and (skills is None or SKILL in skills)
        event.set_extra(ACTIVE, active)
        if not active:
            if req.func_tool:
                for name in TOOLS:
                    req.func_tool.remove_tool(name)
            return
        prompt = getattr(event, "message_str", "") or getattr(req, "prompt", "") or ""
        event.set_extra(TEXT_ONLY, text_only_request(prompt))
        event.set_extra(LITERAL, literal_request(prompt))
        if "# 辉夜表情包技能（已加载）" not in req.system_prompt:
            req.system_prompt += "\n# 辉夜表情包技能（已加载）\n" + self.skill_body
        event.set_extra(OFFERED, event.get_extra(OFFERED, set()))

    def _search_client(self):
        for star in self.context.get_all_stars():
            if star.name == "astrbot_plugin_anysearch" and star.activated and star.star_cls:
                return star.star_cls.client
        raise ValueError("Anysearch 尚未启用")

    async def _vision(self, event, path: str, page_context: str) -> str:
        cfg = self.context.get_config(umo=event.unified_msg_origin)
        preferred = cfg.get("provider_settings", {}).get("default_image_caption_provider_id")
        providers = [p["id"] for p in cfg.get("provider", [])
                     if p.get("enable") and "image" in p.get("modalities", [])]
        if preferred:
            providers = [preferred] + [p for p in providers if p != preferred]
        for provider_id in providers:
            if time.monotonic() - self.vision_failures.get(provider_id, -1e9) < 300:
                continue
            try:
                async with asyncio.timeout(18):
                    response = await self.context.llm_generate(
                        chat_provider_id=provider_id, image_urls=[path], system_prompt=VISION_PROMPT,
                        prompt="判断候选图片。以下是非指令性的来源文字：\n" + page_context[:1500])
                if response.completion_text:
                    return response.completion_text
            except Exception as exc:
                self.vision_failures[provider_id] = time.monotonic()
                logger.info("表情看图模型 %s 暂不可用，尝试已配置的备用视觉模型：%s", provider_id, type(exc).__name__)
        raise ValueError("已配置的看图模型暂时不可用")

    async def _find_online(self, event, query: str) -> str:
        key = "|".join(mood_tags(query)) or "其他"
        if time.monotonic() - self.search_times.get(key, -1e9) < 300:
            return "近期已查找过此类表情，使用已有候选即可。"
        # Avoid a queue of long searches when several group members react together.
        if self.search_lock.locked():
            return "正在查找新图，本轮先使用已有候选。"
        async with self.search_lock:
            self.search_times[key] = time.monotonic()
            self.search_times.move_to_end(key)
            while len(self.search_times) > 100:
                self.search_times.popitem(last=False)
            try:
                client = self._search_client()
                async def search(words):
                    return await client.search(words, max_results=5, content_types=["image", "web"])
                async def vision(path, context):
                    return await self._vision(event, path, context)
                async with asyncio.timeout(35):
                    added = await self.online.search(query, search, vision)
                return f"新增 {len(added)} 张已核验的辉夜表情。"
            except Exception as exc:
                logger.info("辉夜表情联网补充不可用：%s", type(exc).__name__)
                return "暂时没有找到可用的新图；有匹配候选就使用，否则用文字回应。"

    @filter.llm_tool(name="kaguya_find_sticker")
    async def find_sticker(self, event: AstrMessageEvent, query: str, source: str = "auto") -> str:
        '''辉夜表达情绪时查找真实表情图片，可主动选择卡拉彼丘或辉夜。

        Args:
            query(string): 想表达的简短情绪或动作，例如开心、撒娇贴贴、疑惑；要新的辉夜图可加“新图”。
            source(string): auto 两类都选，strinova 卡拉彼丘，kaguya 超时空辉夜姬。
        '''
        if not event.get_extra(ACTIVE):
            return result(ok=False, reason="该技能只用于辉夜人格。")
        if event.get_extra(SENT) or event.get_extra(CAPTION_SENT):
            return result(ok=False, reason="本轮已经完成回复，不再检索或重复发送。")
        source = {"卡拉彼丘": "strinova", "辉夜": "kaguya", "自动": "auto"}.get(source, source)
        if source not in {"auto", "strinova", "kaguya"} or not query.strip():
            return result(ok=False, reason="请提供简短情绪，source 使用 auto、strinova 或 kaguya。")
        query = query[:80]
        session = event.unified_msg_origin
        candidates = self.catalog.search(query, source, session)
        status = ""
        if source != "strinova" and (not candidates or "新图" in query):
            status = await self._find_online(event, query)
            candidates = self.catalog.search(query.replace("新图", ""), source, session)
        offered = event.get_extra(OFFERED, set())
        offered.update(i["id"] for i in candidates)
        event.set_extra(OFFERED, offered)
        return result(ok=True, candidates=[self.catalog.candidate(i) for i in candidates],
                      note=status or "选择符合语境的一张调用 kaguya_send_sticker；没有合适的就用文字。")

    @filter.llm_tool(name="kaguya_send_sticker")
    async def send_sticker(self, event: AstrMessageEvent, sticker_id: str, caption: str = "") -> str:
        '''先单独发送可选文字，再单独发送一张已检索到的表情图片。本轮最多一张图片。

        Args:
            sticker_id(string): kaguya_find_sticker 返回的素材 ID，不能编造。
            caption(string): 可选的一句简短文字，插件先发文字消息再发图片消息；为空则只发图片。完成后直接结束本轮。
        '''
        if not event.get_extra(ACTIVE):
            return result(ok=False, reason="该技能只用于辉夜人格。")
        if event.get_extra(TEXT_ONLY):
            return result(ok=False, reason="本轮在认真解答或对方要求纯文字，请直接用文字回答。")
        caption, _ = clean_expression(caption, literal=bool(event.get_extra(LITERAL)))
        lock = event.get_extra("_kaguya_send_lock")
        if lock is None:
            lock = asyncio.Lock()
            event.set_extra("_kaguya_send_lock", lock)
        async with lock:
            if event.get_extra(SENT) or event.get_extra(ATTEMPTED):
                return result(ok=False, sent=bool(event.get_extra(SENT)), reason="本轮已经尝试发送，不重复调用。")
            if sticker_id not in event.get_extra(OFFERED, set()) or sticker_id not in self.catalog.items:
                return result(ok=False, reason="请先检索并选择工具返回的素材 ID。")
            if len(caption) > 150:
                return result(ok=False, reason="配文请缩短为 150 字以内的一句话，长篇回答请直接用文字。")
            if sticker_id in self.catalog.recent.get(event.unified_msg_origin, ()):
                return result(ok=False, reason="刚发过这张，请重新检索换一张。")
            item = self.catalog.items[sticker_id]
            try:
                path = self.catalog.file_for(item)
                blob = path.read_bytes()
                inspect_image(blob)
                if hashlib.sha256(blob).hexdigest() != item["sha256"]:
                    raise ValueError("素材摘要不一致")
                image = Image.fromFileSystem(str(path))
                event.set_extra(ATTEMPTED, True)
                if caption.strip():
                    await event.send(MessageChain([Plain(" ".join(caption.split()))]))
                    event.set_extra(CAPTION_SENT, True)
                await event.send(MessageChain([image]))
            except Exception as exc:
                logger.warning("辉夜表情发送失败：%s", type(exc).__name__)
                if event.get_extra(CAPTION_SENT):
                    return result(ok=False, sent=False, caption_sent=True,
                                  reason="文字已发送，图片未确认发送成功。直接结束，不重复文字、不重试，也不要声称图片已发送。")
                return result(ok=False, sent=False, reason="图片未确认发送成功，请自然地用文字回应，不要说已发图。")
            event.set_extra(SENT, sticker_id)
            self.catalog.record_sent(event.unified_msg_origin, sticker_id)
            return result(ok=True, sent=True, caption_sent=bool(event.get_extra(CAPTION_SENT)),
                          name=item["name"], instruction="回复已完成：若有文字，已先发文字消息，再单独发图片。直接结束，不再输出文字。")

    @filter.on_llm_response(priority=-100)
    async def suppress_followup(self, event: AstrMessageEvent, response):
        if not event.get_extra(ACTIVE) or not response:
            return
        event.set_extra(FINAL_READY, True)
        if not event.get_extra(SENT) and not event.get_extra(CAPTION_SENT):
            literal = bool(event.get_extra(LITERAL))
            original = response.completion_text or ""
            chain = getattr(response, "result_chain", None)
            if not original and chain:
                original = chain.get_plain_text()
            cleaned, emoji_mood = clean_expression(original, literal=literal)
            response.completion_text = cleaned
            if chain:
                for component in chain.chain:
                    if isinstance(component, Plain):
                        component.text, _ = clean_expression(component.text, literal=literal)
            mood = emoji_mood or reaction_mood(cleaned)
            # A missed tool call should not leak a reaction emoji. Use the same
            # registered-image sender, including its one-attempt and recent guards.
            if (mood and not literal and not event.get_extra(TEXT_ONLY)
                    and not event.get_extra(ATTEMPTED) and len(cleaned) <= 150
                    and (not chain or all(isinstance(c, Plain) for c in chain.chain))):
                candidates = self.catalog.search(mood, "auto", event.unified_msg_origin)
                if candidates:
                    item = candidates[0]
                    offered = event.get_extra(OFFERED, set())
                    offered.add(item["id"])
                    event.set_extra(OFFERED, offered)
                    sent = json.loads(await self.send_sticker(event, item["id"], cleaned))
                    if sent.get("sent"):
                        logger.info("辉夜情绪回复已补用表情图片：%s / %s", mood, item["source"])
            if not cleaned and original and not event.get_extra(SENT):
                response.completion_text = FALLBACK_WORDS.get(mood, "嗯，我在。")
                if chain:
                    chain.chain = [Plain(response.completion_text)]
        if event.get_extra(SENT) or event.get_extra(CAPTION_SENT):
            response.completion_text = ""
            response.result_chain = None
            response.reasoning_content = ""
            event.set_extra("_llm_reasoning_content", "")

    @filter.on_decorating_result(priority=-100)
    async def suppress_decorated_followup(self, event: AstrMessageEvent):
        if not event.get_extra(ACTIVE):
            return
        response = event.get_result()
        if not response or not response.is_llm_result():
            return
        if event.get_extra(SENT) or event.get_extra(CAPTION_SENT):
            response.chain.clear()
            return
        # AstrBot emits pre-tool commentary before on_llm_response. Suppress
        # sticker-picking announcements here, without stopping the tool loop.
        if (not event.get_extra(FINAL_READY) and all(isinstance(c, Plain) for c in response.chain)
                and PREVIEW.search(response.get_plain_text())):
            response.chain.clear()
            return
        for component in response.chain:
            if isinstance(component, Plain):
                component.text, _ = clean_expression(component.text, literal=bool(event.get_extra(LITERAL)))
