// Contornos de animación: la escena se dibuja una vez en un render target con dos salidas
// (color + número de trazo en el alfa, y normales) más su profundidad. Una pasada a pantalla completa
// busca, en un anillo alrededor de cada píxel, cambios de profundidad (siluetas), de normal (dobleces)
// o de número de trazo (un material contra otro) y pinta ahí una línea color tinta.
// El trazo imita uno hecho a mano: centrado en el borde, con orillas suaves, un temblor leve
// y un poco más grueso en lo que está cerca de la cámara.
// Después se dibuja encima la capa translúcida (sombras planas, cono de luz, humo) con la misma profundidad.

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
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

vec4 C; vec3 N; float Z;
// 1 si entre el centro y este vecino hay un borde
float edge(vec2 uv) {
  float zn = viewZ(uv);
  float e = smoothstep(0.03, 0.06, abs(zn - Z) / min(zn, Z));
  vec3 nn = texture2D(tNormal, uv).xyz * 2.0 - 1.0;
  e = max(e, 1.0 - smoothstep(0.7, 0.85, dot(N, nn)));
  return max(e, step(0.5 / 255.0, abs(texture2D(tColor, uv).a - C.a)));
}

void main() {
  vec2 px = gl_FragCoord.xy / width;
  // temblor de mano: el punto de muestreo se mueve un poquito con un ruido suave
  vec2 wob = (vec2(noise(px * 0.045), noise(px * 0.045 + 31.0)) - 0.5) * 1.4 * width;
  vec2 uv = vUv + wob * texel;
  C = texture2D(tColor, uv);
  N = texture2D(tNormal, uv).xyz * 2.0 - 1.0;
  Z = viewZ(uv);
  // más grueso de cerca, más fino de lejos, y el grosor también respira un poco a lo largo del trazo
  float w = width * clamp(1.5 / Z, 0.7, 1.45) * (0.85 + 0.3 * noise(px * 0.02 + 7.0));
  float inner = 0.0, outer = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    vec2 d = vec2(cos(a), sin(a));
    inner = max(inner, edge(uv + d * w * texel));
    if (i % 2 == 1) outer = max(outer, edge(uv + d * (w + 0.9) * texel));
  }
  float e = max(inner, outer * 0.5);
  vec3 col = mix(texture2D(tColor, vUv).rgb, ink, e);
  // esquinas oscuras y suaves, como en la ilustración de referencia
  vec2 q = (vUv - 0.5) * vec2(1.05, 1.25);
  col *= mix(0.42, 1.0, smoothstep(0.85, 0.3, length(q)));
  gl_FragColor = vec4(col, 1.0);
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
      // medio grosor del trazo en píxeles del render: ~1 px de pantalla, el trazo completo mide ~2
      material.uniforms.width.value = pixelRatio;
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
