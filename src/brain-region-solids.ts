export interface RegionSolid {
  /** Illustrative interior closure; the measured outer cortex is untouched. */
  positions: Float32Array;
  indices: number[];
  /** The rim must follow these source vertices while a region expands. */
  boundary: { capVertex: number; sourceVertex: number }[];
  sourceVertices: number[];
}

/** Solve the positive, uniform-weight graph Laplacian with a fixed boundary. */
function solveLaplacian(neighbors: number[][], degrees: number[], rhs: Float64Array, initial?: Float64Array): Float64Array {
  const count = rhs.length;
  const solution = initial?.slice() ?? new Float64Array(count);
  const residual = new Float64Array(count);
  const direction = new Float64Array(count);
  const product = new Float64Array(count);
  let error = 0;
  for (let vertex = 0; vertex < count; vertex += 1) {
    let value = degrees[vertex] * solution[vertex];
    for (const neighbor of neighbors[vertex]) value -= solution[neighbor];
    residual[vertex] = rhs[vertex] - value;
    direction[vertex] = residual[vertex] / degrees[vertex];
    error += residual[vertex] * direction[vertex];
  }
  const tolerance = error * 1e-18;
  // Jacobi-preconditioned conjugate gradients converges in under 200 passes
  // for the supplied atlas. The cap is built once, outside the animation loop.
  for (let pass = 0; pass < 600 && error > tolerance; pass += 1) {
    let denominator = 0;
    for (let vertex = 0; vertex < count; vertex += 1) {
      let value = degrees[vertex] * direction[vertex];
      for (const neighbor of neighbors[vertex]) value -= direction[neighbor];
      product[vertex] = value;
      denominator += direction[vertex] * value;
    }
    if (denominator <= 0) break;
    const step = error / denominator;
    let nextError = 0;
    for (let vertex = 0; vertex < count; vertex += 1) {
      solution[vertex] += step * direction[vertex];
      residual[vertex] -= step * product[vertex];
      nextError += residual[vertex] ** 2 / degrees[vertex];
    }
    const ratio = nextError / error;
    for (let vertex = 0; vertex < count; vertex += 1) {
      direction[vertex] = residual[vertex] / degrees[vertex] + ratio * direction[vertex];
    }
    error = nextError;
  }
  return solution;
}

/**
 * Close an atlas patch with a smooth interior cut face. Reusing its interior
 * triangulation handles the long, nonplanar region contours without a fan of
 * large triangles meeting at one point. These are illustrative solid portions,
 * not a new anatomical segmentation of the brain's interior.
 */
