#!/usr/bin/env node
/**
 * Build smooth, illustrative solid portions for the expanded brain view.
 *
 * The atlas supplies the measured outer patches. Their interior closures are
 * illustrative, not measured subcortical anatomy. A signed voxel union removes
 * the crossings between folded cortex and those closures; a small Gaussian
 * filter rounds their exposed connection faces. Marching cubes then gives each
 * portion a single, closed surface with continuous gradient normals.
 *
 * All inputs are local and checksummed in the generated provenance metadata.
 * Run from any directory with Node >= 22.12:
 *   node --experimental-strip-types scripts/build-brain-solids.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { MeshStandardMaterial } from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { buildRegionSurface } from '../src/brain-regions.ts';
import { buildRegionSolid } from '../src/brain-region-solids.ts';

const ROOT = new URL('../', import.meta.url);
const SETTINGS = {
  spacing: 1.4,
  blurMM: 1.2,
  domeFraction: 0.04,
  isolation: 0.5001,
  normalSmoothingPasses: 10,
  normalSmoothingBlend: 0.65,
};
const round = (value, precision) => Number(value.toFixed(precision));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sources = [
  'src/assets/brain-fsaverage5.json',
  'src/assets/brain-regions.json',
  'src/brain-regions.ts',
  'src/brain-region-solids.ts',
  'scripts/build-brain-solids.mjs',
].map((path) => ({ path, sha256: sha256(readFileSync(new URL(path, ROOT))) }));
const cortex = JSON.parse(readFileSync(new URL('src/assets/brain-fsaverage5.json', ROOT), 'utf8'));
const atlas = JSON.parse(readFileSync(new URL('src/assets/brain-regions.json', ROOT), 'utf8'));

function trianglePoints(positions, indices, offset) {
  return indices.slice(offset, offset + 3).map((vertex) => positions.slice(vertex * 3, vertex * 3 + 3));
}

/** Nonzero signed winding fills the union, including self-intersecting inputs. */
function voxelize(positions, indices) {
  const used = [...new Set(indices)];
  const minimum = [0, 1, 2].map((axis) => Math.min(...used.map((vertex) => positions[vertex * 3 + axis])) - 6);
  const maximum = [0, 1, 2].map((axis) => Math.max(...used.map((vertex) => positions[vertex * 3 + axis])) + 6);
  const size = Math.ceil(Math.max(...maximum.map((value, axis) => value - minimum[axis])) / SETTINGS.spacing) + 1;
  const square = size * size;
  const rays = Array.from({ length: square }, () => []);

  // Rasterize triangles into vertical-ray events. Their projected winding
  // distinguishes entering tissue from leaving it, even at intersecting caps.
  for (let offset = 0; offset < indices.length; offset += 3) {
    const [a, b, c] = trianglePoints(positions, indices, offset);
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) continue;
    const minX = Math.max(0, Math.ceil((Math.min(a[0], b[0], c[0]) - minimum[0]) / SETTINGS.spacing));
    const maxX = Math.min(size - 1, Math.floor((Math.max(a[0], b[0], c[0]) - minimum[0]) / SETTINGS.spacing));
    const minY = Math.max(0, Math.ceil((Math.min(a[1], b[1], c[1]) - minimum[1]) / SETTINGS.spacing));
    const maxY = Math.min(size - 1, Math.floor((Math.max(a[1], b[1], c[1]) - minimum[1]) / SETTINGS.spacing));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = minimum[0] + x * SETTINGS.spacing;
        const py = minimum[1] + y * SETTINGS.spacing;
        const u = ((px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])) / area;
        const v = ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) / area;
        if (u < 0 || v < 0 || u + v > 1) continue;
        rays[y * size + x].push([a[2] + u * (b[2] - a[2]) + v * (c[2] - a[2]), area < 0 ? 1 : -1]);
      }
    }
  }

  const field = new Float32Array(size ** 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const events = rays[y * size + x];
      if (!events.length) continue;
      events.sort((a, b) => a[0] - b[0]);
      if (events.reduce((sum, event) => sum + event[1], 0) !== 0) {
        throw new Error('A voxel ray has unbalanced winding; the source closure must be checked.');
      }
      let winding = 0;
      let event = 0;
      for (let z = 0; z < size; z += 1) {
        const pz = minimum[2] + z * SETTINGS.spacing;
        while (event < events.length && events[event][0] < pz) winding += events[event++][1];
        if (winding > 0) field[z * square + y * size + x] = 1;
      }
    }
  }
  return { field, minimum, size };
}

