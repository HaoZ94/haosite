import * as THREE from 'three';
import brainAssetUrl from './assets/brain-fsaverage5.json?url';
import lowerAnatomyAssetUrl from './assets/brain-subcortical.json?url';
import hippocampusAssetUrl from './assets/brain-hippocampus.json?url';
import regionAssetUrl from './assets/brain-regions.json?url';
import regionSolidsUrl from './assets/brain-region-solids.json.gz?url';
import { createBrainNetwork, findNearestVertex, planBrainSignal, SIGNAL_SPEED } from './brain-network';
import type { BrainNetwork, BrainRegionId } from './brain-network';
import { applyExpansion, createCorticalPieces, createLowerPiece, createSignalOffsets, createSignalNormals, setCorticalSurface, REGION_STYLES } from './brain-anatomy-view';
import type { AnatomyPiece, CortexAtlas, RegionVolume } from './brain-anatomy-view';
import { BrainSurfaceTransition, corticalSurfaceBlend } from './brain-surface-transition';

interface SurfaceData {
  positions: number[];
  indices: number[];
  sulc: number[];
}

interface BrainData {
  hemispheres: { left: SurfaceData; right: SurfaceData };
}

interface AnatomySurface {
  positions: number[];
  indices: number[];
  normals?: number[];
}

interface LowerAnatomyData {
  parts: {
    cerebellumLeft: AnatomySurface;
    cerebellumRight: AnatomySurface;
    brainstem: AnatomySurface;
  };
}

interface LowerAnatomy {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  kind: 'cerebellum' | 'brainstem' | 'hippocampus';
}

interface HippocampusData {
  parts: { hippocampusLeft: AnatomySurface; hippocampusRight: AnatomySurface };
}

interface Cortex {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  positions: Float32Array;
  normals: Float32Array;
  neighbors: number[][];
  sulc: number[];
  curvature: Float32Array;
  baseColors: Float32Array;
}

interface SurfaceSignal {
  group: THREE.Group;
  materials: THREE.ShaderMaterial[];
  geometries: THREE.BufferGeometry[];
  paths: number[][];
  distances: Float64Array;
  network: BrainNetwork;
  offsets: Float32Array;
  translations: Float32Array;
  targetNormals: Float32Array;
  expansion: THREE.IUniform<number>;
  surfaceBlend: THREE.IUniform<number>;
  heads: { points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>; lower: boolean }[];
  age: number;
  duration: number;
  static: boolean;
}

interface PointerState {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  dragging: boolean;
  scrolling: boolean;
  type: string;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const vertex = (positions: Float32Array, index: number): THREE.Vector3 => new THREE.Vector3().fromArray(positions, index * 3);
const MAX_VISIBLE_SIGNALS = 8;

function transformPositions(source: number[]): Float32Array {
  const positions = new Float32Array(source.length);
  for (let offset = 0; offset < positions.length; offset += 3) {
    positions[offset] = source[offset] / 100;
    positions[offset + 1] = (source[offset + 2] - 15) / 100;
    positions[offset + 2] = -(source[offset + 1] + 18) / 100;
  }
  return positions;
}

function transformNormals(source: ArrayLike<number>): Float32Array {
  const normals = new Float32Array(source.length);
  for (let offset = 0; offset < normals.length; offset += 3) {
    normals[offset] = source[offset];
    normals[offset + 1] = source[offset + 2];
    normals[offset + 2] = -source[offset + 1];
  }
  return normals;
}

/** These surfaces share fsaverage surface RAS, so no visual alignment offsets are needed. */
function createLowerAnatomy(data: AnatomySurface, kind: LowerAnatomy['kind']): LowerAnatomy {
  if (data.positions.length % 3 || data.indices.length % 3) throw new Error('Invalid anatomical surface.');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(transformPositions(data.positions), 3));
  geometry.setIndex(data.indices);
  if (data.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(transformNormals(data.normals), 3));
  else geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshPhysicalMaterial({
    roughness: kind === 'brainstem' ? 0.43 : 0.54,
    metalness: 0.015,
    clearcoat: 0.45,
    clearcoatRoughness: 0.30,
    transparent: true,
    opacity: kind === 'brainstem' ? 0.94 : 0.89,
    depthWrite: true,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // Lower anatomy is composed first, so it remains visible through the translucent cortex.
  mesh.renderOrder = 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, kind };
}

/** Pial geometry in RAS millimeters becomes a right-handed, Y-up scene. */
function createCortex(data: SurfaceData, expansion: THREE.IUniform<number>): Cortex {
  if (data.positions.length % 3 || data.indices.length % 3 || data.sulc.length !== data.positions.length / 3) {
    throw new Error('The cortical surface has an invalid format.');
  }
  const positions = transformPositions(data.positions);
  const neighbors = Array.from({ length: data.sulc.length }, () => new Set<number>());
  for (let offset = 0; offset < data.indices.length; offset += 3) {
    const triangle = [data.indices[offset], data.indices[offset + 1], data.indices[offset + 2]];
    for (let index = 0; index < 3; index += 1) {
      neighbors[triangle[index]].add(triangle[(index + 1) % 3]);
      neighbors[triangle[index]].add(triangle[(index + 2) % 3]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
  geometry.setIndex(data.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const normals = geometry.getAttribute('normal').array as Float32Array;
  const curvature = new Float32Array(data.sulc.length);
  const adjacency = neighbors.map((set) => [...set]);
  for (let index = 0; index < adjacency.length; index += 1) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const neighbor of adjacency[index]) {
      x += positions[neighbor * 3];
      y += positions[neighbor * 3 + 1];
      z += positions[neighbor * 3 + 2];
    }
    const count = adjacency[index].length;
    curvature[index] = (
      (positions[index * 3] - x / count) * normals[index * 3]
      + (positions[index * 3 + 1] - y / count) * normals[index * 3 + 1]
      + (positions[index * 3 + 2] - z / count) * normals[index * 3 + 2]
    );
  }
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.36,
    metalness: 0.025,
    clearcoat: 0.82,
    clearcoatRoughness: 0.24,
    ior: 1.42,
    specularIntensity: 0.82,
    transparent: true,
    opacity: 0.66,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.corticalSolidity = expansion;
    shader.fragmentShader = `uniform float corticalSolidity;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
        float corticalFresnel = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
        diffuseColor.a *= mix(0.72 + corticalFresnel * 0.28, 1.0, corticalSolidity);
        #include <opaque_fragment>
      `,
    );
  };
  material.customProgramCacheKey = () => 'frosted-to-solid-cortex-v2';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 3;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Paint a faint inner shell before the nearest surface. The depth-only pass
  // prevents transparency from turning thousands of unsorted folds into a haze,
  // while anatomy already drawn underneath remains visible through the cortex.
  const innerShell = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true,
    color: '#b3d7d4',
    transparent: true,
    opacity: 0.085,
    depthWrite: false,
    side: THREE.BackSide,
  }));
  innerShell.renderOrder = 1;
  const surfaceDepth = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 1,
    colorWrite: false,
    depthWrite: true,
    side: THREE.FrontSide,
  }));
  surfaceDepth.renderOrder = 2;
  mesh.add(innerShell, surfaceDepth);
  return { mesh, positions, normals, neighbors: adjacency, sulc: data.sulc, curvature, baseColors: new Float32Array(positions.length) };
}

