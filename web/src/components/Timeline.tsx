import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { fmtTime } from "../lib/format";
import type { Analysis } from "../types";

const W = 1000;
const H = 100;

interface Props {
  data: Analysis;
  onPick: (rank: number) => void;
}

/** The Most Replayed curve with the picked moments shaded on top. */
export default function Timeline({ data, onPick }: Props) {
  const duration = data.video.duration || Math.max(1, ...data.moments.map((m) => m.end));
  const x = (t: number) => (t / duration) * W;
  const heat = data.heatmap ?? [];
  const area = heat.length
    ? `M0,${H} ` +
      heat.map((p) => `L${x((p.start_time + p.end_time) / 2).toFixed(1)},${(H - p.value * (H - 6)).toFixed(1)}`).join(" ") +
      ` L${W},${H} Z`
    : null;

  return (
    <Box sx={{ my: 2 }}>
      <Box sx={{ position: "relative", height: 20 }}>
        {data.moments.map((m) => (
          <Box
            key={m.rank}
            component="button"
            type="button"
            onClick={() => onPick(m.rank)}
            aria-label={`Go to moment ${m.rank}`}
            sx={{
              position: "absolute",
              left: `${((m.start + m.end) / 2 / duration) * 100}%`,
              transform: "translateX(-50%)",
              p: 0,
              border: 0,
              bgcolor: "transparent",
              color: "primary.main",
              font: "inherit",
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {m.rank}
          </Box>
        ))}
      </Box>
      <Box
        sx={(theme) => {
          const palette = (theme.vars ?? theme).palette;
          return {
            "& svg": { width: "100%", height: 96, display: "block" },
            "& .area": { fill: palette.primary.main, fillOpacity: 0.15, stroke: palette.primary.main, strokeWidth: 1.5 },
            "& .base": { stroke: palette.divider },
            "& .span": { fill: palette.primary.main, fillOpacity: 0.22, cursor: "pointer" },
            "& .span:hover": { fillOpacity: 0.4 },
          };
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Replay heatmap with the chosen moments highlighted">
          {area && <path className="area" d={area} vectorEffect="non-scaling-stroke" />}
          <line className="base" x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} vectorEffect="non-scaling-stroke" />
          {data.moments.map((m) => (
            <rect key={m.rank} className="span" x={x(m.start)} y={0} width={Math.max(4, x(m.end) - x(m.start))} height={H} onClick={() => onPick(m.rank)}>
              <title>{`#${m.rank} ${fmtTime(m.start)}–${fmtTime(m.end)}: ${m.title}`}</title>
            </rect>
          ))}
        </svg>
      </Box>
      <Box sx={{ display: "flex", justifyContent: "space-between" }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          0:00
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {fmtTime(duration)}
        </Typography>
      </Box>
      <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 0.5 }}>
        {heat.length
          ? "Curve: how often YouTube viewers rewatched each part (Most Replayed). Shaded: the picked moments."
          : "YouTube has no replay data for this video yet, so picks are from the transcript alone."}
      </Typography>
    </Box>
  );
}
