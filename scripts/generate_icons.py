"""Generate desktop Tauri icons from the supplied Cinder app icon."""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DESTINATIONS = [
    ROOT / "apps" / "student" / "src-tauri" / "icons",
    ROOT / "apps" / "teacher" / "src-tauri" / "icons",
]


def main() -> None:
    source = Image.open(ROOT / "design" / "brand" / "cinder-app-icon.png").convert("RGBA")
    for destination in DESTINATIONS:
        destination.mkdir(parents=True, exist_ok=True)
        for filename, size in [("32x32.png", 32), ("64x64.png", 64), ("128x128.png", 128), ("128x128@2x.png", 256), ("icon.png", 512)]:
            source.resize((size, size), Image.Resampling.LANCZOS).save(destination / filename)
        source.save(destination / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        source.save(destination / "icon.icns")


if __name__ == "__main__":
    main()
