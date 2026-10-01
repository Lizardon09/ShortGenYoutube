// ShortGen web app: a static page (GitHub Pages) that drives this repo's
// GitHub Actions workflows through the GitHub REST API.
//
//   Find moments  -> runs analyze.yml    -> results branch: analyses/<id>/moments.json
//   Make short    -> runs make-short.yml -> "shorts" release asset: <id>.mp4
//
// Each request gets a unique id that's baked into the workflow run's name,
// which is how the page finds the run it started and polls it.
"use strict";

const API = "https://api.github.com";
const SETTINGS_KEY = "shortgen.settings";
const JOBS_KEY = "shortgen.jobs";
const TITLES_KEY = "shortgen.titles";
const MODEL_KEY = "shortgen.model";
const POLL_MS = 5000;
const RUN_LOOKUP_TIMEOUT_MS = 3 * 60 * 1000;

const PICKERS = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "replay-data": "Replay data only",
};

const WORKFLOWS = {
  analyze: { file: "analyze.yml", runPrefix: "analyze" },
  short: { file: "make-short.yml", runPrefix: "short" },
};

// ------------------------------------------------------------------ helpers

const $ = (sel, root = document) => root.querySelector(sel);

// Builds DOM nodes. Text children are always inserted as text, never HTML,
// so video titles and Claude's output can't inject markup.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / storage blocked: the page still works for this visit */
  }
}

function fmtTime(sec, precise = false) {
  const s = Math.max(0, sec);
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const secs = precise ? rest.toFixed(2).padStart(5, "0") : String(Math.floor(rest)).padStart(2, "0");
  return hours ? `${hours}:${String(mins).padStart(2, "0")}:${secs}` : `${mins}:${secs}`;
}

