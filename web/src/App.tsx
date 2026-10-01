import { useMemo, useState } from "react";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import SettingsIcon from "@mui/icons-material/Settings";
import { GitHub, isConfigured } from "./api/github";
import ActivityCard from "./components/ActivityCard";
import AnalysisView from "./components/AnalysisView";
import AnalyzeCard from "./components/AnalyzeCard";
import RecentAnalyses from "./components/RecentAnalyses";
import SettingsDialog from "./components/SettingsDialog";
import { useJobs } from "./hooks/useJobs";
import { requestId, youtubeId } from "./lib/format";
import { load, rememberTitle, save, SETTINGS_KEY } from "./lib/storage";
import type { AnalyzeRequest, Settings, ShortRequest } from "./types";

// On GitHub Pages the URL is <owner>.github.io/<repo>/, so the repo can be guessed.
function initialSettings(): Settings {
  const host = location.hostname;
  const guess = host.endsWith(".github.io")
    ? { owner: host.slice(0, -".github.io".length), repo: location.pathname.split("/").filter(Boolean)[0] || host }
    : { owner: "", repo: "" };
  return { ...guess, token: "", branch: "main", ...load<Partial<Settings>>(SETTINGS_KEY, {}) };
}

export default function App() {
  const [settings, setSettings] = useState(initialSettings);
  const [settingsOpen, setSettingsOpen] = useState(() => !isConfigured(settings));
  const client = useMemo(() => (isConfigured(settings) ? new GitHub(settings) : null), [settings]);
  // seq changes on every "open", so re-opening the same analysis scrolls back to it
  const [opened, setOpened] = useState<{ id: string; seq: number } | null>(null);
  const [recentKey, setRecentKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const openAnalysis = (id: string) => setOpened((o) => ({ id, seq: (o?.seq ?? 0) + 1 }));
  const { jobs, addJob, updateJob, removeJob } = useJobs(client, (id) => {
    openAnalysis(id);
    setRecentKey((k) => k + 1);
  });

  const saveSettings = (next: Settings) => {
    setSettings(next);
    save(SETTINGS_KEY, next);
  };

  const startAnalysis = async (r: AnalyzeRequest) => {
    if (!client) throw new Error("Connect your repo in Settings first.");
    const id = requestId(youtubeId(r.url));
    await client.dispatch("analyze", {
      url: r.url,
      request_id: id,
      clips: String(r.clips),
      min_seconds: String(r.min),
      max_seconds: String(r.max),
      instructions: r.instructions,
      model: r.model,
    });
    addJob({ id, kind: "analyze", label: r.url, openWhenDone: true });
    setToast("Analysis started. Results open here when they're ready, usually in a few minutes.");
  };

  const startShort = async (r: ShortRequest) => {
    if (!client) throw new Error("Connect your repo in Settings first.");
    const id = requestId();
    await client.dispatch("short", {
      url: r.url,
      request_id: id,
      start: r.start.toFixed(2),
      end: r.end.toFixed(2),
      mode: r.mode,
      zoom: r.zoom,
      captions: r.captions ? "true" : "false",
    });
    addJob({ id, kind: "short", label: r.label, key: r.key });
    setToast("Short started. It usually takes about two minutes.");
  };

  const onAnalysisLoaded = (id: string, title: string) => {
    rememberTitle(id, title);
    updateJob(id, { title });
  };

  return (
    <>
      <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.default" }}>
        <Toolbar>
          <Box aria-hidden sx={{ width: 14, height: 24, borderRadius: 1, bgcolor: "primary.main", mr: 1.5 }} />
          <Typography variant="h6" component="h1" sx={{ fontWeight: 700, flex: 1 }}>
            ShortGen
          </Typography>
          <Button color="inherit" startIcon={<SettingsIcon />} onClick={() => setSettingsOpen(true)}>
            Settings
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ py: 3 }}>
        <Stack spacing={2}>
          <AnalyzeCard ready={Boolean(client)} onNeedSettings={() => setSettingsOpen(true)} onAnalyze={startAnalysis} onShort={startShort} />
          <ActivityCard jobs={jobs} onOpen={openAnalysis} onRemove={removeJob} />
          {client && opened && (
            <AnalysisView
              key={opened.id}
              client={client}
              id={opened.id}
              openSeq={opened.seq}
              jobs={jobs}
              onShort={startShort}
              onLoaded={onAnalysisLoaded}
            />
          )}
          <RecentAnalyses client={client} refreshKey={recentKey} onOpen={openAnalysis} />
        </Stack>
      </Container>

      <SettingsDialog open={settingsOpen} settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        message={toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </>
  );
}
