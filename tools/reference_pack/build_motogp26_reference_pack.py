#!/usr/bin/env python3
"""Assemble exactly 100 high-resolution MotoGP 26 developer-reference images."""

from __future__ import annotations

import csv
import hashlib
import html
import io
import json
import math
import re
import shutil
import subprocess
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlparse

import imagehash
import requests
from bs4 import BeautifulSoup
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageStat

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "work"
OUT = ROOT / "output"
PACK = OUT / "MotoGP26_PS5_100_Reference_Images"
ZIP_PATH = OUT / "MotoGP26_PS5_100_Reference_Images.zip"
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    "Accept-Language": "en-CA,en;q=0.9",
})

PS_STORE_PAGE = "https://store.playstation.com/en-ca/product/EP4356-PPSA32557_00-MOTOGP26FULLGAME"
RAW_GAMEPLAY_URL = "https://youtu.be/YY7Z2PdxntA"
OFFICIAL_GAME_PAGE = "https://milestone.it/games/motogp-26/"
DEEP_DIVE_PAGE = "https://milestone.it/news/motogp-26/deep-dive-trailer/"

PS_STORE_IMAGES = [
    "https://image.api.playstation.com/vulcan/ap/rnd/202604/2414/11bd3d13537bd9c1c205da8ecd33297dc179c8f2c10e0bab.jpg",
    "https://image.api.playstation.com/vulcan/ap/rnd/202604/2414/729eb62843d808ec418e144d07be3eac76ebae14a69120e2.jpg",
    "https://image.api.playstation.com/vulcan/ap/rnd/202604/2414/3669d357aa15b99dcdc6136d9ffa5833bb73e3ec83e9f66b.jpg",
    "https://image.api.playstation.com/vulcan/ap/rnd/202604/2414/307b867d24416c2b61af0d0310b6cb738b9b8cb519f0b468.jpg",
    "https://image.api.playstation.com/vulcan/ap/rnd/202604/2414/1f3dd6f7c37a75ed1df86de5c5f62bdfee5c19b3ec6cd861.jpg",
    "https://image.api.playstation.com/vulcan/ap/rnd/202604/2414/0462ab6853d83a1b236e27a224f18d606b6c7fb18f444c32.jpg",
    "https://image.api.playstation.com/vulcan/ap/rnd/202604/2414/7124756e599936e8805d922b8d2024ebd15149ad0bee9065.jpg",
    "https://image.api.playstation.com/vulcan/ap/rnd/202604/2414/eb6ec7f711f0dd3fdbd353cb8df7828da9b294df5adf7b6c.jpg",
    "https://image.api.playstation.com/vulcan/ap/rnd/202604/2414/06ba278175cb3319cab41cfc14285e1acc10a0f88f802fa4.jpg",
    "https://image.api.playstation.com/vulcan/ap/rnd/202604/2414/dd80238949f41d838dccd0d759f6ca535b1e5655f0c2ca4f.jpg",
]

