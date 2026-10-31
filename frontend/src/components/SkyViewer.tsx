"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { Add, Remove, MyLocation } from "@mui/icons-material";
import type { Candidate, Observation } from "@/services/api";
import { resolveAssetUrl } from "@/services/api";
import AnomalyOverlay from "./AnomalyOverlay";

declare global {
  interface Window {
    A?: {
      aladin: (element: HTMLElement, options: Record<string, unknown>) => {
        gotoRaDec: (coordinates: [number, number]) => void;
        setZoom: (zoom: number) => void;
      };
    };
  }
}

type SkyViewerProps = {
  observation: Observation | null;
  candidates: Candidate[];
  onCandidateSelect: (candidate: Candidate) => void;
};

export default function SkyViewer({ observation, candidates, onCandidateSelect }: SkyViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const aladinRef = useRef<ReturnType<NonNullable<Window["A"]>["aladin"]> | null>(null);
  const [aladinReady, setAladinReady] = useState(false);
  const [referenceMode, setReferenceMode] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!viewerRef.current || aladinRef.current) return;
    const script = document.createElement("script");
    script.src = "https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js";
    script.async = true;
    script.onload = () => {
      if (!viewerRef.current || !window.A) return;
      aladinRef.current = window.A.aladin(viewerRef.current, {
        survey: "P/DSS2/color",
        fov: 0.8,
        target: "0 0",
        showZoomControl: false,
        showFullscreenControl: false,
        showLayersControl: false,
        showGotoControl: false,
      });
      setAladinReady(true);
    };
    document.head.appendChild(script);
    return () => script.remove();
  }, []);

  useEffect(() => {
    if (aladinRef.current && observation?.ra != null && observation.dec != null) {
      aladinRef.current.gotoRaDec([observation.ra, observation.dec]);
    }
  }, [observation]);

  const adjustZoom = (delta: number) => {
    if (referenceMode && aladinRef.current) aladinRef.current.setZoom(delta > 0 ? 1.4 : 0.55);
    else setZoom((value) => Math.max(.85, Math.min(2.2, value + (delta > 0 ? .2 : -.2))));
  };

  const imageUrl = resolveAssetUrl(observation?.image_url ?? null);

  return (
    <Box sx={{ position: "relative", height: "100%", minHeight: 420, overflow: "hidden", borderRadius: 3 }}>
      <Box ref={viewerRef} sx={{ position: "absolute", inset: 0, background: "#050a12", visibility: referenceMode ? "visible" : "hidden" }} />
      {!referenceMode && imageUrl && <Box component="img" src={imageUrl} alt={`Cached FITS preview for ${observation?.observation_id ?? "observation"}`} sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", imageRendering: "auto", transform: `scale(${zoom})`, transition: "transform .2s ease", filter: "contrast(1.12) brightness(1.08)" }} />}
      {!referenceMode && !imageUrl && <Box sx={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 45%, #213a5d 0%, #091321 42%, #050a12 100%)" }} />}
      {!aladinReady && (
        <Box className="cosmic-grid" sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <Typography sx={{ position: "absolute", top: 24, left: 24, color: "rgba(227,240,255,.7)", fontSize: 12, letterSpacing: ".12em" }}>
            INITIALIZING SKY SURVEY
          </Typography>
        </Box>
      )}
      <AnomalyOverlay candidates={candidates} onCandidateSelect={onCandidateSelect} />
      <Stack direction="row" spacing={1} sx={{ position: "absolute", top: 18, right: 18 }}>
        <Stack direction="row" spacing={.75}>
          <Chip label={referenceMode ? (aladinReady ? "ALADIN REFERENCE" : "LOADING REFERENCE") : "REAL FITS PREVIEW"} onClick={() => setReferenceMode((value) => !value)} size="small" sx={{ cursor: "pointer", color: "#b9f5e1", bgcolor: "rgba(7,25,33,.82)", border: "1px solid rgba(112,226,194,.35)" }} />
        </Stack>
      </Stack>
      <Stack spacing={1} sx={{ position: "absolute", right: 18, bottom: 18 }}>
        <Tooltip title="Zoom in"><IconButton onClick={() => adjustZoom(1)} aria-label="Zoom in" sx={{ bgcolor: "rgba(8,18,30,.8)", color: "white" }}><Add /></IconButton></Tooltip>
        <Tooltip title="Zoom out"><IconButton onClick={() => adjustZoom(-1)} aria-label="Zoom out" sx={{ bgcolor: "rgba(8,18,30,.8)", color: "white" }}><Remove /></IconButton></Tooltip>
        <Tooltip title="Center on observation"><IconButton onClick={() => observation?.ra != null && observation.dec != null && aladinRef.current?.gotoRaDec([observation.ra, observation.dec])} aria-label="Center on observation" sx={{ bgcolor: "rgba(8,18,30,.8)", color: "white" }}><MyLocation /></IconButton></Tooltip>
      </Stack>
      <Box sx={{ position: "absolute", left: 18, bottom: 18, color: "rgba(230,239,250,.72)", fontSize: 12 }}>
        <Typography sx={{ fontSize: 12 }}>RA {observation?.ra?.toFixed(4) ?? "--"}° · DEC {observation?.dec?.toFixed(4) ?? "--"}°</Typography>
        <Typography sx={{ fontSize: 11, opacity: .7 }}>{referenceMode ? "Reference survey layer · not the cached SPHEREx asset" : "Cached FITS science preview · derived candidate overlays appear after analysis"}</Typography>
      </Box>
    </Box>
  );
}
