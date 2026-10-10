// Sombreado de animación 2D: cada material tiene su color base y una sola sombra plana (rampa de 2 tonos).
// Los contornos no viven aquí: los dibuja el posproceso de ink.js. Para eso cada material escribe, además
// del color, su número de trazo (en el alfa) y su normal (en una segunda salida). Donde cambia el número,
// la normal o la profundidad, ink.js pinta una línea.
// La luz de la lámpara también es pintada: charcos con bordes duros según la distancia al foco.

import * as THREE from 'three';

export const INK = '#1d1611';
export const LAMP = new THREE.Vector3(0, 1.4, 0);

let ramp = null;
export function gradientMap() {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([0, 255]), 2, 1, THREE.RedFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.generateMipmaps = false;
    ramp.needsUpdate = true;
  }
  return ramp;
}

// Luz ambiental + una direccional: el lado iluminado sale con el color base exacto y el de sombra
// con ~80 % del brillo (los toon de three dividen entre π, por eso las intensidades llevan π).
export function addFlatLights(scene) {
  const SHADE = 0.6;
  scene.add(new THREE.AmbientLight('#ffffff', Math.PI * SHADE));
  const sun = new THREE.DirectionalLight('#ffffff', Math.PI * (1 - SHADE));
  sun.position.set(-0.6, 1.4, 1.1);
  scene.add(sun);
}

// Charco de luz (multiplicador en espacio lineal): la mesa y quien está sentado quedan bajo la lámpara;
// el resto del cuarto queda un tono más oscuro y cálido, con un borde duro como en un fondo pintado.
const POOL = `
uniform vec3 inkLamp;
vec3 lampPool(vec3 p) {
  return distance(p, inkLamp) < 1.32 ? vec3(1.0) : vec3(0.62, 0.52, 0.48);
}
`;

let nextId = 0;
const named = new Map();
// Número de trazo de 1 a 250. Materiales con el mismo nombre comparten número y no se separan con línea.
function edgeId(name) {
  if (name && named.has(name)) return named.get(name);
  const id = ((nextId++ * 97) % 250) + 1;
  if (name) named.set(name, id);
  return id;
}

function inkify(m, { edge, pool = true } = {}) {
  const id = { value: edgeId(edge) / 255 };
  m.userData.edgeId = id;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.edgeId = id;
    sh.uniforms.inkLamp = { value: LAMP };
    sh.vertexShader = 'varying vec3 vInkWorld;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 inkW = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        inkW = instanceMatrix * inkW;
      #endif
      vInkWorld = (modelMatrix * inkW).xyz;`);
    sh.fragmentShader = 'uniform float edgeId;\nvarying vec3 vInkWorld;\nlayout(location = 1) out highp vec4 gInkNormal;\n' + POOL +
      sh.fragmentShader
        .replace('#include <opaque_fragment>', `${pool ? 'outgoingLight *= lampPool(vInkWorld);' : ''}\n#include <opaque_fragment>`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          gl_FragColor.a = edgeId;
          gInkNormal = vec4(normalize(normal) * 0.5 + 0.5, 1.0);`);
  };
  m.customProgramCacheKey = () => 'ink' + (pool ? 1 : 0);
  return m;
}

const plain = new Map();
// Material plano de un color. Los de un solo color se comparten.
// opts.edge: nombre de grupo de trazo (p. ej. el fieltro y su parche iluminado), opts.pool: false para no oscurecerlo.
export function toon(color, opts = {}) {
  const { edge, pool, ...rest } = opts;
  const shared = !Object.keys(rest).length;
  const key = `${color}|${edge || ''}|${pool !== false}`;
  if (shared && plain.has(key)) return plain.get(key);
  const m = inkify(new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...rest }), { edge, pool: pool !== false });
  if (shared) plain.set(key, m);
  return m;
}

// Atajo: malla con material plano (o con el material que se le pase).
export function mesh(geo, color, opts) {
  return new THREE.Mesh(geo, typeof color === 'object' && color.isMaterial ? color : toon(color, opts));
}

// Pequeñas imperfecciones: mueve cada vértice con un ruido suave que depende solo de su posición,
// así las costuras de la malla siguen cerradas y nada se ve como un bloque perfecto.
export function wobble(geo, amount = 0.008, seed = 1) {
  const p = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = (a, b, c) => Math.sin(v.x * a + seed) * Math.cos(v.y * b + seed * 1.7) + Math.sin(v.z * c + seed * 2.3) * 0.5;
    p.setXYZ(i, v.x + n(5.1, 3.7, 4.3) * amount, v.y + n(3.3, 4.9, 5.7) * amount, v.z + n(4.7, 5.3, 3.1) * amount);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Sombra plana proyectada: una forma oscura sin contorno que multiplica lo que tiene debajo.
const shadowMat = new THREE.MeshBasicMaterial({
  color: '#a08a7c', blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});
export function shadowMaterial() { return shadowMat; }

// Capa de lo translúcido (cono de luz, humo): se dibuja después de los contornos para no llevar línea.
export const GLOW_LAYER = 1;
export function glow(m) {
  m.layers.set(GLOW_LAYER);
  return m;
}

// Sombra elíptica bajo un objeto, ya acostada y en la capa translúcida. Se corre un poco
// en contra de la luz direccional para que se lea como sombra proyectada.
const shadowGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
export function flatShadow(rx, rz, y = 0.003) {
  const m = glow(new THREE.Mesh(shadowGeo, shadowMat));
  m.scale.set(rx, 1, rz);
  m.position.set(0.02, y, -0.015);
  return m;
}
