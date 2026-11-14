"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import NextLink from "next/link";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Grid,
  IconButton,
  Link,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import {
  AutoAwesome,
  Bookmarks,
  DarkMode,
  ExpandLess,
  ExpandMore,
  LightMode,
  Search,
  Slideshow,
  TravelExplore,
  Troubleshoot,
} from "@mui/icons-material";
import { nasa } from "@/theme";
import {
  analyzeRegion,
  exploreRegion,
  getHealth,
  resolveAssetUrl,
  type Analysis,
  type Candidate,
  type Observation,
  type Timeline,
  type TimelineFrame,
} from "@/services/api";
import TimelinePlayer from "@/components/TimelinePlayer";
import DiscoveryPanel from "@/components/DiscoveryPanel";
import LightCurvePanel from "@/components/LightCurvePanel";
import SpaceProjection from "@/components/SpaceProjection";
import { featuredTargets } from "@/data/featuredTargets";

const DEFAULT_RA = 269.454; // Barnard's Star — the classic moving target
const DEFAULT_DEC = 4.693;
const CUTOUT_SIZE = 256;

const frameDate = (frame: TimelineFrame | null | undefined) =>
  frame?.epoch
    ? new Date(frame.epoch).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "unknown date";

const toObservation = (frame: TimelineFrame): Observation => ({
  observation_id: frame.observation_id,
  epoch: frame.epoch,
  band: frame.band,
  wavelength: frame.wavelength,
  ra: null,
  dec: null,
  source: frame.source,
  provenance: {},
  // Use the north-up aligned cutout (same sky grid for both epochs), not the
  // full-detector preview, so the two frames actually overlay for the 3-D view.
  image_url: frame.cutout_url,
  asset_status: "preview_available",
});

/** The app's own mark — an orbit sweep. (Not an agency logo.) */
function AppMark() {
  return (
    <Box
      component="svg"
      viewBox="0 0 40 40"
      sx={{ width: 34, height: 34, flexShrink: 0, "& .mark-blue": { stroke: "primary.main", fill: "primary.main" } }}
      aria-hidden
    >
      <circle className="mark-blue" cx="20" cy="20" r="18" fill="none" strokeWidth="2.4" />
      <ellipse cx="20" cy="20" rx="17" ry="6.5" fill="none" stroke={nasa.red} strokeWidth="2.4" transform="rotate(-18 20 20)" />
      <circle className="mark-blue" cx="20" cy="20" r="4.5" />
      <circle cx="33.5" cy="13.5" r="2.6" fill={nasa.red} />
    </Box>
  );
}

const emptySubscribe = () => () => {};

function ModeToggle() {
  const { mode, setMode } = useColorScheme();
  // true on the client, false during server render — no setState needed.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  if (!mounted) return <Box sx={{ width: 40 }} />;
  const dark = mode === "dark";
  return (
    <Tooltip title={dark ? "Switch to light mode" : "Switch to dark mode"}>
      <IconButton onClick={() => setMode(dark ? "light" : "dark")} sx={{ color: "text.secondary" }}>
        {dark ? <LightMode /> : <DarkMode />}
      </IconButton>
    </Tooltip>
  );
}

function StepHeading({ step, title, lead }: { step: string; title: string; lead: string }) {
  return (
    <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
      <Box
        sx={{
          width: 36,
          height: 36,
          flexShrink: 0,
          borderRadius: "50%",
          bgcolor: "primary.main",
          color: "primary.contrastText",
          display: "grid",
          placeItems: "center",
          fontWeight: 800,
        }}
      >
        {step}
      </Box>
      <Box>
        <Typography variant="h6">{title}</Typography>
        <Typography variant="body2" color="text.secondary">
          {lead}
        </Typography>
      </Box>
    </Stack>
  );
}

