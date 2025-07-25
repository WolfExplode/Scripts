"""
Convert every *.mp4 in the current directory to *.mp3 with
the first frame as front-cover artwork.

Requires ffmpeg on PATH.
"""
import argparse
import concurrent.futures
import os
import subprocess
import sys
from pathlib import Path

# ------------------------- helpers -------------------------
def quote(s: str) -> str:
    return f'"{s}"'

def run(cmd: list[str]) -> None:
    """Run an ffmpeg command list, raise on non-zero exit."""
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def convert_one(src: Path, dst_dir: Path) -> None:
    """Convert a single file."""
    dst = dst_dir / f"{src.stem}.mp3"
    jpg = dst_dir / f"{src.stem}.jpg"

    try:
        # 1) grab 1st video frame
        run([
            "ffmpeg", "-y", "-i", str(src),
            "-frames:v", "1", "-q:v", "2", str(jpg)
        ])

        # 2) mux audio + picture (front-cover type 3)
        run([
            "ffmpeg", "-y",
            "-i", str(src),
            "-i", str(jpg),
            "-map", "0:a", "-map", "1:v",
            "-c:a", "libmp3lame", "-q:a", "0",
            "-id3v2_version", "3",
            "-metadata:s:v", "title=Album cover",
            "-metadata:s:v", "comment=Cover (front)",
            str(dst)
        ])
    finally:
        # 3) tidy up
        jpg.unlink(missing_ok=True)

# ------------------------- main -------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description="Batch MP4 → MP3 with embedded front-cover")
    ap.add_argument("-j", "--jobs", type=int, default=os.cpu_count(),
                    help="max concurrent ffmpeg processes (default: all cores)")
    args = ap.parse_args()

    src_dir = Path.cwd()
    dst_dir = src_dir / "mp3"
    dst_dir.mkdir(exist_ok=True)

    mp4s = list(src_dir.glob("*.mp4"))
    if not mp4s:
        print("No *.mp4 files found.", file=sys.stderr)
        sys.exit(1)

    print(f"Converting {len(mp4s)} files with {args.jobs} workers …")
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(convert_one, f, dst_dir): f for f in mp4s}
        for fut in concurrent.futures.as_completed(futures):
            src = futures[fut]
            try:
                fut.result()
            except Exception as e:
                print(f"❌ {src.name}: {e}", file=sys.stderr)
            else:
                done += 1
                print(f"✅ {done}/{len(mp4s)}  {src.name}")

if __name__ == "__main__":
    main()