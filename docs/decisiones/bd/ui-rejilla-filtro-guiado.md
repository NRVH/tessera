# El filtro guiado es una lista vertical de condiciones con desplegables nativos y el texto libre detrás de un botón

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/filtro/BarraFiltroGuiado.tsx`, `filtro/modeloFiltro.ts`

## Contexto

En la barra WHERE de texto, `ESTATUS="NOMINA PROCESADA"` dio ORA-00904 en Oracle: las comillas
dobles son un identificador. Escribir el filtro exige saber el dialecto; elegirlo, no. Cómo se
compila, en [rejilla-filtro-guiado-sql.md](rejilla-filtro-guiado-sql.md) y
[documentos-filtro-guiado.md](documentos-filtro-guiado.md).

## Decisión

- Se elige la columna, el operador sale de su TIPO y el valor va aparte (el main lo manda como
  parámetro). El texto libre queda detrás del botón del modo avanzado («SQL» o «JSON»).
- Una fila por condición, en vertical, cada una con su palabra delante («donde», luego «y» u
  «o»): se lee como una frase. El conmutador «todas / cualquiera» solo con dos o más.
- El pie: «+ Condición» a la izquierda y, a la derecha y siempre en el MISMO sitio, «Aplicar» y
  el modo avanzado; la barra de SQL pone su «Guiado» en ese hueco, así que ir y volver es pulsar
  dos veces en el mismo punto. Todos con texto; el aspa de quitar es de la fila.
- Sin condiciones mide lo mismo que la barra WHERE (cambiar de modo no hace saltar la rejilla);
  estrecha, cada fila se parte (`flex-wrap`) en vez de encoger los controles hasta que no se lean.
- Desplegables NATIVOS (`<select>`): teclado, lectores de pantalla y la lista del sistema, y ya
  saltan por la inicial al teclear.
- El valor según la categoría: texto en monoespaciada, número con teclado decimal, fecha con la
  pista ISO (hora opcional), booleano en un desplegable.
- Teclado: Intro aplica; Esc pide volver a lo aplicado y sigue su camino (lo que hay que
  deshacer lo sabe el padre). Tras añadir, el foco va a la columna de la fila nueva; tras
  quitar, al aspa de la que ocupa su sitio. Un error nuevo lleva el foco al valor de su fila.

## Descartes

- Un combobox propio con búsqueda: con 200 columnas ayudaría, pero el nativo ya salta por la
  inicial.
- `<input type=date>`: no admite la hora opcional ni pegar un ISO a mano.
- Un menú de orden en la cabecera, como el de las hojas de cálculo: clic y Mayús+clic cubren lo mismo
  sin otra capa.
