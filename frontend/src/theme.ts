import { createTheme } from "@mui/material/styles";

export const cosmicColors = {
  ink: "#050708",
  panel: "#111214",
  panelRaised: "#18191c",
  border: "#2b2d31",
  text: "#f2f3f5",
  muted: "#a7a9ad",
  accent: "#76e5a9",
  accentStrong: "#4fd78d",
  violet: "#8f83ff",
  warning: "#e7b866",
  danger: "#ff8f7d",
};

export const cosmicTheme = createTheme({
  palette: {
    mode: "dark",
    background: { default: cosmicColors.ink, paper: cosmicColors.panel },
    text: { primary: cosmicColors.text, secondary: cosmicColors.muted },
    primary: { main: cosmicColors.accent, contrastText: cosmicColors.ink },
    secondary: { main: cosmicColors.violet },
    divider: cosmicColors.border,
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: "var(--font-geist-sans), Arial, sans-serif",
    button: { textTransform: "none", fontWeight: 700 },
  },
  components: {
    MuiButton: { styleOverrides: { root: { borderRadius: 7 } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiSlider: { styleOverrides: { thumb: { boxShadow: `0 0 0 5px ${cosmicColors.ink}` } } },
  },
});