// "754.5", "12:34.5" or "1:02:03" -> seconds
function parseTime(text) {
  const parts = String(text).trim().split(":");
  if (!parts[0] || parts.length > 3) return NaN;
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n) || n < 0)) return NaN;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// e.g. "20261002-153012-dQw4w9WgXcQ" -- sortable, and the workflows only
// accept [A-Za-z0-9_-] so it's safe in file names.
function requestId(suffix) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${(suffix || rand).replace(/[^\w-]/g, "")}`;
}

function idDate(id) {
  const m = id.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (!m) return "";
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function setStatus(el, text, kind = "") {
  el.textContent = text;
  el.className = `status-text ${kind}`;
}

// ------------------------------------------------------------------ settings

function guessRepo() {
  const host = location.hostname;
  if (!host.endsWith(".github.io")) return { owner: "", repo: "" };
  const owner = host.slice(0, -".github.io".length);
  const repo = location.pathname.split("/").filter(Boolean)[0] || host;
  return { owner, repo };
}

let settings = { ...guessRepo(), token: "", branch: "main", ...load(SETTINGS_KEY, {}) };

const repoPath = () => `/repos/${settings.owner}/${settings.repo}`;
const isConfigured = () => Boolean(settings.owner && settings.repo && settings.token);

async function gh(path, { method = "GET", body, raw = false } = {}) {
  const res = await fetch(path.startsWith("http") ? path : API + path, {
    method,
    cache: "no-store",
    headers: {
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      Authorization: `Bearer ${settings.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).message || message;
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(`GitHub said ${res.status}: ${message}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return raw ? res.text() : res.json();
}

function initSettings() {
  const card = $("#settings");
  const toggle = $("#settings-toggle");
  const form = $("#settings-form");
  const status = $("#settings-status");

  const show = (open) => {
    card.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => show(card.hidden));

  form.owner.value = settings.owner;
  form.repo.value = settings.repo;
  form.token.value = settings.token;
  if (!isConfigured()) show(true);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    settings.owner = form.owner.value.trim();
    settings.repo = form.repo.value.trim();
    settings.token = form.token.value.trim();
    setStatus(status, "Checking…");
    try {
      const repo = await gh(repoPath());
      settings.branch = repo.default_branch;
      await gh(`${repoPath()}/actions/workflows/${WORKFLOWS.analyze.file}`).catch((err) => {
        if (err.status === 404) throw new Error("Connected, but the workflows aren't in this repo yet. Push the code first.");
        throw err;
      });
      save(SETTINGS_KEY, settings);
      const note = repo.private ? " (private repo: downloads need you signed in to GitHub in this browser)" : "";
      setStatus(status, `Connected to ${repo.full_name}${note}`, "ok");
      loadRecent();
      if (!repo.private) setTimeout(() => show(false), 1200);
    } catch (err) {
      setStatus(status, err.status === 401 ? "That token was rejected." : err.status === 404 ? "Repo not found, or the token can't see it." : err.message, "error");
    }
  });

  $("#forget-token").addEventListener("click", () => {
    settings.token = "";
    form.token.value = "";
    save(SETTINGS_KEY, settings);
    setStatus(status, "Token removed from this browser.");
  });
}

function requireSettings(statusEl) {
  if (isConfigured()) return true;
  setStatus(statusEl, "Connect your repo in Settings first.", "error");
  $("#settings").hidden = false;
  return false;
}

// ---------------------------------------------------------------------- jobs

let jobs = load(JOBS_KEY, []);
const saveJobs = () => save(JOBS_KEY, jobs.slice(0, 30));

async function dispatch(kind, inputs) {
  await gh(`${repoPath()}/actions/workflows/${WORKFLOWS[kind].file}/dispatches`, {
    method: "POST",
    body: { ref: settings.branch || "main", inputs },
  });
}

async function startAnalysis({ url, clips, min, max, instructions, model }) {
  const id = requestId(youtubeId(url));
  await dispatch("analyze", {
    url,
    request_id: id,
    clips: String(clips),
    min_seconds: String(min),
    max_seconds: String(max),
    instructions,
    model,
  });
  addJob({ id, kind: "analyze", label: url, openWhenDone: true });
}

async function startShort({ url, start, end, mode, zoom, captions, label, key }) {
  const id = requestId();
  await dispatch("short", {
    url,
    request_id: id,
    start: start.toFixed(2),
    end: end.toFixed(2),
    mode,
    zoom: String(zoom),
    captions: captions ? "true" : "false",
  });
  addJob({ id, kind: "short", label, key });
}

function addJob(fields) {
  jobs.unshift({ ...fields, created: Date.now(), status: "queued", step: "Starting the workflow…" });
  saveJobs();
  renderJobs();
}

async function failureReason(runJob) {
  const failed = (runJob.steps || []).find((s) => s.conclusion === "failure");
  let reason = failed ? `Failed at "${failed.name}".` : `Run ${runJob.conclusion}.`;
  try {
    const notes = await gh(`${runJob.check_run_url}/annotations`);
    const messages = notes
      .filter((a) => a.annotation_level === "failure" && !/exit code \d+/.test(a.message))
      .map((a) => a.message);
    if (messages.length) reason += " " + messages.join(" ");
  } catch {
    /* annotations are a nice-to-have */
  }
  return reason;
}

async function pollJob(job) {
  const wf = WORKFLOWS[job.kind];
  if (!job.runId) {
    const runName = `${wf.runPrefix} ${job.id}`;
    const data = await gh(`${repoPath()}/actions/workflows/${wf.file}/runs?event=workflow_dispatch&per_page=30`);
    const run = data.workflow_runs.find((r) => r.display_title === runName);
    if (!run) {
      if (Date.now() - job.created > RUN_LOOKUP_TIMEOUT_MS) {
        Object.assign(job, { status: "completed", conclusion: "failure", finished: Date.now(), error: "GitHub never started the workflow. Check the repo's Actions tab." });
      }
      return;
    }
    job.runId = run.id;
    job.runUrl = run.html_url;
  }

  const { jobs: runJobs } = await gh(`${repoPath()}/actions/runs/${job.runId}/jobs`);
  const runJob = runJobs[0];
  if (!runJob) return;
  const current = (runJob.steps || []).find((s) => s.status === "in_progress");
  job.step = current ? current.name : runJob.status === "queued" ? "Waiting for a GitHub runner…" : job.step;

  if (runJob.status !== "completed") {
    job.status = runJob.status;
    return;
  }
  if (runJob.conclusion !== "success") {
    Object.assign(job, { status: "completed", conclusion: runJob.conclusion, finished: Date.now(), error: await failureReason(runJob) });
    return;
  }
  if (job.kind === "short") {
    const release = await gh(`${repoPath()}/releases/tags/shorts`);
    const asset = release.assets.find((a) => a.name === `${job.id}.mp4`);
    if (!asset) return; // upload not visible yet; check again next tick
    job.download = asset.browser_download_url;
    job.size = asset.size;
  }
  Object.assign(job, { status: "completed", conclusion: "success", finished: Date.now(), step: "" });
  if (job.kind === "analyze" && job.openWhenDone) {
    job.openWhenDone = false;
    openAnalysis(job.id);
    loadRecent();
  }
}

async function tick() {
  const active = jobs.filter((j) => j.status !== "completed");
  if (isConfigured()) {
    for (const job of active) {
      try {
        await pollJob(job);
        job.warning = "";
      } catch (err) {
        job.warning = err.message; // transient network/API hiccup: keep polling
      }
    }
  }
  if (active.length) saveJobs();
  renderJobs();
  setTimeout(tick, POLL_MS);
}

function jobState(job) {
  if (job.status !== "completed") return "running";
  return job.conclusion === "success" ? "success" : "failure";
}

function jobSubline(job) {
  const state = jobState(job);
  if (state === "failure") return h("div", { class: "job-sub error" }, job.error || "Failed.");
  if (state === "success") {
    const size = job.size ? ` · ${(job.size / 1e6).toFixed(1)} MB` : "";
    const took = job.finished ? ` in ${fmtDuration(job.finished - job.created)}` : "";
    return h("div", { class: "job-sub" }, `Done${took}${size}`);
  }
  const warn = job.warning ? ` (retrying: ${job.warning})` : "";
  return h("div", { class: "job-sub" }, `${job.step || "Running…"} · ${fmtDuration(Date.now() - job.created)}${warn}`);
}

function renderJobs() {
  const list = $("#jobs");
  list.replaceChildren(
    ...jobs.slice(0, 12).map((job) => {
      const state = jobState(job);
      const title = job.kind === "analyze" ? `Analyze · ${job.title || job.label}` : `Short · ${job.label}`;
      const actions = [];
      if (state === "success" && job.kind === "analyze")
        actions.push(h("button", { class: "btn small", type: "button", onclick: () => openAnalysis(job.id) }, "Open"));
      if (state === "success" && job.download)
        actions.push(h("a", { class: "btn small primary", href: job.download }, "Download"));
      if (job.runUrl) actions.push(h("a", { class: "btn small ghost", href: job.runUrl, target: "_blank", rel: "noopener" }, "Log"));
      actions.push(
        h("button", {
          class: "icon-btn", type: "button", title: "Remove from list", "aria-label": "Remove from list",
          onclick: () => { jobs = jobs.filter((j) => j !== job); saveJobs(); renderJobs(); },
        }, "×"),
      );
      return h("li", { class: "job" },
        h("span", { class: `dot ${state}`, "aria-label": state }),
        h("div", { class: "job-main" }, h("div", { class: "job-title", title }, title), jobSubline(job)),
        h("div", { class: "job-actions" }, actions),
      );
    }),
  );
  $("#jobs-empty").hidden = jobs.length > 0;
  renderShortStatuses();
}

// ------------------------------------------------------------------ analysis

let current = null; // { id, data }

async function openAnalysis(id) {
  const section = $("#analysis");
  section.hidden = false;
  section.replaceChildren(h("p", { class: "muted" }, "Loading analysis…"));
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const text = await gh(`${repoPath()}/contents/analyses/${id}/moments.json?ref=results`, { raw: true });
    current = { id, data: JSON.parse(text) };
    rememberTitle(id, current.data.video.title);
    const job = jobs.find((j) => j.id === id);
    if (job && !job.title) {
      job.title = current.data.video.title;
      saveJobs();
      renderJobs();
    }
    renderAnalysis();
  } catch (err) {
    section.replaceChildren(h("p", { class: "status-text error" }, `Couldn't load this analysis. ${err.message}`));
  }
}

function renderAnalysis() {
  const { data } = current;
  const v = data.video;
  const source = {
    "youtube-captions": "YouTube captions",
    "youtube-auto-captions": "YouTube auto-captions",
  }[data.transcript_source] || data.transcript_source;

  $("#analysis").replaceChildren(
    h("div", { class: "analysis-head" },
      v.thumbnail ? h("img", { src: v.thumbnail, alt: "" }) : null,
      h("div", {},
        h("h2", {}, v.title || "Untitled video"),
        h("div", { class: "meta" },
          h("span", {}, v.channel || ""),
          h("span", {}, fmtTime(v.duration || 0)),
          h("span", {}, `${data.moments.length} moments`),
          h("span", {}, `Picked by: ${pickedBy(data)}`),
          source ? h("span", {}, `Transcript: ${source}`) : null,
          h("a", { href: v.url, target: "_blank", rel: "noopener" }, "Open on YouTube"),
        ),
      ),
    ),
    timeline(data),
    h("ol", { class: "moments" }, data.moments.map((m) => momentCard(m, data))),
  );
  renderShortStatuses();
}

function pickedBy(data) {
  const name = PICKERS[data.model] || data.model;
  const requested = data.settings && data.settings.model;
  return data.model === "replay-data" && requested && requested !== "none" ? `${name} (no API key set)` : name;
}

