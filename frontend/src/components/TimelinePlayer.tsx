"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  MenuItem,
  Select,
  Slider,
  Stack,
  ToggleButton,
  Tooltip,
  Typography,
} from "@mui/material";
import { CenterFocusStrong, CloudDownload, FlashOn, Pause, PlayArrow, SkipNext, SkipPrevious, StarBorder } from "@mui/icons-material";
import { fetchRegion, getGaiaOverlay, getTimeline, resolveAssetUrl, type GaiaOverlay, type Timeline } from "@/services/api";

const FOV_OPTIONS = [5, 15, 30, 60];
const SPEED_OPTIONS: { label: string; ms: number }[] = [
  { label: "Slow", ms: 1200 },
  { label: "Normal", ms: 600 },
  { label: "Fast", ms: 300 },
];

type Props = {
  ra: number;
  dec: number;
  fov: number;
  onFovChange: (fov: number) => void;
  onTimeline?: (timeline: Timeline | null) => void;
};

/**
 * The challenge's "little video": every frame is a real SPHEREx observation,
 * resampled onto a shared north-up sky grid, played chronologically so moving
 * or varying sources reveal themselves. No frames are synthesized.
 */
export default function TimelinePlayer({ ra, dec, fov, onFovChange, onTimeline }: Props) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [band, setBand] = useState<string | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [blink, setBlink] = useState(false);
  const [speedMs, setSpeedMs] = useState(600);
  const [showReticle, setShowReticle] = useState(true);
  const [showGaia, setShowGaia] = useState(false);
  const [gaia, setGaia] = useState<GaiaOverlay | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The backend starts the archive download in the background and answers
  // immediately (a full fetch takes minutes — longer than the dev proxy keeps
  // a socket open), so we poll the same endpoint until it finishes.
  const startArchiveFetch = useCallback(() => {
    setFetching(true);
    setFetchError(null);
    const poll = (attempt: number) => {
      fetchRegion(ra, dec)
        .then((result) => {
          if (!mountedRef.current) return;
          if (result.status === "already_fetched" || result.status === "fetched") {
            setFetching(false);
            setRefresh((value) => value + 1);
          } else if (result.status === "failed") {
            setFetching(false);
            setFetchError(result.message ?? "The archive fetch failed. Try again shortly.");
          } else if (attempt >= 60) {
            // ~5 minutes of polling: the job may still finish server-side.
            setFetching(false);
            setFetchError("The archive is responding slowly. The download continues in the background — try again in a minute.");
          } else {
            window.setTimeout(() => poll(attempt + 1), 5000);
          }
        })
        .catch((requestError: Error) => {
          if (!mountedRef.current) return;
          setFetching(false);
          setFetchError(requestError.message);
        });
    };
    poll(0);
  }, [ra, dec]);

  // Reset view state the moment the query changes (React's recommended
  // render-time adjustment pattern, instead of setState inside the effect).
  const queryKey = `${ra}|${dec}|${fov}|${band ?? ""}|${refresh}`;
  const [lastQueryKey, setLastQueryKey] = useState(queryKey);
  if (queryKey !== lastQueryKey) {
    setLastQueryKey(queryKey);
    setLoading(true);
    setError(null);
    setPlaying(false);
    setBlink(false);
    setFrame(0);
    setLoadedCount(0);
  }

  const frames = useMemo(() => timeline?.frames ?? [], [timeline]);
  const allLoaded = frames.length > 0 && loadedCount >= frames.length;
  // Playback only needs two frames to start; remaining frames keep preloading
  // in the background so the user doesn't wait for the whole series.
  const canPlay = frames.length >= 2 && loadedCount >= 2;

  useEffect(() => {
    let active = true;
    imagesRef.current = [];
    getTimeline(ra, dec, fov, band)
      .then((result) => {
        if (!active) return;
        setTimeline(result);
        onTimeline?.(result);
        // Preload every frame so playback swaps instantly instead of stuttering.
        result.frames.forEach((item, index) => {
          const image = new Image();
          image.onload = () => active && setLoadedCount((count) => count + 1);
          image.onerror = () => active && setLoadedCount((count) => count + 1);
          image.src = resolveAssetUrl(item.cutout_url) ?? "";
          imagesRef.current[index] = image;
        });
      })
      .catch((requestError: Error) => {
        if (!active) return;
        setError(requestError.message || "Could not load the observation timeline.");
        onTimeline?.(null);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ra, dec, fov, band, refresh]);

  // A new sky frame invalidates the star overlay (render-time adjustment,
  // same pattern as the query reset above).
  const gaiaKey = `${ra}|${dec}|${fov}`;
  const [lastGaiaKey, setLastGaiaKey] = useState(gaiaKey);
  if (gaiaKey !== lastGaiaKey) {
    setLastGaiaKey(gaiaKey);
    setGaia(null);
  }

  // Known-star overlay from the Gaia DR3 catalog (ESA): fetched only while
  // the toggle is on, re-fetched when the sky frame changes.
  useEffect(() => {
    if (!showGaia) return;
    let active = true;
    getGaiaOverlay(ra, dec, fov)
      .then((result) => active && setGaia(result))
      .catch(() => active && setGaia(null));
    return () => {
      active = false;
    };
  }, [showGaia, ra, dec, fov]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setInterval(() => {
      setFrame((current) => {
        if (blink) return current === 0 ? frames.length - 1 : 0;
        return (current + 1) % frames.length;
      });
    }, speedMs);
    return () => window.clearInterval(timer);
  }, [playing, blink, speedMs, frames.length]);

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setFrame((current) => (current + delta + frames.length) % frames.length);
    },
    [frames.length],
  );

  const active = frames[frame];
  const date = active?.epoch
    ? new Date(active.epoch).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

  return (
    <Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ sm: "center" }}
        spacing={1}
        sx={{ mb: 2 }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
          Each frame is a real observation of this exact spot, aligned north-up. Press play, or use
          Blink to flip between the first and last date — anything that jumps or pulses is changing.
        </Typography>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Field of view: how wide a patch of sky you see (in arcminutes — the full Moon is about 31')">
            <Select size="small" value={fov} onChange={(event) => onFovChange(Number(event.target.value))} sx={{ fontSize: 13 }}>
              {FOV_OPTIONS.map((option) => (
                <MenuItem key={option} value={option} sx={{ fontSize: 13 }}>
                  {option}&apos; view
                </MenuItem>
              ))}
            </Select>
          </Tooltip>
          {timeline && Object.keys(timeline.available_bands).length > 1 && (
            <Tooltip title="SPHEREx has six infrared detectors; frames can only be compared within one detector">
              <Select
                size="small"
                value={timeline.band ?? ""}
                onChange={(event) => setBand(event.target.value || null)}
                sx={{ fontSize: 13 }}
              >
                {Object.entries(timeline.available_bands).map(([name, count]) => (
                  <MenuItem key={name} value={name} sx={{ fontSize: 13 }}>
                    Detector {name} · {count} obs
                  </MenuItem>
                ))}
              </Select>
            </Tooltip>
          )}
        </Stack>
      </Stack>

      {loading && (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 4, justifyContent: "center" }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Searching the observation archive…
          </Typography>
        </Stack>
      )}
      {error && <Alert severity="warning">{error}</Alert>}
      {timeline && !loading && frames.length === 0 && (
        <Alert
          severity="info"
          action={
            <Button
              size="small"
              variant="contained"
              startIcon={fetching ? <CircularProgress size={14} color="inherit" /> : <CloudDownload />}
              disabled={fetching}
              onClick={startArchiveFetch}
            >
              {fetching ? "Searching…" : "Search the NASA archive"}
            </Button>
          }
        >
          {fetching
            ? "Querying IRSA and downloading small cutouts of this position — this can take a minute or two."
            : `${timeline.message ?? "Nothing cached covers this position yet."} You can fetch it on demand from the live NASA/IRSA archive.`}
          {fetchError && (
            <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.5 }}>
              {fetchError}
            </Typography>
          )}
        </Alert>
      )}

      {!loading && frames.length > 0 && (
        <>
          <Box
            sx={{
              position: "relative",
              borderRadius: 1,
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "#000",
              maxWidth: 640,
              mx: "auto",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resolveAssetUrl(active?.cutout_url ?? null) ?? undefined}
              alt={`SPHEREx observation of this sky position on ${date}`}
              style={{ width: "100%", display: "block", imageRendering: "pixelated", aspectRatio: "1" }}
            />
            <Stack
              direction="row"
              spacing={1}
              sx={{ position: "absolute", top: 10, left: 10, right: 10, justifyContent: "space-between" }}
            >
              <Chip
                size="small"
                label={date}
                sx={{ bgcolor: "rgba(0,0,0,.72)", color: "#fff", fontSize: 12, fontWeight: 700 }}
              />
              <Chip
                size="small"
                label={`${frame + 1} of ${frames.length}`}
                sx={{ bgcolor: "rgba(0,0,0,.72)", color: "#fff", fontSize: 12 }}
              />
            </Stack>
            <Chip
              size="small"
              label={`Detector ${active?.band ?? "?"}${active?.wavelength ? ` · ${active.wavelength.toFixed(2)} µm` : ""} · real archive data`}
              sx={{ position: "absolute", bottom: 10, left: 10, bgcolor: "rgba(0,0,0,.72)", color: "#d7e4f4", fontSize: 11 }}
            />
            {active?.coverage != null && active.coverage < 0.97 && (
              <Chip
                size="small"
                label={`Partial coverage — gray area is outside this exposure (${Math.round(active.coverage * 100)}% covered)`}
                sx={{ position: "absolute", bottom: 10, right: 10, bgcolor: "rgba(120,80,0,.85)", color: "#ffe2a8", fontSize: 11 }}
              />
            )}
            {/* Crosshair marking the exact RA/Dec being studied — every frame is
                centered on it, and the light curve measures this spot. */}
            {showReticle && (
              <Tooltip title={`Your target position: RA ${ra}°, Dec ${dec}° — frames are centered here and the brightness-over-time chart measures this spot`}>
                <Box
                  sx={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    width: 28,
                    height: 28,
                    transform: "translate(-50%, -50%)",
                    borderRadius: "50%",
                    border: "1.5px solid rgba(127,255,212,.95)",
                    boxShadow: "0 0 6px rgba(0,0,0,.9), inset 0 0 6px rgba(0,0,0,.9)",
                  }}
                />
              </Tooltip>
            )}
            {/* Known-star markers from the Gaia DR3 catalog (ESA). Anything
                that changes but has NO ring here is not a catalogued star —
                exactly the interesting case. */}
            {showGaia &&
              gaia?.sources.map((star) => (
                <Tooltip
                  key={star.source_id}
                  title={`Known star · Gaia DR3 ${star.source_id}${star.g_mag != null ? ` · G=${star.g_mag.toFixed(1)}` : ""}${
                    star.pm_total_mas_yr != null && star.pm_total_mas_yr > 100
                      ? ` · fast mover (${Math.round(star.pm_total_mas_yr)} mas/yr)`
                      : ""
                  }${star.variable_flag === "VARIABLE" ? " · catalogued variable" : ""}`}
                >
                  <Box
                    sx={{
                      position: "absolute",
                      left: `${star.x_frac * 100}%`,
                      top: `${star.y_frac * 100}%`,
                      width: 14,
                      height: 14,
                      transform: "translate(-50%, -50%)",
                      borderRadius: "50%",
                      border:
                        star.variable_flag === "VARIABLE"
                          ? "1.5px solid rgba(255,120,220,.95)"
                          : "1.5px dashed rgba(255,200,80,.9)",
                      pointerEvents: "auto",
                    }}
                  />
                </Tooltip>
              ))}
            {showGaia && gaia && (
              <Chip
                size="small"
                label={
                  gaia.status === "ok"
                    ? `${gaia.sources.length} known stars · Gaia DR3 (ESA)`
                    : "Gaia catalog unavailable"
                }
                sx={{ position: "absolute", top: 40, left: 10, bgcolor: "rgba(0,0,0,.72)", color: "#ffd890", fontSize: 11 }}
              />
            )}
          </Box>

          {!allLoaded && (
            <Box sx={{ mt: 1.5, maxWidth: 640, mx: "auto" }}>
              <LinearProgress variant="determinate" value={(loadedCount / frames.length) * 100} />
              <Typography variant="caption" color="text.secondary">
                Loading frames… {loadedCount} of {frames.length}
              </Typography>
            </Box>
          )}

          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            justifyContent="center"
            sx={{ mt: 1.5, maxWidth: 640, mx: "auto", flexWrap: "wrap", rowGap: 1 }}
          >
            <Tooltip title="Previous date">
              <IconButton size="small" onClick={() => step(-1)}>
                <SkipPrevious />
              </IconButton>
            </Tooltip>
            <Tooltip title={playing ? "Pause" : "Play through time"}>
              <span style={{ display: "inline-flex", flexShrink: 0 }}>
                <IconButton
                  onClick={() => setPlaying((value) => !value)}
                  disabled={!canPlay}
                  sx={{
                    color: "primary.contrastText",
                    bgcolor: "primary.main",
                    "&:hover": { bgcolor: "primary.dark" },
                    "&.Mui-disabled": { bgcolor: "divider" },
                  }}
                >
                  {playing ? <Pause /> : <PlayArrow />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Next date">
              <IconButton size="small" onClick={() => step(1)}>
                <SkipNext />
              </IconButton>
            </Tooltip>
            <Tooltip title="Blink: flip between only the first and last dates — the classic technique that found Pluto">
              <ToggleButton
                value="blink"
                selected={blink}
                size="small"
                onChange={() => {
                  setBlink((value) => !value);
                  setPlaying(true);
                  setFrame(0);
                }}
                sx={{ px: 1.2, fontSize: 12, gap: 0.5 }}
              >
                <FlashOn sx={{ fontSize: 15 }} /> Blink
              </ToggleButton>
            </Tooltip>
            <Tooltip title={showReticle ? "Hide the target marker" : "Show the target marker"}>
              <ToggleButton
                value="reticle"
                selected={showReticle}
                size="small"
                onChange={() => setShowReticle((value) => !value)}
                sx={{ px: 1 }}
              >
                <CenterFocusStrong sx={{ fontSize: 16 }} />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Ring the known catalogued stars (ESA Gaia DR3) — a changing dot with no ring is not in the star catalog">
              <ToggleButton
                value="gaia"
                selected={showGaia}
                size="small"
                onChange={() => setShowGaia((value) => !value)}
                sx={{ px: 1 }}
              >
                <StarBorder sx={{ fontSize: 16 }} />
              </ToggleButton>
            </Tooltip>
            <Select
              size="small"
              value={speedMs}
              onChange={(event) => setSpeedMs(Number(event.target.value))}
              sx={{ fontSize: 12, flexShrink: 0 }}
            >
              {SPEED_OPTIONS.map((option) => (
                <MenuItem key={option.ms} value={option.ms} sx={{ fontSize: 12 }}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </Stack>

          {/* Frame scrubber always gets its own full-width row so the transport
              controls never overflow horizontally on narrow screens. */}
          <Box sx={{ mt: 1.5, maxWidth: 640, mx: "auto" }}>
            <Slider
              size="small"
              min={0}
              max={Math.max(frames.length - 1, 0)}
              value={frame}
              onChange={(_, value) => {
                setPlaying(false);
                setFrame(value as number);
              }}
            />
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5, maxWidth: 640, mx: "auto" }}>
            {timeline?.caveats.join(" ")}
          </Typography>
        </>
      )}
    </Box>
  );
}
