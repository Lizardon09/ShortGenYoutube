import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import RefreshIcon from "@mui/icons-material/Refresh";
import type { GitHub } from "../api/github";
import { idDate, videoIdFromRequest } from "../lib/format";
import { load, rememberTitle, TITLES_KEY } from "../lib/storage";

interface Props {
  client: GitHub | null;
  refreshKey: number;
  onOpen: (id: string) => void;
}

export default function RecentAnalyses({ client, refreshKey, onOpen }: Props) {
  const [ids, setIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>(() => load(TITLES_KEY, {}));
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setError(null);
    client
      .analysisIds()
      .then((all) => {
        if (cancelled) return;
        const shown = all.slice(0, 24);
        setIds(shown);
        // Titles live inside each analysis; fetch the ones not cached yet.
        // (Analyses opened since this list mounted cached theirs already.)
        const cached = load<Record<string, string>>(TITLES_KEY, {});
        setTitles((t) => ({ ...t, ...cached }));
        for (const id of shown.filter((i) => !cached[i])) {
          client
            .analysis(id)
            .then((d) => {
              rememberTitle(id, d.video.title);
              if (!cancelled) setTitles((t) => ({ ...t, [id]: d.video.title }));
            })
            .catch(() => !cancelled && setTitles((t) => ({ ...t, [id]: id })));
        }
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [client, refreshKey, reloads]);

  let body;
  if (!client) {
    body = <Typography variant="body2" sx={{ color: "text.secondary" }}>Connect your repo to see past analyses.</Typography>;
  } else if (error) {
    body = <Alert severity="error">Couldn't load past analyses. {error}</Alert>;
  } else if (!ids) {
    body = <CircularProgress size={24} />;
  } else if (!ids.length) {
    body = <Typography variant="body2" sx={{ color: "text.secondary" }}>No analyses yet.</Typography>;
  } else {
    body = (
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 1.5 }}>
        {ids.map((id) => {
          const videoId = videoIdFromRequest(id);
          return (
            <Card key={id}>
              <CardActionArea onClick={() => onOpen(id)} sx={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start" }}>
                {videoId && (
                  <CardMedia component="img" image={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt="" loading="lazy" sx={{ aspectRatio: "16 / 9" }} />
                )}
                <CardContent sx={{ p: 1.5 }}>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 600, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                  >
                    {titles[id] ?? "Loading title…"}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {idDate(id)}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          );
        })}
      </Box>
    );
  }

  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 2 }}>
          <Typography variant="h6" component="h2">
            Past analyses
          </Typography>
          <Button size="small" color="inherit" startIcon={<RefreshIcon />} onClick={() => setReloads((n) => n + 1)} disabled={!client}>
            Refresh
          </Button>
        </Stack>
        {body}
      </CardContent>
    </Card>
  );
}
