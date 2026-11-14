"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  ArrowBack,
  BookmarkAdd,
  Bookmarks,
  Close,
  HelpOutline,
  Pause,
  PlayArrow,
  Share,
  Speed,
  StarBorder,
  TravelExplore,
} from "@mui/icons-material";
import {
  createMark,
  getFeed,
  getGaiaOverlay,
  getMarks,
  getTimeline,
  resolveAssetUrl,
  type FeedItem,
  type GaiaOverlay,
  type TimelineFrame,
} from "@/services/api";
import { nasa } from "@/theme";
import ScrollTutorial, { tutorialSeen } from "@/components/ScrollTutorial";

const DOUBLE_TAP_MS = 300;
const HOLD_MS = 280;

/** Replay speeds: multiplier label + milliseconds per observation date. */
const SPEEDS = [
  { label: "0.5×", ms: 1400 },
  { label: "1×", ms: 700 },
  { label: "2×", ms: 350 },
];

type TapSpot = { xFrac: number; yFrac: number };

/** The app's orbit mark, sized as a story-ring avatar. */
function OrbitAvatar() {
  return (
    <Box
      sx={{
        width: 34,
        height: 34,
        borderRadius: "50%",
        p: "2px",
        background: `conic-gradient(${nasa.red}, ${nasa.blue}, ${nasa.red})`,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      <Box
        component="svg"
        viewBox="0 0 40 40"
        sx={{ width: "100%", height: "100%", bgcolor: "#0e0e10", borderRadius: "50%", p: "3px" }}
        aria-hidden
      >
        <circle cx="20" cy="20" r="16" fill="none" stroke="#e4e9f1" strokeWidth="2.4" />
        <ellipse cx="20" cy="20" rx="15" ry="6" fill="none" stroke={nasa.red} strokeWidth="2.4" transform="rotate(-18 20 20)" />
        <circle cx="20" cy="20" r="4" fill="#e4e9f1" />
      </Box>
    </Box>
  );
}

/** One icon of the reels action rail. */
function RailButton({
  icon,
  label,
  onClick,
  active,
  href,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  href?: string;
  title: string;
}) {
  const content = (
    <Stack alignItems="center" spacing={0.25} sx={{ cursor: "pointer" }}>
      <IconButton
        component={href ? Link : "button"}
        href={href}
        onClick={onClick}
        sx={{
          color: active ? "#ffb74d" : "#fff",
          bgcolor: "rgba(0,0,0,.35)",
          backdropFilter: "blur(2px)",
          "&:hover": { bgcolor: "rgba(0,0,0,.55)" },
          filter: "drop-shadow(0 1px 4px rgba(0,0,0,.8))",
        }}
        aria-label={title}
      >
        {icon}
      </IconButton>
      <Typography sx={{ fontSize: 10, fontWeight: 700, color: "#eef2f7", textShadow: "0 1px 4px #000" }}>
        {label}
      </Typography>
    </Stack>
  );
  return (
    <Tooltip title={title} placement="left">
      {content}
    </Tooltip>
  );
}

/**
 * One reel: a real sky position whose observations auto-replay in date order.
 * Every frame is a real SPHEREx observation — the reel only animates between
 * real epochs, never synthesizing in-between imagery.
 */
function ReelCard({
  item,
  index,
  total,
  flagsCount,
  onFlagged,
  onToast,
}: {
  item: FeedItem;
  index: number;
  total: number;
  flagsCount: number;
  onFlagged: () => void;
  onToast: (message: string) => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [requested, setRequested] = useState(false);
  const [frames, setFrames] = useState<TimelineFrame[] | null>(null);
  const [frame, setFrame] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(1);
  const [holding, setHolding] = useState(false);
  const [spot, setSpot] = useState<TapSpot | null>(null);
  const [burst, setBurst] = useState(false);
  const [showStars, setShowStars] = useState(false);
  const [stars, setStars] = useState<GaiaOverlay | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const holdTimerRef = useRef<number | null>(null);
  const heldRef = useRef(false);
  const singleTapTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef(0);

  // Play only while this card fills most of the viewport (reel behavior).
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const ratio = entries[0]?.intersectionRatio ?? 0;
        setVisible(ratio > 0.6);
        if (ratio > 0.2) setRequested(true); // prefetch just before it scrolls in
      },
      { threshold: [0, 0.2, 0.6, 1] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!requested || frames !== null) return;
    let active = true;
    getTimeline(item.ra, item.dec, item.fov_arcmin, item.band)
      .then((result) => {
        if (!active) return;
        setFrames(result.frames);
        result.frames.forEach((timelineFrame) => {
          const image = new Image();
          image.src = resolveAssetUrl(timelineFrame.cutout_url) ?? "";
        });
      })
      .catch(() => active && setFrames([]));
    return () => {
      active = false;
    };
  }, [requested, frames, item]);

  const speedMs = SPEEDS[speedIndex].ms;

  useEffect(() => {
    if (!visible || holding || paused || !frames || frames.length < 2) return;
    const timer = window.setInterval(() => setFrame((current) => (current + 1) % frames.length), speedMs);
    return () => window.clearInterval(timer);
  }, [visible, holding, paused, frames, speedMs]);

  // Known stars (ESA Gaia DR3) — fetched once when the toggle first turns on.
  useEffect(() => {
    if (!showStars || stars !== null) return;
    let active = true;
    getGaiaOverlay(item.ra, item.dec, item.fov_arcmin)
      .then((result) => active && setStars(result))
      .catch(() => active && setStars(null));
    return () => {
      active = false;
    };
  }, [showStars, stars, item]);

  const active = frames?.[frame] ?? null;
  const date = active?.epoch
    ? new Date(active.epoch).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  const saveMark = useCallback(
    async (tapSpot: TapSpot | null, markNote: string | null) => {
      await createMark({
        ra: item.ra,
        dec: item.dec,
        fov_arcmin: item.fov_arcmin,
        band: active?.band ?? item.band,
        observation_id: active?.observation_id ?? null,
        epoch: active?.epoch ?? null,
        note: markNote,
        source: "scroll",
        x_frac: tapSpot?.xFrac ?? null,
        y_frac: tapSpot?.yFrac ?? null,
      });
      onFlagged();
    },
    [item, active, onFlagged],
  );

  /** Double-tap: instant flag at the tapped spot, Instagram-like burst. */
  const quickFlag = useCallback(
    (tapSpot: TapSpot) => {
      setSpot(tapSpot);
      setBurst(true);
      window.setTimeout(() => setBurst(false), 750);
      saveMark(tapSpot, null).catch(() => onToast("Could not save the flag — is the backend running?"));
    },
    [saveMark, onToast],
  );

  const onPointerDown = useCallback(() => {
    heldRef.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      heldRef.current = true;
      setHolding(true); // press-and-hold pauses the replay
    }, HOLD_MS);
  }, []);

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
      if (heldRef.current) {
        heldRef.current = false;
        setHolding(false);
        return; // a hold is not a tap
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const tapSpot: TapSpot = {
        xFrac: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
        yFrac: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
      };
      const now = Date.now();
      if (now - lastTapRef.current < DOUBLE_TAP_MS) {
        lastTapRef.current = 0;
        if (singleTapTimerRef.current) window.clearTimeout(singleTapTimerRef.current);
        quickFlag(tapSpot);
        return;
      }
      lastTapRef.current = now;
      singleTapTimerRef.current = window.setTimeout(() => setSpot(tapSpot), DOUBLE_TAP_MS);
    },
    [quickFlag],
  );

  const cancelHold = useCallback(() => {
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    if (heldRef.current) {
      heldRef.current = false;
      setHolding(false);
    }
  }, []);

  const saveFromDialog = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveMark(spot, note.trim() || null);
      setDialogOpen(false);
      setNote("");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the flag.");
    } finally {
      setSaving(false);
    }
  };

  const shareLink = async () => {
    const url = `${window.location.origin}/?ra=${item.ra}&dec=${item.dec}`;
    try {
      await navigator.clipboard.writeText(url);
      onToast("Link copied — it opens this exact sky position");
    } catch {
      onToast(url); // clipboard unavailable: at least show the link
    }
  };

  return (
    <Box
      ref={cardRef}
      sx={{
        height: "100dvh",
        scrollSnapAlign: "start",
        display: "grid",
        placeItems: "center",
        position: "relative",
      }}
    >
      <Box sx={{ position: "relative", width: "min(100vw, 76dvh)" }}>
        <Box
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerLeave={cancelHold}
          sx={{
            position: "relative",
            aspectRatio: "1",
            bgcolor: "#0a0c10",
            borderRadius: { xs: 0, sm: 3 },
            overflow: "hidden",
            cursor: "crosshair",
            touchAction: "pan-y",
            userSelect: "none",
            "@keyframes epochFill": { from: { width: "0%" }, to: { width: "100%" } },
            "@keyframes burstPop": {
              "0%": { transform: "translate(-50%,-50%) scale(.3)", opacity: 0 },
              "25%": { transform: "translate(-50%,-50%) scale(1.15)", opacity: 1 },
              "60%": { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
              "100%": { transform: "translate(-50%,-50%) scale(.9)", opacity: 0 },
            },
          }}
        >
          {active ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolveAssetUrl(active.cutout_url) ?? undefined}
              alt={`SPHEREx observation at RA ${item.ra}, Dec ${item.dec}${date ? ` on ${date}` : ""}`}
              style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated", pointerEvents: "none" }}
              draggable={false}
            />
          ) : (
            <Stack alignItems="center" justifyContent="center" sx={{ height: "100%" }} spacing={1}>
              {frames === null ? (
                <CircularProgress size={22} sx={{ color: "#5b6b82" }} />
              ) : (
                <Typography variant="body2" sx={{ color: "#5b6b82" }}>
                  No frames available for this tile.
                </Typography>
              )}
            </Stack>
          )}

          {/* ——— Top chrome: stories-style epoch bar + source row ——— */}
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              p: 1.25,
              pb: 3,
              background: "linear-gradient(rgba(0,0,0,.72), rgba(0,0,0,0))",
              pointerEvents: "none",
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <OrbitAvatar />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ color: "#fff", fontWeight: 800, fontSize: 13, lineHeight: 1.2, textShadow: "0 1px 4px #000" }}>
                  SPHEREx infrared sky
                </Typography>
                <Typography sx={{ color: "#c3cdd9", fontSize: 11, textShadow: "0 1px 4px #000" }}>
                  NASA/IPAC IRSA archive · real observations
                </Typography>
              </Box>
              {date && (
                <Chip
                  size="small"
                  label={date}
                  sx={{ bgcolor: "rgba(0,0,0,.6)", color: "#fff", fontWeight: 700, fontSize: 11 }}
                />
              )}
            </Stack>
            {frames && frames.length > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ mt: 1 }}>
                {frames.map((_, segment) => (
                  <Box
                    key={segment}
                    sx={{ flex: 1, height: 3, borderRadius: 2, bgcolor: "rgba(255,255,255,.28)", overflow: "hidden" }}
                  >
                    {segment < frame && <Box sx={{ width: "100%", height: "100%", bgcolor: "#fff" }} />}
                    {segment === frame && (
                      <Box
                        key={`fill-${frame}-${speedMs}`}
                        sx={{
                          height: "100%",
                          bgcolor: "#fff",
                          width: frames.length < 2 ? "100%" : undefined,
                          animation: frames.length >= 2 ? `epochFill ${speedMs}ms linear forwards` : undefined,
                          animationPlayState: holding || paused || !visible ? "paused" : "running",
                        }}
                      />
                    )}
                  </Box>
                ))}
              </Stack>
            )}
          </Box>

          {/* ——— Bottom chrome: caption like a post ——— */}
          <Box
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              p: 1.5,
              pt: 5,
              pr: 9,
              background: "linear-gradient(rgba(0,0,0,0), rgba(0,0,0,.78))",
              pointerEvents: "none",
            }}
          >
            <Typography sx={{ color: "#fff", fontWeight: 800, fontSize: 14, textShadow: "0 1px 4px #000" }}>
              RA {item.ra.toFixed(3)}° · Dec {item.dec.toFixed(3)}°
            </Typography>
            <Typography sx={{ color: "#c3cdd9", fontSize: 12, textShadow: "0 1px 4px #000" }}>
              {item.n_frames} observations{item.band ? ` · detector ${item.band}` : ""} · patch {index + 1} of {total}
              {spot ? " · spot pinned" : ""}
            </Typography>
            <Typography sx={{ color: "#7fb8ff", fontSize: 11, mt: 0.5, textShadow: "0 1px 4px #000" }}>
              #SPHEREx #infraredSky #spaceApps
            </Typography>
          </Box>

          {/* ——— Right action rail (Instagram-style) ——— */}
          <Stack
            spacing={1.25}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            sx={{ position: "absolute", right: 8, bottom: 14, alignItems: "center" }}
          >
            <RailButton
              icon={paused ? <PlayArrow sx={{ fontSize: 26 }} /> : <Pause sx={{ fontSize: 26 }} />}
              label={paused ? "Play" : "Pause"}
              title={paused ? "Resume the replay" : "Pause on the current date"}
              active={paused}
              onClick={() => setPaused((value) => !value)}
            />
            <RailButton
              icon={<Speed sx={{ fontSize: 26 }} />}
              label={SPEEDS[speedIndex].label}
              title="Replay speed — cycles 0.5×, 1×, 2×"
              active={speedIndex !== 1}
              onClick={() => setSpeedIndex((value) => (value + 1) % SPEEDS.length)}
            />
            <RailButton
              icon={<BookmarkAdd sx={{ fontSize: 26 }} />}
              label={flagsCount > 0 ? String(flagsCount) : "Flag"}
              title={spot ? "Flag the pinned spot (with a note)" : "Flag this view as suspicious (with a note)"}
              onClick={() => setDialogOpen(true)}
            />
            <RailButton
              icon={<StarBorder sx={{ fontSize: 26 }} />}
              label="Stars"
              title="Ring known catalogued stars (ESA Gaia DR3) — a changing dot with no ring is not a known star"
              active={showStars}
              onClick={() => setShowStars((value) => !value)}
            />
            <RailButton
              icon={<Share sx={{ fontSize: 24 }} />}
              label="Share"
              title="Copy a link to this exact sky position"
              onClick={shareLink}
            />
            <RailButton
              icon={<TravelExplore sx={{ fontSize: 26 }} />}
              label="Inspect"
              title="Open in the full explorer: run the change detector here"
              href={`/?ra=${item.ra}&dec=${item.dec}`}
            />
          </Stack>

          {/* Known-star rings (Gaia DR3) */}
          {showStars &&
            stars?.sources.map((star) => (
              <Box
                key={star.source_id}
                sx={{
                  position: "absolute",
                  left: `${star.x_frac * 100}%`,
                  top: `${star.y_frac * 100}%`,
                  width: 13,
                  height: 13,
                  transform: "translate(-50%, -50%)",
                  borderRadius: "50%",
                  border:
                    star.variable_flag === "VARIABLE"
                      ? "1.5px solid rgba(255,120,220,.95)"
                      : "1.5px dashed rgba(255,200,80,.9)",
                  pointerEvents: "none",
                }}
              />
            ))}
          {showStars && stars && (
            <Chip
              size="small"
              label={stars.status === "ok" ? `${stars.sources.length} known stars · Gaia DR3` : "Gaia catalog unavailable"}
              sx={{ position: "absolute", top: 74, left: 10, bgcolor: "rgba(0,0,0,.65)", color: "#ffd890", fontSize: 10, pointerEvents: "none" }}
            />
          )}

          {/* The user's pinned spot */}
          {spot && (
            <Box
              sx={{
                position: "absolute",
                left: `${spot.xFrac * 100}%`,
                top: `${spot.yFrac * 100}%`,
                width: 26,
                height: 26,
                transform: "translate(-50%, -50%)",
                borderRadius: "50%",
                border: "2px solid #ffb74d",
                boxShadow: "0 0 10px rgba(0,0,0,.9)",
                pointerEvents: "none",
              }}
            />
          )}

          {/* Double-tap burst (Instagram heart, NASA edition) */}
          {burst && (
            <BookmarkAdd
              sx={{
                position: "absolute",
                left: "50%",
                top: "50%",
                fontSize: 96,
                color: "#ffb74d",
                filter: "drop-shadow(0 2px 10px rgba(0,0,0,.8))",
                animation: "burstPop 750ms ease-out forwards",
                pointerEvents: "none",
              }}
            />
          )}

          {holding && (
            <Chip
              size="small"
              label="Paused — release to resume"
              sx={{
                position: "absolute",
                bottom: 86,
                left: "50%",
                transform: "translateX(-50%)",
                bgcolor: "rgba(0,0,0,.7)",
                color: "#fff",
                fontSize: 11,
                pointerEvents: "none",
              }}
            />
          )}
        </Box>

        {/* Clear-pin affordance below the media */}
        {spot && (
          <Stack direction="row" justifyContent="center" sx={{ mt: 0.75 }}>
            <Chip
              size="small"
              label="Clear pinned spot"
              onDelete={() => setSpot(null)}
              deleteIcon={<Close />}
              sx={{ bgcolor: "rgba(255,183,77,.14)", color: "#ffb74d" }}
            />
          </Stack>
        )}
      </Box>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: 17 }}>Flag as suspicious</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Saves {spot ? "the pinned spot" : "this view"} ({date ? `frame of ${date}` : "current frame"}) to
            your flags for later review. A flag is your bookmark — not a detection.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="What looks odd? (optional)"
            placeholder="e.g. object moves between the last two dates"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            inputProps={{ maxLength: 500 }}
          />
          {saveError && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              {saveError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={saveFromDialog}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <BookmarkAdd />}
          >
            Save flag
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

const emptySubscribe = () => () => {};

export default function ScrollPage() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [flagsCount, setFlagsCount] = useState(0);
  // First-visit tutorial: derived at render time (true on the client once
  // mounted, unless already completed), so no setState-in-effect is needed.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const [tutorialDismissed, setTutorialDismissed] = useState(false);
  const [tutorialForced, setTutorialForced] = useState(false);
  const tutorialOpen = tutorialForced || (mounted && !tutorialDismissed && !tutorialSeen());
  const closeTutorial = useCallback(() => {
    setTutorialDismissed(true);
    setTutorialForced(false);
  }, []);

  useEffect(() => {
    getFeed()
      .then((feed) => {
        setItems(feed.items);
        if (feed.items.length === 0) setEmptyMessage(feed.message ?? "The feed is empty.");
      })
      .catch((requestError: Error) => {
        setItems([]);
        setError(requestError.message);
      });
    getMarks()
      .then((result) => setFlagsCount(result.marks.length))
      .catch(() => {});
  }, []);

  const onFlagged = useCallback(() => {
    setFlagsCount((count) => count + 1);
    setToast("Flagged — find it under My flags");
  }, []);

  return (
    <Box sx={{ bgcolor: "#05070b", minHeight: "100dvh" }}>
      {/* Floating chrome — NASA near-black with the red accent line */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          px: 1.25,
          py: 0.75,
          pointerEvents: "none",
          background: "linear-gradient(rgba(5,7,11,.85), rgba(5,7,11,0))",
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ pointerEvents: "auto" }}>
          <IconButton component={Link} href="/" sx={{ color: "#d7e4f4" }} aria-label="Back to explorer">
            <ArrowBack />
          </IconButton>
          <Box sx={{ borderLeft: `3px solid ${nasa.red}`, pl: 1 }}>
            <Typography sx={{ color: "#e4e9f1", fontWeight: 800, letterSpacing: "0.06em", fontSize: 15, lineHeight: 1.1 }}>
              SKY SCROLL
            </Typography>
            <Typography sx={{ color: "#8b97a8", fontSize: 10, letterSpacing: "0.04em" }}>
              COSMIC PREDICT · real SPHEREx data
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ pointerEvents: "auto" }} alignItems="center">
          <Tooltip title="How Sky Scroll works">
            <IconButton onClick={() => setTutorialForced(true)} sx={{ color: "#8b97a8" }} aria-label="Open tutorial">
              <HelpOutline />
            </IconButton>
          </Tooltip>
          <Button
            component={Link}
            href="/flags"
            startIcon={<Bookmarks />}
            sx={{ color: "#ffb74d", bgcolor: "rgba(0,0,0,.45)", "&:hover": { bgcolor: "rgba(0,0,0,.65)" } }}
          >
            My flags{flagsCount > 0 ? ` (${flagsCount})` : ""}
          </Button>
        </Stack>
      </Stack>

      {items === null && (
        <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ height: "100dvh" }}>
          <CircularProgress size={26} sx={{ color: "#5b6b82" }} />
          <Typography variant="body2" sx={{ color: "#8b97a8" }}>
            Building your sky feed from real observations…
          </Typography>
        </Stack>
      )}

      {items !== null && items.length === 0 && (
        <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ height: "100dvh", px: 3, textAlign: "center" }}>
          <Typography variant="h6" sx={{ color: "#e4e9f1" }}>
            Nothing to scroll yet
          </Typography>
          <Typography variant="body2" sx={{ color: "#8b97a8", maxWidth: 420 }}>
            {error ?? emptyMessage} Open the explorer, pick a position, and fetch its observations —
            every region you load becomes part of this feed.
          </Typography>
          <Button component={Link} href="/" variant="contained">
            Go to the explorer
          </Button>
        </Stack>
      )}

      {items !== null && items.length > 0 && (
        <Box sx={{ height: "100dvh", overflowY: "auto", scrollSnapType: "y mandatory" }}>
          {items.map((item, index) => (
            <ReelCard
              key={`${item.region_key}-${item.ra}-${item.dec}`}
              item={item}
              index={index}
              total={items.length}
              flagsCount={flagsCount}
              onFlagged={onFlagged}
              onToast={setToast}
            />
          ))}
        </Box>
      )}

      {tutorialOpen && <ScrollTutorial onClose={closeTutorial} />}

      <Snackbar
        open={toast !== null}
        autoHideDuration={2600}
        onClose={() => setToast(null)}
        message={toast ?? ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