function timeline(data) {
  const W = 1000;
  const H = 100;
  const duration = data.video.duration || Math.max(1, ...data.moments.map((m) => m.end));
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Replay heatmap with the chosen moments highlighted");

  const x = (t) => (t / duration) * W;
  const heat = data.heatmap || [];
  if (heat.length) {
    let d = `M0,${H}`;
    for (const p of heat) d += ` L${x((p.start_time + p.end_time) / 2).toFixed(1)},${(H - p.value * (H - 6)).toFixed(1)}`;
    d += ` L${W},${H} Z`;
    const area = document.createElementNS(NS, "path");
    area.setAttribute("d", d);
    area.setAttribute("class", "area");
    svg.append(area);
  }
  const base = document.createElementNS(NS, "line");
  Object.entries({ x1: 0, x2: W, y1: H - 0.5, y2: H - 0.5, class: "base" }).forEach(([k, val]) => base.setAttribute(k, val));
  svg.append(base);

  const labels = h("div", { class: "heatmap-labels" });
  for (const m of data.moments) {
    const rect = document.createElementNS(NS, "rect");
    Object.entries({ x: x(m.start), y: 0, width: Math.max(4, x(m.end) - x(m.start)), height: H, class: "span" })
      .forEach(([k, val]) => rect.setAttribute(k, val));
    const title = document.createElementNS(NS, "title");
    title.textContent = `#${m.rank} ${fmtTime(m.start)}–${fmtTime(m.end)}: ${m.title}`;
    rect.append(title);
    rect.addEventListener("click", () => focusMoment(m.rank));
    svg.append(rect);
    labels.append(h("span", { style: `left:${((m.start + m.end) / 2 / duration) * 100}%`, onclick: () => focusMoment(m.rank) }, m.rank));
  }

  return h("div", { class: "heatmap" },
    labels,
    svg,
    h("div", { class: "heatmap-axis" }, h("span", {}, "0:00"), h("span", {}, fmtTime(duration))),
    h("div", { class: "heatmap-caption" },
      heat.length
        ? "Curve: how often YouTube viewers rewatched each part (Most Replayed). Shaded: the picked moments."
        : "YouTube has no replay data for this video yet, so picks are from the transcript alone."),
  );
}