function blurVoxels({ field, minimum, size }) {
  const sigma = SETTINGS.blurMM / SETTINGS.spacing;
  const radius = Math.ceil(3 * sigma);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, index) => Math.exp(-0.5 * ((index - radius) / sigma) ** 2));
  const total = kernel.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= total;
  for (const stride of [1, size, size * size]) {
    const next = new Float32Array(field.length);
    for (let index = 0; index < field.length; index += 1) {
      const coordinate = Math.floor(index / stride) % size;
      let value = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        if (coordinate + offset < 0 || coordinate + offset >= size) continue;
        value += field[index + offset * stride] * kernel[offset + radius];
      }
      next[index] = value;
    }
    field = next;
  }
  // Keep crossings away from exact grid vertices, avoiding microscopic
  // zero-area faces after storing positions as Float32 in the browser.
  for (let index = 0; index < field.length; index += 1) {
    const delta = field[index] - SETTINGS.isolation;
    if (Math.abs(delta) < 0.001) field[index] = SETTINGS.isolation + (delta < 0 ? -0.001 : 0.001);
  }
  return { field, minimum, size };
}

function extractSurface({ field, minimum, size }) {
  const material = new MeshStandardMaterial();
  const marching = new MarchingCubes(size, material, false, false, 300_000);
  marching.field.set(field);
  marching.isolation = SETTINGS.isolation;
  marching.update();
  const rawPositions = marching.geometry.getAttribute('position').array;
  const rawNormals = marching.geometry.getAttribute('normal').array;
  const count = marching.geometry.drawRange.count;
  const positions = [];
  const normals = [];
  const indices = [];
  const welded = new Map();
  for (let offset = 0; offset < count * 3; offset += 3) {
    const point = [0, 1, 2].map((axis) => minimum[axis] + (rawPositions[offset + axis] + 1) * size * 0.5 * SETTINGS.spacing);
    // Weld at finer precision than the stored positions so neighboring cells
    // share their edge vertices without merging distinct nearby intersections.
    const key = point.map((value) => Math.round(value * 1e7)).join(',');
    let vertex = welded.get(key);
    if (vertex === undefined) {
      vertex = positions.length / 3;
      welded.set(key, vertex);
      positions.push(...point.map((value) => round(value, 5)));
      const length = Math.hypot(rawNormals[offset], rawNormals[offset + 1], rawNormals[offset + 2]);
      normals.push(...[0, 1, 2].map((axis) => round(rawNormals[offset + axis] / length, 4)));
    }
    indices.push(vertex);
  }
  marching.geometry.dispose();
  material.dispose();
  return { positions, normals, indices };
}

function largestComponent(mesh) {
  const parent = Array.from({ length: mesh.positions.length / 3 }, (_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    parent[find(mesh.indices[offset])] = find(mesh.indices[offset + 1]);
    parent[find(mesh.indices[offset + 1])] = find(mesh.indices[offset + 2]);
  }
  const counts = new Map();
  for (let vertex = 0; vertex < parent.length; vertex += 1) {
    const root = find(vertex);
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  if (counts.size === 1) return mesh;
  // Intersecting source closures can leave tiny isolated fragments. Keep the
  // actual portion, so no floating flecks appear beside an expanded region.
  const largest = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const remap = new Map();
  const positions = [];
  const normals = [];
  const indices = [];
  for (let vertex = 0; vertex < parent.length; vertex += 1) {
    if (find(vertex) !== largest) continue;
    remap.set(vertex, positions.length / 3);
    positions.push(...mesh.positions.slice(vertex * 3, vertex * 3 + 3));
    normals.push(...mesh.normals.slice(vertex * 3, vertex * 3 + 3));
  }
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    if (remap.has(mesh.indices[offset])) indices.push(...mesh.indices.slice(offset, offset + 3).map((vertex) => remap.get(vertex)));
  }
  return { positions, normals, indices };
}

/** Remove voxel-gradient ripples without moving or shrinking the solid. */
function smoothNormals(mesh) {
  const adjacency = Array.from({ length: mesh.positions.length / 3 }, () => new Set());
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const first = mesh.indices[offset + corner];
      const second = mesh.indices[offset + (corner + 1) % 3];
      adjacency[first].add(second);
      adjacency[second].add(first);
    }
  }
  let normals = mesh.normals;
  for (let pass = 0; pass < SETTINGS.normalSmoothingPasses; pass += 1) {
    const next = normals.slice();
    for (let vertex = 0; vertex < adjacency.length; vertex += 1) {
      const neighbors = adjacency[vertex];
      const vector = [0, 0, 0];
      for (const neighbor of neighbors) {
        for (let axis = 0; axis < 3; axis += 1) vector[axis] += normals[neighbor * 3 + axis];
      }
      for (let axis = 0; axis < 3; axis += 1) {
        vector[axis] = normals[vertex * 3 + axis] * (1 - SETTINGS.normalSmoothingBlend)
          + vector[axis] / neighbors.size * SETTINGS.normalSmoothingBlend;
      }
      const length = Math.hypot(...vector);
      for (let axis = 0; axis < 3; axis += 1) next[vertex * 3 + axis] = vector[axis] / length;
    }
    normals = next;
  }
  return { ...mesh, normals: normals.map((value) => round(value, 4)) };
}