const trailVertexShader = `
  attribute float surfaceDistance;
  attribute vec3 expansionOffset;
  attribute vec3 surfaceOffset;
  attribute float expansionOnly;
  uniform float expansion;
  uniform float surfaceBlend;
  varying float vDistance;
  varying float vExpansionVisibility;
  void main() {
    vDistance = surfaceDistance;
    vExpansionVisibility = mix(1.0, clamp(expansion, 0.0, 1.0) * surfaceBlend, expansionOnly);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position + expansionOffset * expansion + surfaceOffset * surfaceBlend, 1.0);
  }
`;

const trailFragmentShader = `
  uniform float progress;
  uniform float opacity;
  uniform vec3 color;
  varying float vDistance;
  varying float vExpansionVisibility;
  void main() {
    float behind = progress - vDistance;
    float head = exp(-pow(behind / 0.045, 2.0));
    float trail = step(0.0, behind) * exp(-behind * 10.0);
    float strength = max(head, trail * 0.76) * vExpansionVisibility;
    if (strength < 0.012) discard;
    gl_FragColor = vec4(color, strength * opacity);
  }
`;

const isLowerVertex = (network: BrainNetwork, index: number): boolean => !network.regionByVertex[index].startsWith('cortex');
const isHippocampalVertex = (network: BrainNetwork, index: number): boolean => network.regionByVertex[index].startsWith('hippocampus');

