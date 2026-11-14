import { Alert, Box, Chip, Divider, Stack, Typography } from "@mui/material";
import { AutoAwesome, InfoOutlined } from "@mui/icons-material";
import type { Candidate } from "@/services/api";

export default function DiscoveryPanel({ candidate }: { candidate: Candidate | null }) {
  if (!candidate) {
    return <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 230, textAlign: "center", color: "rgba(188,204,223,.62)" }}><AutoAwesome sx={{ color: "#71e5c1", fontSize: 30, mb: 1 }} /><Typography sx={{ fontWeight: 700, color: "#e5f0ff" }}>Select a candidate</Typography><Typography sx={{ fontSize: 12, maxWidth: 240, mt: .5 }}>Run Find Changes, then select an overlay to inspect its evidence.</Typography></Stack>;
  }
  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="start">
        <Box><Typography sx={{ fontWeight: 800, fontSize: 18 }}>{candidate.candidate_id}</Typography><Typography sx={{ fontSize: 12, color: "rgba(188,204,223,.6)" }}>Unclassified candidate</Typography></Box>
        <Chip label="REVIEW" size="small" sx={{ color: "#f6d58a", bgcolor: "rgba(246,213,138,.12)", fontSize: 10 }} />
      </Stack>
      <Divider sx={{ borderColor: "rgba(144,169,198,.14)" }} />
      <Box><Typography sx={{ color: "rgba(188,204,223,.6)", fontSize: 11 }}>WHY IT WAS FLAGGED</Typography><Typography sx={{ mt: .5, fontSize: 13, lineHeight: 1.55 }}>A connected region exceeded the simplified normalized difference threshold in the selected image patch.</Typography></Box>
      <Stack direction="row" spacing={1}>
        <Box sx={{ flex: 1, p: 1.2, bgcolor: "rgba(100,140,180,.1)", borderRadius: 2 }}><Typography sx={{ fontSize: 11, color: "rgba(188,204,223,.6)" }}>Difference score</Typography><Typography sx={{ fontWeight: 800 }}>{candidate.score.toFixed(3)}</Typography></Box>
        <Box sx={{ flex: 1, p: 1.2, bgcolor: "rgba(100,140,180,.1)", borderRadius: 2 }}><Typography sx={{ fontSize: 11, color: "rgba(188,204,223,.6)" }}>Area</Typography><Typography sx={{ fontWeight: 800 }}>{candidate.area} px</Typography></Box>
      </Stack>
      <Alert icon={<InfoOutlined />} severity="info" sx={{ bgcolor: "rgba(73,132,174,.1)", color: "#b9d8f4", fontSize: 11, "& .MuiAlert-icon": { color: "#80c5ed" } }}>{candidate.caveat}</Alert>
    </Stack>
  );
}
