import { Alert, Box, Chip, Divider, Stack, Typography } from "@mui/material";
import { TravelExplore } from "@mui/icons-material";
import type { Candidate } from "@/services/api";

type Props = {
  candidate: Candidate | null;
  /** Arcseconds per cutout pixel, so sizes can be reported in sky units. */
  pixelScaleArcsec?: number;
};

/** Plain-language explanation of one flagged region. */
export default function DiscoveryPanel({ candidate, pixelScaleArcsec }: Props) {
  if (!candidate) {
    return (
      <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ minHeight: 200, textAlign: "center", p: 2 }}>
        <TravelExplore sx={{ color: "text.secondary", fontSize: 32 }} />
        <Typography sx={{ fontWeight: 700 }}>No region selected</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 260 }}>
          Run <strong>Find changes</strong>, then choose a flagged region from the list to see why it
          was flagged.
        </Typography>
      </Stack>
    );
  }

  const sigma = candidate.score;
  const sizeArcsec = pixelScaleArcsec
    ? `${Math.round(Math.max(candidate.width, candidate.height) * pixelScaleArcsec)}″ across`
    : `${Math.max(candidate.width, candidate.height)} pixels across`;
  const confidenceWord = sigma >= 10 ? "a very strong" : sigma >= 7 ? "a strong" : "a";

  return (
    <Stack spacing={1.5} sx={{ p: 0.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography sx={{ fontWeight: 800 }}>{candidate.candidate_id}</Typography>
        <Chip
          size="small"
          label="UNCONFIRMED"
          sx={(theme) => ({
            bgcolor: "#fff3cd",
            color: "#6a4e00",
            fontSize: 11,
            ...theme.applyStyles("dark", { bgcolor: "#4a3b00", color: "#ffd558" }),
          })}
        />
      </Stack>
      <Divider />
      <Box>
        <Typography variant="overline" color="text.secondary">
          What happened here
        </Typography>
        <Typography variant="body2">
          The brightness at this spot changed between the two dates by{" "}
          <strong>{sigma.toFixed(1)}× the measurement noise</strong> — {confidenceWord} signal that
          something real changed (5× is the usual astronomy threshold). The changed region is about{" "}
          {sizeArcsec}.
        </Typography>
      </Box>
      <Box>
        <Typography variant="overline" color="text.secondary">
          What it could be
        </Typography>
        <Typography variant="body2" color="text.secondary">
          A star changing brightness, an object that moved (look for a paired red/blue spot in the
          difference image), an image artifact, or a wavelength difference between visits. Telling
          these apart needs human review — that is exactly the discovery step this tool is for.
        </Typography>
      </Box>
      <Alert severity="info" sx={{ fontSize: 12 }}>
        {candidate.caveat}
      </Alert>
    </Stack>
  );
}
