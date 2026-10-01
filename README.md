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
3. **Claude (Opus 5.5)** reads the transcript plus the heatmap. It picks self-contained clips and scores each one on hook, flow, value and trend.
4. **Cleanup:** cuts are snapped to word boundaries, and each clip's final score blends Claude's rating with how rewatched that span is.

Cost is a rough estimate, not measured yet: about 10–30¢ of Claude usage for a 20-minute talk, up to about $1 for a multi-hour podcast. Most of it is Claude's thinking at `--effort high`. Each run prints its token usage in the Actions log.

## Setup

1. **Repository:** push this folder to a **public** GitHub repo. On a free GitHub plan, Pages only works for public repos. Anyone can see the repo and download the shorts it makes; your secrets stay private.
2. **Claude API key:** go to repo Settings → Secrets and variables → Actions → New repository secret. Name it `ANTHROPIC_API_KEY`.
3. **Pages:** in repo Settings → Pages, choose "Deploy from a branch", then `main` / `/docs`.
4. **Token for the web page:** create a fine-grained personal access token (GitHub Settings → Developer settings). Limit it to this repo only, with **Actions: Read and write** and **Contents: Read-only**. Paste it into the page's Settings. It's stored only in that browser.
5. **Optional: YouTube cookies.** If runs fail with "Sign in to confirm you're not a bot", YouTube is blocking GitHub's servers. Export YouTube cookies in Netscape format with a browser extension, then save the file's contents as a secret named `YT_COOKIES`. Use a throwaway Google account, since accounts used this way can get flagged.

## Command line

The scripts still work locally:

```bash
python find_moments.py "https://youtu.be/VIDEO" --clips 5 --min 20 --max 45
python make_short.py "https://youtu.be/VIDEO" 322.8 360.4
python add_captions.py short_3228-3604.mp4
```

`find_moments.py` needs `ANTHROPIC_API_KEY` set. Install dependencies with `pip install -r requirements.txt`.
