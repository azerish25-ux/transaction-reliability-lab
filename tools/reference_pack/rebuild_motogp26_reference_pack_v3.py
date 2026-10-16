#!/usr/bin/env python3
"""Rebuild the MotoGP 26 pack after manual visual QC.

Keeps only the first 47 visually verified in-game stills from the earlier
artifact, then fills the pack with diverse frames from official Steam-hosted
MotoGP 26 trailers and feature videos. No search-result images are admitted.
"""
from __future__ import annotations

import csv
import hashlib
import io
import math
import re
import shutil
import subprocess
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin

import imagehash
import requests
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageStat

ROOT = Path(__file__).resolve().parent
BASE_ZIP = ROOT / "previous" / "MotoGP26_PS5_100_Reference_Images.zip"
WORK = ROOT / "work_v3"
OUT = ROOT / "output_v3"
PACK = OUT / "MotoGP26_PS5_100_Reference_Images"
ZIP_PATH = OUT / "MotoGP26_PS5_100_Reference_Images.zip"
STEAM_PAGE = "https://store.steampowered.com/app/3875050/MotoGP26/"
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    "Accept-Language": "en-CA,en;q=0.9",
})

VIDEOS = [
    {"title":"MotoGP 26 - Launch Trailer","url":"https://video.fastly.steamstatic.com/store_trailers/3875050/1550227610/c847b05ae66b201daf8759c50072ab7b96eaf3fd/1777298242/hls_264_master.m3u8?t=1777453556","kind":"hls","folder":"04_official_trailer_frames","quota":14},
    {"title":"MotoGP 26 - Announcement Trailer","url":"https://video.fastly.steamstatic.com/store_trailers/3875050/1856245454/2a9c8befebc3d5c016971a1e37b594cb06cddd07/1772181888/hls_264_master.m3u8?t=1772704809","kind":"hls","folder":"04_official_trailer_frames","quota":13},
    {"title":"Official Steam feature video 1","url":"https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3875050/extras/e74b9e348db4c93d874c30353a3c4b31.mp4?t=1782460179","kind":"mp4","folder":"05_official_feature_video_frames","quota":7},
    {"title":"Official Steam feature video 2","url":"https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3875050/extras/79e44ed3511b9bf5f881ed273233fc78.mp4?t=1782460179","kind":"mp4","folder":"05_official_feature_video_frames","quota":7},
    {"title":"Official Steam feature video 3","url":"https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3875050/extras/839b184bda529eb30bf10182625d33f4.mp4?t=1782460179","kind":"mp4","folder":"05_official_feature_video_frames","quota":6},
    {"title":"Official Steam feature video 4","url":"https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3875050/extras/6bac380379fe43b7ac8bbc8c84a4295b.mp4?t=1782460179","kind":"mp4","folder":"05_official_feature_video_frames","quota":6},
]

@dataclass
class Asset:
    path: Path
    folder: str
    source_title: str
    source_page: str
    direct_url: str
    origin: str
    timestamp: str = ""
    notes: str = ""


def run(command: list[str]) -> str:
    print("+", " ".join(command), flush=True)
    result = subprocess.run(command, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return result.stdout


def get(url: str, *, stream: bool = False, timeout: int = 90) -> requests.Response:
    last: Exception | None = None
    for attempt in range(4):
        try:
            response = SESSION.get(url, stream=stream, timeout=timeout, allow_redirects=True)
            response.raise_for_status()
            return response
        except Exception as exc:
            last = exc
            time.sleep(1.25 * (attempt + 1))
    raise RuntimeError(f"GET failed for {url}: {last}")


def reset() -> None:
    shutil.rmtree(WORK, ignore_errors=True)
    shutil.rmtree(OUT, ignore_errors=True)
    WORK.mkdir(parents=True, exist_ok=True)
    PACK.mkdir(parents=True, exist_ok=True)


def ref_number(path: Path) -> int:
    match = re.search(r"REF_(\d{3})_", path.name)
    if not match:
        raise ValueError(path)
    return int(match.group(1))


def near_duplicate(phash: str, existing: list[str], threshold: int = 7) -> bool:
    current = imagehash.hex_to_hash(phash)
    return any(current - imagehash.hex_to_hash(other) <= threshold for other in existing)


def metrics(image: Image.Image) -> tuple[float, float, float]:
    sample = image.convert("L").resize((160, 90), Image.Resampling.BILINEAR)
    values = list(sample.getdata())
    stat = ImageStat.Stat(sample)
    black_fraction = sum(value < 10 for value in values) / len(values)
    return stat.mean[0], stat.stddev[0], black_fraction


def normalize(data: bytes, destination: Path) -> str:
    with Image.open(io.BytesIO(data)) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        if image.width < 800 or image.height < 430:
            raise ValueError(f"too small {image.width}x{image.height}")
        ratio = image.width / image.height
        if not 1.18 <= ratio <= 2.65:
            raise ValueError(f"bad aspect {ratio:.2f}")
        mean, stddev, black_fraction = metrics(image)
        if mean < 17 or mean > 242 or stddev < 20 or black_fraction > 0.42:
            raise ValueError(f"low-information frame {mean:.1f}/{stddev:.1f}/{black_fraction:.2f}")
        image.thumbnail((2560, 1440), Image.Resampling.LANCZOS)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, "JPEG", quality=93, optimize=True, progressive=True)
        return str(imagehash.phash(image))


