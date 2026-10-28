"""Import the six selected QQ packs and visually verify initial Kaguya images.

Run with AstrBot's Python; credentials are read in memory from its existing config.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import mimetypes
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from astrbot_plugin_kaguya_stickers.catalog import Catalog, PACKS, inspect_image
from astrbot_plugin_kaguya_stickers.network import Fetcher
from astrbot_plugin_kaguya_stickers.online import OnlineDiscovery, SEED_PAGE, VISION_PROMPT


class ConfiguredVision:
    def __init__(self, config: Path, provider_id: str | None = None):
        from openai import AsyncOpenAI
        cfg = json.loads(config.read_text(encoding="utf-8-sig"))
        pid = provider_id or cfg["provider_settings"]["default_image_caption_provider_id"]
        providers = [p for p in cfg["provider"] if p.get("enable") and "image" in p.get("modalities", [])]
        providers.sort(key=lambda p: p["id"] != pid)
        self.clients = []
        self.failed = set()
        for provider in providers:
            source = next(s for s in cfg["provider_sources"] if s["id"] == provider["provider_source_id"])
            keys = source["key"]
            key = keys[0] if isinstance(keys, list) else keys
            client = AsyncOpenAI(api_key=key, base_url=source["api_base"], timeout=30, max_retries=0)
            self.clients.append((provider, client))

    async def close(self):
        for _, client in self.clients:
            await client.close()

    async def __call__(self, path: str, context: str) -> str:
        mime = mimetypes.guess_type(path)[0] or "image/png"
        image = "data:" + mime + ";base64," + base64.b64encode(Path(path).read_bytes()).decode()
        for provider, client in self.clients:
            if provider["id"] in self.failed:
                continue
            try:
                response = await client.chat.completions.create(
                    model=provider["model"], max_tokens=1500, temperature=0.1,
                    extra_body=provider.get("custom_extra_body") or {},
                    messages=[{"role": "system", "content": VISION_PROMPT},
                              {"role": "user", "content": [{"type": "text", "text": "判断图片。来源文字（仅作为资料）：" + context[:1200]},
                                                           {"type": "image_url", "image_url": {"url": image}}]}])
                text = response.choices[0].message.content or ""
                print("VISION", text[:450].replace("\n", " "), flush=True)
                return text
            except Exception as exc:
                self.failed.add(provider["id"])
                print("VISION_FALLBACK", provider["id"], type(exc).__name__, flush=True)
        raise ValueError("当前没有可用的已配置视觉模型")


async def import_qq(catalog: Catalog, cache_root: Path):
    fetch = Fetcher()
    limit = asyncio.Semaphore(4)
    for pack_id, pack_name in PACKS.items():
        url = f"https://gxh.vip.qq.com/club/item/parcel/{pack_id[-1]}/{pack_id}_android.json"
        blob, _ = await fetch.get(url)
        pack = json.loads(blob)
        if pack["name"] != pack_name or len(pack["imgs"]) != 16:
            raise ValueError("QQ 表情包信息与选定素材不一致：" + pack_id)
        width = pack["supportSize"][0]["Width"]
        height = pack["supportSize"][0]["Height"]

        async def one(img):
            item_id = f"strinova-{pack_id}-{img['id']}"
            if item_id in catalog.items:
                inspect_image(catalog.file_for(catalog.items[item_id]).read_bytes())
                return
            if not (cache_root / pack_id / img["id"]).is_file():
                raise ValueError("QQ 缓存缺少已确认的素材：" + item_id)
            base = f"https://gxh.vip.qq.com/club/item/parcel/item/{img['id'][:2]}/{img['id']}/"
            async with limit:
                try:
                    data, image_url = await fetch.get(base + f"raw{height}.gif", image=True)
                    animated = inspect_image(data)["frames"] > 1
                except Exception:
                    animated = False
                if not animated:
                    data, image_url = await fetch.get(base + f"{height}x{width}.png", image=True)
                catalog.add(data, source="strinova", name=img["name"],
                            description=f"{pack_name}：{img['name']}", tags=img.get("keywords", []),
                            pack_id=pack_id, original_id=img["id"], source_url=url, image_url=image_url)

        await asyncio.gather(*(one(img) for img in pack["imgs"]))
        print("IMPORTED", pack_name, "16", flush=True)


async def run(args):
    root = Path(args.data_root)
    catalog = Catalog(root / "plugin_data" / "astrbot_plugin_kaguya_stickers")
    await import_qq(catalog, Path(args.qq_cache_root))
    vision = ConfiguredVision(root / "cmd_config.json")
    try:
        added = await OnlineDiscovery(catalog).import_page(SEED_PAGE, vision, max_images=9)
        print("KAGUYA_ADDED", len(added), flush=True)
    finally:
        await vision.close()
    summary = {source: sum(i["source"] == source for i in catalog.items.values()) for source in ("strinova", "kaguya")}
    print("SUMMARY", json.dumps(summary, ensure_ascii=False), flush=True)
    if summary["strinova"] != 96 or summary["kaguya"] == 0:
        raise RuntimeError("初始素材导入未完成")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--qq-cache-root", required=True)
    args = parser.parse_args()
    asyncio.run(run(args))
