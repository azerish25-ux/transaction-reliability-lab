#!/usr/bin/env python3
"""MotoGP 26 pack builder v2: use direct Steam-hosted official trailers."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import build_motogp26_reference_pack as base

STEAM_API = "https://store.steampowered.com/api/appdetails?appids=3875050&l=english"
STEAM_PAGE = "https://store.steampowered.com/app/3875050/MotoGP_26/"
FALLBACK_STEAM_VIDEOS = [
    "https://video.fastly.steamstatic.com/store_trailers/3875050/1550227610/c847b05ae66b201daf8759c50072ab7b96eaf3fd/1777298242/microtrailer.mp4",
    "https://video.fastly.steamstatic.com/store_trailers/3875050/1856245454/2a9c8befebc3d5c016971a1e37b594cb06cddd07/1772181888/microtrailer.mp4",
]


def steam_movies() -> list[tuple[str, str]]:
    movies: list[tuple[str, str]] = []
    try:
        payload = base.get(STEAM_API).json()
        data = payload.get("3875050", {}).get("data", {})
        for index, movie in enumerate(data.get("movies", []), start=1):
            mp4 = movie.get("mp4") or {}
            webm = movie.get("webm") or {}
            url = mp4.get("max") or mp4.get("480") or webm.get("max") or webm.get("480")
            if url:
                movies.append((str(movie.get("name") or f"Official Steam trailer {index}"), url))
    except Exception as exc:
        print(f"Steam movie API failed: {exc}")
    known = {url for _, url in movies}
    for index, url in enumerate(FALLBACK_STEAM_VIDEOS, start=1):
        if url not in known:
            movies.append((f"Official Steam microtrailer {index}", url))
    return movies


def download_direct(url: str, path: Path) -> bool:
    try:
        with base.SESSION.get(url, stream=True, timeout=(20, 120), allow_redirects=True) as response:
            response.raise_for_status()
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        handle.write(chunk)
        print(f"Downloaded official trailer: {path.name} ({path.stat().st_size} bytes)")
        return path.stat().st_size > 250_000
    except Exception as exc:
        path.unlink(missing_ok=True)
        print(f"Direct trailer failed {url}: {exc}")
        return False


def add_steam_video_frames(assets: list[base.Asset], hashes: list[str]) -> None:
    movies = steam_movies()
    if not movies:
        print("No Steam-hosted movies found")
        return

    for movie_index, (title, url) in enumerate(movies, start=1):
        needed = 100 - len(assets)
        if needed <= 0:
            return
        suffix = ".webm" if ".webm" in url.lower() else ".mp4"
        video = base.WORK / f"steam_official_{movie_index:02d}{suffix}"
        if not download_direct(url, video):
            continue
        try:
            duration = float(base.run([
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(video),
            ]).strip())
        except Exception as exc:
            print(f"Could not probe {video}: {exc}")
            continue
        if duration <= 1:
            continue

        sample_count = max(needed * 5, 80)
        margin = min(2.0, duration * 0.03)
        usable = max(0.5, duration - 2 * margin)
        frame_dir = base.WORK / "steam_frames" / f"movie_{movie_index:02d}"
        frame_dir.mkdir(parents=True, exist_ok=True)

        for sample_index in range(sample_count):
            if len(assets) >= 100:
                return
            timestamp = margin + usable * (sample_index + 0.5) / sample_count
            raw = frame_dir / f"frame_{sample_index:04d}.jpg"
            result = subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{timestamp:.3f}",
                "-i", str(video), "-frames:v", "1",
                "-vf", "scale=1920:-2:force_original_aspect_ratio=decrease",
                "-q:v", "2", "-y", str(raw),
            ], check=False)
            if result.returncode != 0 or not raw.exists() or raw.stat().st_size < 30_000:
                continue

            destination = base.PACK / "05_official_video_frames" / f"steam_{movie_index:02d}_{sample_index:04d}.jpg"
            try:
                phash, _, _ = base.normalize_image(raw.read_bytes(), destination)
                if base.duplicate(phash, hashes, threshold=5):
                    destination.unlink(missing_ok=True)
                    continue
                hashes.append(phash)
                assets.append(base.Asset(
                    destination,
                    "05_official_video_frames",
                    title,
                    STEAM_PAGE,
                    url,
                    "Official Steam-hosted MotoGP 26 trailer frame",
                    timestamp=f"{timestamp:.2f}s",
                    notes="Direct official store trailer frame for internal visual reference",
                ))
                print(f"Accepted direct trailer frame {len(assets):03d}: {title} at {timestamp:.2f}s")
            except Exception as exc:
                destination.unlink(missing_ok=True)
                print(f"Trailer frame rejected: {exc}")


base.add_video_frames = add_steam_video_frames

if __name__ == "__main__":
    sys.exit(base.main())
