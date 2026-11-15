"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { ArrowBack, Leaderboard, TravelExplore } from "@mui/icons-material";
import { getSurvey, resolveAssetUrl, type Survey } from "@/services/api";

/** Engagement leaderboard: regions ranked by social interaction, with previews. */
export default function LeaderboardPage() {
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getSurvey()
      .then((result) => active && setSurvey(result))
      .catch((requestError: Error) => {
        if (!active) return;
        setSurvey({ status: "error", regions: [], caveats: [] });
        setError(requestError.message);
      });
    return () => {
      active = false;
    };
  }, []);

  const topScore = survey?.regions[0]?.score ?? 0;

  return (
    <Box sx={{ minHeight: "100dvh" }}>
      <Box sx={{ bgcolor: "#0b3d91", color: "#fff", py: 1.5, borderTop: "3px solid #f64137" }}>
        <Container maxWidth="lg">
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={1} alignItems="center">
              <IconButtonHome />
              <Leaderboard sx={{ color: "#ffb74d" }} />
              <Typography variant="h6" sx={{ letterSpacing: "0.02em" }}>
                Engagement leaderboard
              </Typography>
            </Stack>
            <Button component={Link} href="/scroll" sx={{ color: "#fff" }}>
              Back to Sky Scroll
            </Button>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Alert severity="info" sx={{ mb: 2.5 }}>
          Regions ranked by how many likes they received. This is a social measure, not a scientific
          ranking — more likes means people found it interesting, not that the sky is objectively
          more interesting.
        </Alert>

        {error && (
          <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {survey === null ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress size={24} />
          </Stack>
        ) : survey.regions.length === 0 ? (
          <Stack alignItems="center" spacing={1.5} sx={{ py: 6, textAlign: "center" }}>
            <Typography sx={{ fontWeight: 700 }}>No interactions yet</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
              Like a sky region in Sky Scroll and it will show up here.
            </Typography>
            <Button component={Link} href="/scroll" variant="contained" startIcon={<TravelExplore />}>
              Explore the sky
            </Button>
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            {survey.regions.map((region, index) => (
              <Paper key={region.region_key} sx={{ p: 1.5 }}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Box sx={{ width: 44, textAlign: "center", flexShrink: 0 }}>
                    <Typography
                      sx={{
                        fontSize: 22,
                        fontWeight: 800,
                        color: index === 0 ? "#ffb74d" : "text.secondary",
                      }}
                    >
                      {index + 1}
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      width: 72,
                      height: 72,
                      flexShrink: 0,
                      borderRadius: 1,
                      overflow: "hidden",
                      bgcolor: "#000",
                      border: "1px solid",
                      borderColor: "divider",
                    }}
                  >
                    {region.preview_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolveAssetUrl(region.preview_url) ?? undefined}
                        alt={`Sky region at RA ${region.ra}, Dec ${region.dec}`}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    ) : (
                      <Box sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
                        <Typography variant="caption" color="text.secondary">
                          no preview
                        </Typography>
                      </Box>
                    )}
                  </Box>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 14 }}>
                      RA {region.ra.toFixed(2)}° · Dec {region.dec.toFixed(2)}°
                    </Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap" }}>
                      <Chip
                        size="small"
                        label={`${region.likes} like${region.likes === 1 ? "" : "s"}`}
                        sx={{ height: 20, fontSize: 11 }}
                      />
                    </Stack>
                  </Box>

                  <Stack spacing={0.75} alignItems="flex-end" sx={{ flexShrink: 0 }}>
                    <Typography sx={{ fontSize: 20, fontWeight: 800, color: "#ffb74d" }}>{region.score}</Typography>
                    <Box
                      sx={{
                        width: 60,
                        height: 4,
                        borderRadius: 2,
                        bgcolor: "rgba(255,183,77,.2)",
                        overflow: "hidden",
                      }}
                    >
                      <Box
                        sx={{
                          width: `${topScore > 0 ? Math.max((region.score / topScore) * 100, 4) : 0}%`,
                          height: "100%",
                          bgcolor: "#ffb74d",
                        }}
                      />
                    </Box>
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}

        {survey && survey.caveats.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
            {survey.caveats.join(" ")}
          </Typography>
        )}
      </Container>
    </Box>
  );
}

function IconButtonHome() {
  return (
    <Link href="/" aria-label="Back to explorer" style={{ display: "inline-flex", color: "#fff" }}>
      <ArrowBack />
    </Link>
  );
}
