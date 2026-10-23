import * as THREE from 'three';
import { buildRegionSurface } from './brain-regions';
import { buildRoundedSurface } from './brain-region-rounding';
import type { RoundedSurfaceData } from './brain-region-rounding';
import type { BrainRegionId } from './brain-network';

export interface CortexAtlas {
  hemispheres: { left: number[]; right: number[] };
}

/** Precomputed closed volumes, in the same scene coordinates as the cortex. */
export interface RegionVolume {
  side: 'left' | 'right';
  label: number;
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  indices: number[];
  sourceVertices: number[];
  sourcePositions: ArrayLike<number>;
  sourceNormals: ArrayLike<number>;
}

export const REGION_STYLES = [
  { key: 'medial-wall', name: 'Medial wall', color: '#a2b8ba', offset: [0, 0, 0] },
  { key: 'frontal', name: 'Frontal lobe', color: '#91b9d5', offset: [0.28, 0.22, -0.43] },
  { key: 'parietal', name: 'Parietal lobe', color: '#8bc5ac', offset: [0.28, 0.44, 0.15] },
  { key: 'temporal', name: 'Temporal lobe', color: '#b8a2d0', offset: [0.48, -0.22, -0.05] },
  { key: 'occipital', name: 'Occipital lobe', color: '#d8b580', offset: [0.25, 0.12, 0.48] },
  { key: 'insula', name: 'Insula', color: '#d39ca4', offset: [0.22, -0.05, 0] },
  { key: 'cingulate', name: 'Cingulate cortex', color: '#b9c88c', offset: [0.08, 0.25, 0.02] },
  { key: 'cerebellum', name: 'Cerebellum', color: '#80bac2', offset: [0.24, -0.36, 0.30] },
  { key: 'brainstem', name: 'Brainstem', color: '#cdb89d', offset: [0, -0.59, -0.12] },
  { key: 'hippocampus', name: 'Hippocampus', color: '#e5a08b', offset: [0.30, -0.10, -0.65] },
] as const;

export type AnatomyMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;

interface RegionBoundarySurface {
  originalColors: THREE.BufferAttribute;
  colors: THREE.BufferAttribute;
  blends: { index: number; sources: number[] }[];
}

interface RoundedSurface {
  data: RoundedSurfaceData;
  positions: THREE.BufferAttribute;
  normals: THREE.BufferAttribute;
  restNormals: Float32Array;
  expandedNormals: Float32Array;
  sourceLookup: Map<number, number>;
}

interface ClosedRegion {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshPhysicalMaterial;
  restGeometry: THREE.BufferGeometry;
  restMaterial: THREE.MeshPhysicalMaterial;
  sources: THREE.BufferAttribute;
  sourceNormals: THREE.BufferAttribute;
  sourceLookup: Map<number, number>;
}

export interface AnatomyPiece {
  mesh: AnatomyMesh;
  region: BrainRegionId;
  key: string;
  name: string;
  offset: THREE.Vector3;
  tint: THREE.Color;
  baseColor: THREE.Color;
  baseOpacity: number;
  baseRoughness: number;
  baseClearcoat: number;
  source: number;
  vertices: ReadonlySet<number>;
  boundarySurface?: RegionBoundarySurface;
  closed?: ClosedRegion;
  rounded?: RoundedSurface;
}

function createPiece(mesh: AnatomyMesh, region: BrainRegionId, styleIndex: number, start: number, labels?: number[]): AnatomyPiece {
  const style = REGION_STYLES[styleIndex];
  const left = region.endsWith('Left');
  const side = region === 'brainstem' ? '' : left ? 'Left ' : 'Right ';
  const indices = mesh.geometry.index!;
  const positions = mesh.geometry.getAttribute('position');
  const center = new THREE.Vector3();
  const point = new THREE.Vector3();
  // Cut triangles include interpolated seam points. Start signals only at
  // original atlas vertices that belong to this anatomical piece.
  const vertices = new Set(Array.from(indices.array).filter((index) => !labels || labels[index] === styleIndex));
  for (const index of vertices) center.add(point.fromBufferAttribute(positions, index));
  center.divideScalar(vertices.size);
  // A lateral starting point makes a legend-triggered signal easy to see.
  if (region.startsWith('cortex')) center.x += left ? -0.5 : 0.5;
  let nearest = 0;
  let distance = Infinity;
  for (const index of vertices) {
    const candidate = point.fromBufferAttribute(positions, index).distanceToSquared(center);
    if (candidate < distance) { nearest = index; distance = candidate; }
  }
  return {
    mesh, region, key: style.key, name: `${side}${style.name.toLowerCase()}`,
    offset: new THREE.Vector3(style.offset[0] * (left ? -1 : 1), style.offset[1], style.offset[2]),
    tint: new THREE.Color(style.color), baseColor: mesh.material.color.clone(),
    baseOpacity: mesh.material.opacity, baseRoughness: mesh.material.roughness,
    baseClearcoat: mesh.material.clearcoat, source: start + nearest, vertices,
  };
}

