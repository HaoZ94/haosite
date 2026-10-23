export interface RoundedSurfaceData {
  /** Linear refinement retains the exact assembled surface. */
  restPositions: Float32Array;
  expandedPositions: Float32Array;
  outerIndices: number[];
  /** The initial compact controls refer to these original surface vertices. */
  sourceVertices: number[];
  /** New midpoint vertices interpolate attributes from these control vertices. */
  edges: { index: number; a: number; b: number }[];
}

/** One Loop subdivision pass softens closed lower anatomy only when expanded. */
export function buildRoundedSurface(positions: ArrayLike<number>, indices: ArrayLike<number>): RoundedSurfaceData {
  if (!positions.length || positions.length % 3 || Array.from(positions).some((value) => !Number.isFinite(value))) {
    throw new Error('A rounded surface needs three finite coordinates per vertex.');
  }
  if (!indices.length || indices.length % 3) throw new Error('A rounded surface needs complete triangles.');
  const sourceVertices = [...new Set(Array.from(indices))];
  if (sourceVertices.some((vertex) => !Number.isInteger(vertex) || vertex < 0 || vertex * 3 >= positions.length)) {
    throw new Error('A rounded surface references an invalid vertex.');
  }
  const localVertices = new Map(sourceVertices.map((source, local) => [source, local]));
  const localIndices = Array.from(indices, (vertex) => localVertices.get(vertex)!);
  const rest = sourceVertices.flatMap((vertex) => [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]]);
  const count = sourceVertices.length;
  const adjacency = Array.from({ length: count }, () => new Set<number>());
  const edgeKey = (a: number, b: number): number => Math.min(a, b) * count + Math.max(a, b);
  const edgeMap = new Map<number, { a: number; b: number; opposite: number[]; winding: number; index: number }>();
  for (let offset = 0; offset < localIndices.length; offset += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = localIndices[offset + corner];
      const b = localIndices[offset + (corner + 1) % 3];
      const opposite = localIndices[offset + (corner + 2) % 3];
      const key = edgeKey(a, b);
      let edge = edgeMap.get(key);
      if (!edge) {
        edge = { a, b, opposite: [], winding: 0, index: -1 };
        edgeMap.set(key, edge);
      }
      edge.opposite.push(opposite);
      edge.winding += a < b ? 1 : -1;
      adjacency[a].add(b);
      adjacency[b].add(a);
    }
  }
  if ([...edgeMap.values()].some((edge) => edge.a === edge.b || edge.opposite.length !== 2 || edge.winding !== 0)) {
    throw new Error('A rounded surface requires a closed, consistently wound manifold.');
  }
  const expanded = rest.slice();
  for (let vertex = 0; vertex < count; vertex += 1) {
    const neighbors = adjacency[vertex];
    const beta = neighbors.size === 3 ? 3 / 16 : 3 / (8 * neighbors.size);
    for (let axis = 0; axis < 3; axis += 1) {
      let value = (1 - neighbors.size * beta) * rest[vertex * 3 + axis];
      for (const neighbor of neighbors) value += beta * rest[neighbor * 3 + axis];
      expanded[vertex * 3 + axis] = value;
    }
  }
  const edges: RoundedSurfaceData['edges'] = [];
  for (const edge of edgeMap.values()) {
    const { a, b, opposite } = edge;
    edge.index = rest.length / 3;
    edges.push({ index: edge.index, a, b });
    for (let axis = 0; axis < 3; axis += 1) {
      rest.push((rest[a * 3 + axis] + rest[b * 3 + axis]) * 0.5);
      expanded.push((rest[a * 3 + axis] + rest[b * 3 + axis]) * 0.375
        + (rest[opposite[0] * 3 + axis] + rest[opposite[1] * 3 + axis]) * 0.125);
    }
  }
  const outerIndices: number[] = [];
  for (let offset = 0; offset < localIndices.length; offset += 3) {
    const a = localIndices[offset], b = localIndices[offset + 1], c = localIndices[offset + 2];
    const ab = edgeMap.get(edgeKey(a, b))!.index;
    const bc = edgeMap.get(edgeKey(b, c))!.index;
    const ca = edgeMap.get(edgeKey(c, a))!.index;
    outerIndices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const incident = Array.from({ length: rest.length / 3 }, () => [] as number[]);
  const reference = new Float64Array(outerIndices.length);
  const normal = (points: number[], offset: number, amount: number): [number, number, number] => {
    const a = outerIndices[offset] * 3, b = outerIndices[offset + 1] * 3, c = outerIndices[offset + 2] * 3;
    const u = [0, 1, 2].map((axis) => rest[b + axis] - rest[a + axis]
      + ((points[b + axis] - rest[b + axis]) - (points[a + axis] - rest[a + axis])) * amount);
    const v = [0, 1, 2].map((axis) => rest[c + axis] - rest[a + axis]
      + ((points[c + axis] - rest[c + axis]) - (points[a + axis] - rest[a + axis])) * amount);
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  };
  for (let offset = 0; offset < outerIndices.length; offset += 3) {
    for (let corner = 0; corner < 3; corner += 1) incident[outerIndices[offset + corner]].push(offset);
    reference.set(normal(rest, offset, 0), offset);
  }
  // A handful of marching-cubes slivers need smaller moves. The projected face
  // normal is quadratic in expansion, so checking its minimum protects the
  // complete morph without adding smoothing passes or changing distant folds.
  const guarded = rest.slice();
  for (let vertex = 0; vertex < incident.length; vertex += 1) {
    const start = vertex * 3;
    let accepted = false;
    for (let damping = 1; damping >= 1 / 128; damping *= 0.5) {
      for (let axis = 0; axis < 3; axis += 1) guarded[start + axis] = rest[start + axis] + (expanded[start + axis] - rest[start + axis]) * damping;
      accepted = incident[vertex].every((offset) => {
        const base = reference.subarray(offset, offset + 3);
        const first = base.reduce((sum, value) => sum + value * value, 0);
        const middle = normal(guarded, offset, 0.5).reduce((sum, value, axis) => sum + value * base[axis], 0);
        const last = normal(guarded, offset, 1).reduce((sum, value, axis) => sum + value * base[axis], 0);
        const linear = 4 * middle - 3 * first - last;
        const quadratic = 2 * (last + first - 2 * middle);
        const minimumAt = quadratic > 0 ? Math.max(0, Math.min(1, -linear / (2 * quadratic))) : 1;
        const minimum = Math.min(first, last, first + linear * minimumAt + quadratic * minimumAt ** 2);
        return minimum > first * 0.08;
      });
      if (accepted) break;
    }
    if (!accepted) for (let axis = 0; axis < 3; axis += 1) guarded[start + axis] = rest[start + axis];
  }
  return { restPositions: Float32Array.from(rest), expandedPositions: Float32Array.from(guarded), outerIndices, sourceVertices, edges };
}
