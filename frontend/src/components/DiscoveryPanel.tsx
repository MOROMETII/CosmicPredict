import { Alert, Box, Chip, Divider, Link, Stack, Typography } from "@mui/material";
import { OpenInNew, TravelExplore } from "@mui/icons-material";
import type { Candidate } from "@/services/api";

type Props = {
  candidate: Candidate | null;
  /** Arcseconds per cutout pixel, so sizes can be reported in sky units. */
  pixelScaleArcsec?: number;
};

/** WiseView (NASA WISE mission viewer) deep link at a sky position — a 10+ year
 * infrared baseline to cross-check whether something was already moving there. */
const wiseViewUrl = (ra: number, dec: number) =>
  `http://byw.tools/wiseview#ra=${ra.toFixed(6)}&dec=${dec.toFixed(6)}&size=176&band=2&speed=500&zoom=9`;

const esaSkyUrl = (ra: number, dec: number) =>
  `https://sky.esa.int/esasky/?target=${ra.toFixed(6)}%20${dec.toFixed(6)}&fov=0.25&sci=true`;

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
  const hasSky = candidate.ra != null && candidate.dec != null;

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
      {hasSky && (
        <Typography variant="caption" color="text.secondary">
          Sky position: RA {candidate.ra!.toFixed(5)}° · Dec {candidate.dec!.toFixed(5)}° (for
          follow-up in any archive)
        </Typography>
      )}
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
          Star-catalog check (ESA Gaia DR3)
        </Typography>
        {candidate.gaia_checked ? (
          candidate.gaia_match ? (
            <>
              <Typography variant="body2">
                <Chip size="small" label="KNOWN STAR" sx={{ mr: 1, bgcolor: "rgba(120,160,255,.2)", fontSize: 11 }} />
                {candidate.interpretation}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Gaia DR3 {candidate.gaia_match.source_id}
                {candidate.gaia_match.g_mag != null && ` · G=${candidate.gaia_match.g_mag.toFixed(1)}`}
                {candidate.gaia_match.pm_total_mas_yr != null &&
                  ` · proper motion ${Math.round(candidate.gaia_match.pm_total_mas_yr)} mas/yr`}
                {candidate.gaia_match.variable_flag === "VARIABLE" && " · catalogued variable"}
              </Typography>
            </>
          ) : (
            <Typography variant="body2">
              <Chip size="small" label="NOT IN CATALOG" sx={{ mr: 1, bgcolor: "rgba(255,180,80,.25)", fontSize: 11 }} />
              {candidate.interpretation ??
                "No catalogued Gaia DR3 star here — the change is not explained by the star catalog."}
            </Typography>
          )
        ) : (
          <Typography variant="body2" color="text.secondary">
            The Gaia DR3 catalog could not be reached for this scan, so this candidate is unchecked
            against known stars — absence of a match means nothing here.
          </Typography>
        )}
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
      {hasSky && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            Verify with other missions
          </Typography>
          <Stack spacing={0.25}>
            <Link
              href={wiseViewUrl(candidate.ra!, candidate.dec!)}
              target="_blank"
              rel="noopener"
              variant="body2"
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
            >
              Blink 10+ years of NASA WISE infrared data here (WiseView) <OpenInNew sx={{ fontSize: 14 }} />
            </Link>
            <Link
              href={esaSkyUrl(candidate.ra!, candidate.dec!)}
              target="_blank"
              rel="noopener"
              variant="body2"
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
            >
              Open this spot in ESASky (multi-mission archive) <OpenInNew sx={{ fontSize: 14 }} />
            </Link>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            A real slow mover should also drift across WISE&apos;s decade of images; an artifact
            won&apos;t appear anywhere else.
          </Typography>
        </Box>
      )}
      <Alert severity="info" sx={{ fontSize: 12 }}>
        {candidate.caveat}
      </Alert>
    </Stack>
  );
}
