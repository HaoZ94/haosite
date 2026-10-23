export type BrainRegionId = 'cortexLeft' | 'cortexRight' | 'cerebellumLeft' | 'cerebellumRight' | 'brainstem' | 'hippocampusLeft' | 'hippocampusRight';

export interface BrainSurfaceData {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

export interface BrainNetwork {
  positions: Float32Array;
  normals: Float32Array;
  neighbors: number[][];
  regions: Record<BrainRegionId, { start: number; count: number }>;
  regionByVertex: BrainRegionId[];
  bridges: { a: number; b: number; from: BrainRegionId; to: BrainRegionId; illustrative: true }[];
}

export interface BrainSignalPlan {
  source: number;
  targets: number[];
  paths: number[][];
  distances: Float64Array;
  maximumDistance: number;
  duration: number;
}

export const SIGNAL_SPEED = 0.42;
export const SIGNAL_FADE_SECONDS = 1.4;
export const BRAIN_REGIONS: readonly BrainRegionId[] = [
  'cortexLeft', 'cortexRight', 'cerebellumLeft', 'cerebellumRight', 'brainstem', 'hippocampusLeft', 'hippocampusRight',
];

type Point3 = readonly [number, number, number];

export function findNearestVertex(network: BrainNetwork, region: BrainRegionId, target: Point3): number {
  const { start, count } = network.regions[region];
  let nearest = start;
  let best = Infinity;
  for (let index = start; index < start + count; index += 1) {
    const distance = (network.positions[index * 3] - target[0]) ** 2
      + (network.positions[index * 3 + 1] - target[1]) ** 2
      + (network.positions[index * 3 + 2] - target[2]) ** 2;
    if (distance < best) { best = distance; nearest = index; }
  }
  return nearest;
}

/** Build one graph in the exact same RAS-to-scene coordinates as the renderer. */
export function createBrainNetwork(surfaces: Record<BrainRegionId, BrainSurfaceData>): BrainNetwork {
  const total = BRAIN_REGIONS.reduce((sum, region) => sum + surfaces[region].positions.length / 3, 0);
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const neighbors = Array.from({ length: total }, () => new Set<number>());
  const regions = {} as BrainNetwork['regions'];
  const regionByVertex: BrainRegionId[] = [];
  let start = 0;
  for (const region of BRAIN_REGIONS) {
    const surface = surfaces[region];
    const count = surface.positions.length / 3;
    if (!Number.isInteger(count) || surface.indices.length % 3) throw new Error(`Invalid ${region} surface.`);
    regions[region] = { start, count };
    for (let index = 0; index < count; index += 1) {
      const offset = (start + index) * 3;
      positions[offset] = surface.positions[index * 3] / 100;
      positions[offset + 1] = (surface.positions[index * 3 + 2] - 15) / 100;
      positions[offset + 2] = -(surface.positions[index * 3 + 1] + 18) / 100;
      regionByVertex.push(region);
    }
    for (let offset = 0; offset < surface.indices.length; offset += 3) {
      const a = start + surface.indices[offset];
      const b = start + surface.indices[offset + 1];
      const c = start + surface.indices[offset + 2];
      neighbors[a].add(b).add(c);
      neighbors[b].add(a).add(c);
      neighbors[c].add(a).add(b);
      const abx = positions[b * 3] - positions[a * 3];
      const aby = positions[b * 3 + 1] - positions[a * 3 + 1];
      const abz = positions[b * 3 + 2] - positions[a * 3 + 2];
      const acx = positions[c * 3] - positions[a * 3];
      const acy = positions[c * 3 + 1] - positions[a * 3 + 1];
      const acz = positions[c * 3 + 2] - positions[a * 3 + 2];
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      for (const index of [a, b, c]) {
        normals[index * 3] += nx;
        normals[index * 3 + 1] += ny;
        normals[index * 3 + 2] += nz;
      }
    }
    start += count;
  }
  for (let index = 0; index < total; index += 1) {
    const offset = index * 3;
    const length = Math.hypot(normals[offset], normals[offset + 1], normals[offset + 2]) || 1;
    normals[offset] /= length;
    normals[offset + 1] /= length;
    normals[offset + 2] /= length;
  }
  const network: BrainNetwork = { positions, normals, neighbors: [], regions, regionByVertex, bridges: [] };
  // These connectors are illustrative animation links, not reconstructed neural
  // tracts. Each hippocampus joins the temporal cortex on the same side; the
  // existing cortical and cerebellar links connect the wider network via the stem.
  const connections: [BrainRegionId, Point3, BrainRegionId, Point3][] = [
    ['cortexLeft', [-0.40, -0.31, 0.05], 'brainstem', [-0.10, -0.32, 0.12]],
    ['cortexRight', [0.40, -0.31, 0.05], 'brainstem', [0.10, -0.32, 0.12]],
    ['cerebellumLeft', [-0.17, -0.49, 0.30], 'brainstem', [-0.11, -0.47, 0.20]],
    ['cerebellumRight', [0.17, -0.49, 0.30], 'brainstem', [0.11, -0.47, 0.20]],
    ['hippocampusLeft', [-0.25, -0.40, -0.02], 'cortexLeft', [-0.40, -0.42, -0.05]],
    ['hippocampusRight', [0.25, -0.40, -0.02], 'cortexRight', [0.40, -0.42, -0.05]],
  ];
  for (const [from, fromAnchor, to, toAnchor] of connections) {
    const a = findNearestVertex(network, from, fromAnchor);
    const b = findNearestVertex(network, to, toAnchor);
    neighbors[a].add(b);
    neighbors[b].add(a);
    network.bridges.push({ a, b, from, to, illustrative: true });
  }
  network.neighbors = neighbors.map((set) => [...set]);
  return network;
}

function shortestPaths(network: BrainNetwork, source: number): { distances: Float64Array; previous: Int32Array } {
  const distances = new Float64Array(network.neighbors.length).fill(Infinity);
  const previous = new Int32Array(network.neighbors.length).fill(-1);
  const heap: { index: number; distance: number }[] = [];
  const push = (index: number, distance: number): void => {
    let child = heap.length;
    heap.push({ index, distance });
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (heap[parent].distance <= distance) break;
      heap[child] = heap[parent];
      child = parent;
    }
    heap[child] = { index, distance };
  };
  const pop = (): { index: number; distance: number } => {
    const first = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      let parent = 0;
      while (parent * 2 + 1 < heap.length) {
        let child = parent * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].distance < heap[child].distance) child += 1;
        if (heap[child].distance >= last.distance) break;
        heap[parent] = heap[child];
        parent = child;
      }
      heap[parent] = last;
    }
    return first;
  };
  distances[source] = 0;
  push(source, 0);
  while (heap.length) {
    const current = pop();
    if (current.distance > distances[current.index]) continue;
    for (const neighbor of network.neighbors[current.index]) {
      const a = current.index * 3;
      const b = neighbor * 3;
      const next = current.distance + Math.hypot(
        network.positions[a] - network.positions[b],
        network.positions[a + 1] - network.positions[b + 1],
        network.positions[a + 2] - network.positions[b + 2],
      );
      if (next < distances[neighbor]) {
        distances[neighbor] = next;
        previous[neighbor] = current.index;
        push(neighbor, next);
      }
    }
  }
  return { distances, previous };
}

