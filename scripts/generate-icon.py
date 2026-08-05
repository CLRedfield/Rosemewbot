from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)
SOURCE = ASSETS / "rosemewbot-source.png"

image = Image.open(SOURCE).convert("RGBA")
png = image.resize((512, 512), Image.Resampling.NEAREST)
png.save(ASSETS / "icon.png")
png.save(
    ASSETS / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

print(f"Generated Rosemewbot icons from {SOURCE}")