function focusMoment(rank) {
  const el = document.getElementById(`moment-${rank}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1200);
}

function scoreBar(label, value) {
  return h("div", {},
    h("div", { class: "bar-label" }, h("span", {}, label), h("span", {}, value)),
    h("div", { class: "bar" }, h("i", { style: `width:${value}%` })),
  );
}

function shortOptions() {
  return $("#short-options-template").content.firstElementChild.cloneNode(true);
}

function timeField(label, initial) {
  const input = h("input", { value: fmtTime(initial, true), inputmode: "decimal", "aria-label": label });
  const nudge = (delta) => () => {
    const t = parseTime(input.value);
    if (!Number.isNaN(t)) input.value = fmtTime(Math.max(0, t + delta), true);
  };
  const field = h("label", {}, label,
    h("div", { class: "time-field" },
      h("button", { class: "btn small", type: "button", onclick: nudge(-0.5), "aria-label": `${label} back half a second` }, "−½s"),
      input,
      h("button", { class: "btn small", type: "button", onclick: nudge(0.5), "aria-label": `${label} forward half a second` }, "+½s"),
    ),
  );
  return { field, input };
}

function momentCard(m, data) {
  const videoId = data.video.id;
  const key = `${current.id}#${m.rank}`;
  const preview = h("div", { class: "preview", hidden: true });
  const startField = timeField("Start", m.start);
  const endField = timeField("End", m.end);
  const options = shortOptions();
  const status = h("span", { class: "status-text", role: "status" });
  const cut = h("form", { class: "cut", hidden: true },
    h("div", { class: "times" }, startField.field, endField.field),
    options,
    h("div", { class: "row" }, h("button", { class: "btn primary", type: "submit" }, "Make this short"), status),
    h("div", { class: "short-status", "data-short-key": key }),
  );

  cut.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireSettings(status)) return;
    const start = parseTime(startField.input.value);
    const end = parseTime(endField.input.value);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
      setStatus(status, "Start and end need to be valid times, with end after start.", "error");
      return;
    }
    const button = cut.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus(status, "Starting…");
    try {
      await startShort({
        url: data.video.url, start, end,
        mode: options.querySelector("[name=mode]").value,
        zoom: Number(options.querySelector("[name=zoom]").value) || 1.2,
        captions: options.querySelector("[name=captions]").checked,
        label: `#${m.rank} ${m.title}`,
        key,
      });
      setStatus(status, "Started. Usually takes about two minutes.", "ok");
    } catch (err) {
      setStatus(status, err.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  const togglePreview = () => {
    if (preview.hidden && !preview.firstChild) {
      const src = `https://www.youtube-nocookie.com/embed/${videoId}?start=${Math.floor(m.start)}&end=${Math.ceil(m.end)}&autoplay=1&rel=0`;
      preview.append(
        h("iframe", { src, title: `Preview of moment ${m.rank}`, allow: "autoplay; encrypted-media; picture-in-picture", allowfullscreen: true }),
        h("a", { class: "status-text", href: `https://youtu.be/${videoId}?t=${Math.floor(m.start)}`, target: "_blank", rel: "noopener" }, "Won't play here? Open on YouTube at this moment"),
      );
    }
    preview.hidden = !preview.hidden;
    if (preview.hidden) preview.replaceChildren(); // stops playback
  };

  const replay = m.replay == null ? null : h("span", {}, `replay ${m.replay}`);
  const virality = m.virality == null ? null : h("span", {}, `virality ${m.virality}`);
  const scoreTitle = m.virality == null
    ? "Replay score: more rewatched than this % of the video"
    : "Overall score: Claude's virality rating blended with replay data";
  return h("li", { class: "moment", id: `moment-${m.rank}` },
    h("div", { class: "moment-top" },
      h("span", { class: "rank" }, `#${m.rank}`),
      h("div", {},
        h("h3", {}, m.title),
        h("div", { class: "meta" },
          h("span", {}, `${fmtTime(m.start)} → ${fmtTime(m.end)}`),
          h("span", {}, `${Math.round(m.duration)}s`),
          virality,
          replay,
        ),
      ),
      h("span", { class: "score", title: scoreTitle }, m.score),
    ),
    m.hook ? h("p", { class: "hook" }, `“${m.hook}”`) : null,
    m.reason ? h("p", { class: "reason" }, m.reason) : null,
    m.scores
      ? h("div", { class: "bars" },
          scoreBar("Hook", m.scores.hook), scoreBar("Flow", m.scores.flow),
          scoreBar("Value", m.scores.value), scoreBar("Trend", m.scores.trend),
        )
      : null,
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", onclick: togglePreview }, "Preview"),
      h("button", { class: "btn primary", type: "button", onclick: () => { cut.hidden = !cut.hidden; } }, "Make short…"),
    ),
    preview,
    cut,
  );
}

// Shows the newest short started from each moment card inside that card.
function renderShortStatuses() {
  for (const box of document.querySelectorAll("[data-short-key]")) {
    const job = jobs.find((j) => j.kind === "short" && j.key === box.dataset.shortKey);
    if (!job) {
      box.replaceChildren();
      continue;
    }
    const state = jobState(job);
    if (state === "success" && job.download) {
      if (box.dataset.shown === job.id) continue; // don't restart the playing video every tick
      box.dataset.shown = job.id;
      box.replaceChildren(
        h("video", { src: job.download, controls: true, playsinline: true, preload: "metadata" }),
        h("div", { class: "row" },
          h("a", { class: "btn primary", href: job.download }, "Download MP4"),
          h("span", { class: "status-text" }, `${(job.size / 1e6).toFixed(1)} MB · kept for 7 days`),
        ),
      );
    } else {
      delete box.dataset.shown;
      box.replaceChildren(jobSubline(job));
    }
  }
}