function createRoundedSurface(data: RoundedSurfaceData, sourceNormals: THREE.BufferAttribute, smoothNormals = false): RoundedSurface {
  const positions = new THREE.BufferAttribute(data.expandedPositions.slice(), 3);
  const combined = new THREE.BufferGeometry();
  combined.setAttribute('position', positions);
  combined.setIndex(data.outerIndices);
  combined.computeVertexNormals();
  const expandedNormals = Float32Array.from(combined.getAttribute('normal').array);
  combined.dispose();
  if (smoothNormals) {
    // Small segmented structures need a softer normal field so voxel-scale
    // ripples do not become high-contrast stripes under the scene lights.
    const neighbors = Array.from({ length: positions.count }, () => new Set<number>());
    for (let offset = 0; offset < data.outerIndices.length; offset += 3) {
      const [a, b, c] = data.outerIndices.slice(offset, offset + 3);
      neighbors[a].add(b).add(c);
      neighbors[b].add(a).add(c);
      neighbors[c].add(a).add(b);
    }
    const normal = new THREE.Vector3();
    for (let pass = 0; pass < 6; pass += 1) {
      const previous = expandedNormals.slice();
      for (let index = 0; index < neighbors.length; index += 1) {
        normal.fromArray(previous, index * 3).multiplyScalar(0.35);
        const weight = 0.65 / neighbors[index].size;
        for (const neighbor of neighbors[index]) {
          normal.x += previous[neighbor * 3] * weight;
          normal.y += previous[neighbor * 3 + 1] * weight;
          normal.z += previous[neighbor * 3 + 2] * weight;
        }
        normal.normalize().toArray(expandedNormals, index * 3);
      }
    }
  }
  const restNormals = expandedNormals.slice();
  const sourceLookup = new Map<number, number>();
  for (let index = 0; index < data.sourceVertices.length; index += 1) {
    const source = data.sourceVertices[index];
    sourceLookup.set(source, index);
    restNormals[index * 3] = sourceNormals.getX(source);
    restNormals[index * 3 + 1] = sourceNormals.getY(source);
    restNormals[index * 3 + 2] = sourceNormals.getZ(source);
  }
  for (const { index, a, b } of data.edges) {
    for (let axis = 0; axis < 3; axis += 1) restNormals[index * 3 + axis] = (restNormals[a * 3 + axis] + restNormals[b * 3 + axis]) / 2;
  }
  positions.array.set(data.restPositions);
  const normals = new THREE.BufferAttribute(restNormals.slice(), 3);
  return { data, positions, normals, restNormals, expandedNormals, sourceLookup };
}

