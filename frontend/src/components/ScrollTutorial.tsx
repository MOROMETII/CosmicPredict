"use client";

import { useState } from "react";
import { Box, Button, ButtonBase, IconButton, Stack, Typography } from "@mui/material";
import {
  BookmarkAdd,
  Bookmarks,
  Close,
  PanTool,
  Pause,
  Share,
  StarBorder,
  TouchApp,
  TravelExplore,
} from "@mui/icons-material";
import { nasa } from "@/theme";

export const TUTORIAL_STORAGE_KEY = "cosmic-skyscroll-tutorial-v1";

export function tutorialSeen(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_STORAGE_KEY) === "done";
  } catch {
    return false; // storage unavailable: show the tutorial, never crash
  }
}

export function rememberTutorialSeen(): void {
  try {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "done");
  } catch {
    /* storage unavailable: the tutorial will simply show again next visit */
  }
}

/** USWDS icon-list row: the control's real icon beside its explanation. */
function ControlRow({ icon, term, text }: { icon: React.ReactNode; term: string; text: string }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Box
        sx={{
          width: 32,
          height: 32,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          bgcolor: nasa.black,
          color: "#fff",
          borderRadius: "4px",
          "& svg": { fontSize: 18 },
        }}
      >
        {icon}
      </Box>
      <Typography variant="body2" sx={{ color: nasa.muted, pt: 0.5 }}>
        <Box component="strong" sx={{ color: nasa.text }}>
          {term}
        </Box>{" "}
        — {text}
      </Typography>
    </Stack>
  );
}

/** A faithful miniature of the reel's epoch bar, shown on its own dark strip. */
function EpochBarExample() {
  return (
    <Box sx={{ bgcolor: "#0a0c10", borderRadius: "4px", p: 1.5, mt: 2 }}>
      <Stack direction="row" spacing={0.5}>
        {[1, 1, 0.55, 0, 0].map((fill, index) => (
          <Box key={index} sx={{ flex: 1, height: 3, borderRadius: 2, bgcolor: "rgba(255,255,255,.28)", overflow: "hidden" }}>
            <Box sx={{ width: `${fill * 100}%`, height: "100%", bgcolor: "#fff" }} />
          </Box>
        ))}
      </Stack>
      <Typography sx={{ color: "#c3cdd9", fontSize: 11, mt: 1 }}>
        5 observation dates — the third is currently showing
      </Typography>
    </Box>
  );
}

type Step = { title: string; content: React.ReactNode };

const STEPS: Step[] = [
  {
    title: "Scroll the real sky",
    content: (
      <Typography variant="body2" sx={{ color: nasa.muted }}>
        Every card in the feed is a patch of sky photographed by NASA&apos;s SPHEREx space telescope.
        All frames are real archive observations from NASA/IPAC IRSA — nothing is synthetic. Scroll
        vertically to move to the next patch. Stars drift, pulse, and occasionally something moves
        that shouldn&apos;t.
      </Typography>
    ),
  },
  {
    title: "The top bar shows observation dates",
    content: (
      <>
        <Typography variant="body2" sx={{ color: nasa.muted }}>
          Each segment of the bar is one real observation date, often weeks or months apart. The card
          replays the dates in order; the current frame&apos;s date appears at the top right. Use the
          Pause button in the toolbar, or press and hold the image, to stop on one date.
        </Typography>
        <EpochBarExample />
      </>
    ),
  },
  {
    title: "Pin and flag suspicious spots",
    content: (
      <Stack spacing={1.5} sx={{ mt: 0.5 }}>
        <ControlRow icon={<TouchApp />} term="Tap once" text="pin the exact spot you are looking at (an amber ring appears)." />
        <ControlRow icon={<BookmarkAdd />} term="Double-tap" text="flag the spot immediately, without a note." />
        <ControlRow icon={<PanTool />} term="Press and hold" text="pause the replay while you look closely." />
        <Typography variant="body2" sx={{ color: nasa.muted }}>
          Pinned spots are converted to real sky coordinates on the server, so a flag can be
          re-examined later with full precision.
        </Typography>
      </Stack>
    ),
  },
  {
    title: "The toolbar",
    content: (
      <Stack spacing={1.5} sx={{ mt: 0.5 }}>
        <ControlRow icon={<Pause />} term="Pause" text="stop on the current date; press again to resume." />
        <ControlRow icon={<BookmarkAdd />} term="Flag" text="save this view with an optional note describing what looks odd." />
        <ControlRow
          icon={<StarBorder />}
          term="Stars"
          text="ring every known star from ESA's Gaia DR3 catalog. A changing dot without a ring is not a catalogued star."
        />
        <ControlRow icon={<Share />} term="Share" text="copy a link that opens this exact sky position." />
        <ControlRow icon={<TravelExplore />} term="Inspect" text="open the full explorer here and run the change detector." />
      </Stack>
    ),
  },
  {
    title: "Review your flags",
    content: (
      <>
        <Typography variant="body2" sx={{ color: nasa.muted }}>
          Everything you flag is saved to <strong>My flags</strong> (the <Bookmarks sx={{ fontSize: 15, verticalAlign: "text-bottom" }} />{" "}
          button, top right) with its coordinates, preview, and note — a review queue for proper
          follow-up in the explorer.
        </Typography>
        {/* USWDS summary box */}
        <Box
          sx={{
            mt: 2,
            p: 2,
            bgcolor: "#e7f6f8",
            border: "1px solid #99deea",
            borderRadius: "4px",
          }}
        >
          <Typography variant="body2" sx={{ color: "#1b1b1b", fontWeight: 700, mb: 0.5 }}>
            A flag is a bookmark, not a detection
          </Typography>
          <Typography variant="body2" sx={{ color: "#1b1b1b" }}>
            Flags carry no scientific weight on their own. Candidates become interesting only after
            the change detector, the Gaia catalog check, and human review.
          </Typography>
        </Box>
      </>
    ),
  },
];

/** First-use walkthrough of Sky Scroll, built from USWDS-style components
 * (step indicator, buttons, summary box) to match the rest of the site. */
export default function ScrollTutorial({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const current = STEPS[step];

  const finish = () => {
    rememberTutorialSeen();
    onClose();
  };

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        bgcolor: "rgba(0,0,0,.7)",
        display: "grid",
        placeItems: "center",
        p: 2,
        overflowY: "auto",
      }}
      role="presentation"
    >
      <Box
        role="dialog"
        aria-modal="true"
        aria-label="How Sky Scroll works"
        sx={{
          width: "min(94vw, 480px)",
          bgcolor: "#fff",
          color: nasa.text,
          borderRadius: "8px",
          p: { xs: 2.5, sm: 4 },
          position: "relative",
        }}
      >
        <IconButton
          onClick={finish}
          size="small"
          sx={{ position: "absolute", top: 10, right: 10, color: "#71767a" }}
          aria-label="Close tutorial"
        >
          <Close sx={{ fontSize: 20 }} />
        </IconButton>

        {/* USWDS step indicator */}
        <Stack direction="row" spacing="2px" sx={{ mb: 1, mr: 4 }}>
          {STEPS.map((_, index) => (
            <ButtonBase
              key={index}
              onClick={() => setStep(index)}
              aria-label={`Go to step ${index + 1}`}
              sx={{ flex: 1, height: 8, bgcolor: index <= step ? nasa.link : nasa.border }}
            />
          ))}
        </Stack>
        <Typography sx={{ fontSize: 13, color: nasa.muted, mb: 0.25 }}>
          Step <Box component="strong" sx={{ color: nasa.text }}>{step + 1}</Box> of {STEPS.length}
        </Typography>
        <Typography component="h2" sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1.25, mb: 1.5 }}>
          {current.title}
        </Typography>

        <Box sx={{ minHeight: { sm: 190 } }}>{current.content}</Box>

        {/* USWDS button group */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 3 }}>
          <Button
            onClick={finish}
            sx={{ color: nasa.link, textDecoration: "underline", fontWeight: 400, p: 0.5, "&:hover": { bgcolor: "transparent", textDecoration: "underline" } }}
          >
            Skip tutorial
          </Button>
          <Stack direction="row" spacing={1}>
            {step > 0 && (
              <Button
                onClick={() => setStep((value) => value - 1)}
                sx={{
                  color: nasa.link,
                  boxShadow: `inset 0 0 0 2px ${nasa.link}`,
                  borderRadius: "4px",
                  px: 2.5,
                  py: 1,
                  "&:hover": { bgcolor: "rgba(0,94,162,.06)", boxShadow: `inset 0 0 0 2px ${nasa.link}` },
                }}
              >
                Back
              </Button>
            )}
            <Button
              onClick={() => (last ? finish() : setStep((value) => value + 1))}
              sx={{
                bgcolor: nasa.link,
                color: "#fff",
                borderRadius: "4px",
                px: 2.5,
                py: 1,
                "&:hover": { bgcolor: "#1a4480" },
              }}
            >
              {last ? "Start scrolling" : "Next"}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}
