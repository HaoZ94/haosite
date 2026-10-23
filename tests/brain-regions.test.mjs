import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildRegionSurface } from '../src/brain-regions.ts';

const point = (positions, vertex) => Array.from(positions.slice(vertex * 3, vertex * 3 + 3));
const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const normal = (positions, [a, b, c]) => {
  const u = subtract(point(positions, b), point(positions, a));
  const v = subtract(point(positions, c), point(positions, a));
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
};
const area = (positions, indices) => {
  let total = 0;
  for (let offset = 0; offset < indices.length; offset += 3) total += Math.hypot(...normal(positions, indices.slice(offset, offset + 3))) / 2;
  return total;
};

function contourAdjacency(groups) {
  const adjacency = new Map();
  for (const indices of groups.values()) {
    const edges = new Map();
    for (let offset = 0; offset < indices.length; offset += 3) {
      for (let corner = 0; corner < 3; corner += 1) {
        const a = indices[offset + corner], b = indices[offset + (corner + 1) % 3];
        const key = `${Math.min(a, b)},${Math.max(a, b)}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const [key, count] of edges) {
      if (count !== 1) continue;
      const [a, b] = key.split(',').map(Number);
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a).add(b);
      adjacency.get(b).add(a);
    }
  }
  return adjacency;
}

function roughness(positions, adjacency) {
  let total = 0;
  for (const [vertex, neighbors] of adjacency) {
    if (neighbors.size !== 2) continue;
    const [a, b] = [...neighbors];
    for (let axis = 0; axis < 3; axis += 1) total += (positions[vertex * 3 + axis] - (positions[a * 3 + axis] + positions[b * 3 + axis]) / 2) ** 2;
  }
  return total;
}

test('two-label cuts preserve area, winding, and an original signal source in every face', () => {
  const positions = [0, 0, 0, 2, 0, 0, 0, 2, 0];
  const labels = [1, 2, 1];
  const surface = buildRegionSurface(positions, [0, 1, 2], labels);
  assert.deepEqual(surface.blends, [{ index: 3, sources: [1, 2] }, { index: 4, sources: [0, 1] }]);
  assert.equal([...surface.groups.values()].flat().length, 9);
  assert.equal(area(surface.positions, [...surface.groups.values()].flat()), 2);
  for (const [label, indices] of surface.groups) {
    for (let offset = 0; offset < indices.length; offset += 3) {
      const face = indices.slice(offset, offset + 3);
      assert.ok(face.some((vertex) => vertex < labels.length && labels[vertex] === label));
      assert.ok(normal(surface.positions, face)[2] > 0);
    }
  }
  assert.deepEqual(positions, [0, 0, 0, 2, 0, 0, 0, 2, 0], 'The input surface is not mutated');
});

test('three-label cuts share a pinned junction and retain all three labels', () => {
  const surface = buildRegionSurface([0, 0, 0, 3, 0, 0, 0, 3, 0], [0, 1, 2], [0, 1, 2]);
  assert.deepEqual([...surface.groups.keys()], [0, 1, 2]);
  assert.equal([...surface.groups.values()].flat().length, 18);
  const junction = surface.blends.find(({ sources }) => sources.length === 3).index;
  assert.deepEqual(point(surface.positions, junction), [1, 1, 0]);
  assert.deepEqual(point(surface.expandedPositions, junction), [1, 1, 0]);
  for (const [label, indices] of surface.groups) {
    assert.ok(indices.includes(junction));
    for (let offset = 0; offset < indices.length; offset += 3) {
      const face = indices.slice(offset, offset + 3);
      assert.ok(face.includes(label));
      assert.ok(normal(surface.positions, face)[2] > 0);
    }
  }
  assert.equal(area(surface.positions, [...surface.groups.values()].flat()), 4.5);
});

test('region surfaces reject incomplete coordinates, invalid labels, and malformed topology', () => {
  const positions = [0, 0, 0, 2, 0, 0, 0, 2, 0];
  assert.throws(() => buildRegionSurface(positions, [0, 1, 2], []), /one atlas label per vertex/);
  assert.throws(() => buildRegionSurface(positions, [0, 1], [1, 1, 2]), /complete triangles/);
  for (const label of [-1, 7, 1.5, NaN]) assert.throws(() => buildRegionSurface(positions, [0, 1, 2], [1, label, 2]), /Invalid cortical region label/);
  for (const index of [-1, 3, 0.5, NaN]) assert.throws(() => buildRegionSurface(positions, [0, index, 2], [1, 1, 2]), /invalid vertex/);
  assert.throws(() => buildRegionSurface(positions.slice(1), [0, 1, 2], [1, 1, 2]), /three finite coordinates/);
  assert.throws(() => buildRegionSurface([NaN, ...positions.slice(1)], [0, 1, 2], [1, 1, 2]), /three finite coordinates/);
});

for (const hemisphere of ['left', 'right']) {
  test(`the ${hemisphere} cortex has smooth shared seams without altering anatomy or reversing faces`, () => {
    const cortex = JSON.parse(readFileSync(new URL('../src/assets/brain-fsaverage5.json', import.meta.url), 'utf8'));
    const atlas = JSON.parse(readFileSync(new URL('../src/assets/brain-regions.json', import.meta.url), 'utf8'));
    const source = cortex.hemispheres[hemisphere];
    const labels = atlas.hemispheres[hemisphere];
    const surface = buildRegionSurface(source.positions, source.indices, labels);
    const allIndices = [...surface.groups.values()].flat();
    assert.deepEqual([...surface.groups.keys()].sort(), [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(surface.positions.slice(0, source.positions.length), Float32Array.from(source.positions));
    assert.deepEqual(surface.expandedPositions.slice(0, source.positions.length), Float32Array.from(source.positions),
      'All original anatomical points and signal endpoints stay fixed');
    assert.ok(Math.abs(area(surface.positions, allIndices) - area(source.positions, source.indices)) < area(source.positions, source.indices) * 1e-6,
      'The collapsed pieces cover the original surface exactly');
    const interpolationKeys = new Set();
    for (const { index, sources } of surface.blends) {
      const key = [...sources].sort((a, b) => a - b).join(',');
      assert.ok(!interpolationKeys.has(key), 'Adjacent regions reuse the same seam vertex');
      interpolationKeys.add(key);
      assert.equal([...surface.groups.values()].filter((indices) => indices.includes(index)).length, sources.length,
        'Every midpoint or triple junction is shared by its neighboring regions');
      const travel = Math.hypot(...subtract(point(surface.expandedPositions, index), point(surface.positions, index)));
      if (sources.length === 3) assert.equal(travel, 0);
      else assert.ok(travel <= Math.hypot(...subtract(point(source.positions, sources[0]), point(source.positions, sources[1]))) * 0.5 + 1e-5);
    }
    for (const [label, indices] of surface.groups) {
      for (let offset = 0; offset < indices.length; offset += 3) {
        const face = indices.slice(offset, offset + 3);
        assert.ok(face.some((vertex) => vertex < labels.length && labels[vertex] === label), 'Every clickable face includes a valid signal source');
        const before = normal(surface.positions, face);
        const after = normal(surface.expandedPositions, face);
        assert.ok(dot(before, after) >= dot(before, before) * 0.149, 'Smoothing never collapses or reverses a cortical triangle');
      }
    }
    assert.ok(surface.expandedPositions.every(Number.isFinite));
    const contour = contourAdjacency(surface.groups);
    assert.ok(roughness(surface.expandedPositions, contour) < roughness(surface.positions, contour) * 0.75,
      'Expanded contour curvature is measurably smoother than the interpolated cut');
  });
}
