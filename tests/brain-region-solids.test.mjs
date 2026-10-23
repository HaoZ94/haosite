import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildRegionSurface } from '../src/brain-regions.ts';
import { buildRegionSolid } from '../src/brain-region-solids.ts';

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

function assertClosed(sourceIndices, cap, sourceCount) {
  const boundary = new Map(cap.boundary.map(({ capVertex, sourceVertex }) => [capVertex, sourceVertex]));
  const welded = cap.indices.map((vertex) => boundary.get(vertex) ?? sourceCount + vertex);
  const edges = new Map();
  for (const indices of [sourceIndices, welded]) {
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
  }
  for (const edge of edges.values()) {
    assert.equal(edge.count, 2, 'Every welded edge has two faces: no open rim or nonmanifold joins');
    assert.equal(edge.winding, 0, 'The outer cortex and inner cut face wind consistently');
  }
}

test('a flat patch closes into a rounded solid with an unchanged rim', () => {
  const positions = Float32Array.from([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, 0, 0, 0]);
  const original = positions.slice();
  const indices = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4];
  const cap = buildRegionSolid(positions, indices);
  assert.deepEqual(positions, original);
  assert.equal(cap.boundary.length, 4);
  assertClosed(indices, cap, positions.length / 3);
  const center = cap.sourceVertices.indexOf(4);
  assert.ok(Math.abs(cap.positions[center * 3 + 2] + 0.2) < 1e-7);
  assert.ok(volume(positions, indices) + volume(cap.positions, cap.indices) > 0.25);
});

test('closed meshes need no cap and malformed geometry is rejected', () => {
  const tetrahedron = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  assert.equal(buildRegionSolid(tetrahedron, [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]).indices.length, 0);
  assert.throws(() => buildRegionSolid([0, 0, NaN], [0, 0, 0]), /finite coordinates/);
  assert.throws(() => buildRegionSolid(tetrahedron, [0, 1]), /complete triangles/);
  assert.throws(() => buildRegionSolid(tetrahedron, [0, 1, 9]), /invalid vertex/);
});

const cortex = JSON.parse(readFileSync(new URL('../src/assets/brain-fsaverage5.json', import.meta.url), 'utf8'));
const atlas = JSON.parse(readFileSync(new URL('../src/assets/brain-regions.json', import.meta.url), 'utf8'));
for (const hemisphere of ['left', 'right']) {
  test(`all ${hemisphere} regions enclose solid volumes throughout seam expansion`, () => {
    const source = cortex.hemispheres[hemisphere];
    const surface = buildRegionSurface(source.positions, source.indices, atlas.hemispheres[hemisphere]);
    for (const [label, indices] of surface.groups) {
      const cap = buildRegionSolid(surface.expandedPositions, indices);
      assert.ok(cap.positions.every(Number.isFinite));
      assertClosed(indices, cap, surface.positions.length / 3);
      for (const { capVertex, sourceVertex } of cap.boundary) {
        assert.deepEqual(cap.positions.slice(capVertex * 3, capVertex * 3 + 3), surface.expandedPositions.slice(sourceVertex * 3, sourceVertex * 3 + 3));
      }
      let maximumDepth = 0;
      for (let vertex = 0; vertex < cap.sourceVertices.length; vertex += 1) {
        maximumDepth = Math.max(maximumDepth, Math.hypot(...[0, 1, 2].map((axis) => cap.positions[vertex * 3 + axis] - surface.expandedPositions[cap.sourceVertices[vertex] * 3 + axis])));
      }
      assert.ok(maximumDepth > 12, `Region ${label} has substantial interior depth in millimeters`);
      assert.ok(maximumDepth < 70, 'The interior remains bounded near its lobe');
      for (const amount of [0, 0.25, 0.5, 1]) {
        const outer = surface.positions.map((value, index) => value + (surface.expandedPositions[index] - value) * amount);
        const inner = cap.positions.slice();
        for (const { capVertex, sourceVertex } of cap.boundary) {
          for (let axis = 0; axis < 3; axis += 1) inner[capVertex * 3 + axis] = outer[sourceVertex * 3 + axis];
        }
        const enclosed = volume(outer, indices) + volume(inner, cap.indices);
        assert.ok(enclosed > 3000, `Region ${label} has positive, nontrivial enclosed volume at expansion ${amount}`);
        for (let offset = 0; offset < cap.indices.length; offset += 3) {
          const [a, b, c] = cap.indices.slice(offset, offset + 3).map((vertex) => vertex * 3);
          const u = [0, 1, 2].map((axis) => inner[b + axis] - inner[a + axis]);
          const v = [0, 1, 2].map((axis) => inner[c + axis] - inner[a + axis]);
          const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
          assert.ok(area > 1e-8, 'Cut faces have finite, nonzero normals during expansion');
        }
      }
    }
  });
}
