from __future__ import annotations

import ipaddress
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from urllib.request import getproxies

import aiohttp

from .catalog import MAX_IMAGE_BYTES, inspect_image

# Windows' system proxy may use Fake-IP DNS. In that mode the proxy, rather than
# this process, resolves targets, so restrict it to known public media publishers.
PROXY_MEDIA_DOMAINS = ("gxh.vip.qq.com", "sina.cn", "sinaimg.cn", "weibo.com", "weibo.cn",
                       "bilibili.com", "hdslb.com", "b23.tv", "taptap.cn", "tapimg.com",
                       "cho-kaguyahime.com", "x.com", "twitter.com", "twimg.com")


def trusted_proxy_host(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower().rstrip(".")
    return any(host == domain or host.endswith("." + domain) for domain in PROXY_MEDIA_DOMAINS)


def public_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password:
        raise ValueError("只接受公开 HTTP(S) 图片地址")
    if parts.port not in (None, 80, 443):
        raise ValueError("不支持非标准端口")
    host = parts.hostname.lower().rstrip(".")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise ValueError("不接受本机地址")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if not ip.is_global:
            raise ValueError("不接受私有网络地址")
    if parts.scheme == "http" and trusted_proxy_host(url):
        return parts._replace(scheme="https").geturl()
    return url


class PublicResolver(aiohttp.abc.AbstractResolver):
    def __init__(self):
        self.delegate = aiohttp.resolver.ThreadedResolver()

    async def resolve(self, host, port=0, family=socket.AF_INET):
        records = await self.delegate.resolve(host, port, family)
        if not records or any(not ipaddress.ip_address(r["host"]).is_global for r in records):
            raise ValueError("解析到了非公开网络地址")
        return records

    async def close(self):
        await self.delegate.close()


class Fetcher:
    async def get(self, url: str, *, image: bool = False) -> tuple[bytes, str]:
        cap = MAX_IMAGE_BYTES if image else 2 * 1024 * 1024
        proxies = getproxies()
        proxy = proxies.get("https") or proxies.get("http")
        if proxy and urlsplit(proxy).scheme not in {"http", "https"}:
            raise ValueError("暂不支持此代理类型")
        connector = aiohttp.TCPConnector(resolver=None if proxy else PublicResolver(), limit=4)
        timeout = aiohttp.ClientTimeout(total=15, connect=5)
        async with aiohttp.ClientSession(connector=connector, timeout=timeout, trust_env=False,
                                        headers={"User-Agent": "Mozilla/5.0"}) as session:
            current = url
            for _ in range(4):
                current = public_url(current)
                if proxy and not trusted_proxy_host(current):
                    raise ValueError("代理模式下仅下载已知公开图片站点")
                host = (urlsplit(current).hostname or "").lower()
                headers = {}
                if host.endswith(".sinaimg.cn"):
                    headers["Referer"] = "https://weibo.com/"
                elif host.endswith(".hdslb.com"):
                    headers["Referer"] = "https://www.bilibili.com/"
                async with session.get(current, allow_redirects=False, proxy=proxy, headers=headers) as response:
                    if response.status in {301, 302, 303, 307, 308}:
                        current = urljoin(current, response.headers.get("Location", ""))
                        continue
                    response.raise_for_status()
                    if response.content_length and response.content_length > cap:
                        raise ValueError("响应内容过大")
                    content_type = response.headers.get("Content-Type", "").lower()
                    if image and not (content_type.startswith("image/") or "octet-stream" in content_type):
                        raise ValueError("链接返回的不是图片")
                    data = bytearray()
                    async for chunk in response.content.iter_chunked(65536):
                        data.extend(chunk)
                        if len(data) > cap:
                            raise ValueError("响应内容过大")
                    blob = bytes(data)
                    if image:
                        inspect_image(blob)
                    return blob, current
        raise ValueError("重定向过多")


class PageImages(HTMLParser):
    def __init__(self, base: str):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.urls: list[str] = []
        self.texts: list[str] = []
        self.ignored = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in {"script", "style"}:
            self.ignored += 1
        if tag != "img":
            return
        hints = " ".join(a.get(k, "") or "" for k in ("class", "alt", "id"))
        if re.search(r"avatar|logo|icon|qrcode|头像|二维码", hints, re.I):
            return
        for key in ("data-original", "data-src", "data-lazy-src", "src"):
            src = a.get(key)
            if not src or src.startswith("data:"):
                continue
            url = urljoin(self.base, src)
            try:
                url = public_url(url)
            except ValueError:
                continue
            if url not in self.urls:
                self.urls.append(url)
            break

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.ignored = max(0, self.ignored - 1)

    def handle_data(self, data):
        if not self.ignored and data.strip():
            self.texts.append(data.strip())


def result_urls(result: str) -> list[str]:
    urls = []
    for raw in re.findall(r'https?://[^\s<>"\)\]]+', result):
        url = raw.rstrip(".,，。")
        try:
            url = public_url(url)
        except ValueError:
            continue
        if url not in urls:
            urls.append(url)
    return urls[:5]
