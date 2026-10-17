# Lo que se deja en un perfil o un proyecto sigue montado, oculto, para volver a él tal cual

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/comun/vivosRecientes.ts`, `useVivosRecientes.tsx` (`CapaViva`, `useYaVisto`), `capaVisible.ts`, `useDesplazamientoConservado.ts`, `useDialogo.ts`, `ConfirmDialog.tsx`, `util/modalAbierto.ts`, `styles.css` (`.capa-viva`, `.panel-lateral`, `.terminal-body`), sus usos en `features/explorador/Sidebar.tsx`, `features/ssh/RielConexionesSsh.tsx` (y `ListaConexionesSsh.tsx`, `rielSsh.css`, `features/terminales/TerminalsPanel.tsx`) y `features/layout/PanelLateral.tsx` (laterales por vista, `lateralesVivos.ts`; árbol de BD, `features/bd/DbArbol.tsx`)

## Contexto

Al volver a un perfil o a un proyecto, cada pantalla debe estar como se dejó. Las que guardan su
estado en el propio componente (un árbol con carpetas abiertas, su desplazamiento y su selección,
el filtro y la fila elegida de una lista) lo perdían al desmontarse en cada cambio y volvían de
cero, con su «Cargando…».

## Decisión

- Se mantienen montadas las piezas de lo último visto, con tope (`MAX_VIVOS`, 6), y solo se
  enseña la de lo que se ve. Van en orden de entrada y volver a una no la mueve: mover el nodo de
  una pieza oculta hace que el navegador descarte su desplazamiento. Lo reciente se lleva aparte y
  solo decide cuál sale al pasar del tope. Lo que deja de existir (un proyecto cerrado) sale de la
  lista. La lista se ajusta en el render, sin efecto: la pieza de lo que se acaba de abrir existe
  ya en el commit en que se ve.
- La que se ve no añade caja (`display: contents`): el CSS de su contenedor, que selecciona por
  estructura, no cambia. La oculta conserva su caja fuera del flujo, invisible e `inert`: con
  `display: none` el navegador descartaría el desplazamiento de su lista, e `inert` impide que el
  teclado o el lector de pantalla lleguen a ella. Su contenedor lleva `position: relative`.
- Una pieza oculta no se repinta por lo que le llega de fuera (`memo` que la deja quieta mientras
  no se ve), cierra lo que flota (menús, popovers: van por portal y se verían sobre lo que se ve) y
  no actúa sobre peticiones del que se ve. Lo que dependa de avisos que solo valen para lo que se ve
  se refresca al volver a verse. Cada pieza lleva fija su clave (su perfil, su proyecto): nada suyo
  actúa sobre lo de otra.
- `CapaViva` dice a lo que lleva dentro si se ve (`useCapaVisible`); el contexto atraviesa el
  `memo`. Un diálogo con algo a medias (el alta o la edición de una conexión de BD) se queda montado
  con su pieza, oculto e `inert`, y vuelve tal cual, con el foco donde estaba. Mientras está oculto
  no tapa nada: sale de la pila de diálogos y no atiende Esc (`useDialogo`) ni Enter
  (`ConfirmDialog`), y `hayModalAbierto` no lo cuenta, así que los atajos del que se ve siguen vivos.
- Las capas se anidan: una `CapaViva` dentro de otra oculta tampoco se ve, aunque sea la elegida de
  las suyas. Su caja no cambia (ya la oculta la de fuera), pero `useCapaVisible` dice `false` y lo
  de dentro deja de actuar igual: el árbol del proyecto que se ve no escucha cambios de archivos, y
  el de BD y la lista SSH quedan quietos y cierran lo que flota.
- Los contenedores de piezas vivas se conservan también, con el mismo patrón, para que las piezas
  no se vayan con ellos:
  - **Laterales por vista.** El de BD y el de archivos, vistos una vez, siguen montados mientras se
    mira otra vista (`lateralesMontables`); el de git no guarda nada así y se monta al verse. Van
    dentro de una tarjeta propia (`.panel-lateral`) con el ancho de la vista que se ve, y el oculto
    ocupa su mismo tamaño fuera del flujo: volver no lo redimensiona salvo que la otra vista tenga
    otro ancho.
  - **Riel SSH.** Se monta la primera vez que se enseña (`useYaVisto`) y desde entonces se queda,
    oculto fuera del flujo de la fila de la terminal (`.terminal-body` lo contiene), cuando no se
    enseña: al salir de pantalla completa, al plegarlo o al ir a un perfil que no lo enseña. Oculto
    no mide nada: su ancho y su tope se recalculan al volver. Si el perfil al que se va cierra la
    franja o enseña Git·Log, el panel de la terminal pasa a `display: none` y el navegador descarta
    el desplazamiento de la lista: la lista lo anota mientras se ve y lo repone al volver a verse,
    en el mismo commit y antes de pintar (`useDesplazamientoConservado`). El panel no se oculta como
    una capa: sus terminales y sus agentes miden su caja, y fuera del flujo no tendría qué medir
    con la franja cerrada.

## Consecuencias

- Volver a lo reciente es instantáneo; volver a algo que salió de la lista es como antes, desde cero.
  `e2e/cambio-perfil-fotogramas.spec.ts` lo vigila fotograma a fotograma: ninguno mezcla dos
  perfiles ni enseña «Cargando…» al volver, y el árbol vuelve con su carpeta y su desplazamiento.
- Un selector de un e2e que busque filas debe filtrar por `:visible`, y uno del código por
  `.capa-viva:not(.oculta)`: hay varias en el DOM.
- Un contenedor oculto sigue en el DOM: un e2e que compruebe que no se enseña usa `toBeHidden()`, no
  `toHaveCount(0)`, y uno que busque en el lateral filtra por `:visible`.
- Un modal que vaya a una pieza viva escucha `window` solo mientras `useCapaVisible()` es `true`; si
  no, un Enter o un Esc dado en otro perfil actuaría sobre el oculto.

## Descartes

- Guardar el desplazamiento, la selección y el filtro en un store por clave y restaurarlos al
  remontar: hay un fotograma sin ellos y la lista virtual tiene que medirse antes de poder saltar.
- Ocultar con `display: none`: se pierde el desplazamiento.
