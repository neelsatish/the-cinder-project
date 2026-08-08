"""Generate Tauri raster icons from the code-native Lumina brand mark."""

from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DESTINATIONS = [
    ROOT / "apps" / "student" / "src-tauri" / "icons",
    ROOT / "apps" / "teacher" / "src-tauri" / "icons",
]


def make_mark(size: int = 1024) -> Image.Image:
    """Prepare the generated concept as a transparent, launcher-safe square."""
    concept = Image.open(ROOT / "design" / "brand" / "lumina-concept.png").convert("RGBA")
    cleaned = []
    for red, green, blue, _alpha in concept.getdata():
        lowest, highest = min(red, green, blue), max(red, green, blue)
        if lowest > 225 and highest - lowest < 10:
            alpha = max(0, min(255, (240 - lowest) * 17))
        else:
            alpha = 255
        cleaned.append((red, green, blue, alpha))
    concept.putdata(cleaned)
    concept = concept.resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=round(size * 0.205), fill=255)
    concept.putalpha(ImageChops.multiply(concept.getchannel("A"), mask))
    return concept


def main() -> None:
    source = make_mark()
    source.save(ROOT / "design" / "brand" / "lumina-mark.png")
    for destination in DESTINATIONS:
        destination.mkdir(parents=True, exist_ok=True)
        for filename, size in [("32x32.png", 32), ("64x64.png", 64), ("128x128.png", 128), ("128x128@2x.png", 256), ("icon.png", 512)]:
            source.resize((size, size), Image.Resampling.LANCZOS).save(destination / filename)
        source.save(destination / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        source.save(destination / "icon.icns")


if __name__ == "__main__":
    main()
