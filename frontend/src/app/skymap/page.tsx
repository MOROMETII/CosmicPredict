"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { Add, ArrowBack, Close, MyLocation, Remove } from "@mui/icons-material";
import { getSkyMap, resolveAssetUrl, type SkyMap, type SkyMapItem } from "@/services/api";

// World (sky) dimensions in pixels at zoom = 1. RA spans 0–360 (x), Dec spans
// −90–90 (y); equirectangular projection so the aspect ratio is 2:1.
const MAP_W = 2000;
const MAP_H = 1000;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;

function worldToScreen(ra: number, dec: number, zoom: number): { x: number; y: number } {
  const x = ((ra / 360) * MAP_W) * zoom;
  const y = ((90 - dec) / 180) * MAP_H * zoom;
  return { x, y };
}

/** Wrap-aware RA extent: returns the center and span that best contain the points,
 *  accounting for the 0°/360° seam (e.g. points at 359° and 1° are ~2° apart, not 358°). */
function raExtent(ras: number[]): { center: number; span: number } {
  const sorted = [...ras].sort((a, b) => a - b);
  if (sorted.length === 1) return { center: sorted[0], span: 10 };
  let maxGap = -1;
  let gapIndex = 0;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[(i + 1) % sorted.length];
    const gap = i === sorted.length - 1 ? b + 360 - a : b - a;
    if (gap > maxGap) {
      maxGap = gap;
      gapIndex = i;
    }
  }
  const span = 360 - maxGap;
  const start = sorted[(gapIndex + 1) % sorted.length];
  const center = (start + span / 2) % 360;
  return { center, span };
}

// Deterministic pseudo-random so the starfield is stable across renders.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STARS = (() => {
  const rand = mulberry32(12345);
  const stars: { x: number; y: number; r: number; opacity: number }[] = [];
  for (let i = 0; i < 700; i++) {
    stars.push({
      x: rand() * MAP_W,
      y: rand() * MAP_H,
      r: 0.4 + rand() * 1.3,
      opacity: 0.25 + rand() * 0.7,
    });
  }
  return stars;
})();