DIRECT_IMAGES = [
    ("https://images.everyeye.it/img-screenshot/motogp-26-v1-930369-1280x16.webp", "https://www.everyeye.it/", "Rider identity and menu"),
    ("https://www.pcgames.de/screenshots/1280x1024/2026/05/07_MotoGP-26_PCG-Garage-pc-games.jpg", "https://www.pcgames.de/", "Garage setup menu"),
    ("https://backend.testingbuddies.de/uploads/moto_gp_26_12_af048fa5f2.webp", "https://testingbuddies.de/", "Split-screen and HUD"),
    ("https://img.redbull.com/images/q_auto,f_auto/redbullcom/2026/4/27/pkgswauzdlsex929vcno/motogp-26-gameplay-brno", "https://www.redbull.com/", "Track and gameplay"),
    ("https://www.enternity.gr/files/Image/Games/MotoGP_26/MotoGP_26_Review_Image_02.jpg", "https://www.enternity.gr/", "Cornering and rider pose"),
    ("https://fotografias-2.larazon.es/assets/2026/04/motogp-26-salida-639128339868969611.jpg", "https://www.larazon.es/", "Grid and race start"),
    ("https://pliki.ppe.pl/storage/8155ebed61bf6cf0cefb/8155ebed61bf6cf0cefb.jpg", "https://www.ppe.pl/", "Wet onboard camera"),
    ("https://www.gamereactor.se/media/93/motogp26_4879313.jpg", "https://www.gamereactor.se/", "Bike and rider close-up"),
    ("https://kotaku.com/igdb/image/upload/t_original/sc12jl4.jpg", "https://kotaku.com/games/motogp-26/gallery/1", "Milestone promotional screenshot"),
    ("https://img-api.cloud.mediaset.net/api/images/cu/v2/-/0/0/aHR0cHM6Ly9pbWctcHJvZC5zcG9ydG1lZGlhc2V0Lm1lZGlhc2V0Lml0L2ltYWdlcy8yMDI2LzAzLzI1LzEwMTcyMTY0Ni1iMDg2NzBhMC1hNzQ2LTQ5MGQtOWRjNy1jMjYwNDgxMDJjZWQuanBn?r=1", "https://amp.sportmediaset.mediaset.it/sportmediaset/photogallery/110392702", "Official press gameplay still"),
]

GALLERY_PAGES = [
    ("https://www.gamikaze.com/gallery/ps5/motogp-26", "PS5 gallery", "02_ps5_gallery"),
    ("https://kotaku.com/games/motogp-26/gallery/1", "Milestone promotional gallery", "03_gameplay_models_tracks"),
    ("https://amp.sportmediaset.mediaset.it/sportmediaset/photogallery/110392702", "Official press gameplay gallery", "03_gameplay_models_tracks"),
    ("https://steamdb.info/app/3875050/screenshots/", "SteamDB game screenshots", "03_gameplay_models_tracks"),
    ("https://games.gg/en/motogp26/", "MotoGP 26 gallery", "04_ui_career_presentation"),
    ("https://psgames.net/games/PPSA32557-motogptm26", "PS5 media gallery", "02_ps5_gallery"),
    ("https://www.gamekult.com/jeux/motogp-26-3050889179/images.html", "Game image gallery", "03_gameplay_models_tracks"),
    ("https://www.mobygames.com/game/260326/motogp-26/promo/", "Store promotional galleries", "03_gameplay_models_tracks"),
]

SEARCH_QUERIES = [
    "MotoGP 26 PS5 gameplay screenshot",
    "MotoGP 26 bike close up game screenshot",
    "MotoGP 26 rider suit helmet game screenshot",
    "MotoGP 26 garage setup menu screenshot",
    "MotoGP 26 career menu screenshot",
    "MotoGP 26 HUD replay camera screenshot",
    "MotoGP 26 rain wet weather screenshot",
    "MotoGP 26 track environment screenshot",
]

BAD_URL_WORDS = {
    "logo", "favicon", "avatar", "profile", "icon", "emoji", "banner-ad", "advert", "sprite",
    "placeholder", "blank.gif", "tracking", "pixel", "cookie", "loader", "spinner", "social",
}

@dataclass
class Candidate:
    image_url: str
    source_page: str
    source_title: str
    folder: str
    notes: str = ""

@dataclass
class Asset:
    path: Path
    folder: str
    source_title: str
    source_page: str
    image_url: str
    origin: str
    timestamp: str = ""
    notes: str = ""


def reset() -> None:
    shutil.rmtree(WORK, ignore_errors=True)
    shutil.rmtree(OUT, ignore_errors=True)
    WORK.mkdir(parents=True, exist_ok=True)
    PACK.mkdir(parents=True, exist_ok=True)


