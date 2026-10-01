import { useState, type FormEvent } from "react";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert, { type AlertColor } from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { GitHub, GitHubError } from "../api/github";
import type { Settings } from "../types";

interface Props {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  onSave: (settings: Settings) => void;
}

export default function SettingsDialog({ open, settings, onClose, onSave }: Props) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      {/* Remounts on every open, so the form starts from the saved settings */}
      {open && <SettingsForm settings={settings} onClose={onClose} onSave={onSave} />}
    </Dialog>
  );
}

function SettingsForm({ settings, onClose, onSave }: Omit<Props, "open">) {
  const [owner, setOwner] = useState(settings.owner);
  const [repo, setRepo] = useState(settings.repo);
  const [token, setToken] = useState(settings.token);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ severity: AlertColor; text: string } | null>(null);

  const saveAndTest = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const next = { ...settings, owner: owner.trim(), repo: repo.trim(), token: token.trim() };
    try {
      const client = new GitHub(next);
      const info = await client.repo();
      if (!(await client.hasWorkflows())) {
        throw new Error("Connected, but the workflows aren't in this repo yet. Push the code first.");
      }
      onSave({ ...next, branch: info.default_branch });
      if (info.private) {
        setStatus({ severity: "warning", text: `Connected to ${info.full_name}. It's private, so downloads need you signed in to GitHub in this browser.` });
      } else {
        setStatus({ severity: "success", text: `Connected to ${info.full_name}.` });
        window.setTimeout(onClose, 1200);
      }
    } catch (err) {
      const code = err instanceof GitHubError ? err.status : 0;
      const text = code === 401 ? "That token was rejected." : code === 404 ? "Repo not found, or the token can't see it." : (err as Error).message;
      setStatus({ severity: "error", text });
    } finally {
      setBusy(false);
    }
  };

  const forget = () => {
    onSave({ ...settings, token: "" });
    setToken("");
    setStatus({ severity: "info", text: "Token removed from this browser." });
  };

  return (
    <Box component="form" onSubmit={saveAndTest}>
      <DialogTitle>Connect to your repo</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            The heavy lifting runs in GitHub Actions in your repo. This page only needs a token that can start those workflows. It's
            stored in this browser only.
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} required fullWidth autoComplete="off" />
            <TextField label="Repository" value={repo} onChange={(e) => setRepo(e.target.value)} required fullWidth autoComplete="off" />
          </Stack>
          <TextField
            label="Fine-grained access token"
            placeholder="github_pat_…"
            type={showToken ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            fullWidth
            autoComplete="off"
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton aria-label={showToken ? "Hide token" : "Show token"} onClick={() => setShowToken((s) => !s)} edge="end">
                      {showToken ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          {status && <Alert severity={status.severity}>{status.text}</Alert>}
          <Accordion disableGutters elevation={0} variant="outlined">
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="body2">How to create the token</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography component="ol" variant="body2" sx={{ m: 0, pl: 2.5, color: "text.secondary", "& li": { mb: 0.5 } }}>
                <li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>
                <li>Repository access: <b>Only select repositories</b> → pick this repo.</li>
                <li>Permissions: <b>Actions: Read and write</b>, <b>Contents: Read-only</b> (Metadata is added automatically).</li>
                <li>Pick an expiry, generate, and paste it above.</li>
              </Typography>
            </AccordionDetails>
          </Accordion>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={forget} sx={{ mr: "auto" }}>
          Forget token
        </Button>
        <Button color="inherit" onClick={onClose}>
          Close
        </Button>
        <Button type="submit" variant="contained" loading={busy}>
          Save &amp; test
        </Button>
      </DialogActions>
    </Box>
  );
}