/** An all-sky map (Google-Maps style pan/zoom) with a pin per observation. */
export default function SkyMapPage() {
  const [skymap, setSkymap] = useState<SkyMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SkyMapItem | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 800, height: 500 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; active: boolean } | null>(null);

  const selectObservation = (observation: SkyMapItem) => {
    setSelected(observation);
    // Lower the user down to the focused image below the map.
    focusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    let active = true;
    getSkyMap()
      .then((result) => active && setSkymap(result))
      .catch((requestError: Error) => {
        if (!active) return;
        setSkymap({ status: "error", observations: [], caveats: [] });
        setError(requestError.message);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const update = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Center the map so all pins are in view on first load.
  const observations = useMemo(() => skymap?.observations ?? [], [skymap]);
  useEffect(() => {
    if (observations.length === 0 || !viewportRef.current) return;
    const node = viewportRef.current;
    const ras = observations.map((o) => o.ra);
    const decs = observations.map((o) => o.dec);
    const { center: raMid, span: raSpan } = raExtent(ras);
    const decMin = Math.min(...decs);
    const decMax = Math.max(...decs);
    const decMid = (decMin + decMax) / 2;
    const decSpan = Math.max(decMax - decMin, 10);
    const pad = 0.85;
    const fitZoom = Math.max(
      MIN_ZOOM,
      Math.min(
        MAX_ZOOM,
        Math.min(
          (node.clientWidth * pad) / ((raSpan / 360) * MAP_W),
          (node.clientHeight * pad) / ((decSpan / 180) * MAP_H),
        ),
      ),
    );
    const center = worldToScreen(raMid, decMid, fitZoom);
    setZoom(fitZoom);
    setPan({ x: node.clientWidth / 2 - center.x, y: node.clientHeight / 2 - center.y });
  }, [observations]);

  // Screen (pixel) → sky (RA/Dec) inverse of the projection, for the readout.
  const screenToSky = useCallback(
    (x: number, y: number) => {
      const worldX = (x - pan.x) / zoom;
      const worldY = (y - pan.y) / zoom;
      const ra = ((worldX / MAP_W) * 360) % 360;
      const dec = 90 - (worldY / MAP_H) * 180;
      return { ra: (ra + 360) % 360, dec: Math.max(-90, Math.min(90, dec)) };
    },
    [zoom, pan],
  );

  const [hover, setHover] = useState<{ ra: number; dec: number; x: number; y: number } | null>(null);
  const hoverRaf = useRef<number | null>(null);

  // Starfield + grid are static in world coordinates; they're memoized once and
  // moved via a CSS transform on the parent <svg>, so pan/zoom never recomputes
  // their 700+ elements. Rendered as a tile (no <defs>) so it can repeat across
  // the RA 0°/360° seam and the sky stays continuous when panning.
  const worldLayers = useMemo(() => {
    return (
      <>
        <rect x={0} y={(90 - -20) / 180 * MAP_H} width={MAP_W} height={MAP_H * 0.45} fill="url(#milkyway)" />
        {STARS.map((star, i) => (
          <circle key={i} cx={star.x} cy={star.y} r={star.r} fill="#fff" opacity={star.opacity} />
        ))}
        {Array.from({ length: 13 }, (_, i) => i * 30).map((ra) => {
          const x = (ra / 360) * MAP_W;
          return <line key={`ra${ra}`} x1={x} y1={0} x2={x} y2={MAP_H} stroke="rgba(255,255,255,.06)" strokeWidth={1} />;
        })}
        {Array.from({ length: 7 }, (_, i) => i * 30 - 90).map((dec) => {
          const y = ((90 - dec) / 180) * MAP_H;
          return <line key={`dec${dec}`} x1={0} y1={y} x2={MAP_W} y2={y} stroke="rgba(255,255,255,.06)" strokeWidth={1} />;
        })}
      </>
    );
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y, active: false };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    if (!dragRef.current.active) {
      if (Math.hypot(dx, dy) < 4) return;
      dragRef.current.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  const onMouseMove = (event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (hoverRaf.current != null) return;
    hoverRaf.current = requestAnimationFrame(() => {
      hoverRaf.current = null;
      setHover({ ...screenToSky(x, y), x, y });
    });
  };
  const onMouseLeave = () => {
    if (hoverRaf.current != null) cancelAnimationFrame(hoverRaf.current);
    hoverRaf.current = null;
    setHover(null);
  };
  const onWheel = (event: React.WheelEvent) => {
    const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    const worldX = (cx - pan.x) / zoom;
    const worldY = (cy - pan.y) / zoom;
    setZoom(next);
    setPan({ x: cx - worldX * next, y: cy - worldY * next });
  };

  const recenter = () => {
    if (observations.length === 0) return;
    const ras = observations.map((o) => o.ra);
    const decs = observations.map((o) => o.dec);
    const { center: raMid } = raExtent(ras);
    const decMid = (Math.min(...decs) + Math.max(...decs)) / 2;
    const center = worldToScreen(raMid, decMid, zoom);
    setPan({ x: viewport.width / 2 - center.x, y: viewport.height / 2 - center.y });
  };

  // Horizontal wrap: a pin at RA r can appear at r + k·360°. Precompute a flat
  // list of on-screen pin copies so pins stay visible across the 0°/360° seam.
  const pinItems = useMemo(() => {
    const period = MAP_W * zoom;
    const items: { obs: SkyMapItem; x: number; y: number; key: string }[] = [];
    for (const obs of observations) {
      const y = worldToScreen(obs.ra, obs.dec, zoom).y + pan.y;
      if (y < -20 || y > viewport.height + 20) continue;
      let base = (((obs.ra / 360) * MAP_W) * zoom + pan.x) % period;
      if (base < 0) base += period;
      for (let x = base - period; x <= viewport.width + period; x += period) {
        if (x > -20 && x < viewport.width + 20) {
          items.push({ obs, x, y, key: `${obs.observation_id}-${Math.round(x)}` });
        }
      }
    }
    return items;
  }, [observations, zoom, pan, viewport.width, viewport.height]);

  return (
    <Box sx={{ minHeight: "100dvh" }}>
      <Box sx={{ bgcolor: "#0b3d91", color: "#fff", py: 1.5, borderTop: "3px solid #f64137" }}>
        <Container maxWidth="lg">
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={1} alignItems="center">
              <IconButton component={Link} href="/" sx={{ color: "#fff" }} aria-label="Back to explorer">
                <ArrowBack />
              </IconButton>
              <Typography variant="h6" sx={{ letterSpacing: "0.02em" }}>
                Sky map
              </Typography>
            </Stack>
            <Chip
              label={`${observations.length} observations`}
              size="small"
              sx={{ bgcolor: "rgba(255,255,255,.14)", color: "#fff" }}
            />
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 2 }}>
        {error && (
          <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Paper sx={{ p: 1 }}>
          {skymap === null ? (
            <Stack alignItems="center" sx={{ py: 6 }}>
              <CircularProgress size={24} />
            </Stack>
          ) : (
            <Box
              ref={viewportRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
              onMouseMove={onMouseMove}
              onMouseLeave={onMouseLeave}
              sx={{
                position: "relative",
                height: "min(70vh, 640px)",
                overflow: "hidden",
                borderRadius: 1,
                bgcolor: "#050810",
                cursor: "grab",
                touchAction: "none",
                userSelect: "none",
              }}
            >
              {/* World-space starfield + grid, moved via CSS transform (no per-star recompute).
                  Tiled 3× horizontally so panning wraps seamlessly across the RA seam. The
                  trailing translate(-MAP_W) keeps the middle tile aligned with the pins. */}
              <svg
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  pointerEvents: "none",
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) translate(${-MAP_W}px, 0px)`,
                  transformOrigin: "0 0",
                }}
                width={MAP_W * 3}
                height={MAP_H}
                viewBox={`0 0 ${MAP_W * 3} ${MAP_H}`}
              >
                <defs>
                  <linearGradient id="milkyway" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(120,140,190,0)" />
                    <stop offset="50%" stopColor="rgba(150,170,220,.10)" />
                    <stop offset="100%" stopColor="rgba(120,140,190,0)" />
                  </linearGradient>
                </defs>
                <g transform={`translate(0 0)`}>{worldLayers}</g>
                <g transform={`translate(${MAP_W} 0)`}>{worldLayers}</g>
                <g transform={`translate(${MAP_W * 2} 0)`}>{worldLayers}</g>
              </svg>

              {/* Pins */}
              {pinItems.map(({ obs: o, x, y, key }) => {
                const isSelected = selected?.observation_id === o.observation_id;
                return (
                  <Button
                    key={key}
                    aria-label={`View observation at RA ${o.ra.toFixed(2)}, Dec ${o.dec.toFixed(2)}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerUp={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectObservation(o);
                    }}
                    sx={{
                      position: "absolute",
                      left: x,
                      top: y,
                      minWidth: 0,
                      width: 20,
                      height: 20,
                      padding: 0,
                      transform: "translate(-50%, -50%)",
                      borderRadius: "50% 50% 50% 0",
                      rotate: "-45deg",
                      bgcolor: isSelected ? "#ffb74d" : "#f64137",
                      border: "2px solid #fff",
                      boxShadow: "0 1px 4px rgba(0,0,0,.7)",
                      zIndex: 2,
                      "&:hover": { bgcolor: "#ffb74d" },
                    }}
                  />
                );
              })}

              {/* Cursor sky-coordinate readout (RA/Dec follows the mouse) */}
              {hover && (
                <Chip
                  size="small"
                  label={`RA ${hover.ra.toFixed(2)}° · Dec ${hover.dec.toFixed(2)}°`}
                  sx={{
                    position: "absolute",
                    left: Math.min(hover.x + 14, viewport.width - 180),
                    top: Math.max(hover.y - 28, 8),
                    bgcolor: "rgba(0,0,0,.78)",
                    color: "#e6edf5",
                    fontSize: 11,
                    fontFamily: "var(--font-nasa-mono), 'DM Mono', monospace",
                    pointerEvents: "none",
                    border: "1px solid rgba(255,255,255,.2)",
                    zIndex: 3,
                  }}
                />
              )}

              {/* Compass — N/S/E/W orientation for the sky (RA/Dec) grid */}
              <Box
                sx={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  width: 56,
                  height: 56,
                  pointerEvents: "none",
                  zIndex: 3,
                  color: "rgba(255,255,255,.85)",
                  filter: "drop-shadow(0 1px 3px rgba(0,0,0,.8))",
                }}
              >
                <svg viewBox="0 0 56 56" width="56" height="56">
                  <circle cx="28" cy="28" r="26" fill="rgba(0,0,0,.45)" stroke="rgba(255,255,255,.4)" />
                  <text x="28" y="13" textAnchor="middle" fontSize="10" fill="#fff" fontWeight="700">N</text>
                  <text x="28" y="50" textAnchor="middle" fontSize="10" fill="#fff" fontWeight="700">S</text>
                  <text x="50" y="31" textAnchor="middle" fontSize="10" fill="#fff" fontWeight="700">E</text>
                  <text x="6" y="31" textAnchor="middle" fontSize="10" fill="#fff" fontWeight="700">W</text>
                  <polygon points="28,17 32,28 28,26 24,28" fill="#ffb74d" />
                </svg>
              </Box>
            </Box>
          )}

          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <Tooltip title="Zoom in">
              <IconButton onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.4))}>
                <Add />
              </IconButton>
            </Tooltip>
            <Tooltip title="Zoom out">
              <IconButton onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.4))}>
                <Remove />
              </IconButton>
            </Tooltip>
            <Tooltip title="Fit all pins">
              <IconButton onClick={recenter}>
                <MyLocation />
              </IconButton>
            </Tooltip>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              Drag to pan · scroll or +/− to zoom · click a pin to view the observation
            </Typography>
          </Stack>
        </Paper>

        {skymap && skymap.caveats.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            {skymap.caveats.join(" ")}
          </Typography>
        )}
      </Container>

      {/* Focused observation view — scrolls into place when a pin is clicked. */}
      {selected && (
        <Paper ref={focusRef} sx={{ p: { xs: 2, md: 3 }, mt: 2, scrollMarginTop: 16 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6" sx={{ fontSize: 16 }}>
                RA {selected.ra.toFixed(4)}° · Dec {selected.dec.toFixed(4)}°
              </Typography>
              <Chip
                size="small"
                label={selected.band ? `detector ${selected.band}` : "band unknown"}
                sx={{ fontSize: 11 }}
              />
            </Stack>
            <IconButton onClick={() => setSelected(null)} aria-label="Close" size="small">
              <Close />
            </IconButton>
          </Stack>
          <Box
            sx={{
              maxWidth: 640,
              mx: "auto",
              bgcolor: "#000",
              borderRadius: 1,
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resolveAssetUrl(selected.preview_url) ?? undefined}
              alt={`SPHEREx observation at RA ${selected.ra}, Dec ${selected.dec}`}
              style={{ width: "100%", display: "block", aspectRatio: "1" }}
            />
          </Box>
          <Stack direction="row" spacing={2} alignItems="center" justifyContent="center" sx={{ mt: 1.5 }}>
            {selected.epoch && (
              <Typography variant="caption" color="text.secondary">
                Observed {new Date(selected.epoch).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              </Typography>
            )}
            {selected.wavelength != null && (
              <Typography variant="caption" color="text.secondary">
                Wavelength {selected.wavelength.toFixed(2)} µm
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              Source: {selected.source === "live" ? "live IRSA archive" : "cached"}
            </Typography>
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
