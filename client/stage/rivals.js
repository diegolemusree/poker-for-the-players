// Rivales: recortes ilustrados que cambian de pose como en una animación de televisión.
//   espera   por omisión, parpadea cada 3 a 6 s (150 ms con la imagen de parpadeo)
//   espia    justo después de que le reparten y de vez en cuando mientras espera
//   apuesta  unos 2 s cuando iguala, apuesta o sube; luego regresa a espera
//   retirarse  al retirarse, antes de apagarse (si el personaje tiene ese cuadro)
//   gana     mientras se ve el resultado de una mano que ganó (si el personaje tiene ese cuadro)
// Más una respiración muy sutil (escala vertical desde la cintura) para que no se vea congelado.
// Si al personaje le falta un cuadro (por ahora puede tener solo espera), ese cambio no ocurre: no parpadea,
// no espía, no apuesta...; en cuanto se registra el cuadro, se usa solo.

import { angleOf, artUrl, loadedImage, poseFile, hasPose } from './characters.js';

const rand = (a, b) => a + Math.random() * (b - a);
const BLINK_MS = 150;
const BET_POSE = ['call', 'bet', 'raise'];

export class RivalAnim {
  constructor(charId, now) {
    this.charId = charId;
    this.angle = 'frente';         // ángulo en que se dibuja (lo actualiza la escena): de ahí salen sus cuadros
    this.pose = 'espera';
    this.poseUntil = 0;
    this.pending = null;           // { pose, at, ms }: una pose que empieza después (al repartir)
    this.blinkAt = now + rand(800, 4000);
    this.blinkUntil = 0;
    this.peekAt = now + rand(8000, 15000);
    this.period = rand(3.4, 4.6);  // respiración: cada quien a su ritmo
    this.phase = rand(0, Math.PI * 2);
    this.hand = undefined;         // última mano y última jugada vistas (para no animar lo viejo)
    this.lastN = undefined;
    this.wonHand = undefined;      // última mano que celebró (gana)
  }
  has(pose) { return pose === 'espera' || hasPose(this.charId, this.angle, pose); }
  // Pasa a `pose` por `ms` (después de `delay` ms). Si el personaje no tiene ese cuadro, se queda como está.
  play(pose, ms, now, delay = 0) {
    if (!this.has(pose)) return;
    if (delay > 0) { this.pending = { pose, at: now + delay, ms }; return; }
    this.pending = null;
    this.pose = pose;
    this.poseUntil = now + ms;
  }
  // Reacción a su jugada: apuesta al igualar, apostar o subir; retirarse al retirarse, si no está ausente
  // (ausente se retira solo cada mano y ya se ve apagado).
  react(type, angle, away, now) {
    this.angle = angle;
    if (BET_POSE.includes(type)) this.play('apuesta', 2000, now);
    else if (type === 'fold' && !away) this.play('retirarse', 1400, now);
  }
  // Ganó la mano: el cuadro gana mientras dura el resultado (`ms`); si no lo tiene, sigue en espera.
  // `delay`: para que empiece cuando ya se voltearon las cartas.
  win(angle, now, ms, delay = 0) {
    this.angle = angle;
    this.play('gana', ms, now, delay);
  }
  // Mano nueva (aunque el resultado se haya cerrado antes con Listo): deja de celebrar.
  calm() {
    if (this.pending && this.pending.pose === 'gana') this.pending = null;
    if (this.pose === 'gana') { this.pose = 'espera'; this.poseUntil = 0; }
  }
  // Imagen que toca en este momento. `idle`: puede espiar sus cartas por su cuenta.
  frame(now, idle) {
    if (this.pending && now >= this.pending.at) this.play(this.pending.pose, this.pending.ms, now);
    if (this.pose !== 'espera' && now >= this.poseUntil) this.pose = 'espera';
    if (now >= this.peekAt) {
      this.peekAt = now + rand(8000, 15000);
      if (idle && this.pose === 'espera') this.play('espia', rand(1200, 2000), now);
    }
    if (now >= this.blinkAt) { this.blinkUntil = now + BLINK_MS; this.blinkAt = now + rand(3000, 6000); }
    // solo espera tiene cuadro de parpadeo (y si el personaje no lo tiene, no parpadea)
    return now < this.blinkUntil && this.pose === 'espera' && this.has('parpadeo') ? 'parpadeo' : this.pose;
  }
  // ¿Sigue en la pose de retirarse? Mientras tanto no se apaga.
  folding(now) { return this.pose === 'retirarse' && now < this.poseUntil; }
  breath(t) { return 0.0075 * (1 - Math.cos((t / this.period) * Math.PI * 2 + this.phase)); } // 0 a 1.5 %
}

// Las poses ya reducidas al tamaño en que se dibujan (reducir una imagen grande en cada cuadro es caro
// y se ve granulado). Se reduce a la mitad varias veces para que la línea quede limpia.
const scaled = new Map();
export function clearPoseCache() { scaled.clear(); }
// `angle`: 'frente' o 'lado'. `dim`: versión apagada (desaturada y oscura) para quien se retiró o está ausente.
export function poseCanvas(charId, angle, pose, small, pxH, dim = false) {
  angle = angleOf(charId, angle);
  const key = `${charId}|${angle}|${pose}|${small ? 1 : 0}|${pxH}|${dim ? 1 : 0}`;
  if (scaled.has(key)) return scaled.get(key);
  const img = loadedImage(artUrl(poseFile(charId, angle, pose), small));
  if (!img) return null; // todavía no carga (solo pasa si se cambió la calidad hace un momento)
  const c = downscale(img, pxH);
  if (dim) darken(c);
  scaled.set(key, c);
  return c;
}
function darken(c) {
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const l = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
    for (let k = 0; k < 3; k++) px[i + k] = (px[i + k] * 0.35 + l * 0.65) * 0.62;
  }
  g.putImageData(d, 0, 0);
}
function downscale(img, pxH) {
  let src = img, w = img.naturalWidth, h = img.naturalHeight;
  const tw = Math.max(1, Math.round((w * pxH) / h)), th = Math.max(1, Math.round(pxH));
  while (w / 2 >= tw * 1.05) {
    const c = document.createElement('canvas');
    c.width = Math.round(w / 2); c.height = Math.round(h / 2);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    src = c; w = c.width; h = c.height;
  }
  const c = document.createElement('canvas');
  c.width = tw; c.height = th;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, tw, th);
  // la ilustración termina cortada (silla y rodillas): el último pedacito se desvanece por si llega a
  // asomar fuera de la mesa, para que no se vea un corte recto
  const fade = g.createLinearGradient(0, th * 0.9, 0, th);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = fade; g.fillRect(0, th * 0.9, tw, th * 0.1);
  return c;
}
