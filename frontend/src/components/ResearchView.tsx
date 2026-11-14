"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Grid,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Search, Troubleshoot } from "@mui/icons-material";
import { nasa } from "@/theme";
import {
  analyzeRegion,
  getSpectrum,
  resolveAssetUrl,
  type Analysis,
  type Candidate,
  type Spectrum,
  type Timeline,
  type TimelineFrame,
} from "@/services/api";
import TimelinePlayer from "@/components/TimelinePlayer";
import LightCurvePanel from "@/components/LightCurvePanel";

const CUTOUT_SIZE = 256;
const DEFAULT_RA = 269.454;
const DEFAULT_DEC = 4.693;

const frameDate = (frame: TimelineFrame | null | undefined) =>
  frame?.epoch
    ? new Date(frame.epoch).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

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

  const goTo = (ra: number, dec: number) => {
    if (!Number.isFinite(ra) || ra < 0 || ra >= 360 || !Number.isFinite(dec) || dec < -90 || dec > 90) {
      setInputError("Right Ascension must be 0–360 and Declination −90 to +90 (decimal degrees).");
      return;
    }
    setInputError(null);
    setPosition({ ra, dec });
    setRaInput(String(ra));
    setDecInput(String(dec));
    setAnalysis(null);
    setCandidate(null);
    setScanError(null);
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

  const runScan = async () => {
    if (!epochA || !epochB) return;
    setScanning(true);
    setScanError(null);
    setAnalysis(null);
    setCandidate(null);
    try {
      const result = await analyzeRegion(epochA, epochB, position.ra, position.dec, fov, CUTOUT_SIZE);
      setAnalysis(result);
      setCandidate(result.candidates[0] ?? null);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "The comparison failed.");
    } finally {
      setScanning(false);
    }
  };

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
            <Chip
              label={`RA ${position.ra.toFixed(4)}° · Dec ${position.dec.toFixed(4)}°`}
              size="small"
              sx={{ bgcolor: "rgba(255,255,255,.14)", color: "#fff", fontFamily: "var(--font-nasa-mono), 'DM Mono', monospace" }}
            />
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
              onChange={(event) => setFov(Number(event.target.value))}
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
        </Paper>

        <Grid container spacing={3}>
          {/* Section 1 — motion (moving objects) */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Section
              number="1"
              title="Motion"
              lead="Play the epochs in date order, blink the first against the last, and run change detection to flag objects whose position changed."
            >
              <TimelinePlayer ra={position.ra} dec={position.dec} fov={fov} onFovChange={setFov} onTimeline={onTimeline} />
            </Section>
          </Grid>

          {/* Section 2 — change detection */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Section
              number="2"
              title="Change detection"
              lead="Noise-normalized difference between two epochs. Candidates are unclassified — a moving solar-system body, a variable source, or an artifact."
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
                      onClick={runScan}
                    >
                      {scanning ? "Comparing…" : "Find changes"}
                    </Button>
                  </Stack>

                  {scanError && (
                    <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setScanError(null)}>
                      {scanError}
                    </Alert>
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
        </Grid>
      </Container>
    </Box>
  );
}
