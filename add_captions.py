#!/usr/bin/env python3
"""
add_captions.py — Auto-generate and burn in word-by-word captions, matching
the bold, punchy, TikTok/Shorts-style look OpusClip uses.

How it works:
  1. Transcribes the video's audio using Whisper (free, runs locally on your
     own machine, no API costs, no internet needed after the one-time model
     download).
  2. Gets WORD-LEVEL timestamps (not just sentence-level), so captions can
     update every word or two, like Opus/CapCut-style captions do.
  3. Groups words into short chunks and builds a styled .ass subtitle file
     (bold white text, black outline, centered lower-third).
  4. Burns the captions directly into the video with ffmpeg.

Meant to run AFTER make_short.py — feed it the clip make_short.py already
produced, and this adds captions as a second pass.

REQUIREMENTS (install once):
  pip install faster-whisper
  ffmpeg must be installed and on your PATH (same as make_short.py needs)

USAGE:
  python add_captions.py <input_video> [options]

EXAMPLES:
  # Basic — transcribe and caption, 2 words per caption chunk (default)
  python add_captions.py short_1432-1505.mp4

  # Custom output name
  python add_captions.py short_1432-1505.mp4 -o final_clip.mp4

  # One word at a time (punchier, more "viral clip" style)
  python add_captions.py short_1432-1505.mp4 --words-per-chunk 1

  # Bigger/smaller text
  python add_captions.py short_1432-1505.mp4 --font-size 110

  # Use a more accurate (but slower) Whisper model
  python add_captions.py short_1432-1505.mp4 --model small
"""

import argparse
import subprocess
import sys
import shutil
import tempfile
import os


def check_dependencies():
    missing = []
    if shutil.which("ffmpeg") is None:
        missing.append("ffmpeg")
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        missing.append("faster-whisper (pip install faster-whisper)")
    if missing:
        print("Missing dependencies: " + ", ".join(missing))
        print("See the REQUIREMENTS section at the top of this script.")
        sys.exit(1)