def get(url: str, timeout: int = 45) -> requests.Response:
    last: Exception | None = None
    for attempt in range(4):
        try:
            response = SESSION.get(url, timeout=timeout, allow_redirects=True)
            response.raise_for_status()
            return response
        except Exception as exc:
            last = exc
            time.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"GET failed for {url}: {last}")


def canonical_url(value: str, base_url: str) -> str | None:
    value = html.unescape(value.strip()).replace("\\/", "/")
    value = value.strip("'\"()[]{}<>,;")
    if value.startswith("//"):
        value = "https:" + value
    elif value.startswith("/"):
        value = urljoin(base_url, value)
    if not value.startswith(("http://", "https://")):
        return None
    low = value.lower()
    if any(word in low for word in BAD_URL_WORDS):
        return None
    return value


def extract_urls(text: str, base_url: str) -> tuple[list[str], list[str]]:
    soup = BeautifulSoup(text, "html.parser")
    images: list[str] = []
    links: list[str] = []
    attrs = ("src", "data-src", "data-original", "data-lazy-src", "data-full", "data-image", "data-url", "href")
    for tag in soup.find_all(["img", "source", "a", "meta"]):
        for attr in attrs:
            value = tag.get(attr)
            if not isinstance(value, str):
                continue
            url = canonical_url(value, base_url)
            if not url:
                continue
            if tag.name == "a":
                links.append(url)
            if tag.name in {"img", "source"} or re.search(r"\.(?:jpe?g|png|webp|avif)(?:[?#].*)?$", url, re.I) or "image" in url.lower():
                images.append(url)
        srcset = tag.get("srcset")
        if isinstance(srcset, str):
            entries = [part.strip().split()[0] for part in srcset.split(",") if part.strip()]
            for entry in entries[-2:]:
                url = canonical_url(entry, base_url)
                if url:
                    images.append(url)
    for meta in soup.find_all("meta"):
        key = str(meta.get("property") or meta.get("name") or "").lower()
        if "image" in key:
            content = meta.get("content")
            if isinstance(content, str):
                url = canonical_url(content, base_url)
                if url:
                    images.append(url)
    decoded = html.unescape(text).replace("\\/", "/")
    regexes = [
        r"https?://[^\s'\"<>]+?\.(?:jpg|jpeg|png|webp|avif)(?:\?[^\s'\"<>]*)?",
        r"https?://img-api\.cloud\.mediaset\.net/api/images/[^\s'\"<>]+",
        r"https?://kotaku\.com/igdb/image/upload/[^\s'\"<>]+",
        r"https?://image\.api\.playstation\.com/[^\s'\"<>]+",
    ]
    for pattern in regexes:
        for match in re.findall(pattern, decoded, re.I):
            url = canonical_url(match, base_url)
            if url:
                images.append(url)
    return list(dict.fromkeys(images)), list(dict.fromkeys(links))


