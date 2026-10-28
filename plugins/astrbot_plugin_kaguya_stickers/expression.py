"""Small, local safeguards for Kaguya's emotional chat replies."""
from __future__ import annotations

import re

# Map facial reactions, hearts and common chat gestures, rather than treating
# every non-ASCII symbol (math, code, flags, etc.) as a disposable emoji.
REACTIONS = {
    "得意": "😏😎😼😌🤭😈😜😝😛🤪",
    "开心": "😀😃😄😁😆😅😂🤣😊🙂☺🤗🥳✨🎉🎊",
    "撒娇": "🥰😍😘😗😙😚😽❤♥💕💞💓💗💖💘💝💋🫶",
    "疑惑": "🤔🧐😕🙃🤨❓❔",
    "委屈": "🥺🥹😢😭😿😞😔😟☹🙁",
    "疲惫": "😴🥱😪😩😫🫠",
    "生气": "😠😡🤬😤💢",
    "无语": "😒🙄😑😐🫥",
    "惊讶": "😯😮😲😳😱😨😰😵🤯",
    "认可": "👍👌🙌👏🙏✅🤝",
    "害羞": "🤫🫣",
    "期待": "👀🤤",
}
CHAR_MOODS = {char: mood for mood, chars in REACTIONS.items() for char in chars}
EMOJI = re.compile("[" + re.escape("".join(CHAR_MOODS)) + "](?:[\ufe0e\ufe0f\U0001f3fb-\U0001f3ff])*")
CODE = re.compile(r"(```[\s\S]*?```|`[^`\n]*`)")
TEXT_ONLY = re.compile(r"(?:只|仅|纯).{0,5}(?:文字|文本)|(?:不要|别|不许|不用).{0,5}(?:发图|配图|图片|表情包)|(?:text.only|no.images)", re.I)
TECHNICAL = re.compile(r"```|\b(?:python|java|javascript|typescript|sql|c\+\+|api|http|json|unicode|utf-?8|regex)\b|代码|报错|异常堆栈|命令|函数|算法|公式|方程|证明|病情|用药", re.I)
LITERAL = re.compile(r"(?:emoji|表情|符号|字符).{0,16}(?:意思|含义|表示什么|代表什么|编码|码点|正则|怎么输入)|(?:解释|识别|翻译|列出|输出|原样|保留|打印).{0,20}(?:emoji|表情|符号|字符)", re.I)
IMAGE_REQUEST = re.compile(r"(?:发|给|来|要|送|用|找).{0,12}(?:表情|图片|配图)")
CELEBRATION = re.compile(r"(?:终于|总算).{0,16}(?:跑通|完成|写完|搞定|成功)|好开心|累了|抱抱")
PREVIEW = re.compile(r"(?:我来|让我|给你|来给你).{0,12}(?:挑|找|选|发|来).{0,10}(?:图|表情)|(?:挑|选|找)一张给你|(?:发|送|来)一张.{0,10}(?:图|表情)")
SHORT_REACTIONS = (
    ("得意", r"哼哼|嘿嘿|算你有眼光|才不会输|肯定是我|当然是我|那还用说"),
    ("撒娇", r"抱抱|抱紧|贴贴|蹭蹭|亲亲|想你了|想我了|最喜欢你"),
    ("开心", r"好耶|太好了|耶[！!～~]|开心极了|哈哈哈"),
    ("疲惫", r"累趴|困死|先躺|躺一会|晚安"),
    ("委屈", r"呜呜|委屈巴巴|快哄我"),
    ("疑惑", r"[诶咦啊][？?]|满头问号|没听懂"),
)
FALLBACK_WORDS = {"得意": "哼哼。", "开心": "好耶！", "撒娇": "抱抱你。", "疑惑": "诶？",
                  "委屈": "呜。", "疲惫": "先歇一会儿。", "生气": "哼。", "无语": "真拿你没办法。",
                  "惊讶": "诶，居然这样！", "认可": "好呀。", "害羞": "有点不好意思啦。", "期待": "等着呢。"}


def literal_request(prompt: str) -> bool:
    match = EMOJI.search(prompt)
    return bool(match and (LITERAL.search(prompt) or CODE.search(prompt)
                          or re.match(r"[\s这个它是]*.{0,4}(?:什么意思|什么含义|代表什么)", prompt[match.end():])))


def text_only_request(prompt: str) -> bool:
    return bool(TEXT_ONLY.search(prompt) or literal_request(prompt)
                or (TECHNICAL.search(prompt) and not IMAGE_REQUEST.search(prompt) and not CELEBRATION.search(prompt)))


def clean_expression(text: str, *, literal: bool = False) -> tuple[str, str]:
    if literal:
        return text, ""
    parts = CODE.split(text)
    mood = ""
    for index in range(0, len(parts), 2):
        for match in EMOJI.finditer(parts[index]):
            mood = CHAR_MOODS[match.group()[0]]
        parts[index] = EMOJI.sub("", parts[index])
        parts[index] = re.sub(r"[ \t]+(?=[，。！？、；：~～…])", "", parts[index])
    return "".join(parts).strip(), mood


def reaction_mood(text: str) -> str:
    if len(text) > 150 or TECHNICAL.search(text) or CODE.search(text):
        return ""
    for mood, pattern in SHORT_REACTIONS:
        if re.search(pattern, text):
            return mood
    return ""