/** Every signal reaches all anatomical regions; local branches add detail near its source. */
export function planBrainSignal(network: BrainNetwork, source: number): BrainSignalPlan {
  if (!Number.isInteger(source) || source < 0 || source >= network.neighbors.length) throw new RangeError('Invalid signal source.');
  const { distances, previous } = shortestPaths(network, source);
  const targets: number[] = [];
  const anchors: Record<BrainRegionId, Point3> = {
    cortexLeft: [-0.53, 0.20, -0.32], cortexRight: [0.53, 0.25, 0.40],
    cerebellumLeft: [-0.40, -0.57, 0.50], cerebellumRight: [0.40, -0.57, 0.50],
    brainstem: [0.10, -0.76, 0.18],
    hippocampusLeft: [-0.28, -0.14, 0.22], hippocampusRight: [0.28, -0.14, 0.22],
  };
  for (const region of BRAIN_REGIONS) {
    let target = findNearestVertex(network, region, anchors[region]);
    if (distances[target] < 0.08) {
      const { start, count } = network.regions[region];
      for (let index = start; index < start + count; index += 1) {
        if (Number.isFinite(distances[index]) && distances[index] > distances[target]) target = index;
      }
    }
    if (target !== source && Number.isFinite(distances[target])) targets.push(target);
  }
  const sourceRegion = network.regions[network.regionByVertex[source]];
  for (const direction of [[0, 1, 0.6], [0.3, 0.2, -1], [0.1, -0.5, 1]]) {
    const length = Math.hypot(...direction);
    let target = source;
    let best = -Infinity;
    for (let index = sourceRegion.start; index < sourceRegion.start + sourceRegion.count; index += 1) {
      if (distances[index] < 0.20 || distances[index] > 1.2 || targets.includes(index)) continue;
      const dx = network.positions[index * 3] - network.positions[source * 3];
      const dy = network.positions[index * 3 + 1] - network.positions[source * 3 + 1];
      const dz = network.positions[index * 3 + 2] - network.positions[source * 3 + 2];
      const radial = Math.hypot(dx, dy, dz) || 1;
      const score = (dx * direction[0] + dy * direction[1] + dz * direction[2]) / (radial * length)
        - Math.abs(distances[index] - 0.7) * 0.3;
      if (score > best) { best = score; target = index; }
    }
    if (target !== source) targets.push(target);
  }
  const paths = targets.map((target) => {
    const path = [target];
    let current = target;
    while (current !== source && previous[current] !== -1) {
      current = previous[current];
      path.push(current);
    }
    return path.reverse();
  });
  const maximumDistance = Math.max(...targets.map((target) => distances[target]), 0);
  return { source, targets, paths, distances, maximumDistance, duration: maximumDistance / SIGNAL_SPEED + SIGNAL_FADE_SECONDS };
}