def collect_candidates() -> list[Candidate]:
    candidates: list[Candidate] = []
    seen_urls: set[str] = set()

    def add(url: str, source: str, title: str, folder: str, notes: str = "") -> None:
        clean = canonical_url(url, source)
        if not clean or clean in seen_urls:
            return
        seen_urls.add(clean)
        candidates.append(Candidate(clean, source, title, folder, notes))

    for index, url in enumerate(PS_STORE_IMAGES, start=1):
        add(url, PS_STORE_PAGE, f"Official PlayStation Store PS5 screenshot {index}", "01_official_ps5_store", "Direct official PS5 listing image")

    for url, source, title in DIRECT_IMAGES:
        add(url, source, title, "03_gameplay_models_tracks", "Curated high-value reference")

    try:
        payload = get("https://store.steampowered.com/api/appdetails?appids=3875050&l=english").json()
        screenshots = payload.get("3875050", {}).get("data", {}).get("screenshots", [])
        for index, item in enumerate(screenshots, start=1):
            if item.get("path_full"):
                add(item["path_full"], "https://store.steampowered.com/app/3875050/MotoGP_26/", f"Official Steam screenshot {index}", "03_gameplay_models_tracks", "Official store promotional image")
    except Exception as exc:
        print(f"Steam API skipped: {exc}")

    for page_url, title, folder in GALLERY_PAGES:
        try:
            response = get(page_url)
            image_urls, links = extract_urls(response.text, response.url)
            for url in image_urls:
                add(url, page_url, title, folder, "Public gallery image; source retained in manifest")

            # Kotaku has one image per numbered page.
            if "kotaku.com" in page_url:
                for page_number in range(2, 15):
                    slide_url = f"https://kotaku.com/games/motogp-26/gallery/{page_number}"
                    try:
                        slide = get(slide_url)
                        found, _ = extract_urls(slide.text, slide.url)
                        for url in found:
                            add(url, slide_url, f"Milestone promotional screenshot {page_number}", folder)
                    except Exception as exc:
                        print(f"Kotaku slide {page_number} skipped: {exc}")

            # Crawl MotoGP 26 MobyGames gallery groups and image detail pages.
            if "mobygames.com" in page_url:
                queue = [link for link in links if "/game/260326/motogp-26/promo/" in link][:120]
                visited: set[str] = set()
                for detail_url in queue:
                    if detail_url in visited:
                        continue
                    visited.add(detail_url)
                    try:
                        detail = get(detail_url)
                        found, more_links = extract_urls(detail.text, detail.url)
                        for url in found:
                            add(url, detail_url, "MotoGP 26 store promotional image", folder)
                        for link in more_links:
                            if "/game/260326/motogp-26/promo/" in link and link not in visited and len(queue) < 220:
                                queue.append(link)
                    except Exception as exc:
                        print(f"MobyGames detail skipped: {exc}")
        except Exception as exc:
            print(f"Gallery skipped {page_url}: {exc}")

    # Search-image fallback. This is only used after direct and gallery sources.
    for query in SEARCH_QUERIES:
        for page in range(3):
            try:
                response = SESSION.get("https://www.bing.com/images/search", params={"q": query, "first": 1 + page * 35, "form": "HDRSC2"}, timeout=45)
                response.raise_for_status()
                soup = BeautifulSoup(response.text, "html.parser")
                for anchor in soup.select("a.iusc"):
                    raw = anchor.get("m")
                    if not raw:
                        continue
                    try:
                        metadata = json.loads(html.unescape(raw))
                    except Exception:
                        continue
                    image_url = metadata.get("murl")
                    source_page = metadata.get("purl") or response.url
                    title = metadata.get("t") or query
                    relevance = f"{title} {source_page} {image_url}".lower().replace("™", "")
                    if image_url and "motogp" in relevance and ("26" in relevance or "2026" in relevance):
                        add(image_url, source_page, title[:180], "04_ui_career_presentation", f"Search intent: {query}")
            except Exception as exc:
                print(f"Search skipped {query}: {exc}")
    print(f"Discovered {len(candidates)} unique candidate image URLs")
    return candidates


def normalize_image(data: bytes, destination: Path) -> tuple[str, int, int]:
    with Image.open(io.BytesIO(data)) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        if image.width < 800 or image.height < 430:
            raise ValueError(f"too small {image.width}x{image.height}")
        ratio = image.width / image.height
        if ratio < 1.18 or ratio > 2.65:
            raise ValueError(f"unsuitable aspect {ratio:.2f}")
        gray = image.convert("L")
        mean = ImageStat.Stat(gray).mean[0]
        low, high = gray.getextrema()
        if mean < 16 or mean > 244 or high - low < 25:
            raise ValueError("low-information image")
        image.thumbnail((2560, 1440), Image.Resampling.LANCZOS)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, "JPEG", quality=92, optimize=True, progressive=True)
        return str(imagehash.phash(image)), image.width, image.height


def duplicate(phash: str, hashes: list[str], threshold: int = 4) -> bool:
    current = imagehash.hex_to_hash(phash)
    return any(current - imagehash.hex_to_hash(other) <= threshold for other in hashes)