function validateSurface({ positions, normals, indices }) {
  if (!positions.length || positions.some((value) => !Number.isFinite(value)) || normals.some((value) => !Number.isFinite(value))) {
    throw new Error('The extracted solid has invalid coordinates or normals.');
  }
  const edges = new Map();
  let volume = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const vertices = indices.slice(offset, offset + 3);
    const [a, b, c] = trianglePoints(positions, indices, offset);
    const u = subtract(b, a);
    const v = subtract(c, a);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (Math.hypot(...normal) < 1e-10) throw new Error('The extracted solid has a degenerate triangle.');
    volume += dot(a, normal) / 6;
    for (let corner = 0; corner < 3; corner += 1) {
      const first = vertices[corner];
      const second = vertices[(corner + 1) % 3];
      const key = `${Math.min(first, second)},${Math.max(first, second)}`;
      const edge = edges.get(key) ?? { count: 0, winding: 0 };
      edge.count += 1;
      edge.winding += first < second ? 1 : -1;
      edges.set(key, edge);
    }
  }
  if ([...edges.values()].some((edge) => edge.count !== 2 || edge.winding !== 0) || volume <= 0) {
    throw new Error('The extracted solid is not a closed, consistently wound positive volume.');
  }
  return volume;
}

const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);

/** Closest triangle point, with barycentric weights for reproducible anchors. */
function closestTriangle(point, a, b, c) {
  const ab = subtract(b, a), ac = subtract(c, a), ap = subtract(point, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [a, [1, 0, 0]];
  const bp = subtract(point, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [b, [0, 1, 0]];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const weight = d1 / (d1 - d3);
    return [a.map((value, axis) => value + ab[axis] * weight), [1 - weight, weight, 0]];
  }
  const cp = subtract(point, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [c, [0, 0, 1]];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const weight = d2 / (d2 - d6);
    return [a.map((value, axis) => value + ac[axis] * weight), [1 - weight, 0, weight]];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const weight = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [b.map((value, axis) => value + (c[axis] - value) * weight), [0, 1 - weight, weight]];
  }
  const denominator = 1 / (va + vb + vc), v = vb * denominator, w = vc * denominator;
  return [a.map((value, axis) => value + ab[axis] * v + ac[axis] * w), [1 - v - w, v, w]];
}

function projectSources(originalPositions, labels, label, mesh) {
  const cellSize = 3;
  const grid = new Map();
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const points = trianglePoints(mesh.positions, mesh.indices, offset);
    const minimum = [0, 1, 2].map((axis) => Math.floor(Math.min(...points.map((point) => point[axis])) / cellSize));
    const maximum = [0, 1, 2].map((axis) => Math.floor(Math.max(...points.map((point) => point[axis])) / cellSize));
    for (let x = minimum[0]; x <= maximum[0]; x += 1) {
      for (let y = minimum[1]; y <= maximum[1]; y += 1) {
        for (let z = minimum[2]; z <= maximum[2]; z += 1) {
          const key = `${x},${y},${z}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(offset);
        }
      }
    }
  }
  const sourceVertices = [], sourcePositions = [], sourceNormals = [], sourceTriangles = [], sourceBarycentrics = [];
  for (let vertex = 0; vertex < labels.length; vertex += 1) {
    if (labels[vertex] !== label) continue;
    const point = originalPositions.slice(vertex * 3, vertex * 3 + 3);
    const cell = point.map((value) => Math.floor(value / cellSize));
    const visited = new Set();
    let bestDistance = Infinity;
    let nearest, nearestNormal, nearestTriangle, nearestWeights;
    for (let radius = 0; radius < 40; radius += 1) {
      for (let x = cell[0] - radius; x <= cell[0] + radius; x += 1) {
        for (let y = cell[1] - radius; y <= cell[1] + radius; y += 1) {
          for (let z = cell[2] - radius; z <= cell[2] + radius; z += 1) {
            if (radius && Math.max(Math.abs(x - cell[0]), Math.abs(y - cell[1]), Math.abs(z - cell[2])) !== radius) continue;
            for (const triangle of grid.get(`${x},${y},${z}`) ?? []) {
              if (visited.has(triangle)) continue;
              visited.add(triangle);
              const vertices = mesh.indices.slice(triangle, triangle + 3);
              const [candidate, weights] = closestTriangle(point, ...trianglePoints(mesh.positions, mesh.indices, triangle));
              const difference = subtract(point, candidate);
              const distance = dot(difference, difference);
              if (distance >= bestDistance) continue;
              bestDistance = distance;
              nearest = candidate;
              nearestNormal = [0, 1, 2].map((axis) => vertices.reduce((sum, index, corner) => sum + mesh.normals[index * 3 + axis] * weights[corner], 0));
              nearestTriangle = triangle / 3;
              nearestWeights = weights;
            }
          }
        }
      }
      const outsideDistance = Math.min(...point.flatMap((value, axis) => [
        value - (cell[axis] - radius) * cellSize,
        (cell[axis] + radius + 1) * cellSize - value,
      ]));
      if (bestDistance < outsideDistance ** 2) break;
    }
    if (!nearest) throw new Error('A cortical signal source could not be projected onto its solid.');
    sourceVertices.push(vertex);
    sourcePositions.push(...nearest.map((value) => round(value, 5)));
    const length = Math.hypot(...nearestNormal);
    sourceNormals.push(...nearestNormal.map((value) => round(value / length, 4)));
    sourceTriangles.push(nearestTriangle);
    sourceBarycentrics.push(round(nearestWeights[0], 8), round(nearestWeights[1], 8));
  }
  return { sourceVertices, sourcePositions, sourceNormals, sourceTriangles, sourceBarycentrics };
}

const regions = [];
const statistics = [];
for (const side of ['left', 'right']) {
  const source = cortex.hemispheres[side];
  const labels = atlas.hemispheres[side];
  const surface = buildRegionSurface(source.positions, source.indices, labels);
  for (const [label, outerIndices] of [...surface.groups].sort((a, b) => a[0] - b[0])) {
    const closure = buildRegionSolid(surface.expandedPositions, outerIndices);
    const positions = [...surface.expandedPositions, ...closure.positions];
    const indices = [...outerIndices, ...closure.indices.map((vertex) => vertex + surface.expandedPositions.length / 3)];
    const mesh = smoothNormals(largestComponent(extractSurface(blurVoxels(voxelize(positions, indices)))));
    const volume = validateSurface(mesh);
    const anchors = projectSources(source.positions, labels, label, mesh);
    regions.push({ side, label, ...mesh, ...anchors });
    const summary = { side, label, vertices: mesh.positions.length / 3, triangles: mesh.indices.length / 3, sources: anchors.sourceVertices.length, volumeMM3: round(volume, 3) };
    statistics.push(summary);
    console.log(JSON.stringify(summary));
  }
}

const header = {
  version: 1,
  ...SETTINGS,
  coordinateSystem: 'FreeSurfer surface RAS, millimeters',
  description: 'Illustrative smoothed solid closures of fsaverage5 atlas patches; not measured interior anatomy.',
  sources,
};
const compressed = gzipSync(JSON.stringify({ ...header, regions }), { level: 9 });
writeFileSync(new URL('src/assets/brain-region-solids.json.gz', ROOT), compressed);
writeFileSync(new URL('src/assets/brain-region-solids.metadata.json', ROOT), JSON.stringify({
  ...header,
  assetSha256: sha256(compressed),
  compressedBytes: compressed.length,
  regions: statistics,
}, null, 2) + '\n');
console.log(`Wrote ${regions.length} closed portions (${compressed.length} compressed bytes).`);
