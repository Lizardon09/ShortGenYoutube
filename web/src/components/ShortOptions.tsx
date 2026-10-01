import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import type { ShortOptionsValue } from "../types";

export const DEFAULT_SHORT_OPTIONS: ShortOptionsValue = { mode: "blurfill", zoom: "1.2", captions: false };

// Zoom stays a string while typing ("1." is a valid step towards "1.25").
export function cleanZoom(zoom: string) {
  const z = Number(zoom);
  return Number.isFinite(z) && z >= 1 && z <= 3 ? String(z) : DEFAULT_SHORT_OPTIONS.zoom;
}

interface Props {
  value: ShortOptionsValue;
  onChange: (value: ShortOptionsValue) => void;
}

export default function ShortOptions({ value, onChange }: Props) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
      <TextField
        select
        size="small"
        label="Framing"
        value={value.mode}
        onChange={(e) => onChange({ ...value, mode: e.target.value as ShortOptionsValue["mode"] })}
        sx={{ minWidth: 190 }}
      >
        <MenuItem value="blurfill">Blurred fill</MenuItem>
        <MenuItem value="hardcrop">Crop to vertical</MenuItem>
        <MenuItem value="none">Keep horizontal</MenuItem>
      </TextField>
      <TextField
        size="small"
        label="Zoom"
        type="number"
        value={value.zoom}
        disabled={value.mode !== "blurfill"}
        onChange={(e) => onChange({ ...value, zoom: e.target.value })}
        slotProps={{ htmlInput: { step: 0.05, min: 1, max: 3 } }}
        sx={{ width: { sm: 110 } }}
      />
      <FormControlLabel
        control={<Checkbox checked={value.captions} onChange={(e) => onChange({ ...value, captions: e.target.checked })} />}
        label="Captions"
      />
    </Stack>
  );
}