def download_candidates(candidates: list[Candidate], hashes: list[str]) -> list[Asset]:
    assets: list[Asset] = []
    for ordinal, candidate in enumerate(candidates, start=1):
        if len(assets) >= 100:
            break
        destination = PACK / candidate.folder / f"candidate_{ordinal:04d}.jpg"
        try:
            response = get(candidate.image_url)
            content_type = response.headers.get("content-type", "")
            if len(response.content) < 25_000 or (content_type and "image" not in content_type.lower() and not re.search(r"\.(?:jpe?g|png|webp|avif)", candidate.image_url, re.I)):
                continue
            phash, _, _ = normalize_image(response.content, destination)
            if duplicate(phash, hashes):
                destination.unlink(missing_ok=True)
                continue
            hashes.append(phash)
            origin = "Official PlayStation Store" if candidate.folder == "01_official_ps5_store" else "Public promotional/editorial media"
            assets.append(Asset(destination, candidate.folder, candidate.source_title, candidate.source_page, candidate.image_url, origin, notes=candidate.notes))
            print(f"Accepted still {len(assets):03d}: {candidate.source_title}")
        except Exception as exc:
            destination.unlink(missing_ok=True)
            print(f"Rejected {candidate.image_url}: {exc}")
    return assets


def run(command: list[str]) -> str:
    print("+", " ".join(command), flush=True)
    completed = subprocess.run(command, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return completed.stdout


def discover_youtube(page_url: str) -> str | None:
    try:
        text = get(page_url).text
        matches = re.findall(r"(?:youtube(?:-nocookie)?\.com/(?:embed/|watch\?v=)|youtu\.be/)([A-Za-z0-9_-]{11})", text)
        return f"https://youtu.be/{matches[0]}" if matches else None
    except Exception:
        return None


def download_video(target: str, stem: str, search: str) -> Path | None:
    template = str(WORK / f"{stem}.%(ext)s")
    base = [
        "yt-dlp", "--no-playlist", "--no-progress", "--retries", "8", "--fragment-retries", "8",
        "--extractor-args", "youtube:player_client=android,web", "--merge-output-format", "mp4",
        "-f", "bv*[height<=1080]+ba/b[height<=1080]", "-o", template,
    ]
    for source in (target, f"ytsearch1:{search}"):
        try:
            print(run(base + [source])[-2000:])
            for extension in ("mp4", "webm", "mkv"):
                path = WORK / f"{stem}.{extension}"
                if path.exists() and path.stat().st_size > 1_000_000:
                    return path
        except Exception as exc:
            print(f"Video source failed {source}: {exc}")
    return None


def add_video_frames(assets: list[Asset], hashes: list[str]) -> None:
    needed = 100 - len(assets)
    if needed <= 0:
        return
    videos = [
        (RAW_GAMEPLAY_URL, "raw_gameplay", "MotoGP 26 15 Minutes Raw Gameplay Milestone", RAW_GAMEPLAY_URL, "05_official_video_frames"),
        (discover_youtube(DEEP_DIVE_PAGE) or DEEP_DIVE_PAGE, "deep_dive", "MotoGP 26 Deep Dive Trailer Milestone", DEEP_DIVE_PAGE, "05_official_video_frames"),
        (discover_youtube(OFFICIAL_GAME_PAGE) or "ytsearch1:MotoGP 26 Launch Trailer Milestone", "launch", "MotoGP 26 Launch Trailer Milestone", OFFICIAL_GAME_PAGE, "05_official_video_frames"),
    ]
    for target, stem, search, source_page, folder in videos:
        needed = 100 - len(assets)
        if needed <= 0:
            return
        video = download_video(target, stem, search)
        if not video:
            continue
        duration = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(video)]).strip())
        samples = max(needed * 3, 45)
        margin = min(8.0, duration * 0.04)
        usable = max(1.0, duration - 2 * margin)
        frame_dir = WORK / "frames" / stem
        frame_dir.mkdir(parents=True, exist_ok=True)
        for index in range(samples):
            if len(assets) >= 100:
                return
            timestamp = margin + usable * (index + 0.5) / samples
            raw_frame = frame_dir / f"{index:04d}.jpg"
            subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{timestamp:.3f}", "-i", str(video),
                "-frames:v", "1", "-vf", "scale=1920:-2:force_original_aspect_ratio=decrease", "-q:v", "2", "-y", str(raw_frame),
            ], check=False)
            if not raw_frame.exists() or raw_frame.stat().st_size < 30_000:
                continue
            destination = PACK / folder / f"{stem}_{index:04d}.jpg"
            try:
                phash, _, _ = normalize_image(raw_frame.read_bytes(), destination)
                if duplicate(phash, hashes, threshold=5):
                    destination.unlink(missing_ok=True)
                    continue
                hashes.append(phash)
                assets.append(Asset(destination, folder, f"Official {stem.replace('_', ' ')} frame", source_page, target, "Official public gameplay/trailer frame", timestamp=f"{timestamp:.2f}s", notes="Frame extracted for internal visual reference"))
                print(f"Accepted video frame {len(assets):03d} at {timestamp:.2f}s")
            except Exception as exc:
                destination.unlink(missing_ok=True)
                print(f"Frame rejected: {exc}")


