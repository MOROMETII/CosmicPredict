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

// MUI probes `element.matches(':focus-visible')` at runtime, which throws a
// SyntaxError on browsers without native support (Firefox < 85, Safari < 15.4)
// and logs a warning. This inline script (a) rewrites the selector to `:focus`
// as a fallback before any application code loads, and (b) as a belt-and-braces
// guard, suppresses that exact MUI warning so it can never reach the console.
const focusVisiblePolyfill = `(function(){function t(s){return s.replace(/:focus-visible/g,":focus").replace(/:focus-within/g,":focus")}function w(f){return function(s){try{return f.call(this,s)}catch(e){return f.call(this,t(s))}}}var E=Element.prototype,D=Document.prototype,m=E.matches||E.webkitMatchesSelector||E.msMatchesSelector||E.mozMatchesSelector;if(m)E.matches=w(m);if(E.closest)E.closest=w(E.closest);if(E.querySelector)E.querySelector=w(E.querySelector);if(E.querySelectorAll)E.querySelectorAll=w(E.querySelectorAll);if(D.querySelector)D.querySelector=w(D.querySelector);if(D.querySelectorAll)D.querySelectorAll=w(D.querySelectorAll);var ow=console.warn;if(ow){console.warn=function(){for(var i=0;i<arguments.length;i++){if(typeof arguments[i]==="string"&&arguments[i].indexOf(":focus-visible")!==-1&&arguments[i].indexOf("not supported in this browser")!==-1){return}}return ow.apply(console,arguments)}}})();`;

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