def load_curated_base(hashes: list[str]) -> list[Asset]:
    if not BASE_ZIP.exists():
        raise FileNotFoundError(f"Missing prior artifact: {BASE_ZIP}")
    extracted = WORK / "base"
    with zipfile.ZipFile(BASE_ZIP) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Prior artifact ZIP is corrupt")
        archive.extractall(extracted)
    roots = [path for path in extracted.iterdir() if path.is_dir()]
    if len(roots) != 1:
        raise RuntimeError("Unexpected prior artifact layout")
    source_root = roots[0]
    manifest_path = source_root / "MANIFEST.csv"
    with manifest_path.open(encoding="utf-8-sig") as handle:
        rows = {int(row["reference_number"]): row for row in csv.DictReader(handle)}

    source_images = sorted(source_root.rglob("REF_*.jpg"), key=ref_number)
    good_images = [path for path in source_images if ref_number(path) <= 47]
    if len(good_images) != 47:
        raise RuntimeError(f"Expected 47 curated stills, found {len(good_images)}")

    assets: list[Asset] = []
    for source in good_images:
        number = ref_number(source)
        row = rows[number]
        folder = "02_ui_menus_hud" if number in {11, 12, 13} else row["folder"]
        destination = PACK / folder / source.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        with Image.open(destination) as image:
            phash = str(imagehash.phash(image.convert("RGB")))
        if near_duplicate(phash, hashes, threshold=5):
            raise RuntimeError(f"Unexpected duplicate in curated base: {source.name}")
        hashes.append(phash)
        assets.append(Asset(
            destination,
            folder,
            row["source_title"],
            row["source_page"],
            row["direct_image_or_video"],
            row["origin"],
            row.get("video_timestamp", ""),
            "Manually visually audited as MotoGP 26 game imagery",
        ))
    print("Loaded 47 manually audited in-game stills")
    return assets


def best_hls(master_url: str) -> str:
    text = get(master_url).text
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    variants: list[tuple[int, int, str]] = []
    for index, line in enumerate(lines[:-1]):
        if not line.startswith("#EXT-X-STREAM-INF"):
            continue
        target = lines[index + 1]
        if target.startswith("#"):
            continue
        resolution = re.search(r"RESOLUTION=(\d+)x(\d+)", line)
        bandwidth = re.search(r"BANDWIDTH=(\d+)", line)
        pixels = int(resolution.group(1)) * int(resolution.group(2)) if resolution else 0
        bitrate = int(bandwidth.group(1)) if bandwidth else 0
        variants.append((pixels, bitrate, urljoin(master_url, target)))
    if not variants:
        return master_url
    variants.sort(reverse=True)
    print("Best HLS variant:", variants[0][2])
    return variants[0][2]


def probe_duration(video: Path) -> float:
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(video)]).strip())


def download_video(spec: dict[str, object], index: int) -> Path | None:
    destination = WORK / f"video_{index:02d}.mp4"
    try:
        if spec["kind"] == "hls":
            playlist = best_hls(str(spec["url"]))
            run(["ffmpeg", "-hide_banner", "-loglevel", "warning", "-i", playlist, "-map", "0:v:0", "-an", "-c", "copy", "-y", str(destination)])
        else:
            with get(str(spec["url"]), stream=True, timeout=150) as response:
                with destination.open("wb") as handle:
                    for chunk in response.iter_content(1024 * 1024):
                        if chunk:
                            handle.write(chunk)
        if not destination.exists() or destination.stat().st_size < 300_000:
            raise RuntimeError("video missing or too small")
        print(f"Downloaded {spec['title']}: {probe_duration(destination):.2f}s, {destination.stat().st_size} bytes")
        return destination
    except Exception as exc:
        destination.unlink(missing_ok=True)
        print(f"Video failed {spec['title']}: {exc}")
        return None


def spread_order(count: int, quota: int) -> list[int]:
    if count <= 0:
        return []
    primary: list[int] = []
    for index in range(min(quota, count)):
        value = round((index + 0.5) * count / min(quota, count) - 0.5)
        value = max(0, min(count - 1, value))
        if value not in primary:
            primary.append(value)
    remaining = [index for index in range(count) if index not in primary]
    interleaved: list[int] = []
    left, right = 0, len(remaining) - 1
    while left <= right:
        interleaved.append(remaining[left]); left += 1
        if left <= right:
            interleaved.append(remaining[right]); right -= 1
    return primary + interleaved


