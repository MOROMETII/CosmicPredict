"use client";

import { ThemeProvider } from "@mui/material/styles";
import { cosmicTheme } from "@/theme";

export default function ThemeRegistry({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={cosmicTheme}>{children}</ThemeProvider>;
}
