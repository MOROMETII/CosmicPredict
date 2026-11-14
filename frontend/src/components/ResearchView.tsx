"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { Search, Troubleshoot, ZoomIn, ZoomOutMap, Download } from "@mui/icons-material";
import { nasa } from "@/theme";
import {
  analyzeRegion,
  getSpectrum,
  patchCenter,
  resolveAssetUrl,
  type Analysis,
  type Candidate,
  type Spectrum,
  type Timeline,
  type TimelineFrame,
} from "@/services/api";
import TimelinePlayer from "@/components/TimelinePlayer";
import LightCurvePanel from "@/components/LightCurvePanel";
import SpectrumPlot from "@/components/SpectrumPlot";

const CUTOUT_SIZE = 256;
const DEFAULT_RA = 269.454;
const DEFAULT_DEC = 4.693;

const frameDate = (frame: TimelineFrame | null | undefined) =>
  frame?.epoch
    ? new Date(frame.epoch).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) => row.map((cell) => (cell == null ? "" : `"${String(cell).replace(/"/g, '""')}"`)).join(","))
    .join("\n");
}

function Section({ title, number, lead, children }: { title: string; number: string; lead: string; children: React.ReactNode }) {
  return (
    <Paper sx={{ p: { xs: 2, md: 3 }, height: "100%" }}>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: "2px",
            bgcolor: nasa.blue,
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--font-nasa-mono), 'DM Mono', monospace",
            fontWeight: 500,
            fontSize: 15,
          }}
        >
          {number}
        </Box>
        <Box>
          <Typography variant="h6">{title}</Typography>
          <Typography variant="body2" color="text.secondary">
            {lead}
          </Typography>
        </Box>
      </Stack>
      {children}
    </Paper>
  );
}

/**
 * Research-focused view of one sky position. Unlike the home page's guided
 * flow, this surface is organized around the two questions a researcher asks:
 * (1) did anything move, and (2) did anything change in brightness. It reuses
 * the same backend contracts (timeline, aligned cutouts, significance maps,
 * spectrum) so every number is the same provenance-carrying product.
 */
