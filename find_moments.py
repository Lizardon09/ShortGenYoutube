#!/usr/bin/env python3
"""
find_moments.py — Find the moments in a long YouTube video most worth turning
into Shorts, the way OpusClip's clip recommendations do.

How it picks moments:
  1. Pulls the video's metadata with yt-dlp (no download), including YouTube's
     "Most Replayed" heatmap -- real audience rewatch data, which YouTube only
     shows once a video has enough views.
  2. Gets a word-timed transcript: YouTube's own captions when available
     (instant, nothing downloaded), otherwise downloads just the audio and
     runs Whisper on it (the same transcriber add_captions.py uses).
  3. Sends the transcript + heatmap to Claude, which picks self-contained
     clips and scores each on OpusClip's four criteria: hook, flow, value,
     trend.
  4. Snaps every clip's start/end onto word boundaries so cuts never land
     mid-word, and blends Claude's score with the replay data.

Writes a JSON file of ranked moments. Any start/end pair in it can be fed
straight into make_short.py.

REQUIREMENTS (install once):
  pip install yt-dlp anthropic faster-whisper
  ffmpeg on your PATH (only used when the video has no captions)
  ANTHROPIC_API_KEY set in your environment

USAGE:
  python find_moments.py <youtube_url> [options]

EXAMPLES:
  # 8 clips, 20-60s each (defaults)
  python find_moments.py "https://youtu.be/XXXXXXXX"

  # Fewer, shorter clips
  python find_moments.py "https://youtu.be/XXXXXXXX" --clips 5 --min 15 --max 40

  # Steer what counts as a good moment
  python find_moments.py "https://youtu.be/XXXXXXXX" --instructions "only the funniest moments"
"""

import argparse
import bisect
import json
import os
import sys
import tempfile

MODEL = "claude-opus-5-5"

# Every viewer starts at 0:00, so the first few heatmap buckets are always
# near 1.0 regardless of content. Ignore them when judging replay peaks.
INTRO_SKIP_FRACTION = 0.03

# Padding around snapped word boundaries -- caption word timings are
# approximate, and a hair of breathing room sounds less abrupt.
PAD_BEFORE = 0.15
PAD_AFTER = 0.35

SYSTEM_PROMPT = """You are an experienced short-form video editor. You pick moments from long videos that will work as standalone YouTube Shorts, TikToks and Reels.

A good clip:
- Hooks in the first 3 seconds. It opens on a striking claim, a question, the setup of a joke, or an emotional beat, not on filler ("so", "um", "anyway") or on a reply to something the viewer never heard.
- Stands alone. Someone who never saw the full video understands it, with no dangling references to earlier context.
- Has a shape: setup, build, payoff. It ends right after the payoff (the punchline, the answer, the reveal), not mid-thought.
- Is worth sharing: funny, surprising, useful, moving, or provocative enough that people comment or send it to a friend.

Score each clip from 0 to 100 on:
- hook_score: how strongly the first 3 seconds stop the scroll
- flow_score: whether it makes sense on its own and lands on a payoff
- value_score: entertainment, insight, or emotional pull
- trend_score: how well the topic fits what people currently talk about and search for
and give an overall virality score from 0 to 100 (your overall judgment, not an average).

When audience replay data is provided, treat its peaks as strong evidence that viewers found that part worth rewatching, and cover the strongest peaks unless the transcript there is unusable (music, silence, an ad read). Replay buckets are coarse, so take exact boundaries from the transcript.

Transcript timestamps are seconds from the start of the video. Return start and end in seconds: start at the first word of the hook, end on the last word of the payoff. Clips must not overlap."""

