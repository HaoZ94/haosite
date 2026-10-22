import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createBrainNetwork, findNearestVertex, planBrainSignal, SIGNAL_SPEED } from '../src/brain-network.ts';

const cortex = JSON.parse(readFileSync(new URL('../src/assets/brain-fsaverage5.json', import.meta.url), 'utf8'));
const lower = JSON.parse(readFileSync(new URL('../src/assets/brain-subcortical.json', import.meta.url), 'utf8'));
const surfaces = {
  cortexLeft: cortex.hemispheres.left,
  cortexRight: cortex.hemispheres.right,
  cerebellumLeft: lower.parts.cerebellumLeft,
  cerebellumRight: lower.parts.cerebellumRight,
  brainstem: lower.parts.brainstem,
};
const network = createBrainNetwork(surfaces);
const regions = Object.keys(surfaces);
const seeds = {
  cortexLeft: [-0.53, 0.06, -0.30],
  cortexRight: [0.53, 0.06, -0.30],
  cerebellumLeft: [-0.35, -0.65, 0.50],
  cerebellumRight: [0.35, -0.65, 0.50],
  brainstem: [0.11, -0.72, 0.16],
};

test('the real anatomical meshes form one connected signal network', () => {
  const expectedVertices = Object.values(surfaces).reduce((sum, surface) => sum + surface.positions.length / 3, 0);
  assert.equal(network.neighbors.length, expectedVertices);
  const visited = new Set([0]);
  const queue = [0];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const neighbor of network.neighbors[queue[cursor]]) {
      assert.ok(neighbor >= 0 && neighbor < expectedVertices);
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  assert.equal(visited.size, expectedVertices, 'No anatomical surface may be isolated from propagation');
});

for (const region of regions) {
  test(`a signal starting in ${region} reaches every region before it expires`, () => {
    const source = findNearestVertex(network, region, seeds[region]);
    const plan = planBrainSignal(network, source);
    assert.equal(network.regionByVertex[source], region);
    assert.equal(plan.source, source, 'Keep the clicked structure as the origin');
    assert.ok(plan.distances.every(Number.isFinite), 'Every anatomical vertex must be reachable');
    assert.deepEqual(new Set(plan.targets.map((target) => network.regionByVertex[target])), new Set(regions),
      'Selected branches must actually reach the cerebellum and brainstem, not merely connect their graphs');

    for (const path of plan.paths) {
      assert.ok(path.length >= 2);
      assert.equal(path[0], source, 'All branches must propagate continuously from the selected origin');
      let length = 0;
      for (let step = 1; step < path.length; step += 1) {
        const previous = path[step - 1];
        const current = path[step];
        assert.ok(network.neighbors[previous].includes(current), 'A signal cannot jump between unconnected vertices');
        assert.ok(plan.distances[current] >= plan.distances[previous]);
        length += Math.hypot(
          network.positions[current * 3] - network.positions[previous * 3],
          network.positions[current * 3 + 1] - network.positions[previous * 3 + 1],
          network.positions[current * 3 + 2] - network.positions[previous * 3 + 2],
        );
      }
      const end = path.at(-1);
      assert.ok(Math.abs(length - plan.distances[end]) < 1e-8, 'The animation clock must match the complete traveled path');
      assert.ok(plan.duration > length / SIGNAL_SPEED, 'Do not expire the signal before the final structure is reached');
    }
  });
}