// -------------------------------------------------------------------- recent

function rememberTitle(id, title) {
  const titles = load(TITLES_KEY, {});
  titles[id] = title;
  save(TITLES_KEY, titles);
}

async function loadRecent() {
  const list = $("#recent");
  const empty = $("#recent-empty");
  if (!isConfigured()) {
    list.replaceChildren();
    empty.hidden = false;
    empty.textContent = "Connect your repo to see past analyses.";
    return;
  }
  try {
    const items = await gh(`${repoPath()}/contents/analyses?ref=results`);
    const ids = items.filter((i) => i.type === "dir").map((i) => i.name).sort().reverse().slice(0, 24);
    const titles = load(TITLES_KEY, {});
    list.replaceChildren(
      ...ids.map((id) => {
        const videoId = id.split("-").slice(2).join("-");
        const titleEl = h("span", { class: "recent-title" }, titles[id] || "Loading title…");
        if (!titles[id]) fillTitle(id, titleEl);
        return h("li", {},
          h("button", { type: "button", onclick: () => openAnalysis(id) },
            videoId.length === 11 ? h("img", { src: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, alt: "", loading: "lazy" }) : null,
            titleEl,
            h("span", { class: "recent-date" }, idDate(id)),
          ),
        );
      }),
    );
    empty.hidden = ids.length > 0;
    empty.textContent = "No analyses yet.";
  } catch (err) {
    list.replaceChildren();
    empty.hidden = false;
    empty.textContent = err.status === 404 ? "No analyses yet." : `Couldn't load past analyses. ${err.message}`;
  }
}

async function fillTitle(id, el) {
  try {
    const data = JSON.parse(await gh(`${repoPath()}/contents/analyses/${id}/moments.json?ref=results`, { raw: true }));
    el.textContent = data.video.title || id;
    rememberTitle(id, data.video.title);
  } catch {
    el.textContent = id;
  }
}

// --------------------------------------------------------------------- forms

function initForms() {
  const analyze = $("#analyze-form");
  analyze.elements.model.value = load(MODEL_KEY, "opus");
  analyze.elements.model.addEventListener("change", () => save(MODEL_KEY, analyze.elements.model.value));
  analyze.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $(".status-text", analyze);
    if (!requireSettings(status)) return;
    const f = analyze.elements;
    const min = Number(f.min.value);
    const max = Number(f.max.value);
    if (max < min) {
      setStatus(status, "Max seconds must be at least min seconds.", "error");
      return;
    }
    if (!youtubeId(f.url.value)) {
      setStatus(status, "That doesn't look like a YouTube video link.", "error");
      return;
    }
    const button = $("button[type=submit]", analyze);
    button.disabled = true;
    setStatus(status, "Starting…");
    try {
      await startAnalysis({
        url: f.url.value.trim(), clips: Number(f.clips.value), min, max,
        instructions: f.instructions.value.trim(), model: f.model.value,
      });
      setStatus(status, "Started. Follow it under Activity; results open here when ready.", "ok");
      f.url.value = "";
    } catch (err) {
      setStatus(status, err.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  const manual = $("#manual-form");
  const options = shortOptions();
  $(".short-options", manual).append(options);
  manual.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $(".status-text", manual);
    if (!requireSettings(status)) return;
    const f = manual.elements;
    const start = parseTime(f.start.value);
    const end = parseTime(f.end.value);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
      setStatus(status, "Use times like 14:32 or 1:04:12, with end after start.", "error");
      return;
    }
    const button = $("button[type=submit]", manual);
    button.disabled = true;
    setStatus(status, "Starting…");
    try {
      await startShort({
        url: f.url.value.trim(), start, end,
        mode: f.mode.value, zoom: Number(f.zoom.value) || 1.2, captions: f.captions.checked,
        label: `${fmtTime(start)}–${fmtTime(end)}`,
      });
      setStatus(status, "Started. The download appears under Activity.", "ok");
    } catch (err) {
      setStatus(status, err.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#recent-refresh").addEventListener("click", loadRecent);
}

initSettings();
initForms();
renderJobs();
loadRecent();
tick();
