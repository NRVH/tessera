// =============================================================================
// CSS de git: la lista de commits de la columna 2 de la franja de Log (filas, grafo, columnas).
// Es un trozo de la hoja que `estilosGit.ts` concatena en orden fijo e inyecta una vez:
// el orden de los trozos es el de la cascada. Un acento grave en el CSS va escapado.
// Decisiones: docs/decisiones/git/estilos-inyectados.md
// =============================================================================
import { META, MICRO } from './escalera'

/** CSS de la lista de commits del Log. */
export const CSS_LOG_COMMITS = `/* --- Columna 2: lista de commits ------------------------------------------- */
.git-historial {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
/* La fila: grafo + asunto + (refs, autor) + fecha. Altura FIJA e inquebrantable:
   la virtualización calcula los offsets a partir de ROW_HEIGHT, así que si un
   chip envolviera a una segunda línea TODAS las filas de abajo quedarían
   desplazadas respecto del SVG del grafo. De ahí el nowrap de la fila entera. */
.git-fila-commit {
  display: flex;
  align-items: stretch;
  white-space: nowrap;
  cursor: pointer;
  /* Un doble clic aquí no hace nada, pero Chromium selecciona la palabra igual, y
     esa selección viva apagaba el Ctrl+C de copiar el hash EN SILENCIO (la guarda
     del panel cede el paso cuando hay texto seleccionado) hasta el siguiente clic
     simple. No es una regla nueva: es la única fila de esta hoja que se había
     quedado sin ella —.git-arbol-fila, .git-rama-fila y las cabeceras ya la
     llevan—. El asunto sigue siendo seleccionable en la ficha de detalle. */
  user-select: none;
  transition: background 120ms ease;
}
/* Commits que están EN la rama actual (alcanzables desde HEAD). VA ANTES que :hover y
   .activa: las tres reglas tienen la misma especificidad y manda el ORDEN, para que el
   hover y la selección lo tapen. El tinte es flojo a propósito (en rgba, para componer
   sobre el fondo del panel): se percibe en bloque sin competir con el texto. */
.git-fila-commit.en-rama-actual {
  background: rgba(88, 132, 236, 0.07);
}
.git-fila-commit:hover {
  background: rgba(255, 255, 255, 0.04);
}
/* SELECCIONADA: donde está el cursor. Más fuerte que --accent-glow: aquí la selección
   compite contra el tinte de rama y con el glow estándar se confundían. Usa el color del
   PERFIL (--sel-fuerte, 32 % de la ceniza) para ser del mismo color que todo lo
   seleccionado. El peso se midió: ~4,3 veces el salto del tinte. */
.git-fila-commit.activa {
  background: var(--sel-fuerte);
}
.git-commit-asunto {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 0 10px 0 4px;
  color: var(--fg);
  /* Sigue al tamaño de letra de la interfaz, como el resto de listas: era el
     único texto del historial clavado en 12.5px, así que al subir la densidad la
     fila crecía y la letra no (o al revés). */
  font-size: var(--ui-font);
  overflow: hidden;
  text-overflow: ellipsis;
}
/* El TEXTO del asunto: crece hasta donde puede y es el primero en truncar. */
.git-commit-texto {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Los chips de ref, al borde DERECHO de la celda del asunto. El "margin-left: auto" los
   separa del texto; ceden ancho antes que nadie: son el dato menos crítico de la fila. */
.git-commit-chips {
  flex: 0 1 auto;
  margin-left: auto;
  padding-left: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}
/* Celda 3: el AUTOR, en columna propia de ancho estable y texto a la IZQUIERDA, para que
   los nombres formen una línea vertical. El ancho llega MEDIDO en px (--git-log-autor-w) e
   incluye este padding, porque el flex-basis es border-box. El SUELO del 17 % de la lista
   reparte la fila cuando los nombres son cortos; el TOPE del 30 % es un max-width y no un
   número del cálculo, para seguir al ancho real al mover los divisores. El fallback de la
   var cubre el instante antes de medir. */
.git-commit-autor {
  flex: 0 0 max(var(--git-log-autor-w, 14ch), 17%);
  max-width: 30%;
  min-width: 0;
  display: flex;
  align-items: center;
  padding-right: 10px;
  overflow: hidden;
  white-space: nowrap;
  color: var(--fg-muted);
  font-size: var(--ui-font);
}
/* El NOMBRE, dentro de su celda flex. El text-overflow tiene que vivir aquí y no
   en .git-commit-autor: un nodo de texto suelto dentro de un flex no es una caja de
   bloque, así que la elipsis del padre no se aplicaba nunca y el nombre se cortaba
   a media letra al llegar al max-width. Mismo patrón que .git-commit-texto. */
.git-commit-autor-texto {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.git-commit-fecha {
  /* AUTO y no un ancho clavado: con letra variable recortaría la fecha. Todas van en
     cifras de ancho fijo, así que es igual de estable. El SUELO del 12 % sitúa el borde
     del autor donde toca; al ir alineada a la derecha, el hueco de más queda antes. */
  flex: 0 0 auto;
  min-width: 12%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  white-space: nowrap;
  padding-left: 10px;
  /* 4 y no 12: los otros 8 los pone ahora la canaleta de copiar que va detrás. */
  padding-right: 4px;
  color: var(--fg-faint);
  font-size: ${META};
  /* Cifras de ancho fijo: sin esto la columna tiembla al hacer scroll. */
  font-variant-numeric: tabular-nums;
}

/* Celda 5: la CANALETA DE COPIAR EL HASH, al borde derecho. Hueco RESERVADO, no
   superpuesto (taparía los minutos) ni a demanda (empujaría la fecha bajo el cursor):
   revelar anima solo la opacidad. Cuesta 20 px netos, que paga el asunto. Ancho derivado
   de la densidad (--ui-row-h + 4) con tope y suelo. La diana (24x20) no llega al mínimo de
   la WCAG 2.2; lo compensan la fila clicable y Ctrl+C. Los 4 px de margen derecho son zona
   muerta: detrás vienen la barra de scroll y el divisor. */
.git-commit-copiar {
  flex: 0 0 clamp(20px, calc(var(--ui-row-h) + 4px), 26px);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 4px;
  border-radius: 4px;
  color: var(--fg-faint);
  cursor: pointer;
  opacity: 0;
  transition: color 120ms ease, background 120ms ease, opacity 120ms ease;
}
/* Se revela con el hover de la FILA, no con el suyo, y también cuando la fila es
   .activa: es el patrón de .project-tab-close y .editor-tab-close de la hoja
   global. Lo de ".activa" NO es adorno: es lo que le da botón visible al commit al
   que llegaste con las flechas, y lo que convierte una acción oculta en una
   permanente en cuanto hay algo seleccionado.

   El ".copiado" del final es lo que deja la confirmación visible sus 1400 ms
   aunque el ratón ya se haya ido de la fila: si no, copiar y apartar la mano
   borraría el acuse antes de poder leerlo. */
.git-fila-commit:hover .git-commit-copiar,
.git-fila-commit.activa .git-commit-copiar,
.git-fila-commit .git-commit-copiar.copiado {
  opacity: 1;
}
/* COLOR POR ESTADO. Las tres reglas tienen la MISMA especificidad (0,3,0) a
   propósito, así que manda el ORDEN del fichero —mismo criterio, y por el mismo
   motivo, que las tres reglas de fondo de la fila más arriba—. El orden en que
   tienen que ganar es: seleccionada < ratón encima < copiado.

   OJO con la especificidad: si la regla del hover se escribiera SIN el prefijo
   .git-fila-commit sería (0,2,0) y perdería contra la de revelado, que es (0,3,0),
   así que el glifo no llegaría nunca a su color pleno. */
.git-fila-commit.activa .git-commit-copiar {
  /* --fg-muted y no --fg-faint: en la fila activa el fondo es --sel-fuerte, y ahí
     el faint se lee como una mancha en vez de como un icono. */
  color: var(--fg-muted);
}
.git-fila-commit .git-commit-copiar:hover {
  color: var(--fg);
  /* El mismo 0.06 que .git-icon-btn de esta hoja, no --hover-suave (0.07): dos
     valores casi iguales para el mismo gesto en la misma superficie se ven. */
  background: rgba(255, 255, 255, 0.06);
}
/* Sin background propio: dejar puesto el del hover evita que, al copiar con el
   cursor todavía encima, el fondo desaparezca y se lea como "he perdido el hover".
   El verde y los 1400 ms son los MISMOS del chip de la ficha de detalle: dos
   duraciones o dos verdes para el mismo gesto se leen como dos gestos. */
.git-fila-commit .git-commit-copiar.copiado {
  color: var(--green);
}
.git-commit-copiar .icono-copiar {
  width: var(--ui-font);
  height: var(--ui-font);
  flex: 0 0 auto;
}

/* Chip de ref (rama / tag) sobre una fila del log. line-height acotado: si el
   chip creciera, rompería la altura fija de la fila (ver arriba). Por eso se
   deriva de --ui-row-h y no de la letra: así el chip sigue cabiendo en la fila
   a cualquier tamaño, que es la restricción que de verdad manda aquí.
   (Sin comillas invertidas: esto vive dentro de un template literal.) */
.ref-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 100%;
  min-width: 0;
  height: calc(var(--ui-row-h) - 4px);
  line-height: calc(var(--ui-row-h) - 4px);
  padding: 0 5px 0 4px;
  border-radius: 4px;
  font-size: ${MICRO};
  white-space: nowrap;
  overflow: hidden;
}
.ref-chip .icono-etiqueta {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  opacity: 0.9;
}
.ref-chip-nombre {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
/* Una rama se pinta del color del PERFIL; lo que distingue las clases son dos rasgos
   independientes, relleno y filete: head = relleno + filete (la rama actual), local =
   relleno, remota = HUECA (solo filete). Un lavado blanco del 6 % no se distinguía del
   relleno tenue del perfil. El filete va por box-shadow inset y no por border, que
   movería un píxel la altura clavada del chip. Las etiquetas siguen amarillas: una
   etiqueta no es una rama. (Sin comillas invertidas: esto es un literal.) */
.ref-chip-head {
  color: var(--perfil-sobre-tinte);
  background: var(--sel-glow);
  box-shadow: inset 0 0 0 1px var(--sel-borde);
}
.ref-chip-local {
  color: var(--perfil-sobre-tinte);
  background: var(--sel-tenue);
}
.ref-chip-remota {
  color: var(--perfil-sobre-tinte);
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--sel-borde);
}
.ref-chip-etiqueta {
  color: var(--yellow);
  background: color-mix(in srgb, var(--yellow) 14%, transparent);
}

/* Pie del historial: cargar el repo entero. */
.git-cargar-todo {
  display: flex;
  margin: 6px 12px 10px;
}
.git-cargar-todo button {
  flex: 1 1 auto;
  padding: 6px 10px;
  border: 1px solid var(--border-soft);
  border-radius: 5px;
  background: transparent;
  color: var(--fg-muted);
  font-family: inherit;
  font-size: ${META};
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
.git-cargar-todo button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.04);
  color: var(--fg);
  border-color: var(--accent);
}

`
