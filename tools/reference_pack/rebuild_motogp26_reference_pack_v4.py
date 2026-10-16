#!/usr/bin/env python3
"""Collision-safe runner for the visually audited MotoGP 26 pack rebuild."""
from __future__ import annotations

import sys
from pathlib import Path

import rebuild_motogp26_reference_pack_v3 as base

# The two full official trailers provide enough diverse full-resolution game
# imagery. The four short Steam feature loops are only 1170x336, so omit them
# rather than lowering the pack's minimum reference resolution.
base.VIDEOS = base.VIDEOS[:2]


def extract_frames(
    assets: list[base.Asset],
    hashes: list[str],
    spec: dict[str, object],
    video: Path,
    video_index: int,
    quota: int,
    oversample: int = 6,
) -> int:
    duration = base.probe_duration(video)
    margin = min(3.0, duration * 0.08)
    usable = max(0.5, duration - 2 * margin)
    candidate_count = max(quota * oversample, quota + 16)
    fps = max(0.5, min(6.0, candidate_count / usable))
    pass_id = f"{video_index:02d}_{len(assets):03d}_{quota}_{oversample}"
    directory = base.WORK / "frames" / pass_id
    directory.mkdir(parents=True, exist_ok=True)
    pattern = directory / "frame_%05d.jpg"
    base.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-ss", f"{margin:.3f}", "-i", str(video), "-t", f"{usable:.3f}",
        "-vf", f"fps={fps:.6f},scale='min(1920,iw)':-2:flags=lanczos",
        "-q:v", "2", "-y", str(pattern),
    ])
    candidates = sorted(directory.glob("frame_*.jpg"))
    accepted = 0
    for candidate_index in base.spread_order(len(candidates), quota):
        if accepted >= quota or len(assets) >= 100:
            break
        candidate = candidates[candidate_index]
        timestamp = margin + (candidate_index + 0.5) / fps
        serial = len(assets) + 1
        destination = base.PACK / str(spec["folder"]) / (
            f"video_{video_index:02d}_ref_{serial:03d}_pass_{pass_id}_frame_{candidate_index:05d}.jpg"
        )
        try:
            phash = base.normalize(candidate.read_bytes(), destination)
            if base.near_duplicate(phash, hashes, threshold=6):
                destination.unlink(missing_ok=True)
                continue
            hashes.append(phash)
            assets.append(base.Asset(
                destination,
                str(spec["folder"]),
                str(spec["title"]),
                base.STEAM_PAGE,
                str(spec["url"]),
                "Official Steam-hosted MotoGP 26 video frame",
                f"{timestamp:.2f}s",
                "Verified official MotoGP 26 game media",
            ))
            accepted += 1
            print(f"Accepted {len(assets):03d}: {spec['title']} @ {timestamp:.2f}s")
        except Exception as exc:
            destination.unlink(missing_ok=True)
            print(f"Frame rejected {spec['title']} @ {timestamp:.2f}s: {exc}")
    return accepted


base.extract_frames = extract_frames

if __name__ == "__main__":
    sys.exit(base.main())
