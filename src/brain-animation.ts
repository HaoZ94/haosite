import * as THREE from 'three';
import brainAssetUrl from './assets/brain-fsaverage5.json?url';
import lowerAnatomyAssetUrl from './assets/brain-subcortical.json?url';
import { createBrainNetwork, findNearestVertex, planBrainSignal, SIGNAL_SPEED } from './brain-network';
import type { BrainNetwork, BrainRegionId } from './brain-network';

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
  kind: 'cerebellum' | 'brainstem';
}

interface Cortex {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  positions: Float32Array;
  normals: Float32Array;
  neighbors: number[][];
  sulc: number[];
  curvature: Float32Array;
}

interface SurfaceSignal {
  group: THREE.Group;
  materials: THREE.ShaderMaterial[];
  geometries: THREE.BufferGeometry[];
  paths: number[][];
  distances: Float64Array;
  network: BrainNetwork;
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

function transformPositions(source: number[]): Float32Array {
  const positions = new Float32Array(source.length);
  for (let offset = 0; offset < positions.length; offset += 3) {
    positions[offset] = source[offset] / 100;
    positions[offset + 1] = (source[offset + 2] - 15) / 100;
    positions[offset + 2] = -(source[offset + 1] + 18) / 100;
  }
  return positions;
}

/** These surfaces share fsaverage surface RAS, so no visual alignment offsets are needed. */
function createLowerAnatomy(data: AnatomySurface, kind: LowerAnatomy['kind']): LowerAnatomy {
  if (data.positions.length % 3 || data.indices.length % 3) throw new Error('Invalid anatomical surface.');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(transformPositions(data.positions), 3));
  geometry.setIndex(data.indices);
  geometry.computeVertexNormals();
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
function createCortex(data: SurfaceData): Cortex {
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
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
        float corticalFresnel = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
        diffuseColor.a *= 0.72 + corticalFresnel * 0.28;
        #include <opaque_fragment>
      `,
    );
  };
  material.customProgramCacheKey = () => 'frosted-cortex-v1';
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
  return { mesh, positions, normals, neighbors: adjacency, sulc: data.sulc, curvature };
}

const trailVertexShader = `
  attribute float surfaceDistance;
  varying float vDistance;
  void main() {
    vDistance = surfaceDistance;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const trailFragmentShader = `
  uniform float progress;
  uniform float opacity;
  uniform vec3 color;
  varying float vDistance;
  void main() {
    float behind = progress - vDistance;
    float head = exp(-pow(behind / 0.045, 2.0));
    float trail = step(0.0, behind) * exp(-behind * 10.0);
    float strength = max(head, trail * 0.76);
    if (strength < 0.012) discard;
    gl_FragColor = vec4(color, strength * opacity);
  }
`;

const isLowerVertex = (network: BrainNetwork, index: number): boolean => !network.regionByVertex[index].startsWith('cortex');

function createSignal(network: BrainNetwork, source: number, pixelRatio: number): SurfaceSignal {
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
      for (const [a, b] of uniqueEdges.values()) {
        if ((isLowerVertex(network, a) || isLowerVertex(network, b)) !== lower) continue;
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
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('surfaceDistance', new THREE.Float32BufferAttribute(surfaceDistances, 1));
      const material = new THREE.ShaderMaterial({
        uniforms: {
          progress: { value: 0 }, opacity: { value: opacity },
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
  return { group, materials, geometries, paths, distances, network, heads, age: 0, duration, static: false };
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
      const mix = clamp((progress - signal.distances[a]) / (signal.distances[b] - signal.distances[a]), 0, 1);
      const point = vertex(signal.network.positions, a).lerp(vertex(signal.network.positions, b), mix);
      const normal = vertex(signal.network.normals, a).lerp(vertex(signal.network.normals, b), mix).normalize();
      point.addScaledVector(normal, 0.012);
      positions.setXYZ(pathIndex, point.x, point.y, point.z);
      visibility.setX(pathIndex, signal.static ? 1 : Math.min(1, signal.age * 5));
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
  const status = root.querySelector<HTMLElement>('[data-brain-status]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (pulseButton) pulseButton.disabled = true;
  if (toggleButton) toggleButton.disabled = true;
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
  const queuedSources: number[] = [];
  const selectableSurfaces: { region: BrainRegionId; mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial> }[] = [];
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

  function render(): void {
    if (failed || !width || !height) return;
    brain.rotation.set(
      pitch + Math.sin(rotationClock * 0.16) * 0.018,
      yaw + Math.sin(rotationClock * 0.20) * 0.12,
      -0.045,
    );
    renderer.render(scene, camera);
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
    }
    for (const part of lowerAnatomy) {
      part.mesh.material.color.set(part.kind === 'brainstem'
        ? dark ? '#adc1b1' : '#91aa9e'
        : dark ? '#799eaa' : '#7c9da3');
    }
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

  function sendSignal(source?: number, userInitiated = true): void {
    if (!ready || failed) return;
    const origin = source ?? defaultSource();
    const regionNames: Record<BrainRegionId, string> = {
      cortexLeft: 'left cerebral hemisphere', cortexRight: 'right cerebral hemisphere',
      cerebellumLeft: 'left cerebellum', cerebellumRight: 'right cerebellum', brainstem: 'brainstem',
    };
    const sourceName = regionNames[network.regionByVertex[origin]];
    if (motionAllowed() && signals.length >= 3) {
      // Preserve active journeys and the requested source when several signals overlap.
      queuedSources.push(origin);
      if (userInitiated) announce(`Signal queued from the ${sourceName}.`);
      return;
    }
    if (!motionAllowed()) {
      signals.forEach(disposeSignal);
      signals = [];
      queuedSources.length = 0;
    }
    const signal = createSignal(network, origin, renderer.getPixelRatio());
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
    if (!pointer?.dragging) rotationClock += delta;
    for (const signal of signals) { signal.age += delta; updateSignal(signal); }
    signals = signals.filter((signal) => {
      if (signal.age < signal.duration) return true;
      disposeSignal(signal);
      return false;
    });
    if (queuedSources.length && signals.length < 3) sendSignal(queuedSources.shift(), false);
    automaticSignalAge += delta;
    // Start the next automatic journey only after every branch has reached its endpoint.
    if (automaticSignalAge > 6.5 && signals.length === 0 && queuedSources.length === 0) sendSignal(undefined, false);
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

  function signalAt(clientX: number, clientY: number): void {
    if (!ready) return;
    const bounds = canvas!.getBoundingClientRect();
    const pointerPosition = new THREE.Vector2((clientX - bounds.left) / width * 2 - 1, -(clientY - bounds.top) / height * 2 + 1);
    raycaster.setFromCamera(pointerPosition, camera);
    const hits = raycaster.intersectObjects(selectableSurfaces.map((surface) => surface.mesh), false);
    // Lower anatomy is visible through the glass cortex. In an overlap, prefer
    // that visible lower structure so a tap does not silently select the cortex.
    const hit = hits.find((candidate) => selectableSurfaces.some((surface) => surface.mesh === candidate.object && !surface.region.startsWith('cortex')))
      ?? hits[0];
    if (!hit?.face) { sendSignal(); return; }
    const surface = selectableSurfaces.find((candidate) => candidate.mesh === hit.object)!;
    const local = surface.mesh.worldToLocal(hit.point.clone());
    const offset = network.regions[surface.region].start;
    const indices = [hit.face.a + offset, hit.face.b + offset, hit.face.c + offset];
    indices.sort((a, b) => vertex(network.positions, a).distanceToSquared(local) - vertex(network.positions, b).distanceToSquared(local));
    sendSignal(indices[0]);
  }

  canvas.style.touchAction = 'pan-y';
  canvas.addEventListener('pointerdown', (event) => {
    if (!ready || !event.isPrimary || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, dragging: false, scrolling: false, type: event.pointerType };
    if (event.pointerType !== 'touch') canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
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
  toggleButton?.addEventListener('click', () => {
    paused = !paused;
    announce(paused ? 'Brain animation paused.' : 'Brain animation resumed.');
    syncMotion();
  });
  reducedMotion.addEventListener('change', () => {
    signals.forEach(disposeSignal);
    signals = [];
    queuedSources.length = 0;
    syncMotion();
  });
  document.addEventListener('visibilitychange', syncMotion);
  window.addEventListener('blur', cancelPointer);
  window.addEventListener('resize', resize);
  canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); fail(); });
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncMotion(); }, { threshold: 0.01 }).observe(root);
  new MutationObserver(updateTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  resize();
  const fetchAsset = async <T,>(url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('The anatomical surface could not be loaded.');
    return response.json() as Promise<T>;
  };
  void Promise.all([fetchAsset<BrainData>(brainAssetUrl), fetchAsset<LowerAnatomyData>(lowerAnatomyAssetUrl)])
    .then(([data, anatomy]) => {
      if (failed) return;
      lowerAnatomy.push(
        createLowerAnatomy(anatomy.parts.cerebellumLeft, 'cerebellum'),
        createLowerAnatomy(anatomy.parts.cerebellumRight, 'cerebellum'),
        createLowerAnatomy(anatomy.parts.brainstem, 'brainstem'),
      );
      for (const part of lowerAnatomy) brain.add(part.mesh);
      for (const surface of [data.hemispheres.left, data.hemispheres.right]) {
        const cortex = createCortex(surface);
        cortices.push(cortex);
        brain.add(cortex.mesh);
      }
      network = createBrainNetwork({
        cortexLeft: data.hemispheres.left,
        cortexRight: data.hemispheres.right,
        cerebellumLeft: anatomy.parts.cerebellumLeft,
        cerebellumRight: anatomy.parts.cerebellumRight,
        brainstem: anatomy.parts.brainstem,
      });
      selectableSurfaces.push(
        { region: 'cortexLeft', mesh: cortices[0].mesh },
        { region: 'cortexRight', mesh: cortices[1].mesh },
        { region: 'cerebellumLeft', mesh: lowerAnatomy[0].mesh },
        { region: 'cerebellumRight', mesh: lowerAnatomy[1].mesh },
        { region: 'brainstem', mesh: lowerAnatomy[2].mesh },
      );
      ready = true;
      updateTheme();
      resize();
      render();
      if (pulseButton) pulseButton.disabled = false;
      syncMotion();
      if (!reducedMotion.matches) sendSignal(undefined, false);
    })
    .catch(fail);
}
