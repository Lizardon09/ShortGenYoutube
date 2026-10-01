import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import ErrorIcon from "@mui/icons-material/Error";
import { jobState } from "../hooks/useJobs";
import { fmtDuration } from "../lib/format";
import type { Job } from "../types";

export function JobStatusIcon({ job }: { job: Job }) {
  const state = jobState(job);
  if (state === "running") return <CircularProgress size={20} aria-label="Running" />;
  if (state === "success") return <CheckCircleIcon color="success" aria-label="Done" />;
  return <ErrorIcon color="error" aria-label="Failed" />;
}

export function JobSubline({ job }: { job: Job }) {
  const state = jobState(job);
  if (state === "failure") {
    return (
      <Typography variant="body2" sx={{ color: "error.main" }}>
        {job.error || "Failed."}
      </Typography>
    );
  }
  let text: string;
  if (state === "success") {
    const took = job.finished ? ` in ${fmtDuration(job.finished - job.created)}` : "";
    const size = job.size ? ` · ${(job.size / 1e6).toFixed(1)} MB` : "";
    text = `Done${took}${size}`;
  } else {
    const warn = job.warning ? ` (retrying: ${job.warning})` : "";
    text = `${job.step || "Running…"} · ${fmtDuration(Date.now() - job.created)}${warn}`;
  }
  return (
    <Typography variant="body2" sx={{ color: "text.secondary" }}>
      {text}
    </Typography>
  );
}

interface Props {
  jobs: Job[];
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function ActivityCard({ jobs, onOpen, onRemove }: Props) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" component="h2" sx={{ mb: 2 }}>
          Activity
        </Typography>
        {jobs.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Nothing running. Analyses take a few minutes; shorts about two.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {jobs.slice(0, 12).map((job) => (
              <JobRow key={job.id} job={job} onOpen={onOpen} onRemove={onRemove} />
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function JobRow({ job, onOpen, onRemove }: { job: Job } & Omit<Props, "jobs">) {
  const state = jobState(job);
  const title = job.kind === "analyze" ? `Analyze · ${job.title || job.label}` : `Short · ${job.label}`;
  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1.5, flexWrap: { xs: "wrap", sm: "nowrap" } }}>
      <Box sx={{ display: "flex", flexShrink: 0 }}>
        <JobStatusIcon job={job} />
      </Box>
      {/* On phones the text takes the whole first line and the buttons wrap below it */}
      <Box sx={{ flex: 1, minWidth: 0, flexBasis: { xs: "calc(100% - 44px)", sm: "auto" } }}>
        <Typography noWrap title={title} sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <JobSubline job={job} />
      </Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0, ml: { xs: "auto", sm: 0 } }}>
        {state === "success" && job.kind === "analyze" && (
          <Button size="small" variant="outlined" onClick={() => onOpen(job.id)}>
            Open
          </Button>
        )}
        {state === "success" && job.download && (
          <Button size="small" variant="contained" href={job.download} startIcon={<DownloadIcon />}>
            Download
          </Button>
        )}
        {job.runUrl && (
          <Button size="small" color="inherit" href={job.runUrl} target="_blank" rel="noopener">
            Log
          </Button>
        )}
        <Tooltip title="Remove from list">
          <IconButton size="small" aria-label="Remove from list" onClick={() => onRemove(job.id)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Paper>
  );
}
