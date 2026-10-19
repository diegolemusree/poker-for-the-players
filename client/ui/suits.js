// Palos de forma clásica (caja de 100×100), gruesos y limpios, en dos colores como en la baraja tradicional: rojos los
// corazones y los diamantes, de tinta las picas y los tréboles. Los usan las cartas de la mesa (client/stage/cards.js,
// canvas) y las del panel del resultado y la vista 2D (SVG). Todos los trazos van en el mismo sentido, así el relleno
// (nonzero) une los círculos del trébol con su tallo sin dejar huecos. scripts/generar-baraja.py lee estas mismas formas
// para buscar palos en lo que dibuja Gemini.

const circle = (cx, cy, r) => {
  const k = r * 0.5523;
  return `M${cx} ${cy - r} C${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} C${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} `
    + `C${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} C${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} Z`;
};

export const SUIT_PATH = {
  s: 'M50 4 C56 16 70 28 82 39 C95 51 96 66 87 75 C79 83 64 83 56 74 C57 84 62 91 71 96 L29 96 C38 91 43 84 44 74 '
    + 'C36 83 21 83 13 75 C4 66 5 51 18 39 C30 28 44 16 50 4 Z',
  h: 'M50 93 C44 82 6 62 6 35 C6 18 18 8 31 8 C41 8 48 15 50 24 C52 15 59 8 69 8 C82 8 94 18 94 35 C94 62 56 82 50 93 Z',
  d: 'M50 3 C59 18 72 36 85 50 C72 64 59 82 50 97 C41 82 28 64 15 50 C28 36 41 18 50 3 Z',
  c: `${circle(50, 29, 20.5)} ${circle(27, 57, 20.5)} ${circle(73, 57, 20.5)} M50 40 L66 56 L50 70 L34 56 Z `
    + 'M53 62 C53 78 58 88 69 96 L31 96 C42 88 47 78 47 62 Z',
};

// Corazones y diamantes en rojo ladrillo, picas y tréboles en tinta oscura.
export const SUIT_COLOR = { s: '#231c17', h: '#a8352a', d: '#a8352a', c: '#231c17' };
