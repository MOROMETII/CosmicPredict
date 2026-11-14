"use client";

import { Box, Tooltip } from "@mui/material";
import type { Candidate } from "@/services/api";

export default function AnomalyOverlay({ candidates, onCandidateSelect }: { candidates: Candidate[]; onCandidateSelect: (candidate: Candidate) => void }) {
  return (
    <Box sx={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
      {candidates.map((candidate) => (
        <Tooltip key={candidate.candidate_id} title={`${candidate.candidate_id} · ${(candidate.score * 100).toFixed(1)}% relative score`}>
          <Box
            component="button"
            type="button"
            onClick={() => onCandidateSelect(candidate)}
            sx={{
              position: "absolute",
              left: `calc(${12 + Math.min(82, (candidate.column / 128) * 76)}% - 15px)`,
              top: `calc(${18 + Math.min(70, (candidate.row / 128) * 62)}% - 15px)`,
              width: 30,
              height: 30,
              borderRadius: "50%",
              border: "1px solid #65f6ca",
              background: "rgba(74, 240, 189, .08)",
              boxShadow: "0 0 0 5px rgba(74, 240, 189, .08), 0 0 24px rgba(74, 240, 189, .6)",
              cursor: "pointer",
              pointerEvents: "auto",
            }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}