export default function Home() {
  const [position, setPosition] = useState({ ra: DEFAULT_RA, dec: DEFAULT_DEC });
  const [raInput, setRaInput] = useState(String(DEFAULT_RA));
  const [decInput, setDecInput] = useState(String(DEFAULT_DEC));
  const [fov, setFov] = useState(15);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [epochA, setEpochA] = useState<string>("");
  const [epochB, setEpochB] = useState<string>("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [aiScanning, setAiScanning] = useState(false);
  const [aiMode, setAiMode] = useState<"scientific" | "opencv">("scientific");
  const [inputError, setInputError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [show3d, setShow3d] = useState(false);
  const [showSpectrum, setShowSpectrum] = useState(false);
  const [morph, setMorph] = useState(50);

  useEffect(() => {
    // Query-by-URL (?ra=..&dec=..) so views can be shared and embedded.
    const params = new URLSearchParams(window.location.search);
    const ra = Number(params.get("ra"));
    const dec = Number(params.get("dec"));
    if (params.has("ra") && params.has("dec") && Number.isFinite(ra) && Number.isFinite(dec)) {
      // One-time sync from the URL after hydration; reading window.location
      // during render would mismatch the server-rendered HTML.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPosition({ ra, dec });
      setRaInput(String(ra));
      setDecInput(String(dec));
    }
    getHealth()
      .then((health) => setProvider(health.provider))
      .catch(() => setProvider(null));
  }, []);

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
    setShowSpectrum(false);
    window.history.replaceState(null, "", `?ra=${ra}&dec=${dec}`);
    document.getElementById("player-section")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const onTimeline = (result: Timeline | null) => {
    setTimeline(result);
    setAnalysis(null);
    setCandidate(null);
    setScanError(null);
    const frames = result?.frames ?? [];
    setEpochA(frames[0]?.observation_id ?? "");
    setEpochB(frames[frames.length - 1]?.observation_id ?? "");
  };

  const frames = useMemo(() => timeline?.frames ?? [], [timeline]);
  const frameA = frames.find((item) => item.observation_id === epochA) ?? null;
  const frameB = frames.find((item) => item.observation_id === epochB) ?? null;
  const pixelScale = (fov * 60) / CUTOUT_SIZE;

  const runScan = async () => {
    if (!epochA || !epochB) return;
    setScanning(true);
    setScanError(null);
    setAnalysis(null);
    setCandidate(null);
    setAiMode("scientific");
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

  const runAiScan = async () => {
    if (!epochA || !epochB) return;
    setAiScanning(true);
    setScanError(null);
    setAnalysis(null);
    setCandidate(null);
    setAiMode("opencv");
    try {
      const result = await exploreRegion(epochA, epochB, position.ra, position.dec, fov, CUTOUT_SIZE);
      setAnalysis(result);
      setCandidate(result.candidates[0] ?? null);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "The AI scan failed.");
    } finally {
      setAiScanning(false);
    }
  };

  return (
    <Box>
      {/* Honesty banner — this is an independent entry built on public data. */}
      <Box sx={{ bgcolor: nasa.blue, color: "#dbe4f5", py: 0.75, fontSize: 13, textAlign: "center", px: 2 }}>
        Built for the NASA Space Apps Challenge 2026 using public SPHEREx data from NASA/IPAC IRSA ·
        an independent entry, not an official NASA product
      </Box>

      {/* Header — white bar with the NASA red accent line */}
      <Box
        sx={(theme) => ({
          bgcolor: theme.vars ? theme.vars.palette.background.paper : "background.paper",
          color: "text.primary",
          py: 1.5,
          borderTop: `3px solid ${nasa.red}`,
          borderBottom: "1px solid",
          borderColor: "divider",
        })}
      >
        <Container maxWidth="lg">
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={1.5} alignItems="center">
              <AppMark />
              <Box>
                <Typography variant="h5" sx={{ letterSpacing: "0.02em", lineHeight: 1.1, color: "text.primary" }}>
                  COSMIC PREDICT
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  SPHEREx Time-Domain Explorer
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Tooltip title="Sky Scroll — swipe through real sky timelapses and flag anything suspicious">
                <IconButton
                  component={NextLink}
                  href="/scroll"
                  sx={{ color: "text.secondary", display: { xs: "inline-flex", sm: "none" } }}
                  aria-label="Sky Scroll"
                >
                  <Slideshow />
                </IconButton>
              </Tooltip>
              <Tooltip title="Sky Scroll — swipe through real sky timelapses and flag anything suspicious">
                <Button
                  component={NextLink}
                  href="/scroll"
                  startIcon={<Slideshow />}
                  sx={{ color: "text.primary", display: { xs: "none", sm: "inline-flex" } }}
                >
                  Sky Scroll
                </Button>
              </Tooltip>
              <Tooltip title="Discover — explore real observations pinned across the sky">
                <Button
                  component={NextLink}
                  href="/discover"
                  sx={{ color: "text.primary", display: { xs: "none", md: "inline-flex" } }}
                >
                  Discover
                </Button>
              </Tooltip>
              <Tooltip title="Research view — motion and variability analysis">
                <Button
                  component={NextLink}
                  href="/detailed"
                  sx={{ color: "text.primary", display: { xs: "none", md: "inline-flex" } }}
                >
                  Research
                </Button>
              </Tooltip>
              <Tooltip title="My flags — everything you marked for review">
                <IconButton component={NextLink} href="/flags" sx={{ color: "primary.main" }} aria-label="My flags">
                  <Bookmarks />
                </IconButton>
              </Tooltip>
              <Chip
                label={provider ? `Data: ${provider === "supabase" ? "team archive" : "local cache"}` : "Backend offline"}
                size="small"
                sx={{ bgcolor: provider ? "action.selected" : nasa.red, color: provider ? "text.primary" : "#fff", display: { xs: "none", sm: "inline-flex" } }}
              />
              <ModeToggle />
            </Stack>
          </Stack>
        </Container>
      </Box>

      {/* Public-facing explainer */}
      <Box
        sx={(theme) => ({
          bgcolor: nasa.bgAlt,
          borderBottom: "1px solid",
          borderColor: "divider",
          ...theme.applyStyles("dark", { bgcolor: "#17181b" }),
        })}
      >
        <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
          <Grid container spacing={4} alignItems="center">
            <Grid size={{ xs: 12 }}>
              <Typography
                variant="overline"
                sx={{ color: nasa.red, letterSpacing: "0.12em", fontWeight: 700, lineHeight: 1, display: "block", mb: 1 }}
              >
                SPHEREx Time-Domain Explorer
              </Typography>
              <Typography variant="h3" sx={{ fontSize: { xs: 28, md: 38 }, mb: 1.5 }}>
                The sky is not still.
              </Typography>
              <Typography variant="body1" sx={{ color: "text.secondary", maxWidth: 720 }}>
                Compare real SPHEREx observations of any spot on the sky across dates, blink between
                them, and run a change detector to flag things that moved or changed in brightness —
                whatever it flags is a candidate for review, not a confirmed discovery.
              </Typography>
            </Grid>
          </Grid>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
        {/* Steps 1 + 2 side by side on desktop, stacked on mobile */}
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, md: 5 }}>
            <Paper sx={{ p: { xs: 2, md: 3 }, height: "100%" }}>
              <StepHeading
                step="1"
                title="Choose where to look"
                lead="Enter sky coordinates (like latitude and longitude, but for the sky), or pick a featured target."
              />
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1.5}>
                  <TextField
                    size="small"
                    label="Right Ascension (°)"
                    value={raInput}
                    onChange={(event) => setRaInput(event.target.value)}
                    fullWidth
                  />
                  <TextField
                    size="small"
                    label="Declination (°)"
                    value={decInput}
                    onChange={(event) => setDecInput(event.target.value)}
                    fullWidth
                  />
                </Stack>
                <Button
                  variant="contained"
                  startIcon={<Search />}
                  onClick={() => goTo(Number(raInput), Number(decInput))}
                >
                  View this position
                </Button>
                {inputError && <Alert severity="error">{inputError}</Alert>}
              </Stack>
              <Divider sx={{ my: 2.5 }} />
              <Typography variant="overline" color="text.secondary">
                Featured targets (the challenge&apos;s official test objects)
              </Typography>
              <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
                {featuredTargets.map((target) => (
                  <Grid key={target.name} size={{ xs: 12, sm: 6, md: 12 }}>
                    <Paper
                      sx={{
                        p: 1.5,
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        borderLeft: "3px solid",
                        borderLeftColor: "primary.main",
                      }}
                    >
                      <Typography sx={{ fontWeight: 700 }}>{target.name}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, flex: 1 }}>
                        {target.type}. {target.note}
                      </Typography>
                      {target.ra !== null && target.dec !== null ? (
                        <Button
                          size="small"
                          startIcon={<TravelExplore />}
                          onClick={() => goTo(target.ra as number, target.dec as number)}
                          sx={{ alignSelf: "flex-start" }}
                        >
                          View this target
                        </Button>
                      ) : (
                        <Chip size="small" label="Coordinates pending verification" sx={{ alignSelf: "flex-start" }} />
                      )}
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, md: 7 }}>
            <Paper id="player-section" sx={{ p: { xs: 2, md: 3 }, height: "100%", scrollMarginTop: 16 }}>
              <StepHeading
                step="2"
                title="Play the sky through time"
                lead={`Every available SPHEREx observation of RA ${position.ra}°, Dec ${position.dec}°, in date order.`}
              />
              <TimelinePlayer ra={position.ra} dec={position.dec} fov={fov} onFovChange={setFov} onTimeline={onTimeline} />
            </Paper>
          </Grid>
        </Grid>

        {/* Step 3 — compare */}
        <Paper sx={{ p: { xs: 2, md: 3 }, mb: 3 }}>
          <StepHeading
            step="3"
            title="Compare two dates"
            lead="Pick two observations and the tool subtracts them, accounting for measurement noise. Regions that changed significantly get flagged for your review."
          />
          {frames.length < 2 ? (
            <Alert severity="info">
              This position needs at least two observations from the same detector before dates can be
              compared. {frames.length === 1 ? "Only one is available so far." : ""}
            </Alert>
          ) : (
            <>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
                <Select size="small" value={epochA} onChange={(event) => setEpochA(event.target.value)} sx={{ minWidth: 180 }}>
                  {frames.map((item) => (
                    <MenuItem key={item.observation_id} value={item.observation_id} sx={{ fontSize: 13 }}>
                      A — {frameDate(item)}
                    </MenuItem>
                  ))}
                </Select>
                <Typography variant="body2" color="text.secondary">
                  versus
                </Typography>
                <Select size="small" value={epochB} onChange={(event) => setEpochB(event.target.value)} sx={{ minWidth: 180 }}>
                  {frames.map((item) => (
                    <MenuItem key={item.observation_id} value={item.observation_id} sx={{ fontSize: 13 }}>
                      B — {frameDate(item)}
                    </MenuItem>
                  ))}
                </Select>
                <Button
                  variant="contained"
                  color="secondary"
                  startIcon={scanning ? <CircularProgress size={16} color="inherit" /> : <Troubleshoot />}
                  disabled={scanning || aiScanning || !epochA || !epochB || epochA === epochB}
                  onClick={runScan}
                >
                  {scanning ? "Comparing…" : "Find changes"}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={aiScanning ? <CircularProgress size={16} color="inherit" /> : <AutoAwesome />}
                  disabled={scanning || aiScanning || !epochA || !epochB || epochA === epochB}
                  onClick={runAiScan}
                >
                  {aiScanning ? "Scanning…" : "AI scan"}
                </Button>
              </Stack>
              {epochA === epochB && (
                <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>
                  Choose two different dates.
                </Typography>
              )}
              {scanError && (
                <Alert severity="warning" sx={{ mt: 2 }} onClose={() => setScanError(null)}>
                  {scanError}
                </Alert>
              )}

              {analysis && (
                <Box sx={{ mt: 3 }}>
                  <Alert
                    severity={aiMode === "opencv" ? "info" : "success"}
                    sx={{ mb: 2 }}
                  >
                    {aiMode === "opencv"
                      ? "AI scan: OpenCV visual-aid candidates on the rendered difference — unclassified, not the significance baseline."
                      : "Statistical comparison: noise-normalized significance candidates (5σ threshold)."}
                  </Alert>
                  <Grid container spacing={2}>
                    {[
                      { label: `A · ${frameDate(frameA)}`, url: frameA?.cutout_url ?? null },
                      { label: `B · ${frameDate(frameB)}`, url: frameB?.cutout_url ?? null },
                    ].map((item) => (
                      <Grid key={item.label} size={{ xs: 12, sm: 4 }}>
                        <Typography variant="caption" sx={{ fontWeight: 700 }}>
                          {item.label}
                        </Typography>
                        <Box sx={{ border: "1px solid", borderColor: "divider", bgcolor: "#000" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={resolveAssetUrl(item.url) ?? undefined}
                            alt={item.label}
                            style={{ width: "100%", display: "block", aspectRatio: "1" }}
                          />
                        </Box>
                      </Grid>
                    ))}
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700 }}>
                        Difference — red: brighter in A · blue: brighter in B
                      </Typography>
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
                                transition: "box-shadow .15s, border .15s",
                              }}
                            />
                          );
                        })}
                      </Box>
                      {candidate && (
                        <Typography variant="caption" sx={{ color: nasa.red, fontWeight: 700 }}>
                          ◉ {candidate.candidate_id} highlighted
                        </Typography>
                      )}
                    </Grid>
                  </Grid>

                  <Grid container spacing={2} sx={{ mt: 0.5 }}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="overline" color="text.secondary">
                        Flagged regions ({analysis.candidates.length})
                      </Typography>
                      {analysis.candidates.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No significant changes between these two dates — the brightness was stable
                          within the noise level.
                        </Typography>
                      ) : (
                        <Stack spacing={0.5}>
                          {analysis.candidates.slice(0, 8).map((item) => {
                            const selected = candidate?.candidate_id === item.candidate_id;
                            return (
                              <Button
                                key={item.candidate_id}
                                onClick={() => setCandidate(item)}
                                variant={selected ? "contained" : "outlined"}
                                sx={{
                                  justifyContent: "space-between",
                                  borderColor: "divider",
                                  ...(selected ? {} : { color: "text.primary" }),
                                }}
                              >
                                <span>
                                  {item.candidate_id}
                                  {item.gaia_checked && (
                                    <span style={{ opacity: 0.8, fontSize: 11, marginLeft: 8 }}>
                                      {item.gaia_match ? "★ known star" : "◇ not in star catalog"}
                                    </span>
                                  )}
                                </span>
                                <span style={{ opacity: 0.75 }}>{item.score.toFixed(1)}× noise</span>
                              </Button>
                            );
                          })}
                        </Stack>
                      )}
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Paper
                        sx={(theme) => ({
                          p: 1.5,
                          bgcolor: nasa.bgAlt,
                          ...theme.applyStyles("dark", { bgcolor: "#202126" }),
                        })}
                      >
                        <DiscoveryPanel candidate={candidate} pixelScaleArcsec={pixelScale} />
                      </Paper>
                    </Grid>
                  </Grid>

                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
                    {analysis.caveats.join(" ")}
                  </Typography>
                </Box>
              )}
            </>
          )}
        </Paper>

        {/* Light curve — brightness vs. time (also carries wavelength info by color) */}
        <Paper sx={{ p: { xs: 2, md: 3 }, mb: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="h6">Brightness over time — at the crosshair</Typography>
              <Typography variant="body2" color="text.secondary">
                Measures only the small circled spot at the center of the player (your entered RA/Dec,
                a ~1-arcminute box — not the whole image). One dot per observation date. A steady star
                traces a flat line; a variable star rises and falls. Dot color = infrared wavelength.
              </Typography>
            </Box>
            <Button endIcon={showSpectrum ? <ExpandLess /> : <ExpandMore />} onClick={() => setShowSpectrum((value) => !value)}>
              {showSpectrum ? "Hide" : "Show"}
            </Button>
          </Stack>
          {showSpectrum && (
            <Box sx={{ mt: 2 }}>
              <LightCurvePanel ra={position.ra} dec={position.dec} />
            </Box>
          )}
        </Paper>

        {/* Optional 3-D view */}
        <Paper sx={{ p: { xs: 2, md: 3 }, mb: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="h6">Experimental: 3-D star field</Typography>
              <Typography variant="body2" color="text.secondary">
                Real sources detected in the aligned SPHEREx cutouts, placed at their true sky
                positions and colored by the image&apos;s infrared-wavelength tint. Depth is a visual aid
                (brightness → parallax), not a physical distance. WASD to move, drag to look.
              </Typography>
            </Box>
            <Button endIcon={show3d ? <ExpandLess /> : <ExpandMore />} onClick={() => setShow3d((value) => !value)}>
              {show3d ? "Hide" : "Show"}
            </Button>
          </Stack>
          {show3d && frameA && frameB && (
            <Box sx={{ mt: 2 }}>
              <SpaceProjection
                first={toObservation(frameA)}
                second={toObservation(frameB)}
                amount={morph / 100}
                candidates={[]}
              />
              <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1 }}>
                <Typography variant="caption" sx={{ minWidth: 110 }} color="text.secondary">
                  Crossfade A to B
                </Typography>
                <Slider size="small" value={morph} onChange={(_, value) => setMorph(value as number)} sx={{ maxWidth: 320 }} />
              </Stack>
            </Box>
          )}
          {show3d && (!frameA || !frameB) && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Load a position with at least two observations first.
            </Alert>
          )}
        </Paper>
      </Container>

      {/* Footer — near-black chrome */}
      <Box sx={{ bgcolor: nasa.blue, color: "#c7d3ec", py: 4, mt: 2 }}>
        <Container maxWidth="lg">
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography sx={{ color: "#ffffff", fontWeight: 700, mb: 1 }}>Data & provenance</Typography>
              <Typography variant="body2">
                All images are Level-2 calibrated SPHEREx observations retrieved from the NASA/IPAC
                Infrared Science Archive (IRSA). Every displayed frame keeps a link to its archive
                source. Difference images and flagged regions are derived products; synthetic blends
                are labeled and never analyzed.
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography sx={{ color: "#ffffff", fontWeight: 700, mb: 1 }}>Glossary</Typography>
              <Typography variant="body2">
                <strong>Epoch</strong> — the date of one observation · <strong>Detector band</strong> —
                one of six infrared cameras · <strong>Candidate</strong> — an unconfirmed region where
                brightness changed · <strong>Blink</strong> — flipping between two dates to spot motion
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography sx={{ color: "#ffffff", fontWeight: 700, mb: 1 }}>NASA & partner resources</Typography>
              <Typography variant="body2" component="div">
                <Stack spacing={0.5} sx={{ "& a": { color: "#a9c7f5" } }}>
                  <Link href="https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/?tab=resources" target="_blank" rel="noopener">
                    Space Apps challenge: Planet X and SPHEREx
                  </Link>
                  <Link href="https://science.nasa.gov/mission/spherex/" target="_blank" rel="noopener">
                    NASA SPHEREx mission
                  </Link>
                  <Link href="https://irsa.ipac.caltech.edu/Missions/spherex.html" target="_blank" rel="noopener">
                    SPHEREx data at NASA/IPAC IRSA
                  </Link>
                  <Link href="https://doi.org/10.26131/IRSA652" target="_blank" rel="noopener">
                    SPHEREx Quick Release images (DOI 10.26131/IRSA652)
                  </Link>
                  <Link href="https://irsa.ipac.caltech.edu/docs/program_interface/api_images.html" target="_blank" rel="noopener">
                    IRSA Simple Image Access (SIA) API
                  </Link>
                  <Link href="https://gea.esac.esa.int/archive/" target="_blank" rel="noopener">
                    ESA Gaia DR3 — powers the known-star overlay & candidate cross-match
                  </Link>
                  <Link href="http://byw.tools/wiseview" target="_blank" rel="noopener">
                    WiseView (NASA WISE) — our model & per-candidate verification links
                  </Link>
                  <Link href="https://caltech-ipac.github.io/irsa-tutorials/" target="_blank" rel="noopener">
                    SPHEREx tutorial notebooks — basis for our archive cutout pipeline
                  </Link>
                </Stack>
              </Typography>
            </Grid>
          </Grid>
          <Divider sx={{ my: 2, borderColor: "rgba(255,255,255,.25)" }} />
          <Typography variant="caption" sx={{ color: "#b6c4e0" }}>
            COSMIC PREDICT · NASA Space Apps Challenge 2026 entry · independent project, not affiliated
            with or endorsed by NASA · SPHEREx data courtesy NASA/JPL-Caltech/IPAC-IRSA
          </Typography>
        </Container>
      </Box>
    </Box>
  );
}
