// "Celular" = pantalla táctil de 640 px de ancho o menos (en vertical). La misma regla está en style.css;
// una ventana angosta en la computadora no cuenta, así ahí todo queda igual.
export const phoneQuery = matchMedia('(pointer: coarse) and (max-width: 640px)');
export const isPhone = () => phoneQuery.matches;
