import { useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import DownloadIcon from "@mui/icons-material/Download";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { jobState } from "../hooks/useJobs";
import { fmtTime, parseTime } from "../lib/format";
import type { Analysis, Job, Moment, ShortRequest } from "../types";
import { JobSubline } from "./ActivityCard";
import ShortOptions, { cleanZoom, DEFAULT_SHORT_OPTIONS } from "./ShortOptions";

interface Props {
  moment: Moment;
  analysisId: string;
  video: Analysis["video"];
  job?: Job; // newest short cut from this moment
  highlight: boolean;
  onShort: (request: ShortRequest) => Promise<void>;
}

export default function MomentCard({ moment: m, analysisId, video, job, highlight, onShort }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [cutOpen, setCutOpen] = useState(Boolean(job));
  const [start, setStart] = useState(fmtTime(m.start, true));
  const [end, setEnd] = useState(fmtTime(m.end, true));
  const [options, setOptions] = useState(DEFAULT_SHORT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const s = parseTime(start);
    const t = parseTime(end);
    if (Number.isNaN(s) || Number.isNaN(t) || t <= s) return setError("Start and end need to be valid times, with end after start.");
    setBusy(true);
    try {
      await onShort({ url: video.url, start: s, end: t, ...options, zoom: cleanZoom(options.zoom), label: `#${m.rank} ${m.title}`, key: `${analysisId}#${m.rank}` });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const details = [
    `${fmtTime(m.start)} → ${fmtTime(m.end)}`,
    `${Math.round(m.duration)}s`,
    m.virality != null && `virality ${m.virality}`,
    m.replay != null && `replay ${m.replay}`,
  ].filter(Boolean);
  const scoreHint =
    m.virality == null ? "Replay score: more rewatched than this % of the video" : "Overall score: Claude's virality rating blended with replay data";

  return (
    <Card
      id={`moment-${m.rank}`}
      component="li"
      sx={{
        scrollMarginTop: 80,
        outline: "2px solid",
        outlineColor: highlight ? "primary.main" : "transparent",
        transition: "outline-color 0.3s",
      }}
    >
      <CardContent>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
          <Typography sx={{ fontWeight: 800, color: "text.secondary", pt: 0.25 }}>#{m.rank}</Typography>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
              {m.title}
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {details.join(" · ")}
            </Typography>
          </Box>
          <Tooltip title={scoreHint}>
            <Chip label={m.score} color="primary" sx={{ fontWeight: 800, fontSize: "1rem" }} />
          </Tooltip>
        </Stack>
        {m.hook && <Typography sx={{ mt: 1.5, fontStyle: "italic" }}>“{m.hook}”</Typography>}
        {m.reason && (
          <Typography variant="body2" sx={{ mt: 0.5, color: "text.secondary" }}>
            {m.reason}
          </Typography>
        )}
        {m.scores && <ScoreBars scores={m.scores} />}
      </CardContent>

      <CardActions sx={{ px: 2, pb: 2, pt: 0, gap: 1 }}>
        <Button variant="outlined" startIcon={<PlayArrowIcon />} onClick={() => setPreviewOpen((o) => !o)}>
          {previewOpen ? "Hide preview" : "Preview"}
        </Button>
        <Button variant="contained" startIcon={<ContentCutIcon />} onClick={() => setCutOpen((o) => !o)}>
          Make short…
        </Button>
      </CardActions>

      {/* unmountOnExit stops playback when the preview is hidden */}
      <Collapse in={previewOpen} unmountOnExit>
        <Box sx={{ px: 2, pb: 2 }}>
          <Box
            component="iframe"
            src={`https://www.youtube-nocookie.com/embed/${video.id}?start=${Math.floor(m.start)}&end=${Math.ceil(m.end)}&autoplay=1&rel=0`}
            title={`Preview of moment ${m.rank}`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            sx={{ width: "100%", aspectRatio: "16 / 9", border: 0, borderRadius: 1, bgcolor: "#000", display: "block" }}
          />
          <Link variant="body2" href={`https://youtu.be/${video.id}?t=${Math.floor(m.start)}`} target="_blank" rel="noopener">
            Won't play here? Open on YouTube at this moment
          </Link>
        </Box>
      </Collapse>

      <Collapse in={cutOpen}>
        <Stack component="form" onSubmit={submit} spacing={2} sx={{ px: 2, pb: 2 }}>
          <Divider sx={{ borderStyle: "dashed" }} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TimeField label="Start" value={start} onChange={setStart} />
            <TimeField label="End" value={end} onChange={setEnd} />
          </Stack>
          <ShortOptions value={options} onChange={setOptions} />
          {error && <Alert severity="error">{error}</Alert>}
          <Box>
            <Button type="submit" variant="contained" startIcon={<ContentCutIcon />} loading={busy}>
              Make this short
            </Button>
          </Box>
          {job && <ShortResult job={job} />}
        </Stack>
      </Collapse>
    </Card>
  );
}

function ScoreBars({ scores }: { scores: NonNullable<Moment["scores"]> }) {
  const items: [string, number][] = [
    ["Hook", scores.hook],
    ["Flow", scores.flow],
    ["Value", scores.value],
    ["Trend", scores.trend],
  ];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }, gap: 1.5, mt: 1.5 }}>
      {items.map(([label, value]) => (
        <Box key={label}>
          <Stack direction="row" sx={{ justifyContent: "space-between" }}>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {label}
            </Typography>
            <Typography variant="caption">{value}</Typography>
          </Stack>
          <LinearProgress variant="determinate" value={value} aria-label={`${label} score`} sx={{ height: 6, borderRadius: 3 }} />
        </Box>
      ))}
    </Box>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const nudge = (delta: number) => {
    const t = parseTime(value);
    if (!Number.isNaN(t)) onChange(fmtTime(Math.max(0, t + delta), true));
  };
  const nudgeButton = (delta: number) => (
    <Button size="small" onClick={() => nudge(delta)} aria-label={`${label} ${delta < 0 ? "back" : "forward"} half a second`} sx={{ minWidth: 0, px: 1 }}>
      {delta < 0 ? "−½s" : "+½s"}
    </Button>
  );
  return (
    <TextField
      label={label}
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      fullWidth
      slotProps={{
        htmlInput: { inputMode: "decimal", style: { textAlign: "center" } },
        input: {
          startAdornment: <InputAdornment position="start">{nudgeButton(-0.5)}</InputAdornment>,
          endAdornment: <InputAdornment position="end">{nudgeButton(0.5)}</InputAdornment>,
        },
      }}
    />
  );
}

function ShortResult({ job }: { job: Job }) {
  const state = jobState(job);
  if (state === "running") {
    return (
      <Box>
        <LinearProgress sx={{ mb: 1 }} />
        <JobSubline job={job} />
      </Box>
    );
  }
  if (state === "failure") return <Alert severity="error">{job.error || "Failed."}</Alert>;
  if (!job.download) return null;
  return (
    <Stack spacing={1}>
      <Box
        component="video"
        src={job.download}
        controls
        playsInline
        preload="metadata"
        sx={{ width: "100%", maxWidth: 260, aspectRatio: "9 / 16", borderRadius: 2, bgcolor: "#000" }}
      />
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Button variant="contained" href={job.download} startIcon={<DownloadIcon />}>
          Download MP4
        </Button>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {job.size ? `${(job.size / 1e6).toFixed(1)} MB · ` : ""}kept for 7 days
        </Typography>
      </Stack>
    </Stack>
  );
}