/** The assembled atlas stays exact; expansion uses a smooth, closed volume. */
export function createCorticalPieces(mesh: AnatomyMesh, labels: number[], region: BrainRegionId, start: number, volumes: RegionVolume[]): AnatomyPiece[] {
  if (labels.length !== mesh.geometry.getAttribute('position').count) throw new Error('Atlas and cortical surface do not match.');
  const surface = buildRegionSurface(mesh.geometry.getAttribute('position').array, mesh.geometry.index!.array, labels);
  const attributes: Record<string, THREE.BufferAttribute> = { position: new THREE.BufferAttribute(surface.positions, 3) };
  for (const name of ['normal', 'color']) {
    const original = mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
    const array = new Float32Array(surface.positions.length);
    array.set(original.array);
    const attribute = new THREE.BufferAttribute(array, 3);
    const value = new THREE.Vector3();
    for (const { index, sources } of surface.blends) {
      value.set(0, 0, 0);
      for (const source of sources) {
        value.x += original.getX(source);
        value.y += original.getY(source);
        value.z += original.getZ(source);
      }
      value.divideScalar(sources.length);
      if (name === 'normal') value.normalize();
      attribute.setXYZ(index, value.x, value.y, value.z);
    }
    attributes[name] = attribute;
  }
  const boundarySurface: RegionBoundarySurface = {
    originalColors: mesh.geometry.getAttribute('color') as THREE.BufferAttribute,
    colors: attributes.color, blends: surface.blends,
  };
  return [...surface.groups].map(([label, indices]) => {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(attributes)) geometry.setAttribute(name, attribute);
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const part = mesh.clone(false);
    part.geometry = geometry;
    part.material = mesh.material.clone();
    part.material.onBeforeCompile = mesh.material.onBeforeCompile;
    part.material.customProgramCacheKey = mesh.material.customProgramCacheKey;
    for (const child of mesh.children) {
      const layer = (child as THREE.Mesh).clone(false);
      layer.geometry = geometry;
      part.add(layer);
    }
    const piece = { ...createPiece(part, region, label, start, labels), boundarySurface };
    // Medial walls use the same smooth display surface as the named portions,
    // but their zero offset keeps them at the center without separate labels.
    const volume = volumes.find((candidate) => candidate.label === label && candidate.side === (region === 'cortexLeft' ? 'left' : 'right'));
    if (!volume) throw new Error('A closed cortical region is missing.');
    const solidGeometry = new THREE.BufferGeometry();
    solidGeometry.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(volume.positions), 3));
    solidGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from(volume.normals), 3));
    solidGeometry.setIndex(volume.indices);
    solidGeometry.computeBoundingSphere();
    const solidMaterial = part.material.clone();
    // A single surface and finish across cortex, rounded shoulder, and inner cut.
    // Geometry supplies the folds, without transferring mottled atlas colors.
    solidMaterial.vertexColors = false;
    solidMaterial.depthWrite = true;
    const closed: ClosedRegion = {
      geometry: solidGeometry, material: solidMaterial,
      restGeometry: geometry, restMaterial: part.material,
      sources: new THREE.Float32BufferAttribute(Array.from(volume.sourcePositions), 3),
      sourceNormals: new THREE.Float32BufferAttribute(Array.from(volume.sourceNormals), 3),
      sourceLookup: new Map(volume.sourceVertices.map((source, index) => [source, index])),
    };
    return { ...piece, closed };
  });
}

export function createLowerPiece(mesh: AnatomyMesh, region: BrainRegionId, start: number): AnatomyPiece {
  const piece = createPiece(mesh, region, region.startsWith('hippocampus') ? 9 : region === 'brainstem' ? 8 : 7, start);
  const originalGeometry = mesh.geometry;
  const rounded = createRoundedSurface(buildRoundedSurface(originalGeometry.getAttribute('position').array, originalGeometry.index!.array), originalGeometry.getAttribute('normal') as THREE.BufferAttribute, region.startsWith('hippocampus'));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', rounded.positions);
  geometry.setAttribute('normal', rounded.normals);
  geometry.setIndex(rounded.data.outerIndices);
  geometry.computeBoundingSphere();
  mesh.geometry = geometry;
  originalGeometry.dispose();
  return { ...piece, rounded };
}

export function applyExpansion(pieces: AnatomyPiece[], amount: number): void {
  const updatedSurfaces = new Set<RegionBoundarySurface>();
  for (const piece of pieces) {
    const surface = piece.boundarySurface;
    if (surface && !updatedSurfaces.has(surface)) {
      updatedSurfaces.add(surface);
      surface.colors.array.set(surface.originalColors.array);
      for (const { index, sources } of surface.blends) {
        let r = 0, g = 0, b = 0;
        for (const source of sources) {
          r += surface.originalColors.getX(source);
          g += surface.originalColors.getY(source);
          b += surface.originalColors.getZ(source);
        }
        surface.colors.setXYZ(index, r / sources.length, g / sources.length, b / sources.length);
      }
      surface.colors.needsUpdate = true;
    }
    piece.mesh.position.copy(piece.offset).multiplyScalar(amount);
    // Prepare both appearances so the renderer can crossfade their complete
    // color/depth passes without introducing an endpoint material switch.
    const materials = piece.closed ? [piece.closed.restMaterial, piece.closed.material] : [piece.mesh.material];
    for (const material of materials) {
      material.color.copy(piece.baseColor).lerp(piece.tint, amount * 0.85);
      if (material === piece.closed?.material) material.color.multiplyScalar(0.42);
      material.opacity = THREE.MathUtils.lerp(piece.baseOpacity, 1, amount) * (piece.key === 'hippocampus' ? amount : 1);
      material.roughness = THREE.MathUtils.lerp(piece.baseRoughness, 0.48, amount);
      material.clearcoat = THREE.MathUtils.lerp(piece.baseClearcoat, 0.28, amount);
    }
    if (piece.rounded) {
      const { data, positions, normals, restNormals, expandedNormals } = piece.rounded;
      for (let offset = 0; offset < data.restPositions.length; offset += 1) {
        positions.array[offset] = THREE.MathUtils.lerp(data.restPositions[offset], data.expandedPositions[offset], amount);
        normals.array[offset] = THREE.MathUtils.lerp(restNormals[offset], expandedNormals[offset], amount);
      }
      positions.needsUpdate = true;
      normals.needsUpdate = true;
    }
  }
}

