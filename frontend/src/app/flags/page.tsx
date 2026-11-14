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
  Grid,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { ArrowBack, Bookmarks, Delete, Slideshow, TravelExplore } from "@mui/icons-material";
import { deleteMark, getMarks, resolveAssetUrl, type Mark } from "@/services/api";

/** Review queue for everything the user flagged as suspicious. */
export default function FlagsPage() {
  const [marks, setMarks] = useState<Mark[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMarks()
      .then((result) => setMarks(result.marks))
      .catch((requestError: Error) => {
        setMarks([]);
        setError(requestError.message);
      });
  }, []);

  const remove = async (id: string) => {
    try {
      await deleteMark(id);
      setMarks((current) => current?.filter((mark) => mark.id !== id) ?? null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not delete the flag.");
    }
  };

  return (
    <Box sx={{ minHeight: "100dvh" }}>
      <Box sx={{ bgcolor: "#101317", color: "#fff", py: 1.5 }}>
        <Container maxWidth="lg">
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={1} alignItems="center">
              <IconButton component={Link} href="/" sx={{ color: "#d7e4f4" }} aria-label="Back to explorer">
                <ArrowBack />
              </IconButton>
              <Bookmarks sx={{ color: "#ffb74d" }} />
              <Typography variant="h6" sx={{ letterSpacing: "0.03em" }}>
                My flags
              </Typography>
            </Stack>
            <Button component={Link} href="/scroll" startIcon={<Slideshow />} sx={{ color: "#d7e4f4" }}>
              Back to Sky Scroll
            </Button>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Alert severity="info" sx={{ mb: 2.5 }}>
          Flags are your personal bookmarks — spots that looked suspicious while scrolling or
          exploring. They are not detections or confirmed anomalies; open each one in the explorer
          to run the change detector and the Gaia star-catalog check.
        </Alert>

        {error && (
          <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {marks === null && (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress size={24} />
          </Stack>
        )}

        {marks !== null && marks.length === 0 && (
          <Stack alignItems="center" spacing={1.5} sx={{ py: 6, textAlign: "center" }}>
            <Typography sx={{ fontWeight: 700 }}>No flags yet</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
              Scroll the sky and tap the bookmark button whenever something looks like it moved,
              pulsed, or shouldn&apos;t be there. Everything you flag lands here.
            </Typography>
            <Button component={Link} href="/scroll" variant="contained" startIcon={<Slideshow />}>
              Start scrolling
            </Button>
          </Stack>
        )}

        <Grid container spacing={2}>
          {(marks ?? []).map((mark) => {
            const targetRa = mark.spot_ra ?? mark.ra;
            const targetDec = mark.spot_dec ?? mark.dec;
            const created = new Date(mark.created_at).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <Grid key={mark.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Paper sx={{ overflow: "hidden", height: "100%", display: "flex", flexDirection: "column" }}>
                  <Box sx={{ position: "relative", aspectRatio: "1", bgcolor: "#0a0c10" }}>
                    {mark.preview_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolveAssetUrl(mark.preview_url) ?? undefined}
                        alt={`Flagged sky region at RA ${targetRa}, Dec ${targetDec}`}
                        style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated" }}
                      />
                    ) : (
                      <Stack alignItems="center" justifyContent="center" sx={{ height: "100%" }}>
                        <Typography variant="caption" sx={{ color: "#5b6b82" }}>
                          Preview unavailable — open in the explorer
                        </Typography>
                      </Stack>
                    )}
                    {mark.spot_ra != null && (
                      <Chip
                        size="small"
                        label="spot pinned"
                        sx={{ position: "absolute", top: 8, left: 8, bgcolor: "rgba(0,0,0,.7)", color: "#ffb74d", fontSize: 11 }}
                      />
                    )}
                    {mark.epoch && (
                      <Chip
                        size="small"
                        label={new Date(mark.epoch).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        sx={{ position: "absolute", bottom: 8, left: 8, bgcolor: "rgba(0,0,0,.7)", color: "#fff", fontSize: 11 }}
                      />
                    )}
                  </Box>
                  <Stack spacing={0.75} sx={{ p: 1.5, flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      RA {targetRa.toFixed(4)}° · Dec {targetDec.toFixed(4)}°
                    </Typography>
                    {mark.note && (
                      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                        “{mark.note}”
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                      Flagged {created}
                      {mark.band ? ` · detector ${mark.band}` : ""} · via {mark.source}
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Button
                        component={Link}
                        href={`/?ra=${targetRa}&dec=${targetDec}`}
                        size="small"
                        variant="contained"
                        startIcon={<TravelExplore />}
                      >
                        Investigate
                      </Button>
                      <Tooltip title="Remove this flag">
                        <IconButton size="small" onClick={() => remove(mark.id)} aria-label="Delete flag">
                          <Delete sx={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Stack>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      </Container>
    </Box>
  );
}
