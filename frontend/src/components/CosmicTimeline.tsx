"use client";

import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { CheckCircle, RadioButtonUnchecked } from "@mui/icons-material";
import type { Observation } from "@/services/api";

export default function CosmicTimeline({ observations, contextId, targetId, onContextSelect, onTargetSelect }: { observations: Observation[]; contextId: string | null; targetId: string | null; onContextSelect: (observation: Observation) => void; onTargetSelect: (observation: Observation) => void }) {
  return (
    <Box sx={{ overflowX: "auto", pb: 1 }}>
      <Stack direction="row" spacing={1.5} sx={{ minWidth: "max-content" }}>
        {observations.map((observation, index) => {
          const context = observation.observation_id === contextId;
          const target = observation.observation_id === targetId;
          const date = observation.epoch ? new Date(observation.epoch) : null;
          return (
            <Box
              key={observation.observation_id}
              sx={{
                minWidth: 190, p: 1.5, borderRadius: 2,
                border: `1px solid ${context || target ? "#6ee7c3" : "rgba(133,155,182,.18)"}`,
                bgcolor: context || target ? "rgba(81,225,182,.1)" : "rgba(12,25,42,.65)",
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : `Epoch ${index + 1}`}</Typography>
                {context || target ? <CheckCircle sx={{ fontSize: 16, color: "#6ee7c3" }} /> : <RadioButtonUnchecked sx={{ fontSize: 16, color: "rgba(180,198,219,.45)" }} />}
              </Stack>
              <Typography sx={{ color: "rgba(188,204,223,.66)", fontSize: 11, mt: .5 }}>{observation.observation_id}</Typography>
              <Chip label={observation.band ?? "band not provided"} size="small" sx={{ mt: 1, height: 20, fontSize: 10, color: "#b2c5de", bgcolor: "rgba(132,158,191,.13)" }} />
              <Stack direction="row" spacing={.75} sx={{ mt: 1 }}>
                <Button size="small" onClick={() => onContextSelect(observation)} variant={context ? "contained" : "outlined"} sx={{ minWidth: 0, py: .35, px: .8, fontSize: 10, textTransform: "none", color: context ? "#06151c" : "#a9c1da", bgcolor: context ? "#6ee7c3" : "transparent", borderColor: "rgba(145,173,205,.25)" }}>Context</Button>
                <Button size="small" onClick={() => onTargetSelect(observation)} variant={target ? "contained" : "outlined"} sx={{ minWidth: 0, py: .35, px: .8, fontSize: 10, textTransform: "none", color: target ? "#06151c" : "#a9c1da", bgcolor: target ? "#6ee7c3" : "transparent", borderColor: "rgba(145,173,205,.25)" }}>Target</Button>
              </Stack>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
