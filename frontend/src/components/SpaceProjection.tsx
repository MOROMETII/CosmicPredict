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

const TERRAIN_WIDTH = 3.35;
const TERRAIN_HEIGHT = 2.2;
const TERRAIN_SEGMENTS_X = 128;
const TERRAIN_SEGMENTS_Y = 88;

const terrainVertexShader = `
  uniform sampler2D imageA;
  uniform sampler2D imageB;
  uniform float mixAmount;
  uniform float time;
  varying vec2 vUv;
  varying float vHeight;

  float sampleLuma(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  void main() {
    vUv = uv;
    vec3 colorA = texture2D(imageA, uv).rgb;
    vec3 colorB = texture2D(imageB, uv).rgb;
    float brightness = sampleLuma(mix(colorA, colorB, mixAmount));
    float relief = smoothstep(0.035, 0.92, brightness);
    float edgeFade = sin(uv.x * 3.14159265) * sin(uv.y * 3.14159265);
    float height = relief * 0.62 * edgeFade;
    vHeight = height;

    vec3 displaced = position;
    displaced.z += height;
    displaced.z += sin((uv.x + time * 0.018) * 18.0) * 0.008 * relief;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const terrainFragmentShader = `
  uniform sampler2D imageA;
  uniform sampler2D imageB;
  uniform float mixAmount;
  uniform float time;
  varying vec2 vUv;
  varying float vHeight;

  float sampleLuma(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  void main() {
    vec3 image = mix(texture2D(imageA, vUv).rgb, texture2D(imageB, vUv).rgb, mixAmount);
    float brightness = sampleLuma(image);
    vec2 gridUv = vUv * vec2(32.0, 22.0);
    vec2 grid = abs(fract(gridUv - 0.5) - 0.5);
    float line = 1.0 - smoothstep(0.46, 0.5, max(grid.x, grid.y));
    float edge = smoothstep(0.0, 0.18, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
    vec3 terrain = image * (0.78 + vHeight * 0.9);
    terrain += vec3(0.10, 0.20, 0.27) * line * 0.16 * edge;
    terrain += vec3(0.22, 0.08, 0.42) * smoothstep(0.28, 0.75, vHeight) * 0.42;
    terrain += vec3(0.12, 0.44, 0.42) * smoothstep(0.52, 0.9, brightness) * 0.24;
    float scan = 0.018 * sin((vUv.y + time * 0.025) * 420.0);
    gl_FragColor = vec4(terrain + scan, 1.0);
  }
`;

function createAnomalyMarker(candidate: Candidate): THREE.Group {
  const marker = new THREE.Group();
  const x = ((candidate.column + candidate.width / 2) / 128 - 0.5) * TERRAIN_WIDTH;
  const y = (0.5 - (candidate.row + candidate.height / 2) / 128) * TERRAIN_HEIGHT;
  const width = Math.max((candidate.width / 128) * TERRAIN_WIDTH, 0.035);
  const height = Math.max((candidate.height / 128) * TERRAIN_HEIGHT, 0.035);
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x - width / 2, y - height / 2, 0.04),
      new THREE.Vector3(x + width / 2, y - height / 2, 0.04),
      new THREE.Vector3(x + width / 2, y + height / 2, 0.04),
      new THREE.Vector3(x - width / 2, y + height / 2, 0.04),
    ]),
    new THREE.LineBasicMaterial({ color: cosmicColors.warning, transparent: true, opacity: 0.88 }),
  );
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.018, 12),
    new THREE.MeshBasicMaterial({ color: cosmicColors.warning, transparent: true, opacity: 0.85 }),
  );
  dot.position.set(x, y, 0.045);
  marker.add(outline, dot);
  return marker;
}

export default function SpaceProjection({ first, second, amount, candidates }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const terrainRef = useRef<THREE.Mesh | null>(null);
  const anomalyGroupRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const orbitStart = useRef({ x: 0, y: 0 });
  const orbitRef = useRef({ x: -0.44, y: 0.18 });
  const cameraStart = useRef({ x: 0, y: 0, z: 3.65 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#070a10");
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0.02, 3.65);
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

    const geometry = new THREE.PlaneGeometry(
      TERRAIN_WIDTH,
      TERRAIN_HEIGHT,
      TERRAIN_SEGMENTS_X,
      TERRAIN_SEGMENTS_Y,
    );
    const material = new THREE.ShaderMaterial({
      uniforms: {
        imageA: { value: new THREE.Texture() },
        imageB: { value: new THREE.Texture() },
        mixAmount: { value: 0.5 },
        time: { value: 0 },
      },
      vertexShader: terrainVertexShader,
      fragmentShader: terrainFragmentShader,
      side: THREE.DoubleSide,
    });
    const terrain = new THREE.Mesh(geometry, material);
    terrain.rotation.x = orbitRef.current.x;
    terrain.rotation.y = orbitRef.current.y;
    terrainRef.current = terrain;
    materialRef.current = material;
    scene.add(terrain);

    const floor = new THREE.GridHelper(5.5, 28, 0x25445a, 0x12202b);
    floor.position.z = -0.16;
    floor.rotation.x = Math.PI / 2;
    (floor.material as THREE.Material).transparent = true;
    (floor.material as THREE.Material).opacity = 0.28;
    scene.add(floor);

    const anomalyGroup = new THREE.Group();
    anomalyGroupRef.current = anomalyGroup;
    terrain.add(anomalyGroup);

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

    let animationFrame = 0;
    const render = (time: number) => {
      material.uniforms.time.value = time * 0.001;
      anomalyGroup.children.forEach((marker, index) => {
        const pulse = 1 + Math.sin(time * 0.003 + index) * 0.12;
        const dot = marker.children.find((child) => child instanceof THREE.Mesh);
        if (dot) dot.scale.setScalar(pulse);
      });
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    animationFrame = window.requestAnimationFrame(render);

    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrame);
      geometry.dispose();
      material.dispose();
      (material.uniforms.imageA.value as THREE.Texture).dispose();
      (material.uniforms.imageB.value as THREE.Texture).dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      anomalyGroup.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      rendererRef.current = null;
      terrainRef.current = null;
      anomalyGroupRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

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
    candidates.forEach((candidate) => group.add(createAnomalyMarker(candidate)));
  }, [candidates]);

  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    material.uniforms.mixAmount.value = amount;
  }, [amount]);

  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    const loader = new THREE.TextureLoader();
    const urls = [
      resolveAssetUrl(first?.image_url ?? null),
      resolveAssetUrl(second?.image_url ?? null),
    ];
    urls.forEach((url, index) => {
      if (!url) return;
      loader.load(url, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        const uniform = material.uniforms[index === 0 ? "imageA" : "imageB"];
        (uniform.value as THREE.Texture).dispose();
        uniform.value = texture;
      });
    });
  }, [first, second]);

  const pointerDown = (event: React.PointerEvent) => {
    setDragging(true);
    dragStart.current = { x: event.clientX, y: event.clientY };
    orbitStart.current = { ...orbitRef.current };
    cameraStart.current = {
      x: cameraRef.current?.position.x ?? 0,
      y: cameraRef.current?.position.y ?? 0,
      z: cameraRef.current?.position.z ?? 3.65,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: React.PointerEvent) => {
    if (!dragging || !terrainRef.current || !cameraRef.current) return;
    const isPan = event.buttons === 2 || event.buttons === 4 || event.shiftKey;
    if (isPan) {
      cameraRef.current.position.x = cameraStart.current.x - (event.clientX - dragStart.current.x) * 0.004;
      cameraRef.current.position.y = cameraStart.current.y + (event.clientY - dragStart.current.y) * 0.004;
      cameraRef.current.lookAt(0, 0, 0);
      return;
    }
    orbitRef.current = {
      x: Math.max(-1.1, Math.min(0.15, orbitStart.current.x + (event.clientY - dragStart.current.y) * 0.004)),
      y: orbitStart.current.y + (event.clientX - dragStart.current.x) * 0.004,
    };
    terrainRef.current.rotation.x = orbitRef.current.x;
    terrainRef.current.rotation.y = orbitRef.current.y;
  };
  const zoom = (event: React.WheelEvent) => {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.position.z = Math.max(2.15, Math.min(7, camera.position.z + event.deltaY * 0.0025));
    camera.lookAt(0, 0, 0);
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
        onContextMenu={(event) => event.preventDefault()}
        onWheel={zoom}
        sx={{
          height: { xs: 300, md: 470 },
          border: `1px solid ${cosmicColors.border}`,
          borderRadius: 2,
          bgcolor: "#070a10",
          cursor: dragging ? "grabbing" : "grab",
          overflow: "hidden",
          position: "relative",
          touchAction: "none",
        }}
      >
        <Stack direction="row" spacing={1} sx={{ position: "absolute", top: 14, left: 14, pointerEvents: "none", zIndex: 1 }}>
          <Chip label="LUMINANCE TERRAIN" size="small" sx={{ bgcolor: "rgba(5,7,8,.82)", color: cosmicColors.accent, border: `1px solid ${cosmicColors.accentStrong}` }} />
          <Chip label={`${candidates.length} ANOMALY BEACONS`} size="small" sx={{ bgcolor: "rgba(5,7,8,.82)", color: candidates.length ? cosmicColors.violet : cosmicColors.muted }} />
        </Stack>
        <Typography variant="caption" sx={{ position: "absolute", bottom: 12, left: 14, color: cosmicColors.muted, pointerEvents: "none", zIndex: 1 }}>
          Drag to orbit · Shift/right-drag to pan · wheel to zoom · scrub above to morph epochs
        </Typography>
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 1.2 }}>
        <Typography variant="caption" color="text.secondary">A · {first?.epoch ? new Date(first.epoch).toLocaleDateString() : "—"}</Typography>
        <Typography variant="caption" color="text.secondary">B · {second?.epoch ? new Date(second.epoch).toLocaleDateString() : "—"}</Typography>
      </Stack>
    </Box>
  );
}
