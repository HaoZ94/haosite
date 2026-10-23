/** Validate the original indexed atlas before adding interpolated seam vertices. */
function validateAtlas(indices: ArrayLike<number>, labels: ArrayLike<number>): void {
  if (!Number.isSafeInteger(labels.length) || labels.length < 1) {
    throw new Error('A cortex needs one atlas label per vertex.');
  }
  if (!Number.isSafeInteger(indices.length) || indices.length < 0 || indices.length % 3) {
    throw new Error('Cortical indices must describe complete triangles.');
  }
  for (let index = 0; index < labels.length; index += 1) {
    if (!Number.isInteger(labels[index]) || labels[index] < 0 || labels[index] > 6) {
      throw new Error(`Invalid cortical region label at vertex ${index}.`);
    }
  }

  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = [indices[offset], indices[offset + 1], indices[offset + 2]];
    for (const index of triangle) {
      if (!Number.isInteger(index) || index < 0 || index >= labels.length) {
        throw new Error(`Cortical triangle references an invalid vertex at index ${offset}.`);
      }
    }
  }
}

export interface RegionSurface {
  groups: Map<number, number[]>;
  positions: Float32Array;
  expandedPositions: Float32Array;
  /** New vertices interpolate the attributes of these original surface vertices. */
  blends: { index: number; sources: number[] }[];
}

/**
 * Cut atlas boundaries inside their triangles instead of following whole-face
 * stair steps. Original vertices stay fixed, including every signal endpoint.
 */
export function buildRegionSurface(positions: ArrayLike<number>, indices: ArrayLike<number>, labels: ArrayLike<number>): RegionSurface {
  // Retain the same validation for atlas labels and source topology.
  validateAtlas(indices, labels);
  if (positions.length !== labels.length * 3 || Array.from(positions).some((value) => !Number.isFinite(value))) {
    throw new Error('A cortical surface needs three finite coordinates per atlas vertex.');
  }

  const coordinates = Array.from(positions);
  const groups = new Map<number, number[]>();
  const blends: RegionSurface['blends'] = [];
  const midpoints = new Map<string, number>();
  const boundary = new Map<number, Set<number>>();
  const movementLimits = new Map<number, number>();

  const addVertex = (sources: number[]): number => {
    const index = coordinates.length / 3;
    for (let axis = 0; axis < 3; axis += 1) {
      coordinates.push(sources.reduce((sum, source) => sum + positions[source * 3 + axis], 0) / sources.length);
    }
    blends.push({ index, sources });
    return index;
  };
  const midpoint = (a: number, b: number): number => {
    const key = `${Math.min(a, b)},${Math.max(a, b)}`;
    let index = midpoints.get(key);
    if (index === undefined) {
      index = addVertex([a, b]);
      midpoints.set(key, index);
      // A midpoint never travels farther than half its original crossing edge.
      movementLimits.set(index, Math.hypot(
        positions[a * 3] - positions[b * 3],
        positions[a * 3 + 1] - positions[b * 3 + 1],
        positions[a * 3 + 2] - positions[b * 3 + 2],
      ) * 0.5);
    }
    return index;
  };
  const connect = (a: number, b: number): void => {
    if (!boundary.has(a)) boundary.set(a, new Set());
    if (!boundary.has(b)) boundary.set(b, new Set());
    boundary.get(a)!.add(b);
    boundary.get(b)!.add(a);
  };
  const face = (label: number, a: number, b: number, c: number): void => {
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(a, b, c);
  };

  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = [indices[offset], indices[offset + 1], indices[offset + 2]];
    const region = triangle.map((index) => labels[index]);
    const distinct = new Set(region).size;
    if (distinct === 1) {
      face(region[0], triangle[0], triangle[1], triangle[2]);
    } else if (distinct === 2) {
      const minority = region.findIndex((label, index) => label !== region[(index + 1) % 3] && label !== region[(index + 2) % 3]);
      const a = triangle[minority];
      const b = triangle[(minority + 1) % 3];
      const c = triangle[(minority + 2) % 3];
      const ab = midpoint(a, b);
      const ca = midpoint(c, a);
      face(labels[a], a, ab, ca);
      face(labels[b], b, c, ca);
      face(labels[b], b, ca, ab);
      connect(ab, ca);
    } else {
      const center = addVertex(triangle);
      const edges = triangle.map((vertex, index) => midpoint(vertex, triangle[(index + 1) % 3]));
      for (let corner = 0; corner < 3; corner += 1) {
        face(region[corner], triangle[corner], edges[corner], center);
        face(region[corner], triangle[corner], center, edges[(corner + 2) % 3]);
        connect(edges[corner], center);
      }
    }
  }

  const original = Float32Array.from(coordinates);
  const expanded = original.slice();
  const triangles = [...groups.values()].flat();
  const incident = new Map<number, number[]>();
  const normals = new Float64Array(triangles.length);
  const normal = (points: ArrayLike<number>, offset: number): [number, number, number] => {
    const a = triangles[offset] * 3;
    const b = triangles[offset + 1] * 3;
    const c = triangles[offset + 2] * 3;
    const ux = points[b] - points[a];
    const uy = points[b + 1] - points[a + 1];
    const uz = points[b + 2] - points[a + 2];
    const vx = points[c] - points[a];
    const vy = points[c + 1] - points[a + 1];
    const vz = points[c + 2] - points[a + 2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
  for (let offset = 0; offset < triangles.length; offset += 3) {
    normals.set(normal(original, offset), offset);
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = triangles[offset + corner];
      if (!movementLimits.has(vertex)) continue;
      if (!incident.has(vertex)) incident.set(vertex, []);
      incident.get(vertex)!.push(offset);
    }
  }

  // Round only the newly cut contours. Triple junctions and original vertices
  // remain pinned; sequential guarded moves preserve even narrow cortical folds.
  for (let pass = 0; pass < 4; pass += 1) {
    const previous = expanded.slice();
    for (const [vertex, limit] of movementLimits) {
      const neighbors = boundary.get(vertex);
      if (neighbors?.size !== 2) continue;
      const [a, b] = [...neighbors];
      const start = vertex * 3;
      const target = [0, 1, 2].map((axis) => previous[start + axis] * 0.65 + (previous[a * 3 + axis] + previous[b * 3 + axis]) * 0.175);
      const displacement = Math.hypot(...target.map((value, axis) => value - original[start + axis]));
      if (displacement > limit) {
        for (let axis = 0; axis < 3; axis += 1) target[axis] = original[start + axis] + (target[axis] - original[start + axis]) * limit / displacement;
      }
      const before = Array.from(expanded.subarray(start, start + 3));
      let accepted = false;
      for (let damping = 1; damping >= 1 / 128; damping *= 0.5) {
        for (let axis = 0; axis < 3; axis += 1) expanded[start + axis] = before[axis] + (target[axis] - before[axis]) * damping;
        accepted = incident.get(vertex)!.every((offset) => {
          const current = normal(expanded, offset);
          const dot = current.reduce((sum, value, axis) => sum + value * normals[offset + axis], 0);
          const areaSquared = normals[offset] ** 2 + normals[offset + 1] ** 2 + normals[offset + 2] ** 2;
          return dot >= areaSquared * 0.15;
        });
        if (accepted) break;
      }
      if (!accepted) expanded.set(before, start);
    }
  }
  return { groups, positions: original, expandedPositions: expanded, blends };
}
