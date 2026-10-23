// "Celular" = pantalla táctil de 640 px de ancho o menos (en vertical). La misma regla está en style.css;
// una ventana angosta en la computadora no cuenta, así ahí todo queda igual.
export const phoneQuery = matchMedia('(pointer: coarse) and (max-width: 640px)');
export const isPhone = () => phoneQuery.matches;

// "Computadora" = con mouse o trackpad (hover y puntero fino): solo ahí hay brazos (stage/arms.js). No es lo contrario
// de isPhone: una tablet no es ni celular ni computadora, y se queda como antes.
export const desktopQuery = matchMedia('(hover: hover) and (pointer: fine)');
export const isDesktop = () => desktopQuery.matches;
