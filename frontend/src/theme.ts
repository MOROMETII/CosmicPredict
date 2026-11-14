import { createTheme } from "@mui/material/styles";

/**
 * Light + dark editorial palette in the spirit of U.S. government science
 * sites: near-black chrome, deep navy structure, one restrained red accent,
 * high-contrast text. (This is an independent Space Apps entry, not an
 * official NASA product; no agency branding is used.)
 */
export const nasa = {
  navy: "#0b3d91",
  navyDark: "#061f4a",
  red: "#dd361c",
  link: "#005ea2",
  black: "#0e0e10", // chrome (header/footer) in both modes
  text: "#1b1b1b",
  muted: "#565c65",
  border: "#dfe1e2",
  bg: "#ffffff",
  bgAlt: "#f5f6f7",
  success: "#00a91c",
  warning: "#b50909",
};

/** Dark tokens used only inside sky-image views (the sky itself stays dark). */
export const cosmicColors = {
  ink: "#050708",
  panel: "#111214",
  panelRaised: "#18191c",
  border: "#2b2d31",
  text: "#f2f3f5",
  muted: "#a7a9ad",
  accent: "#9ddcff",
  accentStrong: "#58b9ef",
  violet: "#8f83ff",
  warning: "#ffd166",
  danger: "#ff8f7d",
};

export const cosmicTheme = createTheme({
  cssVariables: { colorSchemeSelector: "class" },
  colorSchemes: {
    light: {
      palette: {
        background: { default: nasa.bg, paper: nasa.bg },
        text: { primary: nasa.text, secondary: nasa.muted },
        primary: { main: nasa.navy, contrastText: "#ffffff" },
        secondary: { main: nasa.red },
        divider: nasa.border,
      },
    },
    dark: {
      palette: {
        background: { default: "#121214", paper: "#1a1b1e" },
        text: { primary: "#f0f1f3", secondary: "#a9b0b7" },
        primary: { main: "#5c9ded", contrastText: "#0b0b0d" },
        secondary: { main: "#f0634a" },
        divider: "#34373c",
      },
    },
  },
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: "var(--font-geist-sans), 'Helvetica Neue', Arial, sans-serif",
    h3: { fontWeight: 800, letterSpacing: "-0.02em" },
    h5: { fontWeight: 800, letterSpacing: "-0.01em" },
    h6: { fontWeight: 700 },
    button: { textTransform: "none", fontWeight: 700 },
  },
  components: {
    MuiButton: { styleOverrides: { root: { borderRadius: 4, boxShadow: "none" } } },
    MuiPaper: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundImage: "none",
          boxShadow: "none",
          border: `1px solid ${(theme.vars ?? theme).palette.divider}`,
        }),
      },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 3, fontWeight: 600 } } },
  },
});
