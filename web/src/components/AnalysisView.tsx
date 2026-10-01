import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { GitHub } from "../api/github";
import { fmtTime } from "../lib/format";
import type { Analysis, Job, ShortRequest } from "../types";
import MomentCard from "./MomentCard";
import Timeline from "./Timeline";

const PICKERS: Record<string, string> = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "replay-data": "Replay data only",
};

const TRANSCRIPTS: Record<string, string> = {
  "youtube-captions": "YouTube captions",
  "youtube-auto-captions": "YouTube auto-captions",
};

function pickedBy(data: Analysis) {
  const name = PICKERS[data.model] ?? data.model;
  const requested = data.settings?.model;
  return data.model === "replay-data" && requested && requested !== "none" ? `${name} (no API key set)` : name;
}

interface Props {
  client: GitHub;
  id: string;
  openSeq: number;
  jobs: Job[];
  onShort: (request: ShortRequest) => Promise<void>;
  onLoaded: (id: string, title: string) => void;
}

export default function AnalysisView({ client, id, openSeq, jobs, onShort, onLoaded }: Props) {
  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .analysis(id)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        onLoaded(id, d.video.title);
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
    // onLoaded is a fresh closure each render; loading depends only on which analysis
  }, [client, id]);

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [openSeq]);

  const focusMoment = (rank: number) => {
    document.getElementById(`moment-${rank}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlight(rank);
    window.setTimeout(() => setHighlight((h) => (h === rank ? null : h)), 1200);
  };

  return (
    <Card ref={ref} sx={{ scrollMarginTop: 72 }}>
      <CardContent>
        {error ? (
          <Alert severity="error">Couldn't load this analysis. {error}</Alert>
        ) : !data ? (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <CircularProgress size={20} />
            <Typography sx={{ color: "text.secondary" }}>Loading analysis…</Typography>
          </Stack>
        ) : (
          <>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
              {data.video.thumbnail && (
                <Box
                  component="img"
                  src={data.video.thumbnail}
                  alt=""
                  sx={{ width: { xs: "100%", sm: 168 }, aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 2, flexShrink: 0 }}
                />
              )}
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h6" component="h2" sx={{ lineHeight: 1.3, mb: 0.5 }}>
                  {data.video.title || "Untitled video"}
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {[
                    data.video.channel,
                    fmtTime(data.video.duration ?? 0),
                    `${data.moments.length} moments`,
                    `Picked by: ${pickedBy(data)}`,
                    data.transcript_source && `Transcript: ${TRANSCRIPTS[data.transcript_source] ?? data.transcript_source}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography>
                <Link variant="body2" href={data.video.url} target="_blank" rel="noopener">
                  Open on YouTube
                </Link>
              </Box>
            </Stack>

            <Timeline data={data} onPick={focusMoment} />

            <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }}>
              {data.moments.map((m) => (
                <MomentCard
                  key={m.rank}
                  moment={m}
                  analysisId={id}
                  video={data.video}
                  job={jobs.find((j) => j.kind === "short" && j.key === `${id}#${m.rank}`)}
                  highlight={highlight === m.rank}
                  onShort={onShort}
                />
              ))}
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}