export default function ResearchView() {
  const [raInput, setRaInput] = useState(String(DEFAULT_RA));
  const [decInput, setDecInput] = useState(String(DEFAULT_DEC));
  const [position, setPosition] = useState({ ra: DEFAULT_RA, dec: DEFAULT_DEC });
  const [fov, setFov] = useState(15);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [epochA, setEpochA] = useState("");
  const [epochB, setEpochB] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [band, setBand] = useState<string | null>(null);
  const [spectrum, setSpectrum] = useState<Spectrum | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  // Patch selection + zoom state for the change-detection surface.
  const [activeCenter, setActiveCenter] = useState<{ ra: number; dec: number; fov: number }>({ ra: DEFAULT_RA, dec: DEFAULT_DEC, fov: 15 });
  const [selStart, setSelStart] = useState<{ x: number; y: number } | null>(null);
  const [selRect, setSelRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [zooming, setZooming] = useState(false);
  const refImageRef = useRef<HTMLDivElement | null>(null);

  const goTo = (ra: number, dec: number) => {
    if (!Number.isFinite(ra) || ra < 0 || ra >= 360 || !Number.isFinite(dec) || dec < -90 || dec > 90) {
      setInputError("Right Ascension must be 0–360 and Declination −90 to +90 (decimal degrees).");
      return;
    }
    setInputError(null);
    setPosition({ ra, dec });
    setRaInput(String(ra));
    setDecInput(String(dec));
    setActiveCenter((center) => ({ ...center, ra, dec, fov }));
    setAnalysis(null);
    setCandidate(null);
    setScanError(null);
    setSelRect(null);
    window.history.replaceState(null, "", `?ra=${ra}&dec=${dec}`);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ra = Number(params.get("ra"));
    const dec = Number(params.get("dec"));
    if (params.has("ra") && params.has("dec") && Number.isFinite(ra) && Number.isFinite(dec)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPosition({ ra, dec });
      setRaInput(String(ra));
      setDecInput(String(dec));
    }
  }, []);

  const onTimeline = (result: Timeline | null) => {
    setTimeline(result);
    setAnalysis(null);
    setCandidate(null);
    setScanError(null);
    const frames = result?.frames ?? [];
    setEpochA(frames[0]?.observation_id ?? "");
    setEpochB(frames[frames.length - 1]?.observation_id ?? "");
    setBand(result?.band ?? null);
  };

  const frames = useMemo(() => timeline?.frames ?? [], [timeline]);
  const frameA = frames.find((item) => item.observation_id === epochA) ?? null;

  const runScan = async (center: { ra: number; dec: number; fov: number }) => {
    if (!epochA || !epochB) return;
    setScanning(true);
    setScanError(null);
    setAnalysis(null);
    setCandidate(null);
    try {
      const result = await analyzeRegion(epochA, epochB, center.ra, center.dec, center.fov, CUTOUT_SIZE);
      setAnalysis(result);
      setCandidate(result.candidates[0] ?? null);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "The comparison failed.");
    } finally {
      setScanning(false);
    }
  };

  const zoomToSelection = async () => {
    if (!selRect) return;
    setZooming(true);
    setScanError(null);
    try {
      const patch = await patchCenter(position.ra, position.dec, fov, selRect.x0, selRect.y0, selRect.x1, selRect.y1, CUTOUT_SIZE);
      const center = { ra: patch.ra, dec: patch.dec, fov: patch.fov_arcmin };
      setActiveCenter(center);
      setSelRect(null);
      await runScan(center);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Could not zoom into the selected patch.");
    } finally {
      setZooming(false);
    }
  };

  const resetZoom = () => {
    setSelRect(null);
    setActiveCenter({ ra: position.ra, dec: position.dec, fov });
    void runScan({ ra: position.ra, dec: position.dec, fov });
  };

  // Fraction-of-image selection on the reference frame.
  const pointerDown = (event: React.PointerEvent) => {
    const node = refImageRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setSelStart({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
    setSelRect(null);
  };
  const pointerMove = (event: React.PointerEvent) => {
    if (!selStart || !refImageRef.current) return;
    const rect = refImageRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    setSelRect({
      x0: Math.min(selStart.x, x),
      y0: Math.min(selStart.y, y),
      x1: Math.max(selStart.x, x),
      y1: Math.max(selStart.y, y),
    });
  };
  const pointerUp = () => setSelStart(null);

  const spectrumKey = `${position.ra}|${position.dec}`;
  const [lastSpectrumKey, setLastSpectrumKey] = useState(spectrumKey);
  if (spectrumKey !== lastSpectrumKey) {
    setLastSpectrumKey(spectrumKey);
    setSpectrum(null);
  }

  useEffect(() => {
    let active = true;
    getSpectrum(position.ra, position.dec)
      .then((result) => active && setSpectrum(result))
      .catch(() => active && setSpectrum(null));
    return () => {
      active = false;
    };
  }, [position]);

  const spectrumBands = useMemo(() => {
    const bands = new Set<string>();
    for (const point of spectrum?.points ?? []) if (point.band) bands.add(point.band);
    return [...bands].sort();
  }, [spectrum]);

  const downloadLightCurve = () => {
    const rows: (string | number | null | undefined)[][] = [
      ["epoch", "observation_id", "band", "wavelength_um", "surface_brightness_MJy_sr"],
      ...(spectrum?.points ?? [])
        .filter((point) => point.surface_brightness > 0)
        .map((point) => [point.epoch, point.observation_id, point.band, point.wavelength, point.surface_brightness]),
    ];
    downloadFile(`lightcurve_ra${position.ra.toFixed(2)}_dec${position.dec.toFixed(2)}.csv`, csv(rows), "text/csv");
  };

  const downloadCandidates = () => {
    const rows: (string | number | null | undefined)[][] = [
      ["candidate_id", "row", "column", "width", "height", "area", "score_sigma", "ra", "dec", "gaia_match", "interpretation"],
      ...(analysis?.candidates ?? []).map((item) => [
        item.candidate_id,
        item.row,
        item.column,
        item.width,
        item.height,
        item.area,
        item.score,
        item.ra,
        item.dec,
        item.gaia_checked ? (item.gaia_match ? "known star" : "not in catalog") : null,
        item.interpretation,
      ]),
    ];
    downloadFile(`candidates_ra${position.ra.toFixed(2)}_dec${position.dec.toFixed(2)}.csv`, csv(rows), "text/csv");
  };

  const downloadTimeline = () => {
    const rows: (string | number | null | undefined)[][] = [
      ["observation_id", "epoch", "band", "wavelength_um", "source", "coverage"],
      ...frames.map((frame) => [frame.observation_id, frame.epoch, frame.band, frame.wavelength, frame.source, frame.coverage]),
    ];
    downloadFile(`timeline_ra${position.ra.toFixed(2)}_dec${position.dec.toFixed(2)}.csv`, csv(rows), "text/csv");
  };

  return (
    <Box>
      <Box sx={{ bgcolor: nasa.blue, color: "#fff", py: 1.5, borderTop: `3px solid ${nasa.red}` }}>
        <Container maxWidth="lg">
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="h6" sx={{ letterSpacing: "0.02em" }}>
                Research view
              </Typography>
              <Typography variant="body2" sx={{ color: "#c7d3ec" }}>
                Motion and variability analysis for a single sky position
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                label={`RA ${position.ra.toFixed(4)}° · Dec ${position.dec.toFixed(4)}°`}
                size="small"
                sx={{ bgcolor: "rgba(255,255,255,.14)", color: "#fff", fontFamily: "var(--font-nasa-mono), 'DM Mono', monospace" }}
              />
              <Button
                size="small"
                variant="contained"
                color="secondary"
                startIcon={<Download />}
                disabled={!spectrum || frames.length === 0}
                onClick={downloadLightCurve}
                sx={{ color: "#fff" }}
              >
                Download data
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 4 } }}>
        {/* Coordinate entry */}
        <Paper sx={{ p: 2, mb: 3 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
            <TextField
              size="small"
              label="Right Ascension (°)"
              value={raInput}
              onChange={(event) => setRaInput(event.target.value)}
              sx={{ minWidth: 160 }}
            />
            <TextField
              size="small"
              label="Declination (°)"
              value={decInput}
              onChange={(event) => setDecInput(event.target.value)}
              sx={{ minWidth: 160 }}
            />
            <Select
              size="small"
              value={fov}
              onChange={(event) => {
                const next = Number(event.target.value);
                setFov(next);
                setActiveCenter((center) => ({ ...center, fov: next }));
                setSelRect(null);
                setAnalysis(null);
              }}
              sx={{ minWidth: 120, fontSize: 13 }}
            >
              {[5, 15, 30, 60].map((option) => (
                <MenuItem key={option} value={option} sx={{ fontSize: 13 }}>
                  {option}&apos; field
                </MenuItem>
              ))}
            </Select>
            <Button variant="contained" startIcon={<Search />} onClick={() => goTo(Number(raInput), Number(decInput))}>
              Load position
            </Button>
          </Stack>
          {inputError && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {inputError}
            </Alert>
          )}

          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5, flexWrap: "wrap" }}>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
              Export:
            </Typography>
            <Button size="small" variant="outlined" disabled={frames.length === 0} onClick={downloadTimeline}>
              Timeline (.csv)
            </Button>
            <Button size="small" variant="outlined" disabled={!spectrum || (spectrum?.points ?? []).length === 0} onClick={downloadLightCurve}>
              Light curve (.csv)
            </Button>
            <Button size="small" variant="outlined" disabled={!analysis || analysis.candidates.length === 0} onClick={downloadCandidates}>
              Candidates (.csv)
            </Button>
          </Stack>
        </Paper>

        <Grid container spacing={3}>
          {/* Section 1 — motion (moving objects) */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Section
              number="1"
              title="Motion"
              lead="Play the epochs in date order, blink the first against the last, and run change detection to flag objects whose position changed."
            >
              <TimelinePlayer ra={position.ra} dec={position.dec} fov={fov} onFovChange={(next) => { setFov(next); setActiveCenter((c) => ({ ...c, fov: next })); setSelRect(null); }} onTimeline={onTimeline} />
            </Section>
          </Grid>

          {/* Section 2 — change detection */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Section
              number="2"
              title="Change detection"
              lead="Noise-normalized difference between two epochs. Drag a box on the reference frame to zoom into a patch. Candidates are unclassified."
            >
              {frames.length < 2 ? (
                <Alert severity="info">At least two observations are needed to compare dates.</Alert>
              ) : (
                <>
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: "wrap", rowGap: 1 }}>
                    <Select size="small" value={epochA} onChange={(event) => setEpochA(event.target.value)} sx={{ minWidth: 170, fontSize: 13 }}>
                      {frames.map((item) => (
                        <MenuItem key={item.observation_id} value={item.observation_id} sx={{ fontSize: 13 }}>
                          A · {frameDate(item)}
                        </MenuItem>
                      ))}
                    </Select>
                    <Typography variant="body2" color="text.secondary">
                      vs.
                    </Typography>
                    <Select size="small" value={epochB} onChange={(event) => setEpochB(event.target.value)} sx={{ minWidth: 170, fontSize: 13 }}>
                      {frames.map((item) => (
                        <MenuItem key={item.observation_id} value={item.observation_id} sx={{ fontSize: 13 }}>
                          B · {frameDate(item)}
                        </MenuItem>
                      ))}
                    </Select>
                    <Button
                      variant="contained"
                      color="secondary"
                      startIcon={scanning ? <CircularProgress size={16} color="inherit" /> : <Troubleshoot />}
                      disabled={scanning || !epochA || !epochB || epochA === epochB}
                      onClick={() => runScan(activeCenter)}
                    >
                      {scanning ? "Comparing…" : "Find changes"}
                    </Button>
                  </Stack>

                  {scanError && (
                    <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setScanError(null)}>
                      {scanError}
                    </Alert>
                  )}

                  {/* Reference frame with drag-to-select patch zoom */}
                  {frameA && (
                    <Box sx={{ mb: 2 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          Drag a box on the reference frame ({frameDate(frameA)}) to zoom the difference into that patch.
                        </Typography>
                        <Stack direction="row" spacing={0.5}>
                          <Button
                            size="small"
                            startIcon={zooming ? <CircularProgress size={12} color="inherit" /> : <ZoomIn />}
                            disabled={!selRect || zooming}
                            onClick={zoomToSelection}
                          >
                            Zoom to selection
                          </Button>
                          <Tooltip title="Reset to the full field">
                            <IconButton size="small" onClick={resetZoom} aria-label="Reset zoom">
                              <ZoomOutMap />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </Stack>
                      <Box
                        ref={refImageRef}
                        onPointerDown={pointerDown}
                        onPointerMove={pointerMove}
                        onPointerUp={pointerUp}
                        onPointerLeave={pointerUp}
                        sx={{
                          position: "relative",
                          border: "1px solid",
                          borderColor: "divider",
                          bgcolor: "#000",
                          cursor: "crosshair",
                          touchAction: "none",
                          userSelect: "none",
                          maxWidth: 460,
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={resolveAssetUrl(frameA.cutout_url) ?? undefined}
                          alt={`Reference frame from ${frameDate(frameA)}`}
                          style={{ width: "100%", display: "block", aspectRatio: "1", pointerEvents: "none" }}
                          draggable={false}
                        />
                        {selRect && (
                          <Box
                            sx={{
                              position: "absolute",
                              left: `${selRect.x0 * 100}%`,
                              top: `${selRect.y0 * 100}%`,
                              width: `${(selRect.x1 - selRect.x0) * 100}%`,
                              height: `${(selRect.y1 - selRect.y0) * 100}%`,
                              border: `2px solid ${nasa.red}`,
                              bgcolor: "rgba(246,65,55,.15)",
                              pointerEvents: "none",
                            }}
                          />
                        )}
                      </Box>
                    </Box>
                  )}

                  {analysis && analysis.difference_image_url && (
                    <Box sx={{ position: "relative", border: "1px solid", borderColor: "divider", bgcolor: "#000" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={resolveAssetUrl(analysis.difference_image_url) ?? undefined}
                        alt="Difference between the two selected observations"
                        style={{ width: "100%", display: "block", aspectRatio: "1" }}
                      />
                      {analysis.candidates.map((item) => {
                        const selected = candidate?.candidate_id === item.candidate_id;
                        return (
                          <Box
                            key={item.candidate_id}
                            onClick={() => setCandidate(item)}
                            sx={{
                              position: "absolute",
                              left: `${(item.column / CUTOUT_SIZE) * 100}%`,
                              top: `${(item.row / CUTOUT_SIZE) * 100}%`,
                              width: `${Math.max((item.width / CUTOUT_SIZE) * 100, 4)}%`,
                              height: `${Math.max((item.height / CUTOUT_SIZE) * 100, 4)}%`,
                              border: selected ? `3px solid ${nasa.red}` : "1.5px solid rgba(255,255,255,.55)",
                              boxShadow: selected ? `0 0 0 2px rgba(246,65,55,.35)` : "none",
                              zIndex: selected ? 2 : 1,
                              cursor: "pointer",
                              borderRadius: "2px",
                            }}
                          />
                        );
                      })}
                    </Box>
                  )}

                  {analysis && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography variant="overline" color="text.secondary">
                        Flagged regions ({analysis.candidates.length})
                      </Typography>
                      {analysis.candidates.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No significant change between these two epochs.
                        </Typography>
                      ) : (
                        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                          {analysis.candidates.slice(0, 8).map((item) => (
                            <Button
                              key={item.candidate_id}
                              onClick={() => setCandidate(item)}
                              variant={candidate?.candidate_id === item.candidate_id ? "contained" : "outlined"}
                              sx={{ justifyContent: "space-between", borderColor: "divider", color: "text.primary" }}
                            >
                              <span>{item.candidate_id}</span>
                              <span style={{ opacity: 0.75 }}>{item.score.toFixed(1)}× noise</span>
                            </Button>
                          ))}
                        </Stack>
                      )}
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
                        {analysis.caveats.join(" ")}
                      </Typography>
                    </Box>
                  )}
                </>
              )}
            </Section>
          </Grid>

          {/* Section 3 — variability (variable stars) */}
          <Grid size={{ xs: 12 }}>
            <Section
              number="3"
              title="Variability"
              lead="Brightness of this position across every observation, one point per date, colored by detector band. Select a band to isolate a single infrared channel."
            >
              <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: "wrap" }}>
                <Button variant={band === null ? "contained" : "outlined"} size="small" onClick={() => setBand(null)}>
                  All bands
                </Button>
                {spectrumBands.map((b) => (
                  <Button key={b} variant={band === b ? "contained" : "outlined"} size="small" onClick={() => setBand(b)}>
                    Detector {b}
                  </Button>
                ))}
              </Stack>
              <LightCurvePanel ra={position.ra} dec={position.dec} selectedBand={band} />
            </Section>
          </Grid>

          {/* Section 4 — spectrum */}
          <Grid size={{ xs: 12 }}>
            <Section
              number="4"
              title="Spectrum"
              lead="Surface brightness vs. wavelength, assembled across SPHEREx detectors. Each detector sees a different slice of 0.75–5 µm, so the points trace the source's spectral energy distribution."
            >
              <SpectrumPlot ra={position.ra} dec={position.dec} />
            </Section>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}