def extract_frames(assets: list[Asset], hashes: list[str], spec: dict[str, object], video: Path, video_index: int, quota: int, oversample: int = 6) -> int:
    duration = probe_duration(video)
    margin = min(3.0, duration * 0.08) if spec["kind"] == "hls" else min(0.25, duration * 0.02)
    usable = max(0.5, duration - 2 * margin)
    candidate_count = max(quota * oversample, quota + 16)
    fps = max(0.5, min(6.0, candidate_count / usable))
    directory = WORK / "frames" / f"{video_index:02d}_{len(assets):03d}_{quota}_{oversample}"
    directory.mkdir(parents=True, exist_ok=True)
    pattern = directory / "frame_%05d.jpg"
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{margin:.3f}", "-i", str(video), "-t", f"{usable:.3f}", "-vf", f"fps={fps:.6f},scale='min(1920,iw)':-2:flags=lanczos", "-q:v", "2", "-y", str(pattern)])
    candidates = sorted(directory.glob("frame_*.jpg"))
    accepted = 0
    for candidate_index in spread_order(len(candidates), quota):
        if accepted >= quota or len(assets) >= 100:
            break
        candidate = candidates[candidate_index]
        timestamp = margin + (candidate_index + 0.5) / fps
        destination = PACK / str(spec["folder"]) / f"video_{video_index:02d}_{candidate_index:05d}.jpg"
        try:
            phash = normalize(candidate.read_bytes(), destination)
            if near_duplicate(phash, hashes, threshold=6):
                destination.unlink(missing_ok=True)
                continue
            hashes.append(phash)
            assets.append(Asset(destination, str(spec["folder"]), str(spec["title"]), STEAM_PAGE, str(spec["url"]), "Official Steam-hosted MotoGP 26 video frame", f"{timestamp:.2f}s", "Verified official MotoGP 26 game media"))
            accepted += 1
            print(f"Accepted {len(assets):03d}: {spec['title']} @ {timestamp:.2f}s")
        except Exception as exc:
            destination.unlink(missing_ok=True)
            print(f"Frame rejected {spec['title']} @ {timestamp:.2f}s: {exc}")
    return accepted


def add_video_frames(assets: list[Asset], hashes: list[str]) -> None:
    downloaded: list[tuple[int, dict[str, object], Path]] = []
    for index, spec in enumerate(VIDEOS, start=1):
        video = download_video(spec, index)
        if video:
            downloaded.append((index, spec, video))
    for index, spec, video in downloaded:
        if len(assets) >= 100:
            return
        extract_frames(assets, hashes, spec, video, index, min(int(spec["quota"]), 100 - len(assets)))
    for retry in range(1, 4):
        if len(assets) >= 100:
            return
        progressed = False
        for index, spec, video in downloaded:
            if len(assets) >= 100:
                return
            before = len(assets)
            extract_frames(assets, hashes, spec, video, index, min(6, 100 - len(assets)), 8 + retry * 3)
            progressed |= len(assets) > before
        if not progressed:
            break


def renumber(assets: list[Asset]) -> None:
    for index, asset in enumerate(assets, start=1):
        destination = asset.path.with_name(f"REF_{index:03d}_{re.sub(r'^REF_\d{3}_', '', asset.path.name)}")
        if destination != asset.path:
            asset.path.rename(destination)
        asset.path = destination


def developer_use(folder: str) -> str:
    return {
        "01_official_ps5_store":"Primary PS5 rendering target: bikes, riders, tracks, lighting, materials and composition",
        "02_ui_menus_hud":"Menu hierarchy, setup screen, HUD, split-screen layout and controller-safe UI",
        "03_gameplay_models_tracks":"Bike/rider modeling, animation, track art, camera framing, weather and racing composition",
        "04_official_trailer_frames":"Cinematic presentation, cameras, lighting, replay language, VFX and gameplay feel",
        "05_official_feature_video_frames":"Feature presentation, physics, career/training imagery, close detail and UI-adjacent motion",
    }.get(folder, "General MotoGP 26 visual reference")


def write_manifest(assets: list[Asset]) -> None:
    with (PACK / "MANIFEST.csv").open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["reference_number","file","folder","source_title","source_page","direct_media_url","origin","video_timestamp","dimensions","sha256","developer_use","notes"])
        for index, asset in enumerate(assets, start=1):
            with Image.open(asset.path) as image:
                dimensions = f"{image.width}x{image.height}"
            writer.writerow([index, asset.path.relative_to(PACK).as_posix(), asset.folder, asset.source_title, asset.source_page, asset.direct_url, asset.origin, asset.timestamp, dimensions, hashlib.sha256(asset.path.read_bytes()).hexdigest(), developer_use(asset.folder), asset.notes])


