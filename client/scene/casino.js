// El casino de mala muerte: paredes con tubos y neones, ventana con cielo de dos soles,
// planetas, una nave que pasa de vez en cuando, máquinas raras y la lámpara que cuelga sobre la mesa.

import * as THREE from 'three';
import { mesh, toon } from './toon.js';

const ROOM = { x: 5.5, back: -5.5, front: 4.5, h: 3.8 };
const WIN = { x: 2.8, y0: 0.95, y1: 2.95 };

function box(parent, w, h, d, color, x, y, z, kind = 'big') {
  const m = mesh(new THREE.BoxGeometry(w, h, d), color, kind);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function tube(parent, points, r, color, outlined = true) {
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 64, r, 10, false);
  const m = outlined ? mesh(geo, color) : new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
  parent.add(m);
  return m;
}

function sky(parent) {
  const geo = new THREE.PlaneGeometry(44, 18);
  const mat = new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: { top: { value: new THREE.Color('#2b1160') }, mid: { value: new THREE.Color('#ff3e8a') }, low: { value: new THREE.Color('#ffb547') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec2 vUv;
      void main(){ float y = vUv.y; vec3 c = y < 0.4 ? mix(low, mid, smoothstep(0.1, 0.4, y)) : mix(mid, top, smoothstep(0.4, 0.75, y));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      }`,
  });
  const s = new THREE.Mesh(geo, mat);
  s.position.set(0, 4, -17);
  parent.add(s);

  const flat = (r, color, x, y, z, opacity = 1) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity }));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  // dos soles con halo
  flat(1.7, '#ffd23f', -3.4, 3.7, -16.5, 0.35); flat(1.15, '#fff27a', -3.4, 3.7, -16.4);
  flat(0.95, '#5fe3ff', -1.0, 2.5, -16.3, 0.35); flat(0.6, '#d8fbff', -1.0, 2.5, -16.2);
  // planeta con anillo y una luna
  const planet = mesh(new THREE.SphereGeometry(1.4, 28, 20), '#4fd1a5');
  planet.position.set(4.2, 4.3, -15);
  parent.add(planet);
  const ring = mesh(new THREE.TorusGeometry(2.1, 0.12, 6, 48), '#f5c26b');
  ring.position.copy(planet.position); ring.rotation.set(1.25, 0.2, 0.35); ring.scale.z = 0.3;
  parent.add(ring);
  const moon = mesh(new THREE.SphereGeometry(0.42, 16, 12), '#e07bd1');
  moon.position.set(1.6, 4.6, -14.5);
  parent.add(moon);
  // cerros del planeta
  [[-5, -1.4, 3.2, '#5b2a5c'], [-1.2, -1.8, 4.2, '#3c1e4a'], [3.5, -1.5, 3.6, '#6b2f63'], [7.5, -1.6, 3.5, '#3c1e4a']].forEach(([x, y, r, c]) => {
    const hill = mesh(new THREE.SphereGeometry(r, 20, 12), c);
    hill.position.set(x, y, -13);
    hill.scale.y = 0.55;
    parent.add(hill);
  });
}

function ship(parent) {
  const g = new THREE.Group();
  const hull = mesh(new THREE.CapsuleGeometry(0.22, 0.9, 4, 12), '#d9d9e6');
  hull.rotation.z = Math.PI / 2;
  g.add(hull);
  const dome = mesh(new THREE.SphereGeometry(0.18, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#7ff0ff');
  dome.position.set(0.15, 0.15, 0);
  g.add(dome);
  for (const s of [-1, 1]) {
    const fin = mesh(new THREE.ConeGeometry(0.1, 0.35, 4), '#ff5a5a');
    fin.position.set(-0.45, 0.05, s * 0.18); fin.rotation.set(s * 0.6, 0, Math.PI / 2);
    g.add(fin);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 10), new THREE.MeshBasicMaterial({ color: '#ffb21f' }));
  flame.rotation.z = Math.PI / 2; flame.position.x = -0.85;
  g.add(flame);
  g.position.set(-30, 3.4, -12);
  g.scale.setScalar(1.3);
  parent.add(g);
  return { g, flame, next: 4, speed: 4.5, flying: false };
}

function machine(parent, x, z, rotY, body, screen) {
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = rotY;
  box(g, 0.9, 1.3, 0.7, body, 0, 0.65, 0);
  box(g, 0.95, 0.12, 0.75, '#1d1d22', 0, 1.33, 0);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.38), new THREE.MeshBasicMaterial({ color: screen }));
  scr.position.set(0, 0.95, 0.356);
  g.add(scr);
  const lever = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 8), '#c0c0cc');
  lever.position.set(0.5, 1.0, 0); lever.rotation.z = -0.2;
  g.add(lever);
  const knob = mesh(new THREE.SphereGeometry(0.06, 12, 8), '#ff3b3b');
  knob.position.set(0.55, 1.22, 0);
  g.add(knob);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), new THREE.MeshToonMaterial({ color: '#8ff7ff', transparent: true, opacity: 0.35, depthWrite: false }));
  glass.position.y = 1.72;
  g.add(glass);
  const critter = mesh(new THREE.SphereGeometry(0.13, 14, 10), '#9cff4f');
  critter.position.y = 1.62;
  g.add(critter);
  const bulbs = [-0.25, 0, 0.25].map((bx, i) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    b.position.set(bx, 0.5, 0.36);
    g.add(b);
    return b;
  });
  parent.add(g);
  const colors = ['#ff3df2', '#39f5ff', '#b6ff3b', '#ffd23f'].map(c => new THREE.Color(c));
  return (t, low) => {
    critter.position.y = 1.62 + Math.sin(t * 2 + x) * 0.05;
    critter.scale.set(1 + Math.sin(t * 5) * 0.08, 1 - Math.sin(t * 5) * 0.08, 1);
    if (low) return;
    const k = Math.floor(t * 3 + Math.abs(x));
    bulbs.forEach((b, i) => b.material.color.copy(colors[(k + i) % colors.length]));
    scr.material.color.set(Math.sin(t * 7 + x) > 0.85 ? '#ffffff' : screen);
  };
}

function plant(parent, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const pot = mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.45, 16), '#ff7a3d');
  pot.position.y = 0.225;
  g.add(pot);
  const arms = [];
  for (let i = 0; i < 5; i++) {
    const pivot = new THREE.Group();
    pivot.position.y = 0.42;
    pivot.rotation.y = (i / 5) * Math.PI * 2;
    const t = mesh(new THREE.CapsuleGeometry(0.045, 0.7, 4, 8), i % 2 ? '#2fd17a' : '#1fae64');
    t.position.y = 0.38;
    pivot.add(t);
    const bulb = mesh(new THREE.SphereGeometry(0.07, 10, 8), '#ff4fd8');
    bulb.position.y = 0.78;
    pivot.add(bulb);
    g.add(pivot);
    arms.push(pivot);
  }
  parent.add(g);
  return (t) => arms.forEach((a, i) => { a.rotation.z = 0.35 + Math.sin(t * 1.2 + i) * 0.12; a.rotation.x = Math.cos(t * 0.9 + i * 2) * 0.1; });
}

export function buildCasino(scene) {
  const g = new THREE.Group();
  scene.add(g);
  const ticks = [];

  // piso, tapete y paredes
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x * 2, ROOM.front - ROOM.back), toon('#2a1846'));
  floor.rotation.x = -Math.PI / 2; floor.position.z = (ROOM.front + ROOM.back) / 2;
  floor.receiveShadow = true;
  g.add(floor);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1, 48), toon('#d8572a'));
  rug.rotation.x = -Math.PI / 2; rug.scale.set(3.0, 2.3, 1); rug.position.y = 0.004;
  rug.receiveShadow = true;
  g.add(rug);
  const rug2 = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.95, 48), toon('#ffd23f'));
  rug2.rotation.x = -Math.PI / 2; rug2.scale.set(3.0, 2.3, 1); rug2.position.y = 0.006;
  g.add(rug2);

  const wall = '#4a2c6e', W = 0.3, H = ROOM.h;
  box(g, ROOM.x - WIN.x, H, W, wall, -(ROOM.x + WIN.x) / 2, H / 2, ROOM.back);
  box(g, ROOM.x - WIN.x, H, W, wall, (ROOM.x + WIN.x) / 2, H / 2, ROOM.back);
  box(g, WIN.x * 2, WIN.y0, W, wall, 0, WIN.y0 / 2, ROOM.back);
  box(g, WIN.x * 2, H - WIN.y1, W, wall, 0, (H + WIN.y1) / 2, ROOM.back);
  for (const s of [-1, 1]) box(g, W, H, ROOM.front - ROOM.back, wall, s * ROOM.x, H / 2, (ROOM.front + ROOM.back) / 2);
  box(g, ROOM.x * 2, H, W, wall, 0, H / 2, ROOM.front);
  box(g, ROOM.x * 2, 0.2, ROOM.front - ROOM.back, '#2b1846', 0, H + 0.1, (ROOM.front + ROOM.back) / 2, null);
  // zoclo turquesa
  for (const s of [-1, 1]) box(g, 0.06, 0.9, ROOM.front - ROOM.back, '#2b8a8a', s * (ROOM.x - 0.18), 0.45, (ROOM.front + ROOM.back) / 2);
  box(g, ROOM.x * 2, 0.9, 0.06, '#2b8a8a', 0, 0.45, ROOM.back + 0.18);

  // marco de la ventana con remaches
  const frame = '#c9c2b0', fz = ROOM.back + 0.2;
  box(g, WIN.x * 2 + 0.3, 0.16, 0.18, frame, 0, WIN.y0, fz);
  box(g, WIN.x * 2 + 0.3, 0.16, 0.18, frame, 0, WIN.y1, fz);
  for (const x of [-WIN.x, WIN.x, -0.95, 0.95]) box(g, x === -0.95 || x === 0.95 ? 0.08 : 0.16, WIN.y1 - WIN.y0, 0.14, frame, x, (WIN.y0 + WIN.y1) / 2, fz);
  const rivet = new THREE.SphereGeometry(0.035, 8, 6);
  for (let i = 0; i <= 12; i++) {
    for (const y of [WIN.y0, WIN.y1]) {
      const r = mesh(rivet, '#8c8577', null);
      r.position.set(-WIN.x + (i / 12) * WIN.x * 2, y, fz + 0.1);
      g.add(r);
    }
  }
  sky(g);
  const nave = ship(g);

  // tubos por las paredes y el techo
  tube(g, [[-5.3, 0.2, -4.6], [-5.3, 2.4, -4.6], [-5.1, 3.3, -3.6], [-5.15, 3.35, 0], [-5.3, 2.2, 1.6], [-5.3, 0.2, 2.2]], 0.09, '#3fae6a');
  tube(g, [[5.3, 0.2, -4.2], [5.3, 1.6, -4.2], [5.25, 2.2, -2.5], [5.3, 3.1, 0.8], [5.3, 0.4, 3.0]], 0.11, '#d98a2b');
  tube(g, [[-5.3, 3.5, -2], [-2, 3.6, -3.4], [2, 3.55, -3.0], [5.3, 3.5, -1.5]], 0.07, '#8f6ad8');
  [[-5.3, 1.2, -4.6], [-5.18, 3.32, -2], [5.3, 1.0, -4.2], [5.28, 2.7, -0.8]].forEach(([x, y, z]) => {
    const j = mesh(new THREE.TorusGeometry(0.12, 0.04, 8, 16), '#e6b54c');
    j.position.set(x, y, z); j.rotation.x = Math.PI / 2;
    g.add(j);
  });

  // neones (sin contorno, color plano brillante) y sus luces
  const neon = [
    tube(g, [[-5.25, 2.6, -3.5], [-5.25, 2.2, -2.9], [-5.25, 2.6, -2.3], [-5.25, 2.2, -1.7], [-5.25, 2.6, -1.1], [-5.25, 2.2, -0.5]], 0.035, '#ff3df2', false),
    tube(g, [[5.25, 2.0, -3.2], [5.25, 2.6, -2.6], [5.25, 2.0, -2.0], [5.25, 1.6, -2.6], [5.25, 2.0, -3.2]], 0.035, '#39f5ff', false),
    tube(g, [[-2.6, 3.25, -5.3], [-1.3, 3.45, -5.3], [0, 3.25, -5.3], [1.3, 3.45, -5.3], [2.6, 3.25, -5.3]], 0.035, '#b6ff3b', false),
  ];
  const base = neon.map(n => n.material.color.clone());
  const lights = [new THREE.PointLight('#ff3df2', 1.6, 6, 1), new THREE.PointLight('#39f5ff', 1.6, 6, 1)];
  lights[0].position.set(-4.6, 2.4, -2); lights[1].position.set(4.6, 2.2, -2.6);
  lights.forEach(l => g.add(l));

  ticks.push(machine(g, -4.4, -3.6, 0.9, '#2f6fd6', '#ff3db2'));
  ticks.push(machine(g, 4.4, -3.4, -0.9, '#d63f6f', '#39f5ff'));
  ticks.push(plant(g, -3.4, -4.7));

  // lámpara colgante que zumba
  const lamp = new THREE.Group();
  lamp.position.set(0, ROOM.h, 0);
  const cord = mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.25, 6), '#1d1d22', null);
  cord.position.y = -0.62;
  lamp.add(cord);
  const shade = mesh(new THREE.CylinderGeometry(0.16, 0.62, 0.36, 28, 1, true), toon('#3ad1a0', { side: THREE.DoubleSide }));
  shade.position.y = -1.42;
  lamp.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), new THREE.MeshBasicMaterial({ color: '#fff6c4' }));
  bulb.position.y = -1.55;
  lamp.add(bulb);
  g.add(lamp);

  const spot = new THREE.SpotLight('#fff1c4', 2.6, 0, 0.95, 0.55, 0);
  spot.position.set(0, ROOM.h - 1.5, 0);
  spot.target.position.set(0, 0, 0);
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0008;
  spot.shadow.camera.near = 0.5; spot.shadow.camera.far = 4;
  g.add(spot, spot.target);

  let quality = 'media', calm = false;
  return {
    spot,
    setQuality(q, reducedMotion) {
      quality = q; calm = reducedMotion;
      lights.forEach(l => { l.visible = q !== 'baja'; });
    },
    tick(t, dt) {
      const low = quality === 'baja';
      lamp.rotation.z = calm ? 0 : Math.sin(t * 0.6) * 0.025;
      lamp.rotation.x = calm ? 0 : Math.cos(t * 0.45) * 0.015;
      // neones que parpadean
      neon.forEach((n, i) => {
        const off = !low && Math.sin(t * (7 + i * 3)) > 0.97 - (i === 1 ? 0.05 : 0);
        n.material.color.copy(base[i]).multiplyScalar(off ? 0.25 : 1);
        if (lights[i]) lights[i].intensity = off ? 0.4 : 1.6;
      });
      for (const f of ticks) f(t, low);
      // la nave pasa de vez en cuando
      nave.next -= dt;
      if (!nave.flying && nave.next <= 0) { nave.flying = true; nave.g.position.x = -14; nave.g.position.y = 2.6 + Math.random() * 1.8; }
      if (nave.flying) {
        nave.g.position.x += nave.speed * dt;
        nave.g.position.y += Math.sin(t * 3) * 0.004;
        nave.flame.scale.y = 0.8 + Math.random() * 0.5;
        if (nave.g.position.x > 14) { nave.flying = false; nave.next = (low ? 40 : 14) + Math.random() * 20; }
      }
    },
  };
}