/** Select one complete cortex representation for a render pass or picking. */
export function setCorticalSurface(pieces: AnatomyPiece[], solid: boolean): void {
  for (const piece of pieces) {
    // Their shadow/depth contribution must fade with the expanded frame too;
    // a transparent but visible hippocampus would still cast a full shadow.
    if (piece.key === 'hippocampus') piece.mesh.visible = solid && piece.mesh.material.opacity > 0;
    if (!piece.closed) continue;
    piece.mesh.geometry = solid ? piece.closed.geometry : piece.closed.restGeometry;
    piece.mesh.material = solid ? piece.closed.material : piece.closed.restMaterial;
    for (const child of piece.mesh.children) (child as THREE.Mesh).geometry = piece.mesh.geometry;
    // Avoid coarse cast-shadow edges on the smooth expanded medial walls.
    if (piece.key === 'medial-wall') piece.mesh.receiveShadow = !solid;
  }
}

/** Signal anchors follow the closed surfaces, including the newly rounded cuts. */
export function createSignalOffsets(pieces: AnatomyPiece[], atlas: CortexAtlas, regions: Record<BrainRegionId, { start: number; count: number }>, total: number): { offsets: Float32Array; translations: Float32Array } {
  const offsets = new Float32Array(total * 3);
  const translations = new Float32Array(total * 3);
  for (const piece of pieces) {
    const { start, count } = regions[piece.region];
    const labels = piece.region === 'cortexLeft' ? atlas.hemispheres.left : piece.region === 'cortexRight' ? atlas.hemispheres.right : null;
    for (let index = 0; index < count; index += 1) {
      if (labels && REGION_STYLES[labels[index]].key !== piece.key) continue;
      const target = (start + index) * 3;
      const roundedIndex = piece.rounded?.sourceLookup.get(index);
      const solidIndex = piece.closed?.sourceLookup.get(index);
      const rest = piece.closed?.restGeometry.getAttribute('position');
      for (let axis = 0; axis < 3; axis += 1) {
        const vertexOffset = solidIndex !== undefined && piece.closed && rest
          ? piece.closed.sources.array[solidIndex * 3 + axis] - rest.array[index * 3 + axis]
          : roundedIndex === undefined ? 0
            : piece.rounded!.data.expandedPositions[roundedIndex * 3 + axis] - piece.rounded!.data.restPositions[roundedIndex * 3 + axis];
        offsets[target + axis] = piece.offset.getComponent(axis) + vertexOffset;
        translations[target + axis] = piece.offset.getComponent(axis);
      }
    }
  }
  return { offsets, translations };
}

export function createSignalNormals(pieces: AnatomyPiece[], regions: Record<BrainRegionId, { start: number }>, original: Float32Array): Float32Array {
  const normals = original.slice();
  for (const piece of pieces) {
    for (const index of piece.vertices) {
      const target = (regions[piece.region].start + index) * 3;
      const solidIndex = piece.closed?.sourceLookup.get(index);
      const roundedIndex = piece.rounded?.sourceLookup.get(index);
      for (let axis = 0; axis < 3; axis += 1) {
        if (solidIndex !== undefined && piece.closed) normals[target + axis] = piece.closed.sourceNormals.array[solidIndex * 3 + axis];
        else if (roundedIndex !== undefined && piece.rounded) normals[target + axis] = piece.rounded.expandedNormals[roundedIndex * 3 + axis];
      }
    }
  }
  return normals;
}