export function buildRegionSolid(positions: ArrayLike<number>, indices: ArrayLike<number>): RegionSolid {
  if (positions.length % 3 || Array.from(positions).some((value) => !Number.isFinite(value))) {
    throw new Error('A region solid needs three finite coordinates per vertex.');
  }
  if (!indices.length || indices.length % 3) throw new Error('A region solid needs complete triangles.');
  const sourceVertices = [...new Set(Array.from(indices))];
  if (sourceVertices.some((index) => !Number.isInteger(index) || index < 0 || index * 3 >= positions.length)) {
    throw new Error('A region solid references an invalid vertex.');
  }
  const localVertices = new Map(sourceVertices.map((source, local) => [source, local]));
  const localIndices = Array.from(indices, (index) => localVertices.get(index)!);
  const adjacency = sourceVertices.map(() => new Set<number>());
  const edges = new Map<string, { a: number; b: number; count: number }>();
  const outward = [0, 0, 0];
  for (let offset = 0; offset < localIndices.length; offset += 3) {
    const a = sourceVertices[localIndices[offset]] * 3;
    const b = sourceVertices[localIndices[offset + 1]] * 3;
    const c = sourceVertices[localIndices[offset + 2]] * 3;
    const u = [0, 1, 2].map((axis) => positions[b + axis] - positions[a + axis]);
    const v = [0, 1, 2].map((axis) => positions[c + axis] - positions[a + axis]);
    outward[0] += u[1] * v[2] - u[2] * v[1];
    outward[1] += u[2] * v[0] - u[0] * v[2];
    outward[2] += u[0] * v[1] - u[1] * v[0];
    for (let corner = 0; corner < 3; corner += 1) {
      const first = localIndices[offset + corner];
      const second = localIndices[offset + (corner + 1) % 3];
      const key = `${Math.min(first, second)},${Math.max(first, second)}`;
      const edge = edges.get(key);
      if (edge) edge.count += 1;
      else edges.set(key, { a: first, b: second, count: 1 });
      adjacency[first].add(second);
      adjacency[second].add(first);
    }
  }
  if ([...edges.values()].some(({ count }) => count > 2)) throw new Error('A region solid requires a manifold surface.');
  const rim = new Set<number>();
  for (const { a, b, count } of edges.values()) {
    if (count === 1) { rim.add(a); rim.add(b); }
  }
  // Already closed structures (e.g. a cerebellar mesh) need no interior face.
  if (!rim.size) return { positions: new Float32Array(), indices: [], boundary: [], sourceVertices: [] };
  const interior = sourceVertices.map((_, vertex) => vertex).filter((vertex) => !rim.has(vertex));
  if (!interior.length) throw new Error('A region cut face needs interior vertices.');
  const unknowns = new Map(interior.map((vertex, index) => [vertex, index]));
  const neighbors = interior.map((vertex) => [...adjacency[vertex]].filter((neighbor) => unknowns.has(neighbor)).map((neighbor) => unknowns.get(neighbor)!));
  const degrees = interior.map((vertex) => adjacency[vertex].size);
  const cap = new Float64Array(sourceVertices.length * 3);
  for (let vertex = 0; vertex < sourceVertices.length; vertex += 1) {
    for (let axis = 0; axis < 3; axis += 1) cap[vertex * 3 + axis] = positions[sourceVertices[vertex] * 3 + axis];
  }
  for (let axis = 0; axis < 3; axis += 1) {
    const rhs = new Float64Array(interior.length);
    const initial = new Float64Array(interior.length);
    for (let index = 0; index < interior.length; index += 1) {
      const vertex = interior[index];
      initial[index] = cap[vertex * 3 + axis];
      for (const neighbor of adjacency[vertex]) if (rim.has(neighbor)) rhs[index] += cap[neighbor * 3 + axis];
    }
    const solution = solveLaplacian(neighbors, degrees, rhs, initial);
    for (let index = 0; index < interior.length; index += 1) cap[interior[index] * 3 + axis] = solution[index];
  }

  // Give every connection face a gently curved inward profile. Even broad
  // lobes otherwise close with a flat plate; narrow strips need extra depth
  // to read as a solid too. The profile is zero at the attached rim.
  const normalLength = Math.hypot(...outward);
  if (normalLength > 1e-12) {
    for (let axis = 0; axis < 3; axis += 1) outward[axis] /= normalLength;
    let hemisphereExtent = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      let minimum = Infinity;
      let maximum = -Infinity;
      for (let offset = axis; offset < positions.length; offset += 3) {
        minimum = Math.min(minimum, positions[offset]);
        maximum = Math.max(maximum, positions[offset]);
      }
      hemisphereExtent = Math.max(hemisphereExtent, maximum - minimum);
    }
    let currentDepth = 0;
    for (const vertex of interior) {
      let depth = 0;
      for (let axis = 0; axis < 3; axis += 1) depth += (positions[sourceVertices[vertex] * 3 + axis] - cap[vertex * 3 + axis]) * outward[axis];
      currentDepth = Math.max(currentDepth, depth);
    }
    const extraDepth = Math.max(hemisphereExtent * 0.04, hemisphereExtent * 0.10 - currentDepth);
    if (extraDepth > 0) {
      const profile = solveLaplacian(neighbors, degrees, new Float64Array(interior.length).fill(1));
      let maximum = 0;
      for (const depth of profile) maximum = Math.max(maximum, depth);
      for (let index = 0; index < interior.length; index += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          cap[interior[index] * 3 + axis] -= outward[axis] * extraDepth * profile[index] / maximum;
        }
      }
    }
  }
  const capIndices: number[] = [];
  for (let offset = 0; offset < localIndices.length; offset += 3) {
    capIndices.push(localIndices[offset], localIndices[offset + 2], localIndices[offset + 1]);
  }
  return {
    positions: Float32Array.from(cap), indices: capIndices, sourceVertices,
    boundary: [...rim].map((capVertex) => ({ capVertex, sourceVertex: sourceVertices[capVertex] })),
  };
}
