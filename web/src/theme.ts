import { createTheme } from "@mui/material/styles";

// Follows the device's light/dark setting.
export const theme = createTheme({
  cssVariables: true,
  colorSchemes: {
    light: {
      palette: {
        primary: { main: "#e5484d" },
        background: { default: "#f6f6f4", paper: "#ffffff" },
      },
    },
    dark: {
      palette: {
        primary: { main: "#ff6369" },
        background: { default: "#111110", paper: "#1b1b19" },
      },
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiCard: { defaultProps: { variant: "outlined" } },
    MuiButton: { defaultProps: { disableElevation: true } },
  },
});
