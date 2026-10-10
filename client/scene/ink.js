// Contornos de animación: la escena se dibuja una vez en un render target con dos salidas
// (color + número de trazo en el alfa, y normales) más su profundidad. Una pasada a pantalla completa
// compara cada píxel con sus vecinos y pinta una línea delgada color tinta donde cambia la profundidad
// (siluetas), la normal (dobleces) o el número de trazo (un material contra otro).
// Después se dibuja encima la capa translúcida (cono de luz, humo) usando la misma profundidad.

import * as THREE from 'three';
import { INK, GLOW_LAYER } from './toon.js';

const vertexShader = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const fragmentShader = `
#include <packing>
uniform sampler2D tColor, tNormal, tDepth;
uniform vec2 texel;
uniform float near, far, width;
uniform vec3 ink;
varying vec2 vUv;

float viewZ(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far); }

void main() {
  vec4 c = texture2D(tColor, vUv);
  vec3 n = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
  float z = viewZ(vUv);
  float e = 0.0;
  // diferencias hacia la derecha, arriba y en diagonal: la línea queda de un solo lado del borde
  vec2 offs[3];
  offs[0] = vec2(width, 0.0); offs[1] = vec2(0.0, width); offs[2] = vec2(width, width);
  for (int i = 0; i < 3; i++) {
    vec2 uv = vUv + offs[i] * texel;
    float zn = viewZ(uv);
    // umbral relativo a la distancia, para que el piso visto de lado no se llene de rayas
    e = max(e, smoothstep(0.035, 0.07, abs(zn - z) / min(z, zn)));
    vec3 nn = texture2D(tNormal, uv).xyz * 2.0 - 1.0;
    e = max(e, 1.0 - smoothstep(0.72, 0.86, dot(n, nn)));
    e = max(e, step(0.5 / 255.0, abs(texture2D(tColor, uv).a - c.a)));
  }
  gl_FragColor = vec4(mix(c.rgb, ink, e), 1.0);
  gl_FragDepth = texture2D(tDepth, vUv).x;
  #include <colorspace_fragment>
}`;

export function createInk(renderer) {
  const target = new THREE.WebGLRenderTarget(1, 1, { count: 2, depthBuffer: true });
  target.textures[0].colorSpace = THREE.SRGBColorSpace;
  for (const t of target.textures) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  target.depthTexture = new THREE.DepthTexture(1, 1);
  target.depthTexture.type = THREE.UnsignedIntType;

  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      tColor: { value: target.textures[0] }, tNormal: { value: target.textures[1] }, tDepth: { value: target.depthTexture },
      texel: { value: new THREE.Vector2() }, near: { value: 0.1 }, far: { value: 20 }, width: { value: 1 },
      ink: { value: new THREE.Color(INK) },
    },
    depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera();

  return {
    setSize(w, h, pixelRatio) {
      const W = Math.max(1, Math.floor(w * pixelRatio)), H = Math.max(1, Math.floor(h * pixelRatio));
      target.setSize(W, H);
      material.uniforms.texel.value.set(1 / W, 1 / H);
      // la línea mide ~1 px de pantalla en cualquier densidad
      material.uniforms.width.value = Math.max(1, Math.round(pixelRatio * 1.1));
    },
    render(scene, camera) {
      material.uniforms.near.value = camera.near;
      material.uniforms.far.value = camera.far;
      const mask = camera.layers.mask;
      camera.layers.set(0);
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(quadScene, quadCam);
      camera.layers.set(GLOW_LAYER);
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = auto;
      camera.layers.mask = mask;
    },
  };
}