MOMENTS_SCHEMA = {
    "type": "object",
    "properties": {
        "moments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start": {"type": "number", "description": "Clip start, seconds from video start"},
                    "end": {"type": "number", "description": "Clip end, seconds from video start"},
                    "title": {"type": "string", "description": "Catchy title for the Short, under 70 characters"},
                    "hook": {"type": "string", "description": "The clip's opening line, quoted from the transcript"},
                    "reason": {"type": "string", "description": "One sentence on why this clip works"},
                    "hook_score": {"type": "integer"},
                    "flow_score": {"type": "integer"},
                    "value_score": {"type": "integer"},
                    "trend_score": {"type": "integer"},
                    "virality": {"type": "integer"},
                },
                "required": ["start", "end", "title", "hook", "reason", "hook_score",
                             "flow_score", "value_score", "trend_score", "virality"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["moments"],
    "additionalProperties": False,
}


def fail(message):
    # In GitHub Actions, "::error::" lines become annotations the web app
    # can show without making you dig through the run log.
    prefix = "::error::" if os.environ.get("GITHUB_ACTIONS") == "true" else "Error: "
    print(prefix + message, file=sys.stderr)
    sys.exit(1)


def check_dependencies():
    missing = []
    for module, pip_name in (("yt_dlp", "yt-dlp"), ("anthropic", "anthropic")):
        try:
            __import__(module)
        except ImportError:
            missing.append(f"{pip_name} (pip install {pip_name})")
    if missing:
        print("Missing dependencies: " + ", ".join(missing))
        print("See the REQUIREMENTS section at the top of this script.")
        sys.exit(1)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        fail("ANTHROPIC_API_KEY is not set.")


def fmt_ts(seconds):
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def ydl_opts(cookies=None, **extra):
    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    if cookies:
        opts["cookiefile"] = cookies
    opts.update(extra)
    return opts


# ---------------------------------------------------------------- transcript

def pick_caption_track(info):
    """Choose the best json3 caption track: human-written subs in the video's
    own language first, then YouTube's auto-generated ones."""
    lang = info.get("language")
    manual = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}

    candidates = []
    if lang:
        candidates += [(manual, k, "youtube-captions") for k in manual if k.split("-")[0] == lang]
        candidates += [(auto, f"{lang}-orig", "youtube-auto-captions"), (auto, lang, "youtube-auto-captions")]
    # "-orig" marks the track in the spoken language (the rest are machine translations)
    candidates += [(auto, k, "youtube-auto-captions") for k in auto if k.endswith("-orig")]
    candidates += [(manual, "en", "youtube-captions"), (auto, "en", "youtube-auto-captions")]

    for tracks, key, source in candidates:
        for fmt in tracks.get(key) or []:
            if fmt.get("ext") == "json3":
                return fmt["url"], source
    return None, None


def parse_json3(data):
    """YouTube json3 captions -> [(word, start_sec, end_sec)]. Auto captions
    carry a timestamp per word; human subs carry one per line, so words
    within a line get evenly spread timings."""
    words = []
    for event in data.get("events", []):
        segs = event.get("segs")
        if not segs or "tStartMs" not in event:
            continue
        ev_start = event["tStartMs"] / 1000
        ev_end = ev_start + event.get("dDurationMs", 0) / 1000
        timed = [(seg.get("utf8", "").strip(), ev_start + seg.get("tOffsetMs", 0) / 1000) for seg in segs]
        timed = [(text, start) for text, start in timed if text]
        for i, (text, seg_start) in enumerate(timed):
            seg_end = timed[i + 1][1] if i + 1 < len(timed) else ev_end
            seg_end = max(seg_end, seg_start + 0.05)
            parts = text.split()
            step = (seg_end - seg_start) / len(parts)
            for j, part in enumerate(parts):
                words.append((part, seg_start + j * step, seg_start + (j + 1) * step))

    # Auto-caption events overlap (each line stays on screen while the next
    # one rolls in), so clamp every word to end where the next one starts.
    words.sort(key=lambda w: w[1])
    for k in range(len(words) - 1):
        nxt = words[k + 1][1]
        if nxt > words[k][1] and words[k][2] > nxt:
            words[k] = (words[k][0], words[k][1], nxt)
    return words


