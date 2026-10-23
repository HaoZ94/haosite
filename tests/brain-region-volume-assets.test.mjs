import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

const compressed = readFileSync(new URL('../src/assets/brain-region-solids.json.gz', import.meta.url));
const asset = JSON.parse(gunzipSync(compressed));
const metadata = JSON.parse(readFileSync(new URL('../src/assets/brain-region-solids.metadata.json', import.meta.url)));
const atlas = JSON.parse(readFileSync(new URL('../src/assets/brain-regions.json', import.meta.url)));
const cortex = JSON.parse(readFileSync(new URL('../src/assets/brain-fsaverage5.json', import.meta.url)));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function assertUnitNormals(normals) {
  assert.ok(normals.every(Number.isFinite));
  for (let offset = 0; offset < normals.length; offset += 3) {
    assert.ok(Math.abs(Math.hypot(...normals.slice(offset, offset + 3)) - 1) < 0.00015, 'Stored normals have unit length within quantization precision');
  }
}

function checkTopology(region) {
  const count = region.positions.length / 3;
  const parents = Array.from({ length: count }, (_, index) => index);
  const find = (vertex) => {
    while (parents[vertex] !== vertex) { parents[vertex] = parents[parents[vertex]]; vertex = parents[vertex]; }
    return vertex;
  };
  const edges = new Map();
  const positions = Float32Array.from(region.positions);
  let volume = 0;
  for (let offset = 0; offset < region.indices.length; offset += 3) {
    const triangle = region.indices.slice(offset, offset + 3);
    const [a, b, c] = triangle.map((vertex) => vertex * 3);
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    assert.ok(Math.hypot(...normal) > 1e-10, 'Triangles remain nondegenerate at browser Float32 precision');
    volume += (positions[a] * normal[0] + positions[a + 1] * normal[1] + positions[a + 2] * normal[2]) / 6;
    for (let corner = 0; corner < 3; corner += 1) {
      const first = triangle[corner], second = triangle[(corner + 1) % 3];
      parents[find(first)] = find(second);
      const key = Math.min(first, second) * count + Math.max(first, second);
      const edge = edges.get(key) ?? { count: 0, winding: 0 };
      edge.count += 1;
      edge.winding += first < second ? 1 : -1;
      edges.set(key, edge);
    }
  }
  for (const edge of edges.values()) {
    assert.equal(edge.count, 2, 'Every edge is closed by exactly two faces');
    assert.equal(edge.winding, 0, 'The complete solid has consistent outward winding');
  }
  assert.equal(new Set(parents.map((_, vertex) => find(vertex))).size, 1, 'A region is one connected portion without floating fragments');
  assert.ok(volume > 3_000, 'The region encloses substantial positive volume');
  return volume;
}

function checkCurvedInterior(region) {
  // Points farther than 4 mm from the measured cortical vertices belong to the
  // new interior. Their changing normals distinguish a rounded cut from a flat
  // sheet, independently of the detailed folds on the original outer cortex.
  const original = cortex.hemispheres[region.side].positions;
  const cells = new Map();
  for (const vertex of region.sourceVertices) {
    const key = [0, 1, 2].map((axis) => Math.floor(original[vertex * 3 + axis] / 4)).join(',');
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(vertex);
  }
  const sum = [0, 0, 0];
  let innerCount = 0;
  for (let vertex = 0; vertex < region.positions.length / 3; vertex += 1) {
    const point = region.positions.slice(vertex * 3, vertex * 3 + 3);
    const cell = point.map((value) => Math.floor(value / 4));
    let nearCortex = false;
    for (let x = -1; x <= 1 && !nearCortex; x += 1) {
      for (let y = -1; y <= 1 && !nearCortex; y += 1) {
        for (let z = -1; z <= 1 && !nearCortex; z += 1) {
          for (const source of cells.get(`${cell[0] + x},${cell[1] + y},${cell[2] + z}`) ?? []) {
            if (point.reduce((distance, value, axis) => distance + (value - original[source * 3 + axis]) ** 2, 0) < 16) {
              nearCortex = true;
              break;
            }
          }
        }
      }
    }
    if (nearCortex) continue;
    innerCount += 1;
    for (let axis = 0; axis < 3; axis += 1) sum[axis] += region.normals[vertex * 3 + axis];
  }
  assert.ok(innerCount > 100, 'The portion has a substantial interior surface');
  assert.ok(1 - Math.hypot(...sum) / innerCount > 0.03, 'The interior normals vary across an actually curved surface');
}

