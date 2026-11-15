import { createTheme } from "@mui/material/styles";

/**
 * Editorial palette and typography following the NASA.gov Human-Centered Design
 * System (HDS) tokens, so the app reads as a government science site rather
 * than a generic dashboard: carbon grays, NASA blue, one "meatball" red accent,
 * DM Mono for numerals, Inter for body, sharp 2px corners.
 *
 * This is an independent Space Apps entry — no agency logo or wordmark is used.
 */
export const nasa = {
  // Carbon gray ramp (HDS)
  carbon100: "#17171b",
  carbon80: "#2e2e32",
  carbon60: "#58585b",
  carbon40: "#959599",
  carbon20: "#b9b9bb",
  carbon10: "#d1d1d1",
  carbon5: "#e6e6e6",
  carbon0: "#f6f6f6",

  // Brand
  blue: "#0b3d91", // NASA "Blue" — deep structure / headings
  blueBright: "#1c67e3", // link / primary action blue
  blueFocus: "#2491ff",
  red: "#f64137", // NASA "Red" — the single accent / live badge
  redDark: "#b60109",
  green: "#47da84",
  white: "#ffffff",
  black: "#17171b",

  // Legacy aliases (kept so existing components don't need a rewrite).
  navy: "#0b3d91",
  navyDark: "#061f4a",
  link: "#1c67e3",
  text: "#17171b",
  muted: "#58585b",
  border: "#d1d1d1",
  bg: "#ffffff",
  bgAlt: "#f6f6f6",
  success: "#47da84",
  warning: "#b60109",
};

/** The sky itself stays dark — tokens used only inside sky-image views. */
export const cosmicColors = {
  ink: "#050708",
  panel: "#111214",
  panelRaised: "#18191c",
  border: "#2b2d31",
  text: "#f2f3f5",
  muted: "#a7a9ad",
  accent: "#9ddcff",
  accentStrong: "#58b9ef",
  warning: "#ffd166",
  danger: "#ff8f7d",
};

export const cosmicTheme = createTheme({
  cssVariables: { colorSchemeSelector: "class" },
  colorSchemes: {
    light: {
      palette: {
        background: { default: "#ffffff", paper: "#ffffff" },
        text: { primary: nasa.carbon100, secondary: nasa.carbon60 },
        primary: { main: nasa.blueBright, contrastText: "#ffffff" },
        secondary: { main: nasa.red, contrastText: "#ffffff" },
        divider: nasa.carbon10,
      },
    },
    dark: {
      palette: {
        background: { default: "#0c0c0e", paper: "#141416" },
        text: { primary: "#f0f1f3", secondary: nasa.carbon20 },
        primary: { main: "#4f8fe6", contrastText: "#0b0b0d" },
        secondary: { main: "#f0634a", contrastText: "#ffffff" },
        divider: "#34373c",
      },
    },
  },
  shape: { borderRadius: 2 },
  typography: {
    fontFamily: "var(--font-nasa-sans), Inter, 'Helvetica Neue', Arial, sans-serif",
    h3: { fontWeight: 700, letterSpacing: "-0.02em" },
    h5: { fontWeight: 700, letterSpacing: "-0.01em" },
    h6: { fontWeight: 700 },
    button: { textTransform: "none", fontWeight: 600, letterSpacing: "-0.01em" },
  },
  components: {
    MuiButton: { styleOverrides: { root: { borderRadius: 2, boxShadow: "none" } } },
    MuiPaper: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundImage: "none",
          boxShadow: "none",
          border: `1px solid ${(theme.vars ?? theme).palette.divider}`,
        }),
      },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 2, fontWeight: 600 } } },
  },
});
