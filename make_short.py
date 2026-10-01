#!/usr/bin/env python3
"""
make_short.py — Pull one clip straight out of a YouTube video and turn it
into a clean, watermark-free vertical (9:16) Short.

Why this doesn't download the whole video:
  yt-dlp resolves the direct video/audio stream URLs for a YouTube link.
  ffmpeg then seeks straight to your start time on that stream and only
  reads up through your end time — so a 2-hour, 60GB video costs you only
  the size of the clip itself, not the full file.

REQUIREMENTS (install once):
  pip install yt-dlp
  ffmpeg must be installed and on your PATH:
    - Windows: https://www.gyan.dev/ffmpeg/builds/ (or `winget install ffmpeg`)
    - Mac:     brew install ffmpeg
    - Linux:   sudo apt install ffmpeg

USAGE:
  python make_short.py <youtube_url> <start> <end> [options]

  <start> / <end> — timestamps in the ORIGINAL long-form video, format
                     HH:MM:SS or MM:SS (e.g. 14:32 or 1:04:12)

EXAMPLES:
  # Basic clip, cropped to vertical, no captions
  python make_short.py "https://youtu.be/XXXXXXXX" 14:32 15:05

  # Custom output name
  python make_short.py "https://youtu.be/XXXXXXXX" 14:32 15:05 -o my_clip.mp4

  # Add burned-in captions from an .srt file you already have
  python make_short.py "https://youtu.be/XXXXXXXX" 14:32 15:05 --captions clip.srt

  # Keep original (horizontal) framing instead of reframing to vertical
  python make_short.py "https://youtu.be/XXXXXXXX" 14:32 15:05 --mode none

  # Hard-crop to vertical (zooms in, crops off the sides) instead of the
  # default blurred-background fill
  python make_short.py "https://youtu.be/XXXXXXXX" 14:32 15:05 --mode hardcrop

  # Adjust how much the foreground is enlarged in blurfill mode (default 1.2 = 20%)
  python make_short.py "https://youtu.be/XXXXXXXX" 14:32 15:05 --zoom 1.35
"""

import argparse
import subprocess
import sys
import shutil


def check_dependencies():
    missing = []
    if shutil.which("ffmpeg") is None:
        missing.append("ffmpeg")
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        missing.append("yt-dlp (pip install yt-dlp)")
    if missing:
        print("Missing dependencies: " + ", ".join(missing))
        print("See the REQUIREMENTS section at the top of this script.")
        sys.exit(1)


# When YouTube answers "Sign in to confirm you're not a bot" (common from
# cloud servers like GitHub's), these clients sometimes still get through.
BOT_CHECK_FALLBACK_CLIENTS = (["web_safari"], ["mweb"])


def get_stream_urls(youtube_url, cookies=None):
    """Resolve direct video+audio stream URLs via yt-dlp, without downloading."""
    import yt_dlp

    ydl_opts = {
        "quiet": True,
        "format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
    }
    if cookies:
        ydl_opts["cookiefile"] = cookies
    attempts = [{}] + [{"extractor_args": {"youtube": {"player_client": c}}} for c in BOT_CHECK_FALLBACK_CLIENTS]
    for n, extra in enumerate(attempts):
        try:
            with yt_dlp.YoutubeDL({**ydl_opts, **extra}) as ydl:
                info = ydl.extract_info(youtube_url, download=False)
            break
        except yt_dlp.utils.DownloadError as e:
            if "not a bot" not in str(e) or n == len(attempts) - 1:
                raise
            print("YouTube asked for a bot check -- retrying as a different client...")

    # If yt-dlp already merged into one format with both audio+video
    if info.get("url") and info.get("acodec") != "none" and info.get("vcodec") != "none":
        return info["url"], None, info.get("title", "video")

    # Otherwise pull separate video/audio stream URLs from requested_formats
    video_url, audio_url = None, None
    for f in info.get("requested_formats", []):
        if f.get("vcodec") != "none" and video_url is None:
            video_url = f["url"]
        if f.get("acodec") != "none" and audio_url is None:
            audio_url = f["url"]

    if video_url is None:
        video_url = info["url"]

    return video_url, audio_url, info.get("title", "video")