def extract_audio(video_path, audio_path):
    cmd = ["ffmpeg", "-y", "-i", video_path, "-map", "0:a:0?", "-vn",
           "-af", "loudnorm", "-acodec", "pcm_s16le",
           "-ar", "16000", "-ac", "1", audio_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not os.path.exists(audio_path):
        print("Failed to extract audio from the video. ffmpeg said:")
        print(result.stderr[-1500:])
        sys.exit(1)
    size = os.path.getsize(audio_path)
    if size < 1000:
        print(f"Warning: extracted audio file is suspiciously small ({size} bytes) "
              "-- the source video may have no audio track, or a silent one.")


def transcribe(audio_path, model_size="base", language=None, use_vad=False):
    """Returns a flat list of (word_text, start_sec, end_sec)."""
    from faster_whisper import WhisperModel

    print(f"Loading Whisper model '{model_size}' (first run downloads it, ~1min)...")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    print("Transcribing...")
    vad_kwargs = {}
    if use_vad:
        vad_kwargs = {"vad_filter": True, "vad_parameters": {"min_silence_duration_ms": 150}}
    segments, info = model.transcribe(
        audio_path,
        word_timestamps=True,
        language=language,
        no_speech_threshold=0.3,
        condition_on_previous_text=False,
        log_prob_threshold=-2.0,
        compression_ratio_threshold=3.0,
        beam_size=5,
        **vad_kwargs,
    )
    print(f"Detected language: {info.language} (confidence {info.language_probability:.2f})")

    words = []
    segment_count = 0
    for segment in segments:
        segment_count += 1
        print(f"  [{segment.start:.1f}s - {segment.end:.1f}s] {segment.text.strip()!r}")
        for w in segment.words:
            words.append((w.word.strip(), w.start, w.end))

    if segment_count == 0:
        print(
            "\nWhisper found 0 segments in this audio. Common causes:\n"
            "  - The clip's audio is mostly music/SFX with little clear speech\n"
            "  - Wrong language was auto-detected -- try --language en\n"
            "  - The audio track didn't extract correctly -- check the .wav "
            "with --keep-audio and play it back\n"
            "  - Try a larger model: --model small or --model medium"
        )
    elif not words:
        print("\nSegments were found but had no word-level timestamps -- unusual, "
              "try --model small for a more reliable model.")

    return words


def group_words(words, words_per_chunk=2):
    chunks = []
    for i in range(0, len(words), words_per_chunk):
        group = words[i:i + words_per_chunk]
        if not group:
            continue
        text = " ".join(w[0] for w in group).upper()
        start = group[0][1]
        end = group[-1][2]
        chunks.append((text, start, end))
    return chunks


def to_ass_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def build_ass(chunks, ass_path, font_size=90, position="bottom"):
    # Alignment: 2 = bottom-center, 5 = middle-center, 8 = top-center (libass numpad convention)
    align = {"bottom": 2, "middle": 5, "top": 8}.get(position, 2)
    margin_v = 300 if position == "bottom" else (0 if position == "middle" else 300)

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,{font_size},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,6,0,{align},60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = [
        f"Dialogue: 0,{to_ass_time(start)},{to_ass_time(end)},Caption,,0,0,0,,{text}"
        for text, start, end in chunks
    ]
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(header + "\n".join(events))


def escape_ffmpeg_filter_path(path):
    """Make a filesystem path safe to embed inside an ffmpeg -vf filtergraph
    string. The subtitles filter's parser treats backslash as its own escape
    character, so a raw Windows path (C:\\Users\\...) gets mangled -- silently
    eaten backslashes, "file not found" errors that don't look like a path
    problem. Converting to forward slashes sidesteps that; ffmpeg/Windows
    both accept forward slashes in paths. The drive-letter colon still needs
    escaping since ':' is a filter-option separator.
    """
    p = path.replace("\\", "/")
    p = p.replace(":", "\\:")
    return p


def burn_captions(video_path, ass_path, out_path):
    escaped = escape_ffmpeg_filter_path(ass_path)
    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-vf", f"subtitles='{escaped}'",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "copy",
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print("ffmpeg failed while burning in captions:")
        print(result.stderr[-2000:])
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_video", help="Path to the video to caption (e.g. output of make_short.py)")
    parser.add_argument("-o", "--output", default=None, help="Output filename (default: <input>_captioned.mp4)")
    parser.add_argument("--words-per-chunk", type=int, default=2, help="How many words shown at once (1 = punchiest, default 2)")
    parser.add_argument("--font-size", type=int, default=90, help="Caption font size (default 90)")
    parser.add_argument("--position", choices=["top", "middle", "bottom"], default="bottom", help="Where captions sit (default bottom)")
    parser.add_argument("--model", default="small", choices=["tiny", "base", "small", "medium", "large"],
                         help="Whisper model size: tiny/base are fast but miss a lot on noisy audio, small is a good balance (default), medium/large are more accurate but slower")
    parser.add_argument("--language", default=None, help="Force a language code (e.g. 'en') instead of auto-detecting -- try this if 0 segments are found")
    parser.add_argument("--use-vad", action="store_true", help="Enable voice-activity-detection pre-filtering. Can help isolate short bursts on some audio, but on loud/chaotic sources it may skip real speech entirely -- off by default for that reason")
    parser.add_argument("--keep-srt", action="store_true", help="Also save the generated .ass caption file alongside the video")
    parser.add_argument("--keep-audio", action="store_true", help="Also save the extracted .wav audio alongside the video, for debugging")
    args = parser.parse_args()

    check_dependencies()

    out_path = args.output or (os.path.splitext(args.input_video)[0] + "_captioned.mp4")

    with tempfile.TemporaryDirectory() as tmp:
        audio_path = os.path.join(tmp, "audio.wav") if not args.keep_audio else \
            os.path.splitext(out_path)[0] + "_audio.wav"
        ass_path = os.path.join(tmp, "captions.ass") if not args.keep_srt else \
            os.path.splitext(out_path)[0] + ".ass"

        print("Extracting audio...")
        extract_audio(args.input_video, audio_path)

        words = transcribe(audio_path, model_size=args.model, language=args.language, use_vad=args.use_vad)
        if not words:
            print("No usable speech found -- see diagnostics above. Nothing to caption.")
            sys.exit(1)

        chunks = group_words(words, words_per_chunk=args.words_per_chunk)
        build_ass(chunks, ass_path, font_size=args.font_size, position=args.position)

        print("Burning in captions...")
        burn_captions(args.input_video, ass_path, out_path)

    print(f"\nDone! Saved to: {out_path}")


if __name__ == "__main__":
    main()