test('the compressed volume asset covers every atlas region with reproducible provenance', () => {
  assert.equal(asset.version, 1);
  assert.equal(asset.regions.length, 14);
  assert.deepEqual(new Set(asset.regions.map(({ side, label }) => `${side}:${label}`)), new Set(['left', 'right'].flatMap((side) => Array.from({ length: 7 }, (_, label) => `${side}:${label}`))));
  assert.equal(hash(compressed), metadata.assetSha256);
  assert.equal(compressed.length, metadata.compressedBytes);
  for (const source of metadata.sources) {
    assert.equal(hash(readFileSync(new URL(`../${source.path}`, import.meta.url))), source.sha256, `${source.path} matches the generated asset`);
  }
});

for (const region of asset.regions) {
  test(`${region.side} region ${region.label} is a rounded closed volume with surface-attached signal anchors`, () => {
    assert.equal(region.positions.length % 3, 0);
    assert.equal(region.normals.length, region.positions.length);
    assert.equal(region.indices.length % 3, 0);
    assert.ok(region.positions.every(Number.isFinite));
    assert.ok(region.indices.every((index) => Number.isInteger(index) && index >= 0 && index * 3 < region.positions.length));
    assertUnitNormals(region.normals);
    const volume = checkTopology(region);
    const statistics = metadata.regions.find(({ side, label }) => side === region.side && label === region.label);
    assert.ok(Math.abs(volume - statistics.volumeMM3) < 0.1, 'Geometry agrees with its recorded solid volume');
    const expectedSources = atlas.hemispheres[region.side].flatMap((label, vertex) => label === region.label ? [vertex] : []);
    assert.deepEqual(region.sourceVertices, expectedSources, 'Every original atlas signal source maps to exactly its own region');
    assert.equal(region.sourcePositions.length, expectedSources.length * 3);
    assert.equal(region.sourceNormals.length, expectedSources.length * 3);
    assert.equal(region.sourceTriangles.length, expectedSources.length);
    assert.equal(region.sourceBarycentrics.length, expectedSources.length * 2);
    assert.ok(region.sourcePositions.every(Number.isFinite));
    assert.ok(region.sourceBarycentrics.every(Number.isFinite));
    assertUnitNormals(region.sourceNormals);
    for (let source = 0; source < expectedSources.length; source += 1) {
      const triangle = region.sourceTriangles[source];
      assert.ok(Number.isInteger(triangle) && triangle >= 0 && triangle * 3 < region.indices.length);
      const u = region.sourceBarycentrics[source * 2], v = region.sourceBarycentrics[source * 2 + 1];
      const weights = [u, v, 1 - u - v];
      assert.ok(weights.every((weight) => weight >= -1e-8 && weight <= 1 + 1e-8), 'Signal anchor lies inside its surface triangle');
      const vertices = region.indices.slice(triangle * 3, triangle * 3 + 3);
      const interpolatedNormal = [0, 1, 2].map((axis) => vertices.reduce((sum, vertex, corner) => sum + region.normals[vertex * 3 + axis] * weights[corner], 0));
      const normalLength = Math.hypot(...interpolatedNormal);
      for (let axis = 0; axis < 3; axis += 1) {
        const expected = vertices.reduce((sum, vertex, corner) => sum + region.positions[vertex * 3 + axis] * weights[corner], 0);
        assert.ok(Math.abs(region.sourcePositions[source * 3 + axis] - expected) < 0.00001, 'Signal anchor is on the rendered triangle');
        assert.ok(Math.abs(region.sourceNormals[source * 3 + axis] - interpolatedNormal[axis] / normalLength) < 0.0001, 'Signal lift follows the interpolated surface normal');
      }
    }
    checkCurvedInterior(region);
  });
}