function createSignal(network: BrainNetwork, source: number, pixelRatio: number, offsets: Float32Array, translations: Float32Array, targetNormals: Float32Array, expansion: THREE.IUniform<number>, surfaceBlend: THREE.IUniform<number>): SurfaceSignal {
  const { paths, distances, duration } = planBrainSignal(network, source);
  const uniqueEdges = new Map<string, [number, number]>();
  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) {
      const a = path[index - 1];
      const b = path[index];
      uniqueEdges.set(`${Math.min(a, b)}:${Math.max(a, b)}`, [a, b]);
    }
  }
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.ShaderMaterial[] = [];
  const heads: SurfaceSignal['heads'] = [];
  for (const lower of [true, false]) {
    for (const [width, opacity] of [[0.018, 0.18], [0.0045, 0.98]]) {
      const positions: number[] = [];
      const surfaceDistances: number[] = [];
      const expansionOffsets: number[] = [];
      const surfaceOffsets: number[] = [];
      const expansionOnlyFlags: number[] = [];
      for (const [a, b] of uniqueEdges.values()) {
        if ((isLowerVertex(network, a) || isLowerVertex(network, b)) !== lower) continue;
        // Hide the whole hippocampal edge, including its cortical bridge, until
        // its anatomy is revealed. Existing signals share the expansion value.
        const expansionOnly = isHippocampalVertex(network, a) || isHippocampalVertex(network, b) ? 1 : 0;
        const pa = vertex(network.positions, a);
        const pb = vertex(network.positions, b);
        const na = vertex(network.normals, a);
        const nb = vertex(network.normals, b);
        const tangent = pb.clone().sub(pa).normalize();
        const ribbonSide = (normal: THREE.Vector3): THREE.Vector3 => {
          const side = new THREE.Vector3().crossVectors(normal, tangent);
          // Illustrative bridges may align with a surface normal; use a stable
          // perpendicular so those inter-region ribbons never collapse to zero width.
          if (side.lengthSq() < 0.000001) side.crossVectors(tangent, Math.abs(tangent.y) < 0.9
            ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
          return side.normalize().multiplyScalar(width);
        };
        const sideA = ribbonSide(na);
        const sideB = ribbonSide(nb);
        if (sideA.dot(sideB) < 0) sideB.negate();
        pa.addScaledVector(na, 0.008);
        pb.addScaledVector(nb, 0.008);
        const corners = [pa.clone().add(sideA), pa.clone().sub(sideA), pb.clone().add(sideB), pb.clone().sub(sideB)];
        for (const index of [0, 1, 2, 2, 1, 3]) {
          positions.push(corners[index].x, corners[index].y, corners[index].z);
          surfaceDistances.push(distances[index < 2 ? a : b]);
          expansionOnlyFlags.push(expansionOnly);
          const source = index < 2 ? a : b;
          const offset = source * 3;
          const normal = index < 2 ? na : nb;
          for (let axis = 0; axis < 3; axis += 1) {
            const displacement = offsets[offset + axis] + targetNormals[offset + axis] * 0.014 - normal.getComponent(axis) * 0.008;
            const lowerEndpoint = isLowerVertex(network, source);
            expansionOffsets.push(lowerEndpoint ? displacement : translations[offset + axis]);
            surfaceOffsets.push(lowerEndpoint ? 0 : displacement - translations[offset + axis]);
          }
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('surfaceDistance', new THREE.Float32BufferAttribute(surfaceDistances, 1));
      geometry.setAttribute('expansionOffset', new THREE.Float32BufferAttribute(expansionOffsets, 3));
      geometry.setAttribute('surfaceOffset', new THREE.Float32BufferAttribute(surfaceOffsets, 3));
      geometry.setAttribute('expansionOnly', new THREE.Float32BufferAttribute(expansionOnlyFlags, 1));
      const material = new THREE.ShaderMaterial({
        uniforms: {
          progress: { value: 0 }, opacity: { value: opacity }, expansion, surfaceBlend,
          color: { value: new THREE.Color(width < 0.01 ? '#ffdc9b' : '#ffa955') },
        },
        vertexShader: trailVertexShader,
        fragmentShader: trailFragmentShader,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      // Lower signals compose with the lower anatomy before the cortex depth pass.
      // They retain self-occlusion and remain visible through the frosted cortex.
      mesh.renderOrder = lower ? (width < 0.01 ? 0.3 : 0.2) : (width < 0.01 ? 5 : 4);
      group.add(mesh);
      materials.push(material);
      geometries.push(geometry);
    }
    const headGeometry = new THREE.BufferGeometry();
    headGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(paths.length * 3), 3));
    headGeometry.setAttribute('visibility', new THREE.BufferAttribute(new Float32Array(paths.length), 1));
    const headMaterial = new THREE.ShaderMaterial({
      uniforms: { pixelRatio: { value: pixelRatio } },
      vertexShader: `
        attribute float visibility;
        uniform float pixelRatio;
        varying float vVisibility;
        void main() {
          vVisibility = visibility;
          gl_PointSize = 20.0 * pixelRatio;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vVisibility;
        void main() {
          float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
          float halo = exp(-radius * radius * 6.5) * 0.42;
          float core = exp(-radius * radius * 65.0);
          float alpha = (halo + core) * vVisibility;
          if (alpha < 0.008) discard;
          gl_FragColor = vec4(1.0, 0.77 + core * 0.21, 0.40 + core * 0.48, alpha);
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const points = new THREE.Points(headGeometry, headMaterial);
    points.frustumCulled = false;
    points.renderOrder = lower ? 0.4 : 6;
    group.add(points);
    heads.push({ points, lower });
    materials.push(headMaterial);
    geometries.push(headGeometry);
  }
  return { group, materials, geometries, paths, distances, network, offsets, translations, targetNormals, expansion, surfaceBlend, heads, age: 0, duration, static: false };
}

function updateSignal(signal: SurfaceSignal): void {
  const progress = signal.static ? 0 : signal.age * SIGNAL_SPEED;
  for (const material of signal.materials) {
    if (material.uniforms.progress) material.uniforms.progress.value = progress;
  }
  for (const layer of signal.heads) {
    const positions = layer.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const visibility = layer.points.geometry.getAttribute('visibility') as THREE.BufferAttribute;
    for (let pathIndex = 0; pathIndex < signal.paths.length; pathIndex += 1) {
      const path = signal.paths[pathIndex];
      const end = signal.distances[path[path.length - 1]];
      if (progress > end || path.length < 2) { visibility.setX(pathIndex, 0); continue; }
      let step = 1;
      while (step < path.length - 1 && signal.distances[path[step]] < progress) step += 1;
      const a = path[step - 1];
      const b = path[step];
      const lower = isLowerVertex(signal.network, a) || isLowerVertex(signal.network, b);
      if (layer.lower !== lower) { visibility.setX(pathIndex, 0); continue; }
      const expansionVisibility = isHippocampalVertex(signal.network, a) || isHippocampalVertex(signal.network, b)
        ? clamp(signal.expansion.value, 0, 1) * signal.surfaceBlend.value : 1;
      if (expansionVisibility === 0) { visibility.setX(pathIndex, 0); continue; }
      const mix = clamp((progress - signal.distances[a]) / (signal.distances[b] - signal.distances[a]), 0, 1);
      const surfacePoint = (index: number): THREE.Vector3 => {
        const amount = signal.expansion.value;
        const surfaceAmount = isLowerVertex(signal.network, index) ? amount : signal.surfaceBlend.value;
        const translation = vertex(signal.translations, index);
        const deformation = vertex(signal.offsets, index).sub(translation);
        const normal = vertex(signal.network.normals, index).lerp(vertex(signal.targetNormals, index), surfaceAmount).normalize();
        return vertex(signal.network.positions, index).addScaledVector(translation, amount)
          .addScaledVector(deformation, surfaceAmount).addScaledVector(normal, 0.012);
      };
      const point = surfacePoint(a).lerp(surfacePoint(b), mix);
      positions.setXYZ(pathIndex, point.x, point.y, point.z);
      visibility.setX(pathIndex, expansionVisibility * (signal.static ? 1 : Math.min(1, signal.age * 5)));
    }
    positions.needsUpdate = true;
    visibility.needsUpdate = true;
  }
}

export function initBrainAnimation(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('canvas.brain-canvas');
  if (!canvas || root.dataset.brainInitialized) return;
  root.dataset.brainInitialized = 'true';
  canvas.setAttribute('aria-busy', 'true');
  const pulseButton = root.querySelector<HTMLButtonElement>('[data-brain-pulse]');
  const toggleButton = root.querySelector<HTMLButtonElement>('[data-brain-toggle]');
  const expandButton = root.querySelector<HTMLButtonElement>('[data-brain-expand]');
  const regionLegend = root.querySelector<HTMLElement>('[data-brain-regions]');
  const regionLabel = root.querySelector<HTMLElement>('[data-brain-region-label]');
  const status = root.querySelector<HTMLElement>('[data-brain-status]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (pulseButton) pulseButton.disabled = true;
  if (toggleButton) toggleButton.disabled = true;
  if (expandButton) expandButton.disabled = true;
  let renderer: THREE.WebGLRenderer;
  let frame = 0;
  let failed = false;
  let ready = false;
  let visible = true;
  let paused = false;
  let width = 0;
  let height = 0;
  let lastFrame = 0;
  let rotationClock = 0;
  let yaw = -1.55;
  let pitch = -0.12;
  let automaticSignalAge = 0;
  let pointer: PointerState | null = null;
  let signals: SurfaceSignal[] = [];
  let network: BrainNetwork;
  let offsets: Float32Array;
  let translations: Float32Array;
  let targetNormals: Float32Array;
  let expanded = false;
  let renderedExpansion = -1;
  const expansion = { value: 0 };
  const surfaceBlend = { value: 0 };
  const selectableSurfaces: AnatomyPiece[] = [];
  const cortices: Cortex[] = [];
  const lowerAnatomy: LowerAnatomy[] = [];
  const scene = new THREE.Scene();
  const brain = new THREE.Group();
  brain.position.y = 0.10;
  const camera = new THREE.OrthographicCamera(-1.3, 1.3, 1.1, -1.1, 0.1, 15);
  camera.position.set(0, 0, 4);
  camera.lookAt(0, 0, 0);
  scene.add(brain);
  const ambient = new THREE.HemisphereLight('#e4f5f6', '#354543', 1.45);
  const key = new THREE.DirectionalLight('#ecf4ec', 3.1);
  key.position.set(-3, 4, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -1.5;
  key.shadow.camera.right = 1.5;
  key.shadow.camera.top = 1.5;
  key.shadow.camera.bottom = -1.5;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 12;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.006;
  const rim = new THREE.DirectionalLight('#85c1ca', 2.0);
  rim.position.set(3, 1, -3);
  const fill = new THREE.DirectionalLight('#d8e7df', 0.55);
  fill.position.set(3, -1, 3);
  scene.add(ambient, key, rim, fill);
  const raycaster = new THREE.Raycaster();

  const announce = (message: string): void => { if (status) status.textContent = message; };
  const motionAllowed = (): boolean => !paused && !reducedMotion.matches;
  const canAnimate = (): boolean => ready && !failed && motionAllowed() && visible && !document.hidden && width > 0 && height > 0;

  function fail(): void {
    failed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    root.dataset.brainError = 'true';
    delete root.dataset.brainReady;
    canvas!.setAttribute('aria-busy', 'false');
    canvas!.removeAttribute('tabindex');
    canvas!.setAttribute('aria-label', 'The interactive brain preview is unavailable.');
    canvas!.style.visibility = 'hidden';
    if (pulseButton) pulseButton.disabled = true;
    if (toggleButton) toggleButton.disabled = true;
    if (expandButton) expandButton.disabled = true;
    if (regionLegend) regionLegend.hidden = true;
    if (regionLabel) regionLabel.hidden = true;
    const fallback = root.querySelector<HTMLElement>('.brain-loading') ?? document.createElement('p');
    fallback.className = 'brain-loading brain-fallback';
    fallback.textContent = 'The interactive brain could not load. Refresh to try again, or use a browser with 3D graphics support.';
    if (!fallback.parentNode) root.insertBefore(fallback, canvas!);
    announce('The interactive brain is unavailable.');
  }

  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  } catch {
    fail();
    return;
  }
  const surfaceTransition = new BrainSurfaceTransition(renderer);

  function render(): void {
    if (failed || !width || !height) return;
    if (renderedExpansion !== expansion.value) {
      for (const cortex of cortices) {
        const colors = cortex.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
        for (let index = 0; index < colors.count; index += 1) {
          const offset = index * 3;
          const r = cortex.baseColors[offset];
          const g = cortex.baseColors[offset + 1];
          const b = cortex.baseColors[offset + 2];
          const shade = Math.min(1, (r + g + b) / 3 * 1.25);
          colors.setXYZ(index,
            THREE.MathUtils.lerp(r, shade, expansion.value),
            THREE.MathUtils.lerp(g, shade, expansion.value),
            THREE.MathUtils.lerp(b, shade, expansion.value));
        }
        colors.needsUpdate = true;
      }
      applyExpansion(selectableSurfaces, expansion.value);
      camera.zoom = 1 / (1 + expansion.value * 0.35);
      camera.updateProjectionMatrix();
      renderedExpansion = expansion.value;
    }
    brain.rotation.set(
      pitch + Math.sin(rotationClock * 0.16) * 0.018,
      yaw + Math.sin(rotationClock * 0.20) * 0.12,
      -0.045,
    );
    const blend = corticalSurfaceBlend(expansion.value);
    surfaceTransition.render(blend, (solid) => {
      setCorticalSurface(selectableSurfaces, solid);
      surfaceBlend.value = solid ? 1 : 0;
      for (const signal of signals) updateSignal(signal);
      renderer.render(scene, camera);
    });
    // Picking uses the more visible surface. Existing signal paths retain the
    // continuous blend between frames, including when a transition reverses.
    setCorticalSurface(selectableSurfaces, blend >= 0.5);
    surfaceBlend.value = blend;
    for (const signal of signals) updateSignal(signal);
    if (ready) {
      root.dataset.brainReady = 'true';
      canvas!.setAttribute('aria-busy', 'false');
    }
  }

  function updateTheme(): void {
    const dark = document.documentElement.dataset.theme !== 'light';
    const ridge = new THREE.Color(dark ? '#a9c8c5' : '#8faeaa');
    const sulcus = new THREE.Color(dark ? '#466a70' : '#4e7270');
    for (const cortex of cortices) {
      const colors = cortex.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const color = new THREE.Color();
      for (let index = 0; index < cortex.sulc.length; index += 1) {
        const sulcalShade = clamp(0.49 - cortex.sulc[index] * 0.21, 0.10, 0.94);
        const localShape = clamp(cortex.curvature[index] * 45, -0.24, 0.24);
        color.copy(sulcus).lerp(ridge, clamp(sulcalShade + localShape, 0.06, 1));
        colors.setXYZ(index, color.r, color.g, color.b);
      }
      colors.needsUpdate = true;
      cortex.baseColors.set(colors.array);
    }
    for (const part of lowerAnatomy) {
      part.mesh.material.color.set(part.kind === 'hippocampus' ? dark ? '#d69a87' : '#bb816e' : part.kind === 'brainstem'
        ? dark ? '#adc1b1' : '#91aa9e'
        : dark ? '#799eaa' : '#7c9da3');
    }
    for (const piece of selectableSurfaces) {
      if (!piece.region.startsWith('cortex')) piece.baseColor.copy(piece.mesh.material.color);
    }
    renderedExpansion = -1;
    ambient.intensity = dark ? 1.45 : 1.7;
    key.intensity = dark ? 3.1 : 2.7;
    rim.intensity = dark ? 2.0 : 1.1;
    render();
  }

  function disposeSignal(signal: SurfaceSignal): void {
    brain.remove(signal.group);
    signal.geometries.forEach((geometry) => geometry.dispose());
    signal.materials.forEach((material) => material.dispose());
  }

  function defaultSource(): number {
    return findNearestVertex(network, 'cortexRight', [0.53, 0.06, -0.30]);
  }

  function sendSignal(source?: number, userInitiated = true, sourceLabel?: string): void {
    if (!ready || failed) return;
    const requestedOrigin = source ?? defaultSource();
    const origin = !expanded && expansion.value === 0 && isHippocampalVertex(network, requestedOrigin)
      ? defaultSource() : requestedOrigin;
    const regionNames: Record<BrainRegionId, string> = {
      cortexLeft: 'left cerebral hemisphere', cortexRight: 'right cerebral hemisphere',
      cerebellumLeft: 'left cerebellum', cerebellumRight: 'right cerebellum', brainstem: 'brainstem',
      hippocampusLeft: 'left hippocampus', hippocampusRight: 'right hippocampus',
    };
    const sourceName = (origin === requestedOrigin ? sourceLabel : undefined) ?? (expanded
      ? selectableSurfaces.find((piece) => piece.key !== 'medial-wall' && piece.source === origin)?.name ?? regionNames[network.regionByVertex[origin]]
      : regionNames[network.regionByVertex[origin]]);
    if (!motionAllowed()) {
      signals.forEach(disposeSignal);
      signals = [];
    } else {
      // Every click starts immediately. Retire the oldest visual when busy so
      // repeated input never builds a backlog or grows GPU resources without bound.
      while (signals.length >= MAX_VISIBLE_SIGNALS) disposeSignal(signals.shift()!);
    }
    const signal = createSignal(network, origin, renderer.getPixelRatio(), offsets, translations, targetNormals, expansion, surfaceBlend);
    signal.age = 0.035;
    signal.static = !motionAllowed();
    signals.push(signal);
    brain.add(signal.group);
    updateSignal(signal);
    automaticSignalAge = 0;
    if (userInitiated) announce(motionAllowed()
      ? `Signal started in the ${sourceName} and is travelling through the brain.`
      : `Signal highlighted in the ${sourceName}. Motion is paused.`);
    render();
    schedule();
  }

  function tick(timestamp: number): void {
    frame = 0;
    if (!canAnimate()) { lastFrame = 0; return; }
    if (lastFrame && timestamp - lastFrame < 1000 / 36) { schedule(); return; }
    const delta = lastFrame ? Math.min((timestamp - lastFrame) / 1000, 0.07) : 0;
    lastFrame = timestamp;
    const targetExpansion = expanded ? 1 : 0;
    expansion.value += (targetExpansion - expansion.value) * (1 - Math.exp(-delta * 7));
    if (Math.abs(expansion.value - targetExpansion) < 0.001) expansion.value = targetExpansion;
    if (!pointer?.dragging) rotationClock += delta;
    for (const signal of signals) { signal.age += delta; updateSignal(signal); }
    signals = signals.filter((signal) => {
      if (signal.age < signal.duration) return true;
      disposeSignal(signal);
      return false;
    });
    automaticSignalAge += delta;
    // Start the next automatic journey only after every branch has reached its endpoint.
    if (automaticSignalAge > 6.5 && signals.length === 0) sendSignal(undefined, false);
    render();
    schedule();
  }

  function schedule(): void {
    if (canAnimate() && !frame) frame = requestAnimationFrame(tick);
  }

  function syncMotion(): void {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
    const stopped = !motionAllowed();
    if (stopped) expansion.value = expanded ? 1 : 0;
    if (!stopped) for (const signal of signals) signal.static = false;
    root.dataset.brainPaused = String(stopped);
    if (toggleButton) {
      toggleButton.disabled = !ready || failed || reducedMotion.matches;
      toggleButton.setAttribute('aria-pressed', String(stopped));
      toggleButton.textContent = reducedMotion.matches ? 'Motion reduced' : paused ? 'Resume motion' : 'Pause motion';
    }
    render();
    schedule();
  }

  function resize(): void {
    if (failed) return;
    const bounds = canvas!.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const viewHeight = Math.max(2.10, 2.20 / aspect);
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.left = -viewHeight * aspect / 2;
    camera.right = viewHeight * aspect / 2;
    camera.updateProjectionMatrix();
    for (const signal of signals) {
      for (const layer of signal.heads) layer.points.material.uniforms.pixelRatio.value = renderer.getPixelRatio();
    }
    render();
    schedule();
  }

  function surfaceAt(clientX: number, clientY: number): { hit: THREE.Intersection; surface: AnatomyPiece } | null {
    if (!ready || failed || !width || !height) return null;
    const bounds = canvas!.getBoundingClientRect();
    const pointerPosition = new THREE.Vector2((clientX - bounds.left) / width * 2 - 1, -(clientY - bounds.top) / height * 2 + 1);
    raycaster.setFromCamera(pointerPosition, camera);
    brain.updateWorldMatrix(true, true);
    const hitMeshes = selectableSurfaces.filter((surface) => surface.mesh.visible && (!expanded || surface.key !== 'medial-wall')).map((surface) => surface.mesh);
    const hits = raycaster.intersectObjects(hitMeshes, false);
    // Lower anatomy is visible through the glass cortex. In an overlap, prefer
    // that visible lower structure so a tap does not silently select the cortex.
    const hit = (expanded ? undefined : hits.find((candidate) => selectableSurfaces.some((surface) => surface.mesh === candidate.object && !surface.region.startsWith('cortex')))) ?? hits[0];
    if (!hit?.face) return null;
    const surface = selectableSurfaces.find((candidate) => candidate.mesh === hit.object)!;
    return { hit, surface };
  }

  function showRegion(piece?: AnatomyPiece): void {
    if (piece?.key === 'medial-wall') piece = undefined;
    if (regionLabel) regionLabel.textContent = piece?.name ?? 'Explore the brain’s regions';
    regionLegend?.querySelectorAll<HTMLElement>('[data-region]').forEach((label) => {
      label.dataset.active = String(label.dataset.region === piece?.key);
    });
  }

  function signalAt(clientX: number, clientY: number): void {
    const selected = surfaceAt(clientX, clientY);
    if (!selected) { sendSignal(); return; }
    const { hit, surface } = selected;
    const local = surface.mesh.worldToLocal(hit.point.clone());
    const offset = network.regions[surface.region].start;
    // Rounded faces use refined, local indices. Resolve the nearest original
    // atlas vertex in the current displayed geometry, including lower anatomy.
    const positions = surface.mesh.geometry.getAttribute('position');
    const point = new THREE.Vector3();
    let nearest = surface.source;
    let distance = Infinity;
    for (const index of surface.vertices) {
      const solidIndex = surface.closed?.sourceLookup.get(index);
      const roundedIndex = surface.rounded?.sourceLookup.get(index);
      if (solidIndex !== undefined && surface.closed && surfaceBlend.value >= 0.5) point.fromBufferAttribute(surface.closed.sources, solidIndex);
      else if (roundedIndex === undefined) point.fromArray(network.positions, (offset + index) * 3);
      else point.fromBufferAttribute(positions, roundedIndex);
      const candidate = point.distanceToSquared(local);
      if (candidate < distance) { nearest = offset + index; distance = candidate; }
    }
    if (expanded) showRegion(surface);
    sendSignal(nearest, true, expanded ? surface.name : undefined);
  }

  canvas.style.touchAction = 'pan-y';
  canvas.addEventListener('pointerdown', (event) => {
    if (!ready || !event.isPrimary || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, dragging: false, scrolling: false, type: event.pointerType };
    if (event.pointerType !== 'touch') canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (expanded && !pointer && event.pointerType !== 'touch') showRegion(surfaceAt(event.clientX, event.clientY)?.surface);
    if (!pointer || pointer.id !== event.pointerId || pointer.scrolling) return;
    const totalX = event.clientX - pointer.startX;
    const totalY = event.clientY - pointer.startY;
    if (!pointer.dragging && Math.hypot(totalX, totalY) > 7) {
      if (pointer.type === 'touch' && Math.abs(totalY) > Math.abs(totalX)) { pointer.scrolling = true; return; }
      pointer.dragging = true;
      canvas.setPointerCapture(event.pointerId);
      root.dataset.brainDragging = 'true';
    }
    if (pointer.dragging && !reducedMotion.matches) {
      yaw += (event.clientX - pointer.x) * 0.008;
      pitch = clamp(pitch + (event.clientY - pointer.y) * 0.005, -0.85, 0.85);
      render();
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!pointer.dragging && !pointer.scrolling) signalAt(event.clientX, event.clientY);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    pointer = null;
    delete root.dataset.brainDragging;
  });
  const cancelPointer = (): void => { pointer = null; delete root.dataset.brainDragging; };
  canvas.addEventListener('pointercancel', cancelPointer);
  canvas.addEventListener('lostpointercapture', cancelPointer);
  canvas.addEventListener('pointerleave', () => { if (expanded && !pointer) showRegion(); });
  canvas.addEventListener('keydown', (event) => {
    if (!ready) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); sendSignal(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (reducedMotion.matches) return;
    if (event.key === 'ArrowLeft') yaw -= 0.12;
    if (event.key === 'ArrowRight') yaw += 0.12;
    if (event.key === 'ArrowUp') pitch = clamp(pitch - 0.10, -0.85, 0.85);
    if (event.key === 'ArrowDown') pitch = clamp(pitch + 0.10, -0.85, 0.85);
    render();
  });
  pulseButton?.addEventListener('click', () => sendSignal());
  expandButton?.addEventListener('click', () => {
    if (!ready || failed) return;
    expanded = !expanded;
    root.dataset.brainExpanded = String(expanded);
    expandButton.setAttribute('aria-expanded', String(expanded));
    expandButton.querySelector('[data-brain-expand-text]')!.textContent = expanded ? 'Reassemble brain' : 'Explore regions';
    if (regionLegend) regionLegend.hidden = !expanded;
    if (regionLabel) regionLabel.hidden = !expanded;
    showRegion();
    canvas.setAttribute('aria-label', expanded
      ? 'An expanded three-dimensional brain with color-coded frontal, parietal, temporal, and occipital lobes, insula, cingulate cortex, left and right hippocampi, cerebellum, and brainstem. Drag or use arrow keys to rotate. Tap or press Enter to send a signal.'
      : 'A translucent three-dimensional brain showing the cortex, cerebellum, and brainstem, with illustrative glowing signals. Drag or use arrow keys to rotate. Tap or press Enter to send a signal.');
    if (!motionAllowed()) expansion.value = expanded ? 1 : 0;
    announce(expanded ? 'Brain regions expanded. Choose a region in the legend to send a signal, or rotate the brain to explore.' : 'Brain reassembled.');
    render();
    schedule();
  });
  regionLegend?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-region]');
    if (!button || !expanded) return;
    const candidates = selectableSurfaces.filter((piece) => piece.key === button.dataset.region);
    // Prefer the hemisphere currently facing the viewer after rotation.
    const center = new THREE.Vector3();
    candidates.sort((a, b) => {
      const depth = (piece: AnatomyPiece): number => {
        center.fromArray(network.positions, piece.source * 3);
        return piece.mesh.localToWorld(center).z;
      };
      return depth(b) - depth(a);
    });
    if (candidates[0]) {
      showRegion(candidates[0]);
      sendSignal(candidates[0].source, true, candidates[0].name);
    }
  });
  toggleButton?.addEventListener('click', () => {
    paused = !paused;
    announce(paused ? 'Brain animation paused.' : 'Brain animation resumed.');
    syncMotion();
  });
  reducedMotion.addEventListener('change', () => {
    signals.forEach(disposeSignal);
    signals = [];
    syncMotion();
  });
  document.addEventListener('visibilitychange', syncMotion);
  window.addEventListener('blur', cancelPointer);
  window.addEventListener('resize', resize);
  canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); surfaceTransition.dispose(); fail(); });
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncMotion(); }, { threshold: 0.01 }).observe(root);
  new MutationObserver(updateTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  resize();
  const fetchAsset = async <T,>(url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('The anatomical surface could not be loaded.');
    return response.json() as Promise<T>;
  };
  const fetchVolumes = async (): Promise<RegionVolume[]> => {
    const response = await fetch(regionSolidsUrl);
    if (!response.ok || !response.body) throw new Error('The closed brain regions could not be loaded.');
    // Some hosts advertise Content-Encoding and fetch already decompresses;
    // others serve the .gz file as ordinary bytes. Accept both responses.
    const bytes = new Uint8Array(await response.arrayBuffer());
    const decoded = bytes[0] === 0x1f && bytes[1] === 0x8b
      ? new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')))
      : new Response(bytes);
    const asset = await decoded.json() as { regions: RegionVolume[] };
    return asset.regions.map((volume) => ({
      ...volume,
      positions: transformPositions(Array.from(volume.positions)),
      normals: transformNormals(volume.normals),
      sourcePositions: transformPositions(Array.from(volume.sourcePositions)),
      sourceNormals: transformNormals(volume.sourceNormals),
    }));
  };
  void Promise.all([fetchAsset<BrainData>(brainAssetUrl), fetchAsset<LowerAnatomyData>(lowerAnatomyAssetUrl), fetchAsset<CortexAtlas>(regionAssetUrl), fetchVolumes(), fetchAsset<HippocampusData>(hippocampusAssetUrl)])
    .then(([data, anatomy, atlas, volumes, hippocampi]) => {
      if (failed) return;
      lowerAnatomy.push(
        createLowerAnatomy(anatomy.parts.cerebellumLeft, 'cerebellum'),
        createLowerAnatomy(anatomy.parts.cerebellumRight, 'cerebellum'),
        createLowerAnatomy(anatomy.parts.brainstem, 'brainstem'),
        createLowerAnatomy(hippocampi.parts.hippocampusLeft, 'hippocampus'),
        createLowerAnatomy(hippocampi.parts.hippocampusRight, 'hippocampus'),
      );
      for (const surface of [data.hemispheres.left, data.hemispheres.right]) {
        const cortex = createCortex(surface, expansion);
        cortices.push(cortex);
      }
      network = createBrainNetwork({
        cortexLeft: data.hemispheres.left,
        cortexRight: data.hemispheres.right,
        cerebellumLeft: anatomy.parts.cerebellumLeft,
        cerebellumRight: anatomy.parts.cerebellumRight,
        brainstem: anatomy.parts.brainstem,
        hippocampusLeft: hippocampi.parts.hippocampusLeft,
        hippocampusRight: hippocampi.parts.hippocampusRight,
      });
      selectableSurfaces.push(
        ...createCorticalPieces(cortices[0].mesh, atlas.hemispheres.left, 'cortexLeft', network.regions.cortexLeft.start, volumes),
        ...createCorticalPieces(cortices[1].mesh, atlas.hemispheres.right, 'cortexRight', network.regions.cortexRight.start, volumes),
        createLowerPiece(lowerAnatomy[0].mesh, 'cerebellumLeft', network.regions.cerebellumLeft.start),
        createLowerPiece(lowerAnatomy[1].mesh, 'cerebellumRight', network.regions.cerebellumRight.start),
        createLowerPiece(lowerAnatomy[2].mesh, 'brainstem', network.regions.brainstem.start),
        createLowerPiece(lowerAnatomy[3].mesh, 'hippocampusLeft', network.regions.hippocampusLeft.start),
        createLowerPiece(lowerAnatomy[4].mesh, 'hippocampusRight', network.regions.hippocampusRight.start),
      );
      for (const piece of selectableSurfaces) brain.add(piece.mesh);
      ({ offsets, translations } = createSignalOffsets(selectableSurfaces, atlas, network.regions, network.neighbors.length));
      targetNormals = createSignalNormals(selectableSurfaces, network.regions, network.normals);
      if (regionLegend) {
        regionLegend.innerHTML = REGION_STYLES.filter((style) => style.key !== 'medial-wall').map((style) =>
          `<button type="button" data-region="${style.key}" style="--region-color: ${style.color}" title="Send a signal from the ${style.name.toLowerCase()}"><span aria-hidden="true"></span>${style.name}</button>`,
        ).join('');
      }
      ready = true;
      updateTheme();
      resize();
      render();
      if (pulseButton) pulseButton.disabled = false;
      if (expandButton) expandButton.disabled = false;
      syncMotion();
      if (!reducedMotion.matches) sendSignal(undefined, false);
    })
    .catch(fail);
}
