import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url));
const decode = (path) => JSON.parse(read(path));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assetBytes = read('../src/assets/brain-hippocampus.json');
const anatomy = JSON.parse(assetBytes);
const metadata = decode('../src/assets/brain-hippocampus.metadata.json');
const cortex = decode('../src/assets/brain-fsaverage5.json');
const lower = decode('../src/assets/brain-subcortical.json');

function bounds(positions) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], positions[offset + axis]);
      maximum[axis] = Math.max(maximum[axis], positions[offset + axis]);
    }
  }
  return [minimum, maximum];
}

test('hippocampi retain verified segmentation provenance and reproducible output hashes', () => {
  assert.equal(anatomy.source.sha256, 'b55ef817e5e5bd1a3d76d4a2305283eef16fbff199ead3d840dd4b0fa8205e48');
  assert.equal(anatomy.source.sha256, lower.source.sha256, 'Use the same fsaverage anatomy as the existing lower brain');
  assert.equal(anatomy.source.url, lower.source.url);
  assert.deepEqual(anatomy.source, metadata.source);
  assert.equal(metadata.outputSha256, hash(assetBytes));
  assert.equal(metadata.generator.sha256, hash(read(`../${metadata.generator.path}`)));
  assert.deepEqual(Object.keys(anatomy.parts), ['hippocampusLeft', 'hippocampusRight']);
  assert.deepEqual(anatomy.parts.hippocampusLeft.labels, [17]);
  assert.deepEqual(anatomy.parts.hippocampusRight.labels, [53]);
  assert.deepEqual(anatomy.source.vox2rasTkr, [
    [-1, 0, 0, 128], [0, 0, 1, -128], [0, -1, 0, 128], [0, 0, 0, 1],
  ], 'The extraction must retain FreeSurfer surface RAS orientation and millimeter scale');
});

for (const [name, mesh] of Object.entries(anatomy.parts)) {
  test(`${name} is one closed, nondegenerate solid with outward normals`, () => {
    const vertexCount = mesh.positions.length / 3;
    assert.ok(Number.isInteger(vertexCount) && vertexCount > 1000);
    assert.equal(mesh.indices.length % 3, 0);
    assert.equal(mesh.normals.length, mesh.positions.length);
    assert.ok(mesh.positions.every(Number.isFinite));
    assert.ok(mesh.normals.every(Number.isFinite));
    for (let offset = 0; offset < mesh.normals.length; offset += 3) {
      assert.ok(Math.abs(Math.hypot(...mesh.normals.slice(offset, offset + 3)) - 1) < 2e-5);
    }

    const edges = new Map();
    const neighbors = Array.from({ length: vertexCount }, () => new Set());
    let signedVolume = 0;
    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
      const face = mesh.indices.slice(offset, offset + 3);
      assert.equal(new Set(face).size, 3);
      assert.ok(face.every((vertex) => Number.isInteger(vertex) && vertex >= 0 && vertex < vertexCount));
      const [a, b, c] = face.map((vertex) => vertex * 3);
      const u = [0, 1, 2].map((axis) => mesh.positions[b + axis] - mesh.positions[a + axis]);
      const v = [0, 1, 2].map((axis) => mesh.positions[c + axis] - mesh.positions[a + axis]);
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      assert.ok(Math.hypot(...normal) > 1e-8, 'No stored triangles may collapse after coordinate rounding');
      signedVolume += normal.reduce((sum, value, axis) => sum + mesh.positions[a + axis] * value, 0) / 6;
      const shadingNormal = [0, 1, 2].map((axis) => (mesh.normals[a + axis] + mesh.normals[b + axis] + mesh.normals[c + axis]) / 3);
      assert.ok(normal.reduce((sum, value, axis) => sum + value * shadingNormal[axis], 0) > 0,
        'Smoothed shading normals must face the same direction as every triangle');
      for (let corner = 0; corner < 3; corner += 1) {
        const first = face[corner], second = face[(corner + 1) % 3];
        neighbors[first].add(second);
        neighbors[second].add(first);
        const key = `${Math.min(first, second)},${Math.max(first, second)}`;
        const edge = edges.get(key) ?? { count: 0, winding: 0 };
        edge.count += 1;
        edge.winding += first < second ? 1 : -1;
        edges.set(key, edge);
      }
    }
    for (const edge of edges.values()) {
      assert.equal(edge.count, 2, 'Every edge must have two incident faces');
      assert.equal(edge.winding, 0, 'Adjacent faces must have opposite edge directions');
    }
    const visited = new Set([0]);
    const queue = [0];
    for (const vertex of queue) {
      for (const neighbor of neighbors[vertex]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    assert.equal(visited.size, vertexCount, 'No isolated fragments or unreferenced vertices');
    assert.equal(vertexCount - edges.size + mesh.indices.length / 3, 2, 'Each whole hippocampus is a single closed surface');
    assert.ok(signedVolume > 0, 'Surface winding must point outward');
    assert.ok(Math.abs(signedVolume - metadata.parts[name].volumeMM3) < 1e-4);
    assert.ok(signedVolume > metadata.parts[name].sourceVoxels * 0.85
      && signedVolume < metadata.parts[name].sourceVoxels * 1.05,
    'Smoothing retains the scale of the original 1 mm voxel segmentation');
    assert.deepEqual(bounds(mesh.positions), metadata.parts[name].boundsMM);
  });
}

test('both hippocampi stay within their corresponding hemisphere at the original anatomical scale', () => {
  const sizes = [];
  const centers = [];
  for (const side of ['left', 'right']) {
    const name = side === 'left' ? 'hippocampusLeft' : 'hippocampusRight';
    const [minimum, maximum] = bounds(anatomy.parts[name].positions);
    const [cortexMinimum, cortexMaximum] = bounds(cortex.hemispheres[side].positions);
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(minimum[axis] > cortexMinimum[axis] && maximum[axis] < cortexMaximum[axis],
        'Hippocampi must sit inside the cortex bounding volume in the shared surface RAS frame');
    }
    assert.ok(side === 'left' ? maximum[0] < -5 : minimum[0] > 5, 'Left and right must not be swapped or cross the midline');
    const size = maximum.map((value, axis) => value - minimum[axis]);
    assert.ok(size.every((value) => value > 20 && value < 45), 'Hippocampal extents must remain in millimeters');
    sizes.push(size);
    centers.push(maximum.map((value, axis) => (value + minimum[axis]) / 2));
  }
  for (let axis = 0; axis < 3; axis += 1) assert.ok(Math.abs(sizes[0][axis] - sizes[1][axis]) < 4);
  for (const axis of [1, 2]) assert.ok(Math.abs(centers[0][axis] - centers[1][axis]) < 4);
  assert.ok(Math.abs(centers[0][0] + centers[1][0]) < 4, 'Both segmented sides should straddle the shared anatomical center');
});
