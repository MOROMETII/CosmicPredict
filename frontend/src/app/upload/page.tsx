"use client";

import { useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { CloudUpload, CheckCircle } from "@mui/icons-material";
import { cosmicColors } from "@/theme";
import { resolveAssetUrl, uploadImage, type Observation } from "@/services/api";

export default function UploadPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [observationId, setObservationId] = useState("");
  const [ra, setRa] = useState("");
  const [dec, setDec] = useState("");
  const [wavelength, setWavelength] = useState("");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<Observation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const uploaded = await uploadImage(file, {
        observation_id: observationId.trim() || undefined,
        ra: ra.trim() ? Number(ra) : undefined,
        dec: dec.trim() ? Number(dec) : undefined,
        wavelength: wavelength.trim() ? Number(wavelength) : undefined,
      });
      setResult(uploaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const previewUrl = result ? resolveAssetUrl(result.image_url) : null;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: cosmicColors.ink, color: cosmicColors.text }}>
      <Container maxWidth="sm" sx={{ py: { xs: 3, md: 6 } }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          Upload an image
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
          Add a SPHEREx FITS file (.fits) or a parsed snapshot (.npz) to the catalog.
          FITS metadata (coordinates, band, wavelength) is read automatically; for .npz
          files you can supply it below.
        </Typography>

        <Paper sx={{ p: 3, bgcolor: cosmicColors.panel, border: `1px solid ${cosmicColors.border}` }}>
          <Stack spacing={2}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".fits,.fit,.fz,.npz"
              hidden
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <Button
              variant="outlined"
              startIcon={<CloudUpload />}
              onClick={() => fileInputRef.current?.click()}
              sx={{ color: cosmicColors.accent, borderColor: cosmicColors.border }}
            >
              {file ? file.name : "Choose file (.fits or .npz)"}
            </Button>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField size="small" label="Observation ID (optional)" value={observationId} onChange={(e) => setObservationId(e.target.value)} fullWidth />
              <TextField size="small" label="RA (deg, optional)" value={ra} onChange={(e) => setRa(e.target.value)} fullWidth />
              <TextField size="small" label="Dec (deg, optional)" value={dec} onChange={(e) => setDec(e.target.value)} fullWidth />
            </Stack>
            <TextField size="small" label="Wavelength µm (optional)" value={wavelength} onChange={(e) => setWavelength(e.target.value)} />

            <Button
              fullWidth
              variant="contained"
              startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : <CloudUpload />}
              onClick={handleUpload}
              disabled={uploading || !file}
            >
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </Stack>
        </Paper>

        {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mt: 2 }}>{error}</Alert>}

        {result && (
          <Paper sx={{ mt: 2, p: 2, bgcolor: cosmicColors.panel, border: `1px solid ${cosmicColors.border}` }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <CheckCircle sx={{ color: cosmicColors.accent }} />
              <Typography sx={{ fontWeight: 800 }}>Uploaded {result.observation_id}</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              RA {result.ra?.toFixed(4) ?? "—"} · Dec {result.dec?.toFixed(4) ?? "—"}
              {result.wavelength != null ? ` · ${result.wavelength.toFixed(2)} µm` : ""}
            </Typography>
            {previewUrl && (
              <Box component="img" src={previewUrl} alt={`Preview of ${result.observation_id}`} sx={{ mt: 1.5, width: "100%", maxHeight: 360, objectFit: "contain", borderRadius: 1, bgcolor: "#070a10" }} />
            )}
          </Paper>
        )}
      </Container>
    </Box>
  );
}
