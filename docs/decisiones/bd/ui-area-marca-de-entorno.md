# El entorno de una conexión se marca con un solo componente: chip con el nombre o franja, con colores medidos

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/MarcaEntorno.tsx`, `marcaEntorno.css`

## Contexto

El árbol, la tira de pestañas, la barra de la consola, la de la pestaña de datos y los panes de
documentos y claves tienen que decir si una conexión es de Desarrollo, Pruebas o Producción. Cuatro
copias de un color acabarían divergiendo, y el color solo no es accesible.

## Decisión

- UN componente con UNA hoja de tokens. Sin entorno válido (`esEntorno`) no pinta nada: nunca un
  color que no se sabe qué significa. Recibe el entorno, no la conexión, para que lo use igual
  quien solo tiene el título de una pestaña.
- NORMAL: un chip con el NOMBRE, en las barras (identidad y metadatos, nunca un botón).
  Producción en ROJO RELLENO, porque el rojo relleno es para un ESTADO, nunca para una acción;
  Desarrollo y Pruebas en tinte con filete: informan, no alarman.
- COMPACTA: una FRANJA sin texto; la coloca el CSS de quien la usa (borde izquierdo de la fila del
  árbol, pie de la pestaña). Es `role="img"` con «Entorno: …», que entra en el nombre accesible
  de la fila o la pestaña; la normal lleva el nombre como texto. Las dos llevan `title`.
- Tokens en `:root`, redefinidos con `:root[data-theme='light']` para el tema claro. Contrastes
  medidos (WCAG) del texto del chip sobre su tinte del 16 %: en oscuro, sobre el fondo más claro
  donde cae, Desarrollo 6,00:1, Pruebas 5,27:1 y Producción rellena 6,40:1 (6,31:1 contra el
  fondo hundido); en claro, 4,96:1, 5,15:1 y 6,54:1. La franja pide 3:1 y todos lo superan.
- Desarrollo es el verde del tema («bien, sin riesgo»). Pruebas NO es el amarillo del tema, que es
  el de los avisos del árbol y la llave de la PK: un ámbar más anaranjado lo separa. Producción es
  el rojo del tema relleno, NO la familia `--danger-*` (rojo de ACCIÓN). El tinte de fila y
  pestaña de producción es un 10 % que no compite con el azul de la selección.

## Consecuencias

- Cambiar un color exige volver a medir el contraste en los dos temas.

## Descartes

- Un PUNTO como compacta: junto al punto de sesión del árbol (verde = conectada), un punto verde
  de «Desarrollo» se leía como «conectada».
- Abreviaturas («PROD», «PRU») en el chip: «PRU» no se entiende y en las barras hay sitio.
