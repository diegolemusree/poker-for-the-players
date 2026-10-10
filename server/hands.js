// Evaluador de manos de poker. Las cartas son cadenas de 2 letras: rango + palo, p. ej. 'Ah', 'Td'.

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';
export const HAND_NAMES = ['Carta alta', 'Par', 'Doble par', 'Trío', 'Escalera', 'Color', 'Full', 'Póker', 'Escalera de color'];

const RV = r => RANKS.indexOf(r) + 2;

// Puntaje de exactamente 5 cartas: [categoría, desempates...]. Mayor es mejor.
export function score5(cs) {
  const v = cs.map(c => RV(c[0])).sort((a, b) => b - a);
  const flush = cs.every(c => c[1] === cs[0][1]);
  let sh = 0;
  if (new Set(v).size === 5) {
    if (v[0] - v[4] === 4) sh = v[0];
    else if (v[0] === 14 && v[1] === 5) sh = 5; // escalera baja A-2-3-4-5
  }
  const cnt = {};
  v.forEach(x => { cnt[x] = (cnt[x] || 0) + 1; });
  const g = Object.entries(cnt).map(([r, c]) => [+r, c]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const ord = g.map(x => x[0]);
  if (sh && flush) return [8, sh];
  if (g[0][1] === 4) return [7, ...ord];
  if (g[0][1] === 3 && g[1][1] === 2) return [6, ...ord];
  if (flush) return [5, ...v];
  if (sh) return [4, sh];
  if (g[0][1] === 3) return [3, ...ord];
  if (g[0][1] === 2 && g[1][1] === 2) return [2, ...ord];
  if (g[0][1] === 2) return [1, ...ord];
  return [0, ...v];
}

// Compara dos puntajes: >0 si gana a, <0 si gana b, 0 si empatan.
export function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Mejor mano de 5 entre 5 a 7 cartas.
export function bestHand(cs) {
  if (cs.length <= 5) return score5(cs);
  let best = null;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const s = score5(cs.filter((_, k) => k !== i && k !== j));
      if (!best || cmp(s, best) > 0) best = s;
    }
  }
  return best;
}

export const handName = s => (s[0] === 8 && s[1] === 14) ? 'Escalera real' : HAND_NAMES[s[0]];
