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

// Inline, must-run-first polyfill: MUI probes `element.matches(':focus-visible')`
// at runtime, which throws on browsers without native support (older Firefox /
// Safari) and logs a warning. This rewrites the selector to `:focus` as a
// fallback before any application code loads, so the probe never throws.
const focusVisiblePolyfill = `(function () {
  function translate(s) {
    return s.replace(/:focus-visible/g, ':focus').replace(/:focus-within/g, ':focus');
  }
  function wrap(fn) {
    return function (sel) {
      try { return fn.call(this, sel); } catch (e) { return fn.call(this, translate(sel)); }
    };
  }
  var E = Element.prototype;
  var D = Document.prototype;
  var m = E.matches || E.webkitMatchesSelector || E.msMatchesSelector;
  if (m) E.matches = wrap(m);
  if (E.closest) E.closest = wrap(E.closest);
  if (E.querySelector) E.querySelector = wrap(E.querySelector);
  if (E.querySelectorAll) E.querySelectorAll = wrap(E.querySelectorAll);
  if (D.querySelector) D.querySelector = wrap(D.querySelector);
  if (D.querySelectorAll) D.querySelectorAll = wrap(D.querySelectorAll);
})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${dmMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: focusVisiblePolyfill }} />
      </head>
      <body>
        <InitColorSchemeScript attribute="class" defaultMode="light" />
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
