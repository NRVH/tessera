# La rejilla de datos es propia, virtual en los dos ejes y pinta el valor sin reinterpretarlo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/rejilla/{ventanaRejilla,anchoColumnas,celdasRejilla,seleccionRejilla}.ts`, `DbRejilla.tsx`

## Contexto

Las tablas pueden tener decenas de miles de filas y cientos de columnas, con números que no
caben en un double, NULL distinto de la cadena vacía y LOB de 64 KiB por celda.

## Decisión

- Rejilla propia, sin dependencias: las de npm traen su modelo de edición, tema y selección,
  pesan cientos de KB y no resuelven lo que importa aquí (número como texto exacto, `<null>`,
  celdas recortadas por el main, teclado con la plataforma por parámetro).
- Coordenadas: cabecera y columna de números `sticky` TAPAN su franja; lo visible es el scroll
  más el tamaño útil. Columnas con prefijos en `Float64Array` y búsqueda binaria (O(log n) por
  cuadro); filas de alto fijo, una línea.
- Margen de 6 filas y 2 columnas: con el scroll rápido React pinta un cuadro después que el
  navegador. Quedan ~40×15 celdas vivas, se carguen 500 filas o 50 000.
- La página siguiente se pide a dos pantallas del final; una rejilla oculta (alto 0) no pide
  nada, o las pestañas de fondo se traerían la tabla entera solas.
- Ancho: el mayor entre la cabecera (medida en SU fuente, con el hueco del icono) y una muestra
  del texto PINTADO (100 filas al abrir, 1000 al ajustar), entre 56 y 360 px. A mano, sin el
  máximo de 360. Se deja de medir al llegar al máximo.
- NULL es `<null>` atenuado, nunca vacío. Los números se pintan tal cual, sin separador de miles
  (acabaría copiado). Los saltos se ven como ` ⏎ `. El binario es `<binario N bytes>`.
- Selección: UN rango `{ancla, foco}`; las flechas se mueven desde el foco; sin selección, la
  primera tecla entra por la primera celda. Es posicional; quien cambia la forma de la vista la
  reubica ([ui-rejilla-modelo-cambios.md](ui-rejilla-modelo-cambios.md)).

## Consecuencias

`DbRejilla` mide el DOM y estas funciones puras deciden; las prueba `test-rejilla.mts` y
`test-celdas-rejilla.mts`. La rejilla es CSS grid con `sticky`: un envoltorio nuevo la rompe.

## Descartes

- Varios rangos con Ctrl+clic: no hay un TSV sensato de dos rectángulos y nadie lo ha pedido.
- `content-visibility` en las filas: en otras listas dejaba huecos al desplazar rápido.
