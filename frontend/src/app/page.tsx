"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Container, Divider, FormControlLabel, Paper, Slider, Stack, Switch, TextField, Typography } from "@mui/material";
import { CheckCircle, ExpandMore, PlayArrow, Refresh, Science } from "@mui/icons-material";
import { cosmicColors } from "@/theme";
import { analyzePair, getEpochs, type Analysis, type Candidate, type Observation } from "@/services/api";
import SpaceProjection from "@/components/SpaceProjection";
import DiscoveryPanel from "@/components/DiscoveryPanel";
import { motion } from "framer-motion";
import { featuredTargets } from "@/data/featuredTargets";

const DEFAULT_RA = 84.4295;
const DEFAULT_DEC = -6.9095;

export default function Home() {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [context, setContext] = useState<Observation | null>(null);
  const [target, setTarget] = useState<Observation | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [amount, setAmount] = useState(50);
  const [ra, setRa] = useState(String(DEFAULT_RA));
  const [dec, setDec] = useState(String(DEFAULT_DEC));
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [modelEnabled, setModelEnabled] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadRegion = async (position = { ra: Number(ra), dec: Number(dec) }) => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await getEpochs(position.ra, position.dec);
      setObservations(result.observations);
      setContext(result.observations[0] ?? null);
      setTarget(result.observations[1] ?? null);
      setAnalysis(null);
      setCandidate(null);
      if (!result.observations.length) setMessage(result.message ?? "No cached observations cover this position.");
    } catch {
      setMessage("The backend is not reachable. Start FastAPI on port 8000.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    getEpochs(DEFAULT_RA, DEFAULT_DEC).then((result) => {
      if (!active) return;
      setObservations(result.observations);
      setContext(result.observations[0] ?? null);
      setTarget(result.observations[1] ?? null);
      if (!result.observations.length) setMessage(result.message ?? "No cached observations cover this position.");
    }).catch(() => {
      if (active) setMessage("The backend is not reachable. Start FastAPI on port 8000.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const runScan = async () => {
    if (!context || !target) {
      setMessage("Select two different observations first.");
      return;
    }
    setScanning(true);
    setMessage(null);
    try {
      const result = await analyzePair(context.observation_id, target.observation_id, modelEnabled);
      setAnalysis(result);
      setCandidate(result.candidates[0] ?? null);
    } catch {
      setMessage("The scan failed. Check that the selected observations are compatible.");
    } finally {
      setScanning(false);
    }
  };

  const orderedCandidates = useMemo(() => analysis?.candidates ?? [], [analysis]);
  const chooseContext = (item: Observation) => { setContext(item); setAnalysis(null); setCandidate(null); };
  const chooseTarget = (item: Observation) => { setTarget(item); setAnalysis(null); setCandidate(null); };
  const date = (item: Observation | null) => item?.epoch ? new Date(item.epoch).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: cosmicColors.ink, color: cosmicColors.text }}>
      <Container maxWidth="md" sx={{ py: { xs: 2, md: 4 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
          <Box><Typography sx={{ fontWeight: 800, letterSpacing: "-.02em" }}>Cosmic Timeline</Typography><Typography variant="caption" color="text.secondary">SPHEREx time-domain workspace</Typography></Box>
          <Chip label={observations.length ? "Cached data" : "Waiting for data"} size="small" icon={<CheckCircle sx={{ fontSize: 15 }} />} sx={{ color: observations.length ? cosmicColors.accent : cosmicColors.warning, border: `1px solid ${observations.length ? cosmicColors.accentStrong : cosmicColors.warning}`, bgcolor: "transparent" }} />
        </Stack>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Paper sx={{ p: { xs: 2, md: 3 }, bgcolor: cosmicColors.panel, border: `1px solid ${cosmicColors.border}` }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box><Typography sx={{ fontWeight: 800 }}>Observation timeline</Typography><Typography variant="caption" color="text.secondary">Choose the two endpoints for the transition</Typography></Box>
              <Button size="small" startIcon={<Refresh />} onClick={() => void loadRegion()} disabled={loading} sx={{ color: cosmicColors.accent }}>Reload</Button>
            </Stack>
            <Box sx={{ mt: 2, display: "flex", gap: 1, overflowX: "auto", pb: 1 }}>
              {observations.map((item) => {
                const isContext = item.observation_id === context?.observation_id;
                const isTarget = item.observation_id === target?.observation_id;
                return <Paper key={item.observation_id} onClick={() => chooseTarget(item)} sx={{ minWidth: 170, p: 1.4, cursor: "pointer", bgcolor: isContext || isTarget ? "rgba(118,229,169,.1)" : cosmicColors.panelRaised, border: `1px solid ${isContext || isTarget ? cosmicColors.accentStrong : cosmicColors.border}` }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{date(item)}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>{item.observation_id.slice(0, 18)}</Typography>
                  <Stack direction="row" spacing={.5} sx={{ mt: 1 }}>
                    <Button size="small" onClick={(event) => { event.stopPropagation(); chooseContext(item); }} sx={{ px: .6, fontSize: 10, color: isContext ? cosmicColors.ink : cosmicColors.muted, bgcolor: isContext ? cosmicColors.accent : "transparent" }}>A</Button>
                    <Button size="small" onClick={(event) => { event.stopPropagation(); chooseTarget(item); }} sx={{ px: .6, fontSize: 10, color: isTarget ? cosmicColors.ink : cosmicColors.muted, bgcolor: isTarget ? cosmicColors.accent : "transparent" }}>B</Button>
                  </Stack>
                </Paper>;
              })}
            </Box>
            {loading && <CircularProgress size={18} sx={{ color: cosmicColors.accent }} />}
          </Paper>
        </motion.div>

        <Paper sx={{ mt: 2, p: { xs: 2, md: 3 }, bgcolor: cosmicColors.panel, border: `1px solid ${cosmicColors.border}` }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
            <Typography variant="caption" sx={{ minWidth: 120, color: cosmicColors.muted }}>Transition position</Typography>
            <Slider value={amount} onChange={(_, value) => setAmount(value as number)} sx={{ color: cosmicColors.violet }} />
            <Typography sx={{ fontWeight: 800, minWidth: 45, textAlign: "right" }}>{amount}%</Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">A · {date(context)}</Typography><Typography variant="caption" color="text.secondary">B · {date(target)}</Typography></Stack>
        </Paper>

        {message && <Alert severity="warning" onClose={() => setMessage(null)} sx={{ mt: 2 }}>{message}</Alert>}

        <Paper sx={{ mt: 2, p: { xs: 1.5, md: 2 }, bgcolor: cosmicColors.panel, border: `1px solid ${cosmicColors.border}` }}>
          <SpaceProjection first={context} second={target} amount={amount / 100} candidates={orderedCandidates} />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>Intermediate transition is a synthetic visual blend between the two real endpoint observations. It is not an observation and is excluded from analysis.</Typography>
        </Paper>

        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mt: 2 }}>
          <Paper sx={{ flex: 1, p: 2, bgcolor: cosmicColors.panel, border: `1px solid ${cosmicColors.border}` }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography sx={{ fontWeight: 800 }}>Change detector</Typography><Typography variant="caption" color="text.secondary">Simplified normalized difference baseline</Typography></Box><Science sx={{ color: cosmicColors.accent }} /></Stack>
            <Button fullWidth variant="contained" startIcon={scanning ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />} onClick={runScan} disabled={scanning || loading || !context || !target} sx={{ mt: 2 }}>{scanning ? "Scanning..." : "Find anomalies"}</Button>
            <FormControlLabel sx={{ mt: 1 }} control={<Switch checked={modelEnabled} onChange={(event) => setModelEnabled(event.target.checked)} size="small" />} label={<Typography variant="caption">Run optional predictive model</Typography>} />
            {analysis && <Stack direction="row" spacing={2} sx={{ mt: 1.5 }}><Box><Typography variant="caption" color="text.secondary">Candidates</Typography><Typography variant="h6">{analysis.candidates.length}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Difference</Typography><Typography variant="h6">{analysis.difference_score?.toFixed(3) ?? "—"}</Typography></Box></Stack>}
          </Paper>
          <Paper sx={{ flex: 1, p: 2, bgcolor: cosmicColors.panel, border: `1px solid ${cosmicColors.border}` }}><Typography sx={{ fontWeight: 800, mb: 1 }}>Candidate review</Typography><DiscoveryPanel candidate={candidate} analysis={analysis} /></Paper>
        </Stack>

        {analysis && <Paper sx={{ mt: 2, p: 2, bgcolor: cosmicColors.panel, border: `1px solid ${cosmicColors.border}` }}>
          <Typography sx={{ fontWeight: 800 }}>Flagged regions</Typography>
          <Typography variant="caption" color="text.secondary">Candidates are regions for review, not confirmed detections.</Typography>
          <Divider sx={{ my: 1.5 }} />
          <Stack spacing={.75}>{orderedCandidates.slice(0, 8).map((item) => <Button key={item.candidate_id} onClick={() => setCandidate(item)} sx={{ justifyContent: "space-between", color: cosmicColors.text, bgcolor: candidate?.candidate_id === item.candidate_id ? "rgba(118,229,169,.1)" : "transparent" }}><span>{item.candidate_id} · {item.area}px</span><span>{item.score.toFixed(3)}</span></Button>)}</Stack>
        </Paper>}

        <Paper sx={{ mt: 2, p: 2, bgcolor: cosmicColors.panel, border: `1px solid ${cosmicColors.border}` }}>
          <Typography sx={{ fontWeight: 800, mb: 1 }}>Region</Typography>
          <Stack direction="row" spacing={1}><TextField size="small" label="RA" value={ra} onChange={(event) => setRa(event.target.value)} /><TextField size="small" label="Dec" value={dec} onChange={(event) => setDec(event.target.value)} /><Button onClick={() => void loadRegion()} startIcon={<ExpandMore />} sx={{ color: cosmicColors.accent }}>Load</Button></Stack>
        </Paper>

        <Paper sx={{ mt: 2, p: 2, bgcolor: cosmicColors.panel, border: `1px solid ${cosmicColors.border}` }}>
          <Typography sx={{ fontWeight: 800 }}>Featured science targets</Typography>
          <Typography variant="caption" color="text.secondary">
            Target context from the project brief. A name is not treated as a detection, and only verified coordinates can load a region.
          </Typography>
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            {featuredTargets.map((target) => {
              const targetRa = target.ra;
              const targetDec = target.dec;
              return <Stack key={target.name} direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1} sx={{ p: 1, border: `1px solid ${cosmicColors.border}`, borderRadius: 1 }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{target.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{target.type} · {target.note}</Typography>
                </Box>
                {targetRa !== null && targetDec !== null ? (
                  <Button size="small" onClick={() => { setRa(String(targetRa)); setDec(String(targetDec)); void loadRegion({ ra: targetRa, dec: targetDec }); }} sx={{ color: cosmicColors.accent, alignSelf: { sm: "center" } }}>
                    Explore target
                  </Button>
                ) : (
                  <Chip size="small" label="Awaiting verified coordinates" sx={{ color: cosmicColors.muted, alignSelf: { sm: "center" } }} />
                )}
              </Stack>;
            })}
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
