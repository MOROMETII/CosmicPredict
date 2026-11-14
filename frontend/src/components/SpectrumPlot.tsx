"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Stack, Typography } from "@mui/material";
import { getSpectrum, type Spectrum } from "@/services/api";

type Props = { ra: number; dec: number };

const WIDTH = 680;
const HEIGHT = 280;
const MARGIN = { top: 18, right: 20, bottom: 48, left: 70 };

/**
 * A spectrum (surface brightness vs. wavelength) at one sky position, assembled
 * across detectors: each detector sees a different slice of 0.75–5 µm, so the
 * per-band median brightness sketches the source's spectral energy distribution.
 * One point per observation per band; repeated visits of the same band overlap.
 */
export default function SpectrumPlot({ ra, dec }: Props) {
  const [spectrum, setSpectrum] = useState<Spectrum | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getSpectrum(ra, dec)
      .then((result) => active && setSpectrum(result))
      .catch((requestError: Error) => active && setError(requestError.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [ra, dec]);

  const plot = useMemo(() => {
    const points = (spectrum?.points ?? []).filter((point) => point.surface_brightness > 0);
    if (points.length === 0) return null;
    const wavelengths = points.map((point) => point.wavelength);
    const values = points.map((point) => point.surface_brightness);
    const wMin = Math.min(...wavelengths);
    const wMax = Math.max(...wavelengths);
    const wSpan = Math.max(wMax - wMin, 0.2);
    const vLow = Math.min(...values);
    const vHigh = Math.max(...values);
    const useLog = vHigh / vLow > 50;
    const toY = (value: number) => (useLog ? Math.log10(value) : value);
    const yLow = toY(vLow);
    const yHigh = toY(vHigh);
    const ySpan = Math.max(yHigh - yLow, useLog ? 0.5 : vHigh * 0.2 || 1);

    const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
    const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const x = (w: number) => MARGIN.left + ((w - (wMin - wSpan * 0.08)) / (wSpan * 1.16)) * innerWidth;
    const y = (value: number) => MARGIN.top + innerHeight - ((toY(value) - (yLow - ySpan * 0.12)) / (ySpan * 1.24)) * innerHeight;
    return { points, x, y, useLog, wMin, wMax, yLow, yHigh };
  }, [spectrum]);

  if (loading) {
    return (
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 3, justifyContent: "center" }}>
        <Typography variant="body2" color="text.secondary">
          Assembling the spectrum…
        </Typography>
      </Stack>
    );
  }
  if (error) return <Alert severity="warning">{error}</Alert>;
  if (!plot) return <Alert severity="info">{spectrum?.message ?? "No observations cover this position yet."}</Alert>;

  const formatValue = (value: number) =>
    value >= 100 ? Math.round(value).toString() : value >= 1 ? value.toFixed(1) : value.toPrecision(2);

  const xTicks = Array.from({ length: 6 }, (_, i) => plot.wMin + ((plot.wMax - plot.wMin) / 5) * i);
  const yTicks = Array.from({ length: 4 }, (_, i) => {
    const t = plot.useLog ? 10 ** (Math.log10(Math.max(plot.yLow, 1e-6)) + ((Math.log10(plot.yHigh + 1e-6) - Math.log10(Math.max(plot.yLow, 1e-6))) / 3) * i) : plot.yLow + ((plot.yHigh - plot.yLow) / 3) * i;
    return t;
  });

  return (
    <Box component="svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} sx={{ width: "100%", maxWidth: 780, display: "block" }}>
      <line x1={MARGIN.left} y1={HEIGHT - MARGIN.bottom} x2={WIDTH - MARGIN.right} y2={HEIGHT - MARGIN.bottom} stroke="currentColor" strokeOpacity={0.45} />
      <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={HEIGHT - MARGIN.bottom} stroke="currentColor" strokeOpacity={0.45} />
      {xTicks.map((tick, index) => (
        <g key={`x${index}`}>
          <line x1={plot.x(tick)} y1={HEIGHT - MARGIN.bottom} x2={plot.x(tick)} y2={HEIGHT - MARGIN.bottom + 5} stroke="currentColor" strokeOpacity={0.45} />
          <text x={plot.x(tick)} y={HEIGHT - MARGIN.bottom + 20} textAnchor="middle" fontSize={11.5} fill="currentColor" opacity={0.75}>
            {tick.toFixed(1)}
          </text>
        </g>
      ))}
      <text x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={12} fill="currentColor" opacity={0.75}>
        Wavelength (µm)
      </text>
      {yTicks.map((tick, index) => (
        <g key={`y${index}`}>
          <line x1={MARGIN.left - 5} y1={plot.y(tick)} x2={MARGIN.left} y2={plot.y(tick)} stroke="currentColor" strokeOpacity={0.45} />
          <text x={MARGIN.left - 9} y={plot.y(tick) + 4} textAnchor="end" fontSize={11} fill="currentColor" opacity={0.75}>
            {formatValue(tick)}
          </text>
        </g>
      ))}
      <text
        transform={`translate(16 ${(MARGIN.top + HEIGHT - MARGIN.bottom) / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize={12}
        fill="currentColor"
        opacity={0.75}
      >
        Brightness (MJy/sr{plot.useLog ? ", log scale" : ""})
      </text>
      {plot.points.map((point) => (
        <circle
          key={point.observation_id + point.wavelength}
          cx={plot.x(point.wavelength)}
          cy={plot.y(point.surface_brightness)}
          r={5}
          fill="#1c67e3"
          stroke="currentColor"
          strokeOpacity={0.4}
        >
          <title>
            {`${point.surface_brightness.toPrecision(3)} MJy/sr at ${point.wavelength.toFixed(2)} µm · detector ${point.band ?? "?"}`}
          </title>
        </circle>
      ))}
    </Box>
  );
}
