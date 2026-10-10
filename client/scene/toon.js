// Sombreado de caricatura: MeshToonMaterial con rampa de 3 tonos y contornos negros por "casco invertido"
// (una copia de la malla, inflada sobre sus normales y pintada solo por dentro). No necesita posproceso.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

let ramp = null;
export function gradientMap() {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.generateMipmaps = false;
    ramp.needsUpdate = true;
  }
  return ramp;
}

const plain = new Map();
// Material toon de un color; los de un solo color se comparten.
export function toon(color, opts) {
  if (!opts) {
    if (!plain.has(color)) plain.set(color, new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() }));
    return plain.get(color);
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...opts });
}

// Grosor en metros por metro de distancia a la cámara: así el trazo mide lo mismo en pantalla de cerca y de lejos.
const WIDTH = { big: 0.0055, small: 0.0032 };
const outlineMats = {};
function outlineMaterial(kind) {
  if (outlineMats[kind]) return outlineMats[kind];
  const width = { value: WIDTH[kind] };
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.outlineW = width;
    sh.vertexShader = 'uniform float outlineW;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      vec4 oWorld = modelMatrix * vec4(position, 1.0);
      #ifdef USE_INSTANCING
        oWorld = modelMatrix * instanceMatrix * vec4(position, 1.0);
      #endif
      float oDist = clamp(distance(oWorld.xyz, cameraPosition), 0.35, 9.0);
      float oScale = (length(modelMatrix[0].xyz) + length(modelMatrix[1].xyz) + length(modelMatrix[2].xyz)) / 3.0;
      transformed += normalize(normal) * outlineW * oDist / oScale;`);
  };
  m.customProgramCacheKey = () => 'toon-outline';
  return (outlineMats[kind] = m);
}

// Normales suavizadas para que el contorno de una caja no se abra en las esquinas.
const smoothCache = new WeakMap();
function smoothed(geo) {
  let g = smoothCache.get(geo);
  if (!g) {
    const c = new THREE.BufferGeometry();
    c.setAttribute('position', geo.getAttribute('position'));
    if (geo.index) c.setIndex(geo.index);
    g = mergeVertices(c, 1e-4);
    g.computeVertexNormals();
    smoothCache.set(geo, g);
  }
  return g;
}

// Contornos chicos (fichas, cartas) se apagan en calidad baja.
export const smallOutlines = new Set();

export function outline(mesh, kind = 'big') {
  const geo = smoothed(mesh.geometry);
  let o;
  if (mesh.isInstancedMesh) {
    o = new THREE.InstancedMesh(geo, outlineMaterial(kind), mesh.instanceMatrix.count);
    o.instanceMatrix = mesh.instanceMatrix;
    o.frustumCulled = false;
    mesh.userData.outline = o;
  } else o = new THREE.Mesh(geo, outlineMaterial(kind));
  o.castShadow = o.receiveShadow = false;
  o.userData.isOutline = true;
  mesh.add(o);
  if (kind === 'small') smallOutlines.add(o);
  return mesh;
}

// Atajo: malla toon con contorno.
export function mesh(geo, color, kind = 'big', opts) {
  const m = new THREE.Mesh(geo, typeof color === 'object' && color.isMaterial ? color : toon(color, opts));
  if (kind) outline(m, kind);
  return m;
}
