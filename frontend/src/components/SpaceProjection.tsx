"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Box, Chip, Stack, Typography } from "@mui/material";
import { cosmicColors } from "@/theme";
import { resolveAssetUrl, type Candidate, type Observation } from "@/services/api";

type Props = {
  first: Observation | null;
  second: Observation | null;
  amount: number;
  candidates: Candidate[];
};

const MAX_STARS = 2500;
const MIN_STAR_LUM = 0.08; // relative brightness threshold for a "detected" source
const FIELD_RADIUS = 9;
const MOVE_SPEED = 2.4;
const LOOK_SPEED = 2.2;

/**
 * A navigable 3-D star field built from the *real* observation, not synthetic
 * points. We detect local brightness maxima in the rendered SPHEREx cutout —
 * i.e. actual sources — and place one point per star at its true sky position,
 * colored by the image's wavelength-tinted pixel and sized by its real
 * intensity. The depth (z) axis is a visual aid (brightness → parallax), not a
 * physical distance; the sky itself is 2-D in these cutouts.
 */
export default function SpaceProjection({ first, second, amount, candidates }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const anomalyGroupRef = useRef<THREE.Group | null>(null);
  const keysRef = useRef<Record<string, boolean>>({});
  const yawPitchRef = useRef({ yaw: 0, pitch: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, yaw: 0, pitch: 0 });
  const [hint, setHint] = useState("Click to look · WASD to move");

  // Build the scene once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#070a10");
    // Light fog only — heavy fog washed the stars out at field distance.
    scene.fog = new THREE.FogExp2("#070a10", 0.04);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 6.5);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Soft circular glow sprite so stars render as luminous discs, not faint
    // square pixels.
    const spriteCanvas = document.createElement("canvas");
    spriteCanvas.width = spriteCanvas.height = 64;
    const spriteContext = spriteCanvas.getContext("2d");
    let spriteTexture: THREE.CanvasTexture | null = null;
    if (spriteContext) {
      const gradient = spriteContext.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.3, "rgba(255,255,255,.7)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      spriteContext.fillStyle = gradient;
      spriteContext.fillRect(0, 0, 64, 64);
      spriteTexture = new THREE.CanvasTexture(spriteCanvas);
    }

    // Point cloud (positions/colors filled from real source detection).
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(0), 3));

    const material = new THREE.PointsMaterial({
      size: 0.14,
      map: spriteTexture ?? undefined,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);
    pointsRef.current = points;

    // Anomaly markers (boxed outlines, billboarded toward the camera).
    const anomalyGroup = new THREE.Group();
    anomalyGroupRef.current = anomalyGroup;
    scene.add(anomalyGroup);

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight || 460;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const clock = new THREE.Clock();
    let animationFrame = 0;
    const render = () => {
      const dt = Math.min(clock.getDelta(), 0.1);

      // Fly movement along the camera's facing direction.
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const move = new THREE.Vector3();
      if (keysRef.current.KeyW) move.add(forward);
      if (keysRef.current.KeyS) move.sub(forward);
      if (keysRef.current.KeyA) move.sub(right);
      if (keysRef.current.KeyD) move.add(right);
      if (move.lengthSq() > 0) {
        move.y = 0;
        move.normalize().multiplyScalar(MOVE_SPEED * dt);
        camera.position.add(move);
      }
      if (keysRef.current.KeyR) camera.position.y += MOVE_SPEED * dt;
      if (keysRef.current.KeyF) camera.position.y -= MOVE_SPEED * dt;

      // Keep the field centered on the flyer (endless starfield feel).
      const horizontal = Math.hypot(camera.position.x, camera.position.z);
      if (horizontal > FIELD_RADIUS) {
        const scale = FIELD_RADIUS / horizontal;
        camera.position.x *= scale;
        camera.position.z *= scale;
      }
      camera.position.y = THREE.MathUtils.clamp(camera.position.y, -FIELD_RADIUS * 0.6, FIELD_RADIUS * 0.6);

      // Keep markers facing the camera.
      anomalyGroup.children.forEach((marker) => marker.lookAt(camera.position));

      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    animationFrame = window.requestAnimationFrame(render);

    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrame);
      geometry.dispose();
      material.dispose();
      spriteTexture?.dispose();
      anomalyGroup.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      pointsRef.current = null;
      anomalyGroupRef.current = null;
    };
  }, []);

  // Detect real sources in the blended observation and build the point cloud
  // from their actual sky positions and intensities.
  useEffect(() => {
    const points = pointsRef.current;
    if (!points) return;

    const urls = [
      resolveAssetUrl(first?.image_url ?? null),
      resolveAssetUrl(second?.image_url ?? null),
    ];
    if (!urls[0] && !urls[1]) return;

    const imageA = urls[0] ? new Image() : null;
    const imageB = urls[1] ? new Image() : null;
    const loaded: (HTMLImageElement | null)[] = [null, null];

    const render = () => {
      if ((imageA && !loaded[0]) || (imageB && !loaded[1])) return;
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (loaded[0]) {
        ctx.globalAlpha = imageB ? 1 - amount : 1;
        ctx.drawImage(loaded[0], 0, 0, size, size);
      }
      if (loaded[1]) {
        ctx.globalAlpha = imageA ? amount : 1;
        ctx.drawImage(loaded[1], 0, 0, size, size);
      }
      ctx.globalAlpha = 1;
      const data = ctx.getImageData(0, 0, size, size).data;

      // Luminance map (0..1) over the rendered frame.
      const lum = new Float32Array(size * size);
      for (let p = 0; p < size * size; p++) {
        lum[p] = (data[p * 4] + data[p * 4 + 1] + data[p * 4 + 2]) / 3 / 255;
      }

      // Detect local brightness maxima (real sources): a pixel brighter than
      // its 8 neighbours and above the threshold. This yields one point per
      // star rather than a filled blob, and only at true source locations.
      const detections: { x: number; y: number; lum: number }[] = [];
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          const c = lum[y * size + x];
          if (c < MIN_STAR_LUM) continue;
          if (
            c >= lum[(y - 1) * size + (x - 1)] &&
            c >= lum[(y - 1) * size + x] &&
            c >= lum[(y - 1) * size + (x + 1)] &&
            c >= lum[y * size + (x - 1)] &&
            c >= lum[y * size + (x + 1)] &&
            c >= lum[(y + 1) * size + (x - 1)] &&
            c >= lum[(y + 1) * size + x] &&
            c >= lum[(y + 1) * size + (x + 1)]
          ) {
            detections.push({ x, y, lum: c });
          }
        }
      }
      // Keep the brightest sources so the field stays readable.
      detections.sort((a, b) => b.lum - a.lum);
      const stars = detections.slice(0, MAX_STARS);

      const positions = new Float32Array(stars.length * 3);
      const colors = new Float32Array(stars.length * 3);
      for (let i = 0; i < stars.length; i++) {
        const { x, y, lum: brightness } = stars[i];
        const fx = x / size;
        const fy = y / size;
        const idx = (y * size + x) * 4;
        const depth = -2.5 + brightness * 7;
        positions[i * 3] = (fx - 0.5) * FIELD_RADIUS;
        positions[i * 3 + 1] = (0.5 - fy) * FIELD_RADIUS * 0.62;
        positions[i * 3 + 2] = depth;
        // Lift the stretched pixel values so faint real sources stay visible
        // while the hue (the wavelength tint) is preserved.
        colors[i * 3] = Math.min(1, Math.pow(data[idx] / 255, 0.6) * 1.35);
        colors[i * 3 + 1] = Math.min(1, Math.pow(data[idx + 1] / 255, 0.6) * 1.35);
        colors[i * 3 + 2] = Math.min(1, Math.pow(data[idx + 2] / 255, 0.6) * 1.35);
      }

      const geometry = points.geometry as THREE.BufferGeometry;
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    };

    if (imageA) {
      imageA.onload = () => {
        loaded[0] = imageA;
        render();
      };
      imageA.crossOrigin = "anonymous";
      imageA.src = urls[0] as string;
    }
    if (imageB) {
      imageB.onload = () => {
        loaded[1] = imageB;
        render();
      };
      imageB.crossOrigin = "anonymous";
      imageB.src = urls[1] as string;
    }
    render();
  }, [first, second, amount]);

  // Anomaly markers (fixed sky-grid positions derived from candidates).
  useEffect(() => {
    const group = anomalyGroupRef.current;
    if (!group) return;
    while (group.children.length) {
      const child = group.children.pop();
      child?.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
    }
    candidates.forEach((candidate) => {
      const x = ((candidate.column + candidate.width / 2) / 256 - 0.5) * FIELD_RADIUS;
      const y = (0.5 - (candidate.row + candidate.height / 2) / 256) * FIELD_RADIUS * 0.62;
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.09, 0.11, 32),
        new THREE.MeshBasicMaterial({ color: cosmicColors.warning, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      );
      marker.position.set(x, y, -1.5);
      group.add(marker);
    });
  }, [candidates]);

  // Keyboard handling.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      keysRef.current[event.code] = true;
      if (event.code === "ArrowLeft") yawPitchRef.current.yaw += LOOK_SPEED * 0.05;
      if (event.code === "ArrowRight") yawPitchRef.current.yaw -= LOOK_SPEED * 0.05;
    };
    const up = (event: KeyboardEvent) => {
      keysRef.current[event.code] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const pointerDown = (event: React.PointerEvent) => {
    setDragging(true);
    dragStart.current = { x: event.clientX, y: event.clientY, yaw: yawPitchRef.current.yaw, pitch: yawPitchRef.current.pitch };
    setHint("Drag to look · WASD to move");
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: React.PointerEvent) => {
    if (!dragging || !cameraRef.current) return;
    const dx = event.clientX - dragStart.current.x;
    const dy = event.clientY - dragStart.current.y;
    yawPitchRef.current.yaw = dragStart.current.yaw - dx * 0.004;
    yawPitchRef.current.pitch = THREE.MathUtils.clamp(dragStart.current.pitch - dy * 0.004, -1.2, 1.2);
    const euler = new THREE.Euler(yawPitchRef.current.pitch, yawPitchRef.current.yaw, 0, "YXZ");
    cameraRef.current.quaternion.setFromEuler(euler);
  };

  return (
    <Box>
      <Box
        ref={hostRef}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
        tabIndex={0}
        sx={{
          height: { xs: 300, md: 470 },
          border: `1px solid ${cosmicColors.border}`,
          borderRadius: 2,
          bgcolor: "#070a10",
          cursor: dragging ? "grabbing" : "grab",
          overflow: "hidden",
          position: "relative",
          touchAction: "none",
          outline: "none",
        }}
      >
        <Stack direction="row" spacing={1} sx={{ position: "absolute", top: 14, left: 14, pointerEvents: "none", zIndex: 1 }}>
          <Chip label="3-D star field · real sources" size="small" sx={{ bgcolor: "rgba(5,7,8,.82)", color: cosmicColors.accent, border: `1px solid ${cosmicColors.accentStrong}` }} />
          {candidates.length > 0 && <Chip label={`${candidates.length} flagged regions`} size="small" sx={{ bgcolor: "rgba(5,7,8,.82)", color: cosmicColors.danger }} />}
        </Stack>
        <Typography variant="caption" sx={{ position: "absolute", bottom: 12, left: 14, color: cosmicColors.muted, pointerEvents: "none", zIndex: 1 }}>
          {hint}
        </Typography>
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 1.2 }}>
        <Typography variant="caption" color="text.secondary">A · {first?.epoch ? new Date(first.epoch).toLocaleDateString() : "—"}</Typography>
        <Typography variant="caption" color="text.secondary">B · {second?.epoch ? new Date(second.epoch).toLocaleDateString() : "—"}</Typography>
      </Stack>
    </Box>
  );
}
