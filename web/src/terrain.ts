// Drawing meshed chunks: the vertex buffers, and the shader patch that repeats a tile across a merged quad.
import * as THREE from 'three';
import { tileUv, type AtlasLayout } from './atlas';
import { PASS_NAMES, type ChunkMeshData, type PassMesh } from './meshing';

/** Ambient occlusion level 0 (darkest) to 3 (open), as the brightness of the corner. */
export const AO_BRIGHTNESS = [0.42, 0.62, 0.82, 1.0] as const;
const CHUNK_SIZE = 16;

/** A chunk's bounding sphere: the cube's centre and half its diagonal, with a little to spare at the corners. */
const BOUNDS = new THREE.Sphere(new THREE.Vector3(8, 8, 8), Math.sqrt(3) * 8 + 0.1);

export function passGeometry(pass: PassMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pass.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(pass.normals, 3));
  g.setAttribute('tileCoord', new THREE.BufferAttribute(pass.uvs, 2));
  g.setAttribute('tile', new THREE.BufferAttribute(pass.tiles, 1));
  g.setAttribute('ao', new THREE.BufferAttribute(pass.ao, 1));
  g.setIndex(new THREE.BufferAttribute(pass.indices, 1));
  g.boundingSphere = BOUNDS.clone();
  return g;
}

export interface TerrainOptions {
  /**
   * Take the mip level from the tile coordinate before it is wrapped. Only a test turns this off, to show that
   * wrapping first picks the wrong level along every tile edge.
   */
  unwrappedGradients?: boolean;
}

/**
 * Patches a material to sample the atlas by tile and tile coordinate. The tile coordinate runs past 1 across a merged
 * quad, so the fragment shader keeps its fraction and maps that into the tile's rectangle. The mip level still comes
 * from the unwrapped coordinate: the wrapped one jumps at every tile edge and would pick the smallest mip there.
 */
export function useAtlas<M extends THREE.Material>(
  material: M,
  atlas: THREE.Texture,
  layout: AtlasLayout,
  tiles: readonly string[],
  { unwrappedGradients = true }: TerrainOptions = {},
): M {
  const rects = tiles.map((t) => new THREE.Vector4(...tileUv(layout, t)));
  material.onBeforeCompile = (shader) => {
    shader.uniforms.atlas = { value: atlas };
    shader.uniforms.tileRects = { value: rects };
    shader.uniforms.aoBrightness = { value: AO_BRIGHTNESS };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 tileCoord;
        attribute float tile;
        attribute float ao;
        uniform float aoBrightness[4];
        varying vec2 vTileCoord;
        flat varying float vTile;`,
      )
      // Shadow depth materials have no colour chunk, so the tile varyings are set where every program starts.
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTileCoord = tileCoord;
        vTile = tile;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #ifdef USE_COLOR
          vColor = vec3(aoBrightness[int(ao + 0.5)]);
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D atlas;
        uniform vec4 tileRects[${tiles.length}];
        varying vec2 vTileCoord;
        flat varying float vTile;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 rect = tileRects[int(vTile + 0.5)];
        vec2 extent = rect.zw - rect.xy;
        vec2 inTile = fract(vTileCoord);
        ${
          unwrappedGradients
            ? 'vec4 sampledDiffuseColor = textureGrad(atlas, rect.xy + inTile * extent, dFdx(vTileCoord) * extent, dFdy(vTileCoord) * extent);'
            : 'vec4 sampledDiffuseColor = texture2D(atlas, rect.xy + inTile * extent);'
        }
        diffuseColor *= sampledDiffuseColor;`,
      );
  };
  // Three keys its shader cache on this, so materials with different patches never share a program.
  material.customProgramCacheKey = () => `atlas:${tiles.length}:${unwrappedGradients}`;
  return material;
}

export interface TerrainMaterials {
  opaque: THREE.Material;
  cutout: THREE.Material;
  glass: THREE.Material;
  water: THREE.Material;
  /** Materials that shadows are cast through. The cutout one needs the leaves' holes. */
  cutoutDepth: THREE.Material;
}

/** The four passes' materials, lit the way the style frame lights them. */
export function terrainMaterials(
  atlas: THREE.Texture,
  layout: AtlasLayout,
  tiles: readonly string[],
  options?: TerrainOptions,
): TerrainMaterials {
  const use = <M extends THREE.Material>(m: M) => useAtlas(m, atlas, layout, tiles, options);
  return {
    opaque: use(new THREE.MeshLambertMaterial({ vertexColors: true })),
    cutout: use(new THREE.MeshLambertMaterial({ vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide })),
    glass: use(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false })),
    water: use(
      new THREE.MeshPhongMaterial({
        vertexColors: true,
        color: 0x7cc4ec,
        transparent: true,
        opacity: 0.8,
        shininess: 90,
        specular: 0x9ab8c8,
        depthWrite: false,
      }),
    ),
    cutoutDepth: use(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.5 })),
  };
}

/** One chunk as meshes, one per pass that has any quads, positioned at the chunk's corner. */
export class ChunkMeshes extends THREE.Group {
  /** Frees the vertex buffers. The materials are shared, so they stay. */
  dispose(): void {
    for (const child of this.children) (child as THREE.Mesh).geometry.dispose();
    this.clear();
  }
}

export function chunkMeshes(data: ChunkMeshData, materials: TerrainMaterials, chunk: [number, number, number]) {
  const group = new ChunkMeshes();
  group.position.set(chunk[0] * CHUNK_SIZE, chunk[1] * CHUNK_SIZE, chunk[2] * CHUNK_SIZE);
  data.forEach((pass, i) => {
    if (pass.indices.length === 0) return;
    const name = PASS_NAMES[i]!;
    const mesh = new THREE.Mesh(passGeometry(pass), materials[name]);
    mesh.name = name;
    // Glass and water are drawn after everything opaque, far to near, which Three does for transparent materials.
    mesh.castShadow = name === 'opaque' || name === 'cutout';
    mesh.receiveShadow = true;
    if (name === 'cutout') mesh.customDepthMaterial = materials.cutoutDepth;
    group.add(mesh);
  });
  return group;
}

const ONE_QUAD: PassMesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  normals: new Int8Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  tiles: new Uint8Array(4),
  ao: new Uint8Array([3, 3, 3, 3]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
};

/**
 * Draws one quad of every pass once, in front of the camera, so Three compiles every shader (shadow ones included)
 * before the first chunk shows up. Otherwise the first glass or leaf block in view stalls a frame.
 */
export function warmUp(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  materials: TerrainMaterials,
) {
  const group = chunkMeshes(PASS_NAMES.map(() => ONE_QUAD) as ChunkMeshData, materials, [0, 0, 0]);
  const ahead = new THREE.Vector3(0, 0, -2).applyQuaternion(camera.quaternion).add(camera.position);
  group.position.copy(ahead);
  scene.add(group);
  renderer.render(scene, camera);
  scene.remove(group);
  group.dispose();
}