def build_ffmpeg_cmd(video_url, audio_url, start, end, out_path, crop_vertical, captions, zoom=1.0):
    cmd = ["ffmpeg", "-y"]

    # Seek BEFORE -i on the input so ffmpeg jumps straight there on the
    # remote stream rather than reading from the beginning.
    cmd += ["-ss", start, "-to", end, "-i", video_url]
    if audio_url:
        cmd += ["-ss", start, "-to", end, "-i", audio_url]

    filter_complex = None
    simple_filters = []

    if crop_vertical == "hardcrop":
        # Scale up to cover a 1080x1920 canvas, then center-crop the edges off.
        simple_filters.append(
            "scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,setsar=1"
        )
    elif crop_vertical == "blurfill":
        # Fit the WHOLE frame into 1080x1920 (nothing cropped off), then
        # enlarge that foreground slightly (zoom) so it reads bigger on
        # screen -- matches OpusClip's default look, which doesn't leave
        # the foreground at a small "shrunk to fit" size. Overflow off the
        # 1080x1920 canvas is auto-clipped by the overlay filter, so a
        # zoom > 1.0 crops a bit off whichever edge is now too long.
        # Fill the empty top/bottom space with a blurred, zoomed copy of
        # the same video as a background.
        fg_scale = "scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1"
        if zoom != 1.0:
            fg_scale += f",scale=iw*{zoom}:ih*{zoom}"
        filter_complex = (
            f"[0:v]{fg_scale}[fg];"
            "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,gblur=sigma=20,setsar=1[bg];"
            "[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto,setsar=1[vout]"
        )

    if captions:
        # Burn in subtitles from an .srt/.ass file
        escaped = captions.replace("\\", "/").replace(":", "\\:")
        sub_filter = f"subtitles='{escaped}'"
        if filter_complex:
            filter_complex = filter_complex.replace("[vout]", "[pre]") + f";[pre]{sub_filter}[vout]"
        else:
            simple_filters.append(sub_filter)

    audio_input_idx = 1 if audio_url else 0

    if filter_complex:
        cmd += ["-filter_complex", filter_complex, "-map", "[vout]"]
        cmd += ["-map", f"{audio_input_idx}:a:0?"]
    else:
        if simple_filters:
            cmd += ["-vf", ",".join(simple_filters)]
        cmd += ["-map", "0:v:0", "-map", f"{audio_input_idx}:a:0?"]

    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac"]
    # Put the index at the front of the file so browsers can start playing
    # it before the whole download finishes (the web app previews shorts).
    cmd += ["-movflags", "+faststart"]
    cmd += [out_path]
    return cmd


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url", help="YouTube video URL")
    parser.add_argument("start", help="Clip start time, e.g. 14:32 or 1:04:12")
    parser.add_argument("end", help="Clip end time, e.g. 15:05")
    parser.add_argument("-o", "--output", default=None, help="Output filename (default: short_<start>-<end>.mp4)")
    parser.add_argument("--captions", default=None, help="Path to an .srt/.ass subtitle file to burn in")
    parser.add_argument(
        "--mode", choices=["blurfill", "hardcrop", "none"], default="blurfill",
        help=(
            "How to reframe to 9:16. 'blurfill' (default): fits the full frame in, "
            "fills empty space with a blurred background -- matches OpusClip's look, "
            "nothing gets cropped off. 'hardcrop': zooms in and crops the sides off "
            "entirely. 'none': keeps the original horizontal framing."
        ),
    )
    parser.add_argument(
        "--zoom", type=float, default=1.2,
        help=(
            "Only affects --mode blurfill. How much to enlarge the foreground "
            "footage before centering it on the vertical canvas, as a multiplier "
            "(1.0 = no zoom, 1.2 = 20%% bigger, matching OpusClip's default look). "
            "Higher values crop more off the long edge; 1.0 shows the full frame "
            "with no cropping at all."
        ),
    )
    parser.add_argument(
        "--cookies", default=None,
        help="Netscape-format YouTube cookies file, if YouTube asks you to sign in",
    )
    args = parser.parse_args()

    check_dependencies()

    print(f"Resolving stream for: {args.url}")
    import yt_dlp
    try:
        video_url, audio_url, title = get_stream_urls(args.url, cookies=args.cookies)
    except yt_dlp.utils.DownloadError as e:
        print(f"\nyt-dlp couldn't get the video: {e}")
        if "not a bot" in str(e):
            print("YouTube is bot-checking this connection -- pass --cookies (or add the "
                  "YT_COOKIES secret on GitHub, see README).")
        sys.exit(1)

    out_path = args.output or f"short_{args.start.replace(':', '')}-{args.end.replace(':', '')}.mp4"

    cmd = build_ffmpeg_cmd(
        video_url, audio_url, args.start, args.end, out_path,
        crop_vertical=args.mode, captions=args.captions, zoom=args.zoom,
    )

    print(f"Extracting clip [{args.start} - {args.end}] from '{title}'...")
    result = subprocess.run(cmd)

    if result.returncode == 0:
        print(f"\nDone! Saved to: {out_path}")
    else:
        print("\nffmpeg failed — see the error output above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