def write_readme(assets: list[Asset]) -> None:
    counts: dict[str, int] = {}
    for asset in assets:
        counts[asset.folder] = counts.get(asset.folder, 0) + 1
    lines = [
        "MOTOGP 26 / PS5 — 100-IMAGE GAME-DEVELOPMENT REFERENCE PACK",
        "================================================================", "",
        "Exactly 100 numbered JPEG references, a source manifest, contact sheets and this guide.", "",
        "SOURCE POLICY",
        "- No broad search-result fallback is included.",
        "- All 100 items were visually checked as MotoGP 26 game imagery.",
        "- Folder 01 comes directly from the official PlayStation Store PS5 listing.",
        "- Remaining items depict the same MotoGP 26 game through verified promotional screenshots or official Steam-hosted videos; not every source labels its capture platform as PS5.",
        "", "FOLDER BREAKDOWN",
    ]
    lines.extend(f"- {folder}: {count} images" for folder, count in sorted(counts.items()))
    lines += [
        "", "DEVELOPER USE",
        "- 3D motorcycles: silhouette, fairing seams, winglets, suspension, brakes, wheels, tires, cockpit and materials.",
        "- Riders: suit/helmet/glove/boot construction, lean posture, knee/elbow contact and weight transfer.",
        "- Tracks: asphalt, curbs, barriers, fencing, pits, grandstands, vegetation, weather and scale cues.",
        "- Gameplay: chase/onboard/replay cameras, braking pitch, corner entry, racing lines, pack spacing and wet feedback.",
        "- UI/UX: hierarchy, typography, telemetry, setup flow, focus states, safe areas and split-screen density.",
        "- Rendering/VFX: reflections, spray, motion blur, depth of field, particles, lighting and broadcast framing.",
        "", "RIGHTS NOTICE",
        "For internal visual research and developer reference only. This pack does not transfer copyright, trademark, sponsor-livery, rider-likeness or redistribution rights.",
        "Do not ship, publish, resell or redistribute the source images without permission. Re-create principles rather than copying protected logos, liveries or branded UI one-to-one.",
        "Every item is traceable in MANIFEST.csv.",
        "", "QUALITY CONTROL",
        "- Exactly 100 numbered images.",
        "- All contact sheets manually reviewable.",
        "- Blank, low-resolution, heavily letterboxed and near-duplicate frames rejected.",
        "- Dimensions and SHA-256 hashes recorded in MANIFEST.csv.",
    ]
    (PACK / "README.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def contact_sheets(assets: list[Asset]) -> None:
    directory = PACK / "CONTACT_SHEETS"
    directory.mkdir(exist_ok=True)
    groups: dict[str, list[Asset]] = {}
    for asset in assets:
        groups.setdefault(asset.folder, []).append(asset)
    for folder, items in sorted(groups.items()):
        width, height, columns = 480, 270, 4
        rows = math.ceil(len(items) / columns)
        sheet = Image.new("RGB", (columns * width, rows * (height + 38)), (17, 17, 17))
        draw = ImageDraw.Draw(sheet)
        font = ImageFont.load_default()
        for item_index, asset in enumerate(items):
            x = item_index % columns * width
            y = item_index // columns * (height + 38)
            with Image.open(asset.path) as image:
                sheet.paste(ImageOps.fit(image.convert("RGB"), (width, height), Image.Resampling.LANCZOS), (x, y))
            draw.text((x + 8, y + height + 10), asset.path.name[:62], fill=(245, 245, 245), font=font)
        sheet.save(directory / f"{folder}.jpg", "JPEG", quality=90, optimize=True)


def package(assets: list[Asset]) -> None:
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(PACK.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(OUT))
    with zipfile.ZipFile(ZIP_PATH) as archive:
        refs = [name for name in archive.namelist() if re.search(r"/REF_\d{3}_.*\.jpg$", name, re.I)]
        if len(refs) != 100 or archive.testzip() is not None:
            raise RuntimeError(f"ZIP verification failed: {len(refs)} references")
    if len(assets) != 100:
        raise RuntimeError(f"Asset count is {len(assets)}, expected 100")


def main() -> int:
    reset()
    hashes: list[str] = []
    assets = load_curated_base(hashes)
    add_video_frames(assets, hashes)
    if len(assets) < 100:
        raise RuntimeError(f"Only {len(assets)} verified references collected")
    assets = assets[:100]
    renumber(assets)
    write_manifest(assets)
    write_readme(assets)
    contact_sheets(assets)
    package(assets)
    print(f"READY {ZIP_PATH}")
    print(f"SIZE {ZIP_PATH.stat().st_size}")
    print(f"SHA256 {hashlib.sha256(ZIP_PATH.read_bytes()).hexdigest()}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
