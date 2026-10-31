"use client";

import { useEffect, useState } from "react";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { SwapHoriz } from "@mui/icons-material";
import { resolveAssetUrl, type Observation } from "@/services/api";

const fallbackImage = "radial-gradient(circle at 63% 40%, rgba(245,198,100,.9) 0 1px, transparent 2px), radial-gradient(circle at 30% 60%, rgba(104,224,220,.9) 0 2px, transparent 3px), radial-gradient(circle at 72% 68%, rgba(195,126,255,.8) 0 1px, transparent 2px), linear-gradient(135deg, #162e4b, #07111f 60%, #321b43)";

export default function ImageComparison({ first, second, differenceScore, differenceImageUrl, onSwap }: { first: Observation | null; second: Observation | null; differenceScore: number | null; differenceImageUrl: string | null; onSwap: () => void }) {
  const [blink, setBlink] = useState(false);
  const [showDifference, setShowDifference] = useState(false);
  useEffect(() => {
    if (!blink) return;
    const timer = window.setInterval(() => setBlink((value) => !value), 900);
    return () => window.clearInterval(timer);
  }, [blink]);
  const active = blink ? second : first;
  const activeImageUrl = resolveAssetUrl(active?.image_url ?? null);
  const diffUrl = resolveAssetUrl(differenceImageUrl);
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Blink comparator</Typography>
          <Chip label={blink ? "BLINKING" : "PAUSED"} size="small" sx={{ height: 21, fontSize: 10, bgcolor: blink ? "rgba(113,233,193,.15)" : "rgba(150,165,184,.12)", color: blink ? "#72e9c1" : "#9caec2" }} />
        </Stack>
        <Stack direction="row" spacing={.75}>
          <Button size="small" onClick={() => setBlink((value) => !value)} variant="outlined" sx={{ color: "#d8e6f5", borderColor: "rgba(155,182,214,.25)" }}>{blink ? "Pause blink" : "Start blink"}</Button>
          <Button size="small" onClick={() => setShowDifference((value) => !value)} disabled={!diffUrl} variant="outlined" sx={{ color: "#8cebd0", borderColor: "rgba(112,227,191,.3)" }}>{showDifference ? "Show observation" : "Show difference"}</Button>
        </Stack>
      </Stack>
      <Box sx={{ position: "relative", height: 210, borderRadius: 2, overflow: "hidden", background: (showDifference ? diffUrl : activeImageUrl) ? `url(${showDifference ? diffUrl : activeImageUrl}) center/cover` : fallbackImage }}>
        <Box sx={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 52% 52%, transparent 0 12%, rgba(10,18,30,.15) 52%, rgba(4,8,15,.55))" }} />
        <Chip label={active?.epoch ? new Date(active.epoch).toLocaleDateString() : "No epoch selected"} size="small" sx={{ position: "absolute", top: 12, left: 12, bgcolor: "rgba(5,14,24,.8)", color: "white" }} />
        <Chip label={showDifference ? "DERIVED DIFFERENCE · SIMPLIFIED" : activeImageUrl ? "REAL FITS PREVIEW" : "PREVIEW UNAVAILABLE"} size="small" sx={{ position: "absolute", bottom: 12, left: 12, bgcolor: "rgba(5,14,24,.8)", color: showDifference || activeImageUrl ? "#b4f4dc" : "#f0d195", fontSize: 10 }} />
      </Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1 }}>
        <Typography sx={{ fontSize: 12, color: "rgba(191,207,225,.65)" }}>Context ↔ target · aligned display</Typography>
        <Button size="small" startIcon={<SwapHoriz />} onClick={onSwap} sx={{ color: "#8cebd0", textTransform: "none" }}>Swap epochs</Button>
      </Stack>
      <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 2, bgcolor: "rgba(90,117,148,.1)", border: "1px solid rgba(130,163,199,.13)" }}>
        <Typography sx={{ fontSize: 11, color: "rgba(191,207,225,.66)" }}>Difference baseline</Typography>
        <Typography sx={{ fontSize: 23, fontWeight: 700, color: "#e7f2ff" }}>{differenceScore == null ? "—" : differenceScore.toFixed(4)}</Typography>
      </Box>
    </Box>
  );
}
