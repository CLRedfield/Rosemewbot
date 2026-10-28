from __future__ import annotations

import hashlib
import io
import json
import os
import re
import unicodedata
from collections import OrderedDict, deque
from pathlib import Path

from PIL import Image, UnidentifiedImageError

PACKS = {
    "235698": "卡丘涂鸦", "235699": "卡丘第1弹", "235700": "卡丘第2弹",
    "235705": "卡丘第3弹", "237514": "卡丘第5弹", "238485": "卡丘第6弹",
}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MOODS = {
    "开心": ("开心", "高兴", "快乐", "好耶", "太好了", "庆祝", "欢呼", "兴奋", "幸福", "飞起来", "笑", "蹦"),
    "疑惑": ("疑惑", "疑问", "问号", "怎么回事", "怎么绘世", "奇怪", "不懂", "困惑", "歪头", "啊？"),
    "撒娇": ("撒娇", "贴贴", "抱抱", "抱", "比心", "喜欢", "想你", "亲亲", "吧唧", "爱你", "蹭", "吻"),
    "得意": ("得意", "哼哼", "骄傲", "坏笑", "如我所料", "自信", "会赢的", "优雅", "可靠", "交给我"),
    "委屈": ("委屈", "难过", "伤心", "哭", "呜呜", "呜哇", "失落", "快哄我", "弱小无助"),
    "安慰": ("安慰", "摸摸", "拍拍", "没事", "抱抱", "加油", "鼓励", "陪着"),
    "疲惫": ("疲惫", "疲劳", "累", "困", "休息", "躺平", "睡", "扑街", "升天", "坐牢", "晚安"),
    "思考": ("思考", "看书", "研究", "让我看看", "琢磨", "沉思", "喝茶"),
    "无语": ("无语", "冷漠", "呆滞", "阿巴阿巴", "停止思考", "傻眼", "啧", "白眼"),
    "生气": ("生气", "不爽", "不甘", "吵死了", "瞪", "鄙视", "铁咩", "威胁", "制止", "火力大喵"),
    "惊讶": ("惊讶", "吃惊", "震惊", "惊呆", "呆住", "晕", "害怕"),
    "认可": ("认可", "点赞", "肯定", "嗯好", "好棒", "厉害", "赞", "同意", "收到", "感谢", "谢谢"),
    "害羞": ("害羞", "心虚", "不好意思", "羞", "脸红", "我错了", "道歉"),
    "期待": ("期待", "探头", "盯", "拜托", "可以吗", "带带我", "等你", "想要"),
    "离开": ("离开", "溜了", "快跑", "冲刺", "再见", "拜拜", "看不到我"),
}


def normalized(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKC", text).lower() if c.isalnum())


def mood_tags(text: str) -> list[str]:
    n = normalized(text)
    return [mood for mood, words in MOODS.items() if any(normalized(w) in n for w in words)]


def inspect_image(blob: bytes) -> dict:
    if not blob or len(blob) > MAX_IMAGE_BYTES:
        raise ValueError("图片为空或超过 10 MB")
    try:
        with Image.open(io.BytesIO(blob)) as im:
            fmt = im.format
            if fmt not in {"PNG", "JPEG", "GIF", "WEBP"}:
                raise ValueError("不支持的图片格式")
            width, height = im.size
            frames = getattr(im, "n_frames", 1)
            if min(width, height) < 48 or max(width, height) > 4096:
                raise ValueError("图片尺寸不适合作表情")
            if frames > 300 or width * height * frames > 120_000_000:
                raise ValueError("动图过大")
            for frame in range(frames):
                im.seek(frame)
                im.load()
        return {"extension": {"PNG": ".png", "JPEG": ".jpg", "GIF": ".gif", "WEBP": ".webp"}[fmt],
                "width": width, "height": height, "frames": frames}
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("图片损坏或无法解码") from exc


class Catalog:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.images = self.root / "images"
        self.images.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "catalog.json"
        self.items: dict[str, dict] = {}
        self.recent: OrderedDict[str, deque[str]] = OrderedDict()
        if self.path.exists():
            data = json.loads(self.path.read_text(encoding="utf-8"))
            self.items = {item["id"]: item for item in data["items"]}

    def save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"version": 1, "items": list(self.items.values())}, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)

    def add(self, blob: bytes, *, source: str, name: str, description: str,
            source_url: str, image_url: str, tags: list[str] | None = None,
            pack_id: str = "", original_id: str = "") -> dict:
        info = inspect_image(blob)
        digest = hashlib.sha256(blob).hexdigest()
        item_id = f"strinova-{pack_id}-{original_id}" if source == "strinova" else f"kaguya-{digest[:20]}"
        filename = digest + info.pop("extension")
        dest = self.images / filename
        if not dest.exists():
            tmp = dest.with_suffix(dest.suffix + ".tmp")
            tmp.write_bytes(blob)
            os.replace(tmp, dest)
        all_tags = list(dict.fromkeys((tags or []) + mood_tags(name + " " + description)))
        item = {"id": item_id, "source": source, "name": name, "description": description,
                "tags": all_tags, "source_url": source_url, "image_url": image_url,
                "pack_id": pack_id, "original_id": original_id, "filename": filename,
                "sha256": digest, **info}
        self.items[item_id] = item
        self.save()
        return item

    def file_for(self, item: dict) -> Path:
        filename = item["filename"]
        if not re.fullmatch(r"[a-f0-9]{64}\.(png|jpg|gif|webp)", filename):
            raise ValueError("无效素材路径")
        path = (self.images / filename).resolve()
        if path.parent != self.images.resolve() or not path.is_file():
            raise ValueError("素材文件不存在")
        return path

    def record_sent(self, session: str, item_id: str) -> None:
        self.recent.setdefault(session, deque(maxlen=3)).append(item_id)
        self.recent.move_to_end(session)
        while len(self.recent) > 500:
            self.recent.popitem(last=False)

    def search(self, query: str, source: str, session: str, limit: int = 8) -> list[dict]:
        q = normalized(query)
        if not q:
            return []
        wanted = set(mood_tags(query))
        recent = set(self.recent.get(session, ()))
        ranked = []
        for item in self.items.values():
            if source != "auto" and item["source"] != source or item["id"] in recent:
                continue
            try:
                self.file_for(item)
            except ValueError:
                continue
            name = normalized(item["name"])
            body = normalized(item["description"] + " ".join(item["tags"]))
            score = 100 if q == name else 0
            if name and name in q:
                score += 35
            if q in body or q in name:
                score += 20
            score += 15 * len(wanted.intersection(item["tags"]))
            if score:
                ranked.append((score, item))
        # Equal scores alternate the two sources instead of favoring the larger library.
        ranked.sort(key=lambda pair: (-pair[0], pair[1]["id"]))
        result = []
        for score in sorted({score for score, _ in ranked}, reverse=True):
            groups = [[i for s, i in ranked if s == score and i["source"] == src] for src in ("kaguya", "strinova")]
            while any(groups):
                for group in groups:
                    if group:
                        result.append(group.pop(0))
        return result[:limit]

    @staticmethod
    def candidate(item: dict) -> dict:
        return {"sticker_id": item["id"], "source": item["source"], "name": item["name"],
                "description": item["description"], "tags": item["tags"], "animated": item["frames"] > 1}
