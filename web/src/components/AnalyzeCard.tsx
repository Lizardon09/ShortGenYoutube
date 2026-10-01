import { useState, type FormEvent } from "react";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { fmtTime, parseTime, youtubeId } from "../lib/format";
import { load, MODEL_KEY, save } from "../lib/storage";
import type { AnalyzeRequest, ModelChoice, ShortRequest } from "../types";
import ShortOptions, { cleanZoom, DEFAULT_SHORT_OPTIONS } from "./ShortOptions";

const MODEL_OPTIONS: { value: ModelChoice; label: string }[] = [
  { value: "opus", label: "Claude Opus 5.5 · best picks" },
  { value: "sonnet", label: "Claude Sonnet 5.5 · cheaper" },
  { value: "haiku", label: "Claude Haiku 4.5 · cheapest" },
  { value: "none", label: "Replay data only · free" },
];

interface Props {
  ready: boolean;
  onNeedSettings: () => void;
  onAnalyze: (request: AnalyzeRequest) => Promise<void>;
  onShort: (request: ShortRequest) => Promise<void>;
}

export default function AnalyzeCard({ ready, onNeedSettings, onAnalyze, onShort }: Props) {
  const [url, setUrl] = useState("");
  const [clips, setClips] = useState("8");
  const [min, setMin] = useState("20");
  const [max, setMax] = useState("60");
  const [model, setModel] = useState<ModelChoice>(() => load<ModelChoice>(MODEL_KEY, "opus"));
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!ready) {
      onNeedSettings();
      return setError("Connect your repo in Settings first.");
    }
    if (!youtubeId(url)) return setError("That doesn't look like a YouTube video link.");
    if (Number(max) < Number(min)) return setError("Max seconds must be at least min seconds.");
    setBusy(true);
    try {
      await onAnalyze({ url: url.trim(), clips: Number(clips), min: Number(min), max: Number(max), instructions: instructions.trim(), model });
      setUrl("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" component="h2" sx={{ mb: 2 }}>
          Find Shorts moments
        </Typography>
        <Box component="form" onSubmit={submit}>
          <Grid container spacing={2}>
            <Grid size={12}>
              <TextField
                label="YouTube URL"
                type="url"
                placeholder="https://www.youtube.com/watch?v=…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                fullWidth
                autoComplete="off"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField label="Clips" type="number" value={clips} onChange={(e) => setClips(e.target.value)} required fullWidth slotProps={{ htmlInput: { min: 1, max: 20 } }} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TextField label="Min seconds" type="number" value={min} onChange={(e) => setMin(e.target.value)} required fullWidth slotProps={{ htmlInput: { min: 5, max: 180 } }} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TextField label="Max seconds" type="number" value={max} onChange={(e) => setMax(e.target.value)} required fullWidth slotProps={{ htmlInput: { min: 5, max: 180 } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                label="Picked by"
                value={model}
                onChange={(e) => {
                  const next = e.target.value as ModelChoice;
                  setModel(next);
                  save(MODEL_KEY, next);
                }}
                fullWidth
              >
                {MODEL_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Anything to focus on?"
                placeholder="e.g. only the funniest moments"
                helperText="Optional · Claude only"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                disabled={model === "none"}
                fullWidth
                autoComplete="off"
              />
            </Grid>
            <Grid size={12}>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Without an <code>ANTHROPIC_API_KEY</code> secret in the repo, every option uses replay data, which only works on videos with
                enough views to have a Most Replayed graph.
              </Typography>
            </Grid>
            {error && (
              <Grid size={12}>
                <Alert severity="error">{error}</Alert>
              </Grid>
            )}
            <Grid size={12}>
              <Button type="submit" variant="contained" size="large" startIcon={<AutoAwesomeIcon />} loading={busy}>
                Find moments
              </Button>
            </Grid>
          </Grid>
        </Box>

        <Accordion disableGutters elevation={0} variant="outlined" sx={{ mt: 3 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2">Or cut a clip by timestamps</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <ManualCutForm ready={ready} onNeedSettings={onNeedSettings} onShort={onShort} />
          </AccordionDetails>
        </Accordion>
      </CardContent>
    </Card>
  );
}

function ManualCutForm({ ready, onNeedSettings, onShort }: Omit<Props, "onAnalyze">) {
  const [url, setUrl] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [options, setOptions] = useState(DEFAULT_SHORT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!ready) {
      onNeedSettings();
      return setError("Connect your repo in Settings first.");
    }
    const s = parseTime(start);
    const t = parseTime(end);
    if (Number.isNaN(s) || Number.isNaN(t) || t <= s) return setError("Use times like 14:32 or 1:04:12, with end after start.");
    setBusy(true);
    try {
      await onShort({ url: url.trim(), start: s, end: t, ...options, zoom: cleanZoom(options.zoom), label: `${fmtTime(s)}–${fmtTime(t)}` });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack component="form" onSubmit={submit} spacing={2}>
      <TextField label="YouTube URL" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required fullWidth autoComplete="off" />
      <Stack direction="row" spacing={2}>
        <TextField label="Start" placeholder="14:32" value={start} onChange={(e) => setStart(e.target.value)} required fullWidth autoComplete="off" />
        <TextField label="End" placeholder="15:05" value={end} onChange={(e) => setEnd(e.target.value)} required fullWidth autoComplete="off" />
      </Stack>
      <ShortOptions value={options} onChange={setOptions} />
      {error && <Alert severity="error">{error}</Alert>}
      <Box>
        <Button type="submit" variant="contained" startIcon={<ContentCutIcon />} loading={busy}>
          Make short
        </Button>
      </Box>
    </Stack>
  );
}
