"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import { getSpectrum, type Spectrum } from "@/services/api";

type Props = { ra: number; dec: number; selectedBand?: string | null };

const WIDTH = 680;
const HEIGHT = 300;
const MARGIN = { top: 18, right: 20, bottom: 48, left: 70 };

/** Map an infrared wavelength (µm) to a display hue (matches the frame tinting). */
function wavelengthColor(um: number): string {
  const stops: [number, string][] = [
    [1.09, "#2a4fff"], // D1
    [1.62, "#00a6ff"], // D2
    [2.41, "#33cc55"], // D3
    [3.82, "#f0c419"], // D4
    [4.41, "#ff6a00"], // D5
    [9.99, "#ff2a1a"], // D6
  ];
  for (const [limit, color] of stops) {
    if (um <= limit) return color;
  }
  return "#ff2a1a";
}

/**
 * Brightness of this sky position over time, one dot per real observation.
 * A steady source traces a flat line; a variable star rises and falls; points
 * are colored by the infrared wavelength their detector saw.
 */
export default function LightCurvePanel({ ra, dec, selectedBand = null }: Props) {
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
    const points = (spectrum?.points ?? [])
      .filter((point) => point.epoch && point.surface_brightness > 0)
      .filter((point) => !selectedBand || point.band === selectedBand)
      .map((point) => ({ ...point, time: new Date(point.epoch as string).getTime() }))
      .sort((a, b) => a.time - b.time);
    if (points.length === 0) return null;

    const times = points.map((point) => point.time);
    const pad = Math.max((Math.max(...times) - Math.min(...times)) * 0.06, 15 * 86400e3);
    const tMin = Math.min(...times) - pad;
    const tMax = Math.max(...times) + pad;

    const values = points.map((point) => point.surface_brightness);
    const vLow = Math.min(...values);
    const vHigh = Math.max(...values);
    const useLog = vHigh / vLow > 10;
    const toY = (value: number) => (useLog ? Math.log10(value) : value);
    const yLow = toY(vLow);
    const yHigh = toY(vHigh);
    const ySpan = Math.max(yHigh - yLow, useLog ? 0.3 : vHigh * 0.2 || 1);
    const yMin = yLow - ySpan * 0.12;
    const yMax = yHigh + ySpan * 0.12;

    const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
    const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const x = (time: number) => MARGIN.left + ((time - tMin) / (tMax - tMin)) * innerWidth;
    const y = (value: number) => MARGIN.top + innerHeight - ((toY(value) - yMin) / (yMax - yMin)) * innerHeight;

    const tickCount = Math.min(5, points.length + 1);
    const xTicks = Array.from({ length: tickCount }, (_, index) => tMin + ((index + 0.5) / tickCount) * (tMax - tMin));
    const yTicks = Array.from({ length: 4 }, (_, index) => yMin + ((index + 0.5) / 4) * (yMax - yMin));
    const fromY = (value: number) => (useLog ? 10 ** value : value);

    const bands = [...new Set(points.map((point) => `${point.band ?? "?"}|${point.wavelength.toFixed(2)}`))];
    return { points, x, y, xTicks, yTicks, fromY, useLog, bands };
  }, [spectrum, selectedBand]);

  if (loading) {
    return (
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 3, justifyContent: "center" }}>
        <CircularProgress size={18} />
        <Typography variant="body2" color="text.secondary">
          Measuring this position in every observation… (first time can take a minute)
        </Typography>
      </Stack>
    );
  }
  if (error) return <Alert severity="warning">{error}</Alert>;
  if (!plot) return <Alert severity="info">{spectrum?.message ?? "No observations cover this position yet."}</Alert>;

  const formatValue = (value: number) =>
    value >= 100 ? Math.round(value).toString() : value >= 1 ? value.toFixed(1) : value.toPrecision(2);

  return (
    <Box>
      <Box component="svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} sx={{ width: "100%", maxWidth: 780, display: "block" }}>
        {/* frame */}
        <line x1={MARGIN.left} y1={HEIGHT - MARGIN.bottom} x2={WIDTH - MARGIN.right} y2={HEIGHT - MARGIN.bottom} stroke="currentColor" strokeOpacity={0.45} />
        <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={HEIGHT - MARGIN.bottom} stroke="currentColor" strokeOpacity={0.45} />
        {plot.xTicks.map((tick) => (
          <g key={`x${tick}`}>
            <line x1={plot.x(tick)} y1={HEIGHT - MARGIN.bottom} x2={plot.x(tick)} y2={HEIGHT - MARGIN.bottom + 5} stroke="currentColor" strokeOpacity={0.45} />
            <text x={plot.x(tick)} y={HEIGHT - MARGIN.bottom + 20} textAnchor="middle" fontSize={11.5} fill="currentColor" opacity={0.75}>
              {new Date(tick).toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
            </text>
          </g>
        ))}
        <text x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={12} fill="currentColor" opacity={0.75}>
          Observation date
        </text>
        {plot.yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line
              x1={MARGIN.left - 5}
              y1={plot.y(plot.fromY(tick))}
              x2={MARGIN.left}
              y2={plot.y(plot.fromY(tick))}
              stroke="currentColor"
              strokeOpacity={0.45}
            />
            <text x={MARGIN.left - 9} y={plot.y(plot.fromY(tick)) + 4} textAnchor="end" fontSize={11} fill="currentColor" opacity={0.75}>
              {formatValue(plot.fromY(tick))}
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

        {/* connect same-band points so trends read as a curve */}
        {plot.bands.map((bandKey) => {
          const [bandName] = bandKey.split("|");
          const series = plot.points.filter((point) => `${point.band ?? "?"}` === bandName);
          if (series.length < 2) return null;
          const path = series.map((point, index) => `${index ? "L" : "M"}${plot.x(point.time)},${plot.y(point.surface_brightness)}`).join(" ");
          return <path key={bandKey} d={path} fill="none" stroke={wavelengthColor(series[0].wavelength)} strokeOpacity={0.45} strokeWidth={1.5} />;
        })}

        {plot.points.map((point) => (
          <circle
            key={point.observation_id}
            cx={plot.x(point.time)}
            cy={plot.y(point.surface_brightness)}
            r={5.5}
            fill={wavelengthColor(point.wavelength)}
            stroke="currentColor"
            strokeOpacity={0.4}
          >
            <title>
              {`${new Date(point.time).toLocaleDateString()} · ${point.surface_brightness.toPrecision(3)} MJy/sr · detector ${point.band ?? "?"} (${point.wavelength.toFixed(2)} µm)`}
            </title>
          </circle>
        ))}
      </Box>

      <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
        {plot.bands.map((bandKey) => {
          const [bandName, wavelength] = bandKey.split("|");
          return (
            <Chip
              key={bandKey}
              size="small"
              label={`Detector ${bandName} · ${wavelength} µm`}
              sx={{ bgcolor: "transparent", border: "1px solid", borderColor: "divider" }}
              icon={
                <Box component="span" sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: wavelengthColor(Number(wavelength)), ml: 0.75 }} />
              }
            />
          );
        })}
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        {spectrum?.caveats.join(" ")}
      </Typography>
    </Box>
  );
}