def renumber(assets: list[Asset]) -> None:
    for index, asset in enumerate(assets, start=1):
        new_path = asset.path.with_name(f"REF_{index:03d}_{asset.path.name}")
        asset.path.rename(new_path)
        asset.path = new_path


def developer_use(folder: str) -> str:
    return {
        "01_official_ps5_store": "PS5 presentation, bikes, riders, liveries, tracks, lighting and composition",
        "02_ps5_gallery": "PS5 visual target, bike/rider modeling, environment scale and materials",
        "03_gameplay_models_tracks": "3D modeling, rider animation, track art, cameras, physics presentation and racing composition",
        "04_ui_career_presentation": "Menus, HUD, career, garage, hierarchy, typography and controller-safe layout",
        "05_official_video_frames": "Gameplay feel, camera rigs, body motion, weather, replay, VFX and temporal presentation",
    }.get(folder, "General visual reference")


def write_manifest(assets: list[Asset]) -> None:
    with (PACK / "MANIFEST.csv").open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["reference_number", "file", "folder", "source_title", "source_page", "direct_image_or_video", "origin", "video_timestamp", "dimensions", "sha256", "developer_use", "notes"])
        for index, asset in enumerate(assets, start=1):
            with Image.open(asset.path) as image:
                dimensions = f"{image.width}x{image.height}"
            writer.writerow([
                index, asset.path.relative_to(PACK).as_posix(), asset.folder, asset.source_title,
                asset.source_page, asset.image_url, asset.origin, asset.timestamp, dimensions,
                hashlib.sha256(asset.path.read_bytes()).hexdigest(), developer_use(asset.folder), asset.notes,
            ])


