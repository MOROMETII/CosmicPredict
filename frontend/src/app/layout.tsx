import type { Metadata } from "next";
import { DM_Mono, Inter } from "next/font/google";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import "./globals.css";
import ThemeRegistry from "@/components/ThemeRegistry";

const inter = Inter({
  variable: "--font-nasa-sans",
  subsets: ["latin"],
});

const dmMono = DM_Mono({
  weight: ["300", "400", "500"],
  variable: "--font-nasa-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "COSMIC PREDICT | SPHEREx Time-Domain Explorer",
  description: "Compare cached SPHEREx observations across epochs and inspect candidate changes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${dmMono.variable}`} suppressHydrationWarning>
      <body>
        <InitColorSchemeScript attribute="class" defaultMode="light" />
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