def caption_words(ydl, info):
    url, source = pick_caption_track(info)
    if not url:
        return None, None
    try:
        data = json.loads(ydl.urlopen(url).read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001 -- any failure here just means "fall back to Whisper"
        print(f"Couldn't fetch YouTube captions ({e}); falling back to Whisper.")
        return None, None
    words = parse_json3(data)
    return (words, source) if words else (None, None)


def whisper_words(url, cookies, model_size):
    import yt_dlp
    from add_captions import extract_audio, transcribe

    with tempfile.TemporaryDirectory() as tmp:
        print("No usable captions -- downloading audio for Whisper...")
        opts = ydl_opts(cookies, skip_download=False, format="bestaudio/best",
                        outtmpl=os.path.join(tmp, "source.%(ext)s"))
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            source_path = ydl.prepare_filename(info)
        wav_path = os.path.join(tmp, "audio.wav")
        extract_audio(source_path, wav_path)
        return transcribe(wav_path, model_size=model_size)


def transcript_lines(words, max_gap=1.0, max_len=10.0):
    """Group words into short timestamped lines -- breaking on sentence ends,
    pauses, or every ~10s -- so Claude can cite precise start points."""
    lines, current = [], []
    for w in words:
        if current and (
            w[1] - current[-1][2] > max_gap
            or w[1] - current[0][1] > max_len
            or current[-1][0][-1:] in ".?!"
        ):
            lines.append(current)
            current = []
        current.append(w)
    if current:
        lines.append(current)
    return [f"[{line[0][1]:.1f}] " + " ".join(w[0] for w in line) for line in lines]


# ------------------------------------------------------------------- heatmap

def usable_heatmap(heatmap, duration):
    return [p for p in heatmap or [] if p["start_time"] >= duration * INTRO_SKIP_FRACTION]


def heatmap_lines(heatmap, duration):
    usable = usable_heatmap(heatmap, duration)
    if not usable:
        return []
    values = sorted(p["value"] for p in usable)
    high = values[int(len(values) * 0.75)]
    lines = []
    for i, p in enumerate(heatmap):
        prev_v = heatmap[i - 1]["value"] if i > 0 else -1
        next_v = heatmap[i + 1]["value"] if i + 1 < len(heatmap) else -1
        is_peak = p in usable and p["value"] >= high and p["value"] >= prev_v and p["value"] >= next_v
        lines.append(f"{p['start_time']:.0f}-{p['end_time']:.0f}s: {p['value']:.2f}" + ("  <- peak" if is_peak else ""))
    return lines


def replay_score(start, end, heatmap, duration):
    """How rewatched a clip's span is, as a percentile of the whole video
    (90 = more replayed than 90% of it). None when there's no heatmap."""
    usable = usable_heatmap(heatmap, duration)
    if not usable:
        return None
    weighted, total = 0.0, 0.0
    for p in usable:
        overlap = min(end, p["end_time"]) - max(start, p["start_time"])
        if overlap > 0:
            weighted += p["value"] * overlap
            total += overlap
    if total == 0:
        return None
    mean = weighted / total
    return round(100 * sum(1 for p in usable if p["value"] <= mean) / len(usable))


# --------------------------------------------------------------------- Claude

def build_prompt(info, lines, heatmap, clips, min_len, max_len, instructions):
    duration = info.get("duration") or 0
    parts = ["<transcript>", "\n".join(lines), "</transcript>", ""]

    hm = heatmap_lines(heatmap, duration)
    if hm:
        parts += [
            "<replay_data>",
            "YouTube \"Most Replayed\" heatmap: how often viewers rewatched each part, 0 (least) to 1 (most).",
            "The first few buckets are inflated because every viewer starts at 0:00 -- ignore them.",
            "\n".join(hm),
            "</replay_data>",
            "",
        ]
    else:
        parts += ["No audience replay data is available for this video.", ""]

    parts += [
        f"Video title: {info.get('title', '')}",
        f"Channel: {info.get('channel') or info.get('uploader') or ''}",
        f"Duration: {fmt_ts(duration)} ({duration} seconds)",
    ]
    chapters = info.get("chapters") or []
    if chapters:
        parts.append("Chapters: " + "; ".join(f"{c['start_time']:.0f}s {c.get('title', '')}" for c in chapters))
    description = (info.get("description") or "").strip()
    if description:
        parts.append("Description (truncated): " + description[:1000])
    parts += [
        "",
        f"Pick the {clips} best clips from this video, each between {min_len} and {max_len} seconds long, ranked best first.",
    ]
    if instructions:
        parts.append(f"Additional instructions from the creator: {instructions}")
    return "\n".join(parts)


def ask_claude(prompt, effort):
    import anthropic

    client = anthropic.Anthropic()
    print(f"Asking {MODEL} to pick moments (effort: {effort})...")
    try:
        with client.beta.messages.stream(
            model=MODEL,
            max_tokens=64000,
            # If a safety classifier declines, re-run on Anthropic's
            # recommended fallback model instead of failing outright.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            thinking={"type": "adaptive"},
            output_config={
                "effort": effort,
                "format": {"type": "json_schema", "schema": MOMENTS_SCHEMA},
            },
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            message = stream.get_final_message()
    except anthropic.AuthenticationError:
        fail("Claude rejected the API key -- check ANTHROPIC_API_KEY.")
    except anthropic.RateLimitError:
        fail("Claude API rate limit hit -- wait a minute and try again.")
    except anthropic.APIStatusError as e:
        fail(f"Claude API error {e.status_code}: {e.message}")
    except anthropic.APIConnectionError:
        fail("Couldn't reach the Claude API.")

    if message.stop_reason == "refusal":
        fail("Claude declined to analyze this video.")
    if message.stop_reason == "max_tokens":
        fail("Claude's answer was cut off -- try fewer --clips.")

    usage = message.usage
    print(f"  tokens: {usage.input_tokens} in, {usage.output_tokens} out")
    text = next(b.text for b in message.content if b.type == "text")
    return json.loads(text)["moments"]


# ------------------------------------------------------------ post-processing

def snap_to_words(start, end, words, min_len, max_len, duration):
    """Move start/end onto the nearest word boundaries, then nudge to fit the
    length limits without cutting a word in half."""
    starts = [w[1] for w in words]
    i = bisect.bisect_left(starts, start)
    if i > 0 and (i == len(words) or abs(starts[i - 1] - start) <= abs(starts[i] - start)):
        i -= 1
    j = max(i, min(range(i, len(words)), key=lambda k: abs(words[k][2] - end)))

    span_max = max_len - PAD_BEFORE - PAD_AFTER
    span_min = min_len - PAD_BEFORE - PAD_AFTER
    while j > i and words[j][2] - words[i][1] > span_max:
        j -= 1
    while j + 1 < len(words) and words[j][2] - words[i][1] < span_min:
        j += 1

    clip_start = max(0.0, words[i][1] - PAD_BEFORE)
    clip_end = words[j][2] + PAD_AFTER
    if duration:
        clip_end = min(clip_end, float(duration))
    return round(clip_start, 2), round(clip_end, 2)


def finalize(raw_moments, words, heatmap, info, min_len, max_len):
    duration = info.get("duration") or 0
    moments = []
    for m in raw_moments:
        start, end = snap_to_words(m["start"], m["end"], words, min_len, max_len, duration)
        if end <= start:
            continue
        # Drop clips that mostly overlap one already kept (Claude ranks best first).
        if any(min(end, k["end"]) - max(start, k["start"]) > 0.5 * (end - start) for k in moments):
            continue
        clamp = lambda v: max(0, min(100, int(v)))  # noqa: E731
        replay = replay_score(start, end, heatmap, duration)
        virality = clamp(m["virality"])
        moments.append({
            "start": start,
            "end": end,
            "duration": round(end - start, 2),
            "title": m["title"],
            "hook": m["hook"],
            "reason": m["reason"],
            "scores": {k: clamp(m[f"{k}_score"]) for k in ("hook", "flow", "value", "trend")},
            "virality": virality,
            "replay": replay,
            # Claude's judgment, nudged by what real viewers rewatched
            "score": virality if replay is None else round(0.6 * virality + 0.4 * replay),
        })
    moments.sort(key=lambda m: m["score"], reverse=True)
    for rank, m in enumerate(moments, 1):
        m["rank"] = rank
    return moments


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url", help="YouTube video URL")
    parser.add_argument("--clips", type=int, default=8, help="How many moments to find (default 8)")
    parser.add_argument("--min", dest="min_len", type=float, default=20, help="Shortest clip, seconds (default 20)")
    parser.add_argument("--max", dest="max_len", type=float, default=60, help="Longest clip, seconds (default 60)")
    parser.add_argument("--instructions", default="", help="Extra guidance for Claude, e.g. 'only the funniest moments'")
    parser.add_argument("-o", "--out", default="moments.json", help="Where to write the results (default moments.json)")
    parser.add_argument("--effort", default="high", choices=["low", "medium", "high", "xhigh", "max"],
                        help="How hard Claude thinks (default high). Higher = better picks, slower, pricier")
    parser.add_argument("--whisper-model", default="small", choices=["tiny", "base", "small", "medium", "large"],
                        help="Whisper model for videos without captions (default small)")
    parser.add_argument("--cookies", default=None, help="Netscape-format YouTube cookies file, if YouTube asks you to sign in")
    args = parser.parse_args()

    if args.min_len <= 0 or args.max_len < args.min_len:
        fail("--min must be positive and no larger than --max.")
    check_dependencies()
    import yt_dlp

    print(f"Fetching video info: {args.url}")
    try:
        with yt_dlp.YoutubeDL(ydl_opts(args.cookies)) as ydl:
            info = ydl.extract_info(args.url, download=False)
            words, source = caption_words(ydl, info)
    except yt_dlp.utils.DownloadError as e:
        fail(f"yt-dlp couldn't read the video: {e}")

    heatmap = info.get("heatmap")
    print(f"'{info.get('title')}' -- {fmt_ts(info.get('duration') or 0)}, "
          f"replay heatmap: {'yes' if heatmap else 'none'}")

    if not words:
        words = whisper_words(args.url, args.cookies, args.whisper_model)
        source = f"whisper-{args.whisper_model}"
    if not words:
        fail("Couldn't get a transcript for this video (no captions, and Whisper heard no speech).")
    print(f"Transcript: {len(words)} words from {source}")

    lines = transcript_lines(words)
    prompt = build_prompt(info, lines, heatmap, args.clips, args.min_len, args.max_len, args.instructions)
    # Rough guard (~4 chars/token) well under the 1M-token context window
    if len(prompt) > 3_000_000:
        fail("This video's transcript is too long to analyze in one pass.")

    raw = ask_claude(prompt, args.effort)
    moments = finalize(raw, words, heatmap, info, args.min_len, args.max_len)

    result = {
        "video": {
            "id": info.get("id"),
            "url": info.get("webpage_url") or args.url,
            "title": info.get("title"),
            "channel": info.get("channel") or info.get("uploader"),
            "duration": info.get("duration"),
            "thumbnail": info.get("thumbnail"),
        },
        "transcript_source": source,
        "model": MODEL,
        "settings": {"clips": args.clips, "min": args.min_len, "max": args.max_len,
                     "instructions": args.instructions},
        "heatmap": heatmap,
        "moments": moments,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"\nTop moments ({len(moments)}):")
    for m in moments:
        replay = f", replay {m['replay']}" if m["replay"] is not None else ""
        print(f"  {m['rank']}. [{fmt_ts(m['start'])} - {fmt_ts(m['end'])}] {m['duration']:.0f}s  "
              f"score {m['score']} (virality {m['virality']}{replay})  {m['title']}")
    if moments:
        best = moments[0]
        print(f"\nMake the top one into a Short:\n  python make_short.py \"{args.url}\" {best['start']} {best['end']}")
    print(f"\nSaved to: {args.out}")


if __name__ == "__main__":
    main()
