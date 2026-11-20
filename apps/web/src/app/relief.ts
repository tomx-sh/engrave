import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three";

export const DEFAULT_SPAN = 8;
const BACKING_THICKNESS = 0.025;

export function makeRelief(front: Mesh<BufferGeometry, MeshBasicMaterial>) {
  const texture = front.material.map;
  if (!texture) throw new Error("The depth surface is missing its photo texture.");
  const image = texture.image;
  if (
    !image || typeof image !== "object" || !("width" in image) || !("height" in image) ||
    typeof image.width !== "number" || typeof image.height !== "number"
  ) {
    throw new Error("The photo texture is missing its dimensions.");
  }
  const { width, height } = image;
  const longestSide = Math.max(width, height);
  const position = front.geometry.getAttribute("position");
  const uv = front.geometry.getAttribute("uv");
  const inverseDepth = Array.from({ length: position.count }, (_, index) => {
    const z = position.getZ(index);
    return z < 0 ? -1 / z : 0;
  });
  const sorted = inverseDepth.toSorted((a, b) => a - b);
  const low = sorted[Math.floor((sorted.length - 1) * 0.02)];
  const high = sorted[Math.ceil((sorted.length - 1) * 0.98)];
  const range = high - low || 1;
  const heights = inverseDepth.map((depth) => Math.min(1, Math.max(0, (depth - low) / range)));

  const left = Math.fround(0.5 / width);
  const right = Math.fround(1 - 0.5 / width);
  const horizontal = width / longestSide / (right - left);
  const top = Math.fround(0.5 / height);
  const bottom = Math.fround(1 - 0.5 / height);
  const vertical = height / longestSide / (bottom - top);
  const edges = { bottom: [] as number[], right: [] as number[], top: [] as number[], left: [] as number[] };

  for (let index = 0; index < position.count; index += 1) {
    const u = uv.getX(index);
    const v = uv.getY(index);
    position.setXY(index, (u - 0.5) * horizontal, (0.5 - v) * vertical);
    // The UVs follow a rectangular grid. Include each corner once in the ring.
    const tolerance = 1e-6;
    if (Math.abs(v - bottom) < tolerance) edges.bottom.push(index);
    else if (Math.abs(u - right) < tolerance) edges.right.push(index);
    else if (Math.abs(v - top) < tolerance) edges.top.push(index);
    else if (Math.abs(u - left) < tolerance) edges.left.push(index);
  }

  edges.bottom.sort((a, b) => uv.getX(a) - uv.getX(b));
  edges.right.sort((a, b) => uv.getY(b) - uv.getY(a));
  edges.top.sort((a, b) => uv.getX(b) - uv.getX(a));
  edges.left.sort((a, b) => uv.getY(a) - uv.getY(b));
  const ring = [...edges.bottom, ...edges.right, ...edges.top, ...edges.left];
  if (!edges.bottom.length || !edges.right.length || !edges.top.length) {
    throw new Error("The depth surface is missing its outer edge.");
  }

  const columns = edges.bottom.length;
  const rows = position.count / columns;
  if (front.geometry.index?.count !== (columns - 1) * (rows - 1) * 6) {
    // Close gaps in the sampled depth grid when making a solid plaque.
    const indices: number[] = [];
    for (let row = 0; row < rows - 1; row += 1) {
      for (let column = 0; column < columns - 1; column += 1) {
        const topLeft = row * columns + column;
        const bottomLeft = topLeft + columns;
        indices.push(topLeft, bottomLeft, topLeft + 1, topLeft + 1, bottomLeft, bottomLeft + 1);
      }
    }
    front.geometry.setIndex(indices);
  }

  const sidePositions = new BufferAttribute(new Float32Array(ring.length * 6), 3);
  const sideIndices: number[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const vertex = ring[index];
    const next = (index + 1) % ring.length;
    sidePositions.setXYZ(index, position.getX(vertex), position.getY(vertex), 0);
    sidePositions.setXYZ(index + ring.length, position.getX(vertex), position.getY(vertex), -BACKING_THICKNESS);
    sideIndices.push(index, index + ring.length, next, next, index + ring.length, next + ring.length);
  }

  // Fan the back from its center so the cap shares every boundary edge with the walls.
  const center = sidePositions.count;
  const backingPositions = new Float32Array((center + 1) * 3);
  backingPositions.set(sidePositions.array);
  backingPositions.set([0, 0, -BACKING_THICKNESS], center * 3);
  for (let index = 0; index < ring.length; index += 1) {
    sideIndices.push(center, ring.length + (index + 1) % ring.length, ring.length + index);
  }

  const backing = new BufferGeometry();
  const backingAttribute = new BufferAttribute(backingPositions, 3);
  backing.setAttribute("position", backingAttribute);
  backing.setIndex(sideIndices);

  const surface = new Mesh(front.geometry, new MeshStandardMaterial({ map: texture, roughness: 0.9 }));
  surface.name = "Photo surface";
  const base = new Mesh(backing, new MeshStandardMaterial({ color: 0x8f8576, roughness: 0.9 }));
  base.name = "Flat backing";
  const group = new Group();
  group.name = "Engrave bas-relief";
  group.add(surface, base);

  function setSpan(percent: number) {
    const span = percent / 100;
    for (let index = 0; index < position.count; index += 1) {
      position.setZ(index, heights[index] * span);
    }
    for (let index = 0; index < ring.length; index += 1) {
      backingAttribute.setZ(index, heights[ring[index]] * span);
    }
    position.needsUpdate = true;
    backingAttribute.needsUpdate = true;
    front.geometry.computeVertexNormals();
    backing.computeVertexNormals();
    front.geometry.computeBoundingSphere();
    backing.computeBoundingSphere();
  }

  const dispose = () => {
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
    texture.dispose();
    front.material.dispose();
    surface.material.dispose();
    base.material.dispose();
    front.geometry.dispose();
    backing.dispose();
  };

  return { group, setSpan, dispose };
}
