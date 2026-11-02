import * as THREE from 'three';
import { expect, test } from 'vitest';
import { layoutAtlas } from './atlas';
import { AO_BRIGHTNESS, chunkMeshes, passGeometry, terrainMaterials, useAtlas } from './terrain';
import type { ChunkMeshData, PassMesh } from './meshing';

const tiles = ['grass_top', 'dirt', 'stone'];
const layout = layoutAtlas(tiles);
const texture = new THREE.Texture();

const quad = (): PassMesh => ({
  positions: new Float32Array([0, 0, 0, 3, 0, 0, 3, 1, 0, 0, 1, 0]),
  normals: new Int8Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uvs: new Float32Array([0, 0, 3, 0, 3, 1, 0, 1]),
  tiles: new Uint8Array([2, 2, 2, 2]),
  ao: new Uint8Array([3, 3, 2, 3]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
});
const none = (): PassMesh => ({
  positions: new Float32Array(),
  normals: new Int8Array(),
  uvs: new Float32Array(),
  tiles: new Uint8Array(),
  ao: new Uint8Array(),
  indices: new Uint32Array(),
});

/** What Three hands a material's onBeforeCompile: the shader source with its include lines. */
function patched(material: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n',
    fragmentShader: '#include <common>\n#include <map_fragment>\n',
  };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as never);
  return shader;
}

test('the vertex buffers are the mesh arrays, with a bounding sphere that covers the chunk', () => {
  const g = passGeometry(quad());
  expect(g.getAttribute('position').count).toBe(4);
  expect(g.getAttribute('tileCoord').itemSize).toBe(2);
  expect(g.getAttribute('tile').array).toEqual(new Uint8Array([2, 2, 2, 2]));
  expect(g.getAttribute('normal').normalized).toBe(false);
  expect(g.index!.count).toBe(6);
  expect(g.boundingSphere!.containsPoint(new THREE.Vector3(16, 16, 16))).toBe(true);
  expect(g.boundingSphere!.containsPoint(new THREE.Vector3(0, 0, 0))).toBe(true);
});

test('the patch finds each tile in the atlas and takes the mip level from the unwrapped coordinate', () => {
  const shader = patched(useAtlas(new THREE.MeshBasicMaterial({ vertexColors: true }), texture, layout, tiles));
  expect(shader.fragmentShader).toContain('fract(vTileCoord)');
  expect(shader.fragmentShader).toContain('textureGrad(atlas');
  expect(shader.fragmentShader).toContain('dFdx(vTileCoord)');
  expect(shader.fragmentShader).toContain('tileRects[3]');
  expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
  expect((shader.uniforms.tileRects!.value as THREE.Vector4[]).map((r) => r.toArray())).toEqual(
    tiles.map((t) => {
      const o = layout.origin.get(t)!;
      return [o.x / layout.width, 1 - (o.y + 128) / layout.height, (o.x + 128) / layout.width, 1 - o.y / layout.height];
    }),
  );
  expect(shader.uniforms.aoBrightness!.value).toBe(AO_BRIGHTNESS);
});

test('wrapping first is only there for the test that needs it', () => {
  const m = useAtlas(new THREE.MeshBasicMaterial(), texture, layout, tiles, { unwrappedGradients: false });
  expect(patched(m).fragmentShader).not.toContain('textureGrad');
  const plain = useAtlas(new THREE.MeshBasicMaterial(), texture, layout, tiles);
  expect(plain.customProgramCacheKey()).not.toBe(m.customProgramCacheKey());
});

test('the tile varyings are set in every program, shadow depth ones included', () => {
  const shader = patched(useAtlas(new THREE.MeshDepthMaterial(), texture, layout, tiles));
  expect(shader.vertexShader).toMatch(/begin_vertex>\s+vTileCoord = tileCoord;\s+vTile = tile;/);
});

test('each pass that has quads becomes a mesh with its material, at the chunk corner', () => {
  const materials = terrainMaterials(texture, layout, tiles);
  const data: ChunkMeshData = [quad(), none(), quad(), quad()];
  const group = chunkMeshes(data, materials, [2, 1, -3]);
  expect(group.position.toArray()).toEqual([32, 16, -48]);
  expect(group.children.map((c) => c.name)).toEqual(['opaque', 'glass', 'water']);
  const [opaque, glass, water] = group.children as THREE.Mesh[];
  expect(opaque!.material).toBe(materials.opaque);
  expect(glass!.material).toBe(materials.glass);
  expect([opaque!.castShadow, glass!.castShadow, water!.castShadow]).toEqual([true, false, false]);
  group.dispose();
  expect(group.children).toHaveLength(0);
});

test('leaves cast shadows through their holes', () => {
  const materials = terrainMaterials(texture, layout, tiles);
  const group = chunkMeshes([none(), quad(), none(), none()], materials, [0, 0, 0]);
  const leaves = group.children[0] as THREE.Mesh;
  expect(leaves.castShadow).toBe(true);
  expect(leaves.customDepthMaterial).toBe(materials.cutoutDepth);
  expect(materials.cutout.alphaTest).toBe(0.5);
});
