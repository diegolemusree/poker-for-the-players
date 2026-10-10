// Fichas del torneo: denominaciones, colores y cómo se forma una cantidad con ellas.
// Lo usa la interfaz (y lo usará la escena 3D). Es un módulo puro, también se prueba en Node.

export const CHIPS = [
  { value: 1000, name: 'mostaza',  color: '#c99a35', edge: '#6e5216' },
  { value: 500,  name: 'marino',   color: '#2f3f5c', edge: '#141c2b' },
  { value: 100,  name: 'negra',    color: '#2b2622', edge: '#8a8174' },
  { value: 50,   name: 'ladrillo', color: '#a4452f', edge: '#57200f' },
  { value: 25,   name: 'oliva',    color: '#6f7a3c', edge: '#353b17' },
  { value: 10,   name: 'crema',    color: '#e3d6b8', edge: '#7d705a' },
];

// Lo que recibe cada jugador al empezar (o al recomprar): 32 fichas = 5,000.
export const STARTING_CHIPS = [
  { value: 1000, count: 2 },
  { value: 500, count: 3 },
  { value: 100, count: 10 },
  { value: 50, count: 6 },
  { value: 25, count: 6 },
  { value: 10, count: 5 },
];

// Forma `amount` con el menor número de fichas. Cualquier múltiplo de 5 desde 20 sale exacto;
// si sobra algo que no se puede formar (5 o 15, o no múltiplo de 5) se regresa en `rest`.
export function breakdown(amount) {
  amount = Math.max(0, Math.floor(amount));
  let big = amount - (amount % 100), small = amount % 100;
  if ((small === 5 || small === 15) && big >= 100) { big -= 100; small += 100; }
  const out = [];
  for (const v of [1000, 500, 100]) { const n = Math.floor(big / v); if (n) out.push({ value: v, count: n }); big -= n * v; }
  const best = bestSmall(small);
  const rest = small - best.reduce((a, c) => a + c.value * c.count, 0);
  return { chips: [...out, ...best].sort((a, b) => b.value - a.value), rest };
}

// Búsqueda exhaustiva para el resto chico (menos de 200): mínimas fichas, máximo valor formado.
function bestSmall(x) {
  let best = null, bestKey = null;
  for (let a = 0; a * 100 <= x; a++) {
    for (let b = 0; a * 100 + b * 50 <= x; b++) {
      for (let c = 0; a * 100 + b * 50 + c * 25 <= x; c++) {
        const d = Math.floor((x - a * 100 - b * 50 - c * 25) / 10);
        const formed = a * 100 + b * 50 + c * 25 + d * 10;
        const key = [x - formed, a + b + c + d];
        if (!best || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { best = [a, b, c, d]; bestKey = key; }
      }
    }
  }
  return [[100, best[0]], [50, best[1]], [25, best[2]], [10, best[3]]].filter(([, n]) => n).map(([value, count]) => ({ value, count }));
}

// Para pilas que se ven en la mesa: además de las fichas grandes deja cambio en fichas más chicas,
// como una pila de verdad (5,000 = 4 de 1,000, 1 de 500 y 5 de 100, no solo 5 amarillas).
const KEEP = [[1000, 1000], [500, 500], [100, 200]];
export function stackBreakdown(amount) {
  amount = Math.max(0, Math.floor(amount));
  const out = [];
  let r = amount;
  for (const [v, keep] of KEEP) {
    const n = Math.max(0, Math.floor((r - keep) / v));
    if (n) { out.push({ value: v, count: n }); r -= n * v; }
  }
  const tail = breakdown(r);
  for (const c of tail.chips) {
    const same = out.find(o => o.value === c.value);
    if (same) same.count += c.count; else out.push({ ...c });
  }
  return { chips: out.sort((a, b) => b.value - a.value), rest: tail.rest };
}

export const chipInfo = value => CHIPS.find(c => c.value === value);