def write_readme(assets: list[Asset]) -> None:
    counts: dict[str, int] = {}
    for asset in assets:
        counts[asset.folder] = counts.get(asset.folder, 0) + 1
    lines = [
        "MOTOGP 26 / PS5 — 100-IMAGE GAME-DEVELOPMENT REFERENCE PACK",
        "================================================================", "",
        f"Exactly {len(assets)} numbered high-quality JPEG references, plus source manifest and contact sheets.", "",
        "FOLDER BREAKDOWN",
    ]
    lines.extend(f"- {folder}: {count}" for folder, count in sorted(counts.items()))
    lines.extend([
        "", "DEVELOPER USE",
        "- Bike modeling: fairing silhouette, seams, winglets, cockpit, suspension, brakes, wheels, tires, materials and livery placement.",
        "- Rider modeling/animation: suit construction, helmet proportion, gloves/boots, lean posture, knee/elbow contact and weight transfer.",
        "- Tracks/environments: asphalt variation, curbs, barriers, fencing, pit buildings, grandstands, vegetation, weather and scale cues.",
        "- Gameplay: chase/onboard/replay camera behavior, braking pitch, corner entry, racing lines, pack spacing, wet grip and feedback.",
        "- UI/UX: information hierarchy, typography, telemetry, race status, career/garage/setup flows, focus states and safe areas.",
        "- Rendering/VFX: wet surfaces, spray, reflections, motion blur, depth of field, particles, lighting, color grade and broadcast framing.",
        "", "PLATFORM ACCURACY",
        "Folder 01 is taken directly from the official PlayStation Store PS5 listing. Other images represent the same MotoGP 26 game through official promotional media or public galleries, but not every item is explicitly identified by its source as a PS5 capture.",
        "", "RIGHTS NOTICE",
        "This pack is for internal visual research and developer reference. It does not transfer copyright, trademark, sponsor-livery, rider-likeness or redistribution rights.",
        "Do not ship, publish, resell, or redistribute these images without permission. Re-create principles rather than copying protected logos, liveries, branded UI or identifiable assets one-to-one.",
        "Every reference includes a source page in MANIFEST.csv.",
        "", "QUALITY CONTROL",
        "- Exactly 100 numbered references.",
        "- Low-resolution, blank, extreme-aspect and near-duplicate candidates rejected.",
        "- Images normalized to progressive JPEG without upscaling beyond source detail.",
        "- Dimensions and SHA-256 recorded in MANIFEST.csv.",
    ])
    (PACK / "README.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def contact_sheets(assets: list[Asset]) -> None:
    destination = PACK / "CONTACT_SHEETS"
    destination.mkdir(exist_ok=True)
    groups: dict[str, list[Asset]] = {}
    for asset in assets:
        groups.setdefault(asset.folder, []).append(asset)
    for folder, items in sorted(groups.items()):
        width, height, columns = 384, 216, 4
        rows = math.ceil(len(items) / columns)
        sheet = Image.new("RGB", (columns * width, rows * (height + 34)), (18, 18, 18))
        draw = ImageDraw.Draw(sheet)
        font = ImageFont.load_default()
        for index, asset in enumerate(items):
            x = (index % columns) * width
            y = (index // columns) * (height + 34)
            with Image.open(asset.path) as image:
                thumb = ImageOps.fit(image.convert("RGB"), (width, height), Image.Resampling.LANCZOS)
            sheet.paste(thumb, (x, y))
            draw.text((x + 6, y + height + 9), asset.path.name[:49], font=font, fill=(240, 240, 240))
        sheet.save(destination / f"{folder}.jpg", "JPEG", quality=88, optimize=True)


def package() -> None:
    ZIP_PATH.unlink(missing_ok=True)
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(PACK.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(OUT))
    with zipfile.ZipFile(ZIP_PATH) as archive:
        images = [name for name in archive.namelist() if re.search(r"/REF_\d{3}_.*\.jpg$", name, re.I)]
        if len(images) != 100:
            raise RuntimeError(f"ZIP contains {len(images)} references, expected 100")
        broken = archive.testzip()
        if broken:
            raise RuntimeError(f"ZIP integrity failure: {broken}")


def main() -> int:
    reset()
    hashes: list[str] = []
    assets = download_candidates(collect_candidates(), hashes)
    print(f"Usable still images: {len(assets)}")
    add_video_frames(assets, hashes)
    if len(assets) < 100:
        raise RuntimeError(f"Collected only {len(assets)} usable images")
    assets = assets[:100]
    renumber(assets)
    write_manifest(assets)
    write_readme(assets)
    contact_sheets(assets)
    package()
    print(f"READY {ZIP_PATH}")
    print(f"SIZE {ZIP_PATH.stat().st_size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
