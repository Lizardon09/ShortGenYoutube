# ShortGen

Turn long YouTube videos into Shorts, from any device. A static web page on GitHub Pages starts GitHub Actions workflows in this repo. The workflows find the best moments and cut them.

```
GitHub Pages (docs/)  --GitHub API-->  Actions: analyze.yml     --> results branch: analyses/<id>/moments.json
  your phone/laptop                    Actions: make-short.yml  --> "shorts" release: <id>.mp4 (kept 7 days)
```

## How moments are picked

`find_moments.py` works like OpusClip's clip recommendations:

1. **Real audience data:** YouTube's "Most Replayed" heatmap, read through yt-dlp. It only exists once a video has enough views.
2. **Transcript:** YouTube's own captions when available. Otherwise the audio is downloaded and transcribed with Whisper.
3. **Claude** reads the transcript plus the heatmap. It picks self-contained clips and scores each one on hook, flow, value and trend.
4. **Cleanup:** cuts are snapped to word boundaries, and each clip's final score blends Claude's rating with how rewatched that span is.

You choose who picks the moments, in the web page or with `--model`:

| Choice | Rough cost per analysis | Notes |
|---|---|---|
| Claude Opus 5.5 (default) | 10–30¢ for a 20-min video, up to ~$1 for a multi-hour podcast | Best picks |
| Claude Sonnet 5.5 | about half of Opus | |
| Claude Haiku 4.5 | a few cents | Videos up to roughly 10 hours |
| Replay data only | Free, no API key | Uses the biggest Most Replayed peaks, trimmed to whole sentences. Only works on videos with enough views to have the graph, and can't judge hooks. |

The Claude costs are estimates, not measured yet; each run prints its token usage in the Actions log. **With no `ANTHROPIC_API_KEY` secret set, every choice runs as "Replay data only".** API credits are prepaid at [console.anthropic.com](https://console.anthropic.com) and are separate from claude.ai subscriptions.

## Setup

1. **Repository:** push this folder to a **public** GitHub repo. On a free GitHub plan, Pages only works for public repos. Anyone can see the repo and download the shorts it makes; your secrets stay private.
2. **Claude API key (optional):** go to repo Settings → Secrets and variables → Actions → New repository secret. Name it `ANTHROPIC_API_KEY`. Skip this step to use the free replay-data mode.
3. **Pages:** in repo Settings → Pages, choose "Deploy from a branch", then `main` / `/docs`.
4. **Token for the web page:** create a fine-grained personal access token (GitHub Settings → Developer settings). Limit it to this repo only, with **Actions: Read and write** and **Contents: Read-only**. Paste it into the page's Settings. It's stored only in that browser.
5. **Optional: YouTube cookies.** If runs fail with "Sign in to confirm you're not a bot", YouTube is blocking GitHub's servers. The scripts first retry as other YouTube clients. That usually still gets the replay data, but not always the captions or the video itself. Export YouTube cookies in Netscape format with a browser extension, then save the file's contents as a secret named `YT_COOKIES`. Use a throwaway Google account, since accounts used this way can get flagged.

## Command line

The scripts still work locally:

```bash
python find_moments.py "https://youtu.be/VIDEO" --clips 5 --min 20 --max 45
python make_short.py "https://youtu.be/VIDEO" 322.8 360.4
python add_captions.py short_3228-3604.mp4
```

`find_moments.py` uses Claude when `ANTHROPIC_API_KEY` is set and replay data otherwise; `--model none` forces the free mode. Install dependencies with `pip install -r requirements.txt`.
