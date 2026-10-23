import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildRoundedSurface } from '../src/brain-region-rounding.ts';

function normal(positions, indices, offset) {
  const a = indices[offset] * 3, b = indices[offset + 1] * 3, c = indices[offset + 2] * 3;
  const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
  const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function volume(positions, indices) {
  let result = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset] * 3, b = indices[offset + 1] * 3, c = indices[offset + 2] * 3;
    result += (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      + positions[a + 1] * (positions[b + 2] * positions[c] - positions[b] * positions[c + 2])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) / 6;
  }
  return result;
}

function assertClosed(indices) {
  const edges = new Map();
  for (let offset = 0; offset < indices.length; offset += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = indices[offset + corner], b = indices[offset + (corner + 1) % 3];
      const key = `${Math.min(a, b)},${Math.max(a, b)}`;
      const edge = edges.get(key) ?? { count: 0, winding: 0 };
      edge.count += 1;
      edge.winding += a < b ? 1 : -1;
      edges.set(key, edge);
    }
  }
  for (const edge of edges.values()) {
    assert.equal(edge.count, 2, 'Each edge belongs to exactly two faces');
    assert.equal(edge.winding, 0, 'Neighboring faces have consistent winding');
  }
}

const anatomy = JSON.parse(readFileSync(new URL('../src/assets/brain-subcortical.json', import.meta.url), 'utf8'));
const hippocampi = JSON.parse(readFileSync(new URL('../src/assets/brain-hippocampus.json', import.meta.url), 'utf8'));
for (const [name, source] of Object.entries({ ...anatomy.parts, ...hippocampi.parts })) {
  test(`${name} rounds smoothly while its assembled shape and solid topology remain intact`, () => {
    const original = source.positions.slice();
    const rounded = buildRoundedSurface(source.positions, source.indices);
    assert.deepEqual(source.positions, original, 'Input anatomy is unchanged');
    assertClosed(rounded.outerIndices);
    assert.equal(rounded.outerIndices.length, source.indices.length * 4);
    assert.ok(rounded.expandedPositions.every(Number.isFinite));
    let moved = 0;
    for (let vertex = 0; vertex < rounded.sourceVertices.length; vertex += 1) {
      const sourceVertex = rounded.sourceVertices[vertex];
      for (let axis = 0; axis < 3; axis += 1) {
        assert.equal(rounded.restPositions[vertex * 3 + axis], Math.fround(source.positions[sourceVertex * 3 + axis]));
      }
      const displacement = Math.hypot(...[0, 1, 2].map((axis) => rounded.expandedPositions[vertex * 3 + axis] - rounded.restPositions[vertex * 3 + axis]));
      assert.ok(displacement < 0.8, 'One local pass preserves the anatomical details');
      if (displacement > 1e-4) moved += 1;
    }
    assert.ok(moved > rounded.sourceVertices.length * 0.9, 'Smoothing changes the actual geometry');
    for (const { index, a, b } of rounded.edges) {
      for (let axis = 0; axis < 3; axis += 1) {
        const midpoint = (rounded.restPositions[a * 3 + axis] + rounded.restPositions[b * 3 + axis]) * 0.5;
        assert.ok(Math.abs(rounded.restPositions[index * 3 + axis] - midpoint) < 1e-5, 'Linear rest refinement preserves the assembled surface');
      }
    }
    const originalVolume = volume(rounded.restPositions, rounded.outerIndices);
    const expandedVolume = volume(rounded.expandedPositions, rounded.outerIndices);
    assert.ok(expandedVolume / originalVolume > 0.97 && expandedVolume < originalVolume, 'Rounding retains the solid volume');
    for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
      const current = rounded.restPositions.map((value, index) => value + (rounded.expandedPositions[index] - value) * amount);
      for (let offset = 0; offset < rounded.outerIndices.length; offset += 3) {
        const before = normal(rounded.restPositions, rounded.outerIndices, offset);
        const after = normal(current, rounded.outerIndices, offset);
        const areaSquared = before.reduce((sum, value) => sum + value * value, 0);
        const dot = before.reduce((sum, value, axis) => sum + value * after[axis], 0);
        assert.ok(dot > areaSquared * 0.05, `Triangles retain orientation at expansion ${amount}`);
      }
    }
  });
}

test('invalid lower surfaces are rejected before subdivision', () => {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  const tetrahedron = [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3];
  assert.throws(() => buildRoundedSurface([NaN, 0, 0], [0, 0, 0]), /finite coordinates/);
  assert.throws(() => buildRoundedSurface(positions, [0, 1]), /complete triangles/);
  assert.throws(() => buildRoundedSurface(positions, [0, 1, 9]), /invalid vertex/);
  assert.throws(() => buildRoundedSurface(positions, [0, 1, 2]), /closed.*manifold/);
  assert.throws(() => buildRoundedSurface(positions, tetrahedron.slice(0, -3).concat([2, 3, 0])), /consistently wound/);
});
