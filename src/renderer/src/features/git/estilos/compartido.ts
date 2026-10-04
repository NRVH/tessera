// =============================================================================
// CSS de git: lo compartido por las dos superficies (raíz `.git-ui`): fila del árbol de archivos,
// casilla tri-estado, estados de carga, botón de icono, chip de rama y resaltado.
// Es un trozo de la hoja que `estilosGit.ts` concatena en orden fijo e inyecta una vez:
// el orden de los trozos es el de la cascada. Un acento grave en el CSS va escapado.
// Decisiones: docs/decisiones/git/estilos-inyectados.md
// =============================================================================
import { META, MICRO } from './escalera'

/** CSS común a Cambios y a Log (raíz `.git-ui`). */
export const CSS_COMPARTIDO = `
@keyframes git-spin { to { transform: rotate(360deg); } }

/* La superficie CONSUME su propia --ui-font. Imprescindible aunque casi todas
   las reglas de aquí ya la usen explícitamente: lo que NO la declara (un texto
   suelto, un botón nuevo) heredaría el tamaño calculado de \`body\`, que es el de
   la interfaz y no el de esta vista. Declararlo en la raíz hace que el subárbol
   herede de la superficie y no del cuerpo. */
.git-ui {
  font-size: var(--ui-font);
}

/* --- Fila del ÁRBOL de archivos (Cambios, Preparados y archivos de un commit) --
   Clon visual de .tree-row del explorador, pero clase PROPIA: .tree-row es global
   y arrastra selected-dir / drop-over / cut, que aquí no significan nada.
   El padding-left lo fija el componente segun la profundidad. */
.git-ui .git-arbol-fila {
  display: flex;
  align-items: center;
  gap: 4px;
  height: var(--ui-row-h);
  padding-right: 12px;
  margin: 0 8px;
  border-radius: 6px;
  color: var(--fg);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  /* Doble clic = abrir. Sin esto, el segundo clic selecciona el texto del nombre
     y la fila se queda con media palabra en azul de selección. */
  user-select: none;
}
.git-ui .git-arbol-fila:hover {
  background: rgba(255, 255, 255, 0.04);
}
/* SELECCIONADA (un clic): marca dónde está el cursor, sin prometer nada más. */
.git-ui .git-arbol-fila.selected {
  background: var(--selection);
}
/* ACTIVA: su diff está abierto en el editor. Acento, porque señala algo que
   existe fuera de esta lista. Puede coexistir con .selected en la vista de
   Cambios, donde clicar y abrir son gestos distintos. */
.git-ui .git-arbol-fila.active {
  background: var(--sel-glow);
  box-shadow: inset 2px 0 0 var(--sel);
}
/* PERO EN LOS ARCHIVOS DE UN COMMIT HAY UN SOLO RESALTADO, y es el de acento.
   Ahí el cursor y el archivo abierto son la MISMA cosa —moverse a un archivo lo
   abre—, así que dos marcas a la vez solo aparecían cuando el cursor estaba sobre
   una carpeta: una gris donde estabas y una azul en el último archivo abierto. Dos
   cajas encendidas para un solo cursor se leen como un error de la interfaz, no
   como dos datos. La de Cambios conserva las dos porque allí clicar y abrir SÍ son
   gestos distintos y pueden apuntar a filas distintas. */
.git-ui .git-detalle-archivos .git-arbol-fila.selected {
  background: var(--sel-glow);
  box-shadow: inset 2px 0 0 var(--sel);
}
.git-ui .git-arbol-fila:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

/* FOCO DE LA LISTA, no de la fila. Las dos listas del log se navegan con las
   flechas y el foco vive en su CONTENEDOR (las filas se desmontan al salir de la
   ventana virtualizada, así que un foco puesto en una de ellas se perdería a media
   navegación). Sin este contorno no habría forma de saber cuál de las dos listas
   manda, que es justo lo que hay que ver al pasar del historial a los archivos con
   un doble clic. */
.git-ui .git-historial:focus-visible,
.git-ui .git-detalle-archivos:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
.git-ui .git-arbol-etiqueta {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--ui-font);
  flex: 0 1 auto;
}
.git-ui .git-arbol-flecha {
  color: var(--fg-faint);
  margin: 0 4px;
}
/* Carpeta del archivo en la lista PLANA de Cambios: la ruta va en gris tras el nombre y
   cede el ancho ANTES que él. El 9999 NO se puede bajar a 1: flexbox reparte el recorte
   proporcional a shrink por flex-basis, y con shrink 1 se cortaba el nombre largo y no la
   ruta. Esta clase solo se pinta en modo plana; por eso no se toca git-arbol-etiqueta, que
   comparten las filas de carpeta con su conteo anclado a la derecha.
   Ver docs/decisiones/git/cambios-fila-de-archivo.md */
.git-ui .git-arbol-carpeta {
  flex: 1 9999 auto;
  min-width: 0;
  margin-left: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-faint);
  font-size: calc(var(--ui-font) - 1px);
}
/* Conteo de archivos de una carpeta: se ancla a la derecha y NUNCA se encoge. */
.git-ui .git-arbol-conteo {
  margin-left: auto;
  flex: 0 0 auto;
  padding-left: 6px;
  color: var(--fg-faint);
  font-size: ${MICRO};
  font-variant-numeric: tabular-nums;
}

/* --- Casilla tri-estado ----------------------------------------------------- */
.git-ui .git-casilla {
  flex: 0 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border: 1px solid var(--fg-faint);
  border-radius: 3px;
  color: var(--bg);
  cursor: pointer;
}
.git-ui .git-casilla.llena,
.git-ui .git-casilla.parcial {
  border-color: var(--accent);
  background: var(--accent);
}
.git-ui .git-casilla svg {
  width: 10px;
  height: 10px;
}
.git-ui .git-arbol-fila:hover .git-casilla.vacia {
  border-color: var(--fg-muted);
}

/* --- Estados (cargando / vacío / error) ------------------------------------ */
.git-ui .git-state {
  padding: 12px 16px;
  color: var(--fg-faint);
  font-size: var(--ui-font);
  line-height: 1.4;
}
.git-ui .git-state-inline {
  padding: 4px 16px 4px 12px;
  color: var(--fg-faint);
  font-size: ${META};
}
.git-ui .git-error {
  padding: 8px 12px;
  color: var(--red);
  font-size: ${META};
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

/* --- Botón de icono fantasma (recargar, cerrar, limpiar) ------------------- */
.git-ui .git-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto; /* SIEMPRE visible: nunca se encoge ni se sale del header */
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, opacity 140ms ease;
}
.git-ui .git-icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--fg);
}
.git-ui .git-icon-btn:active:not(:disabled) {
  background: rgba(255, 255, 255, 0.09);
}
.git-ui .git-icon-btn:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
.git-ui .git-icon-btn:disabled {
  cursor: default;
  color: var(--fg-faint);
}
.git-ui .git-icon-btn svg {
  width: 15px;
  height: 15px;
  transform-origin: center;
}

/* --- Chip de rama en cabeceras (repo activo, rama del filtro) --------------- */
.git-ui .repo-branch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
  color: var(--fg-muted);
  font-size: ${META};
}
.git-ui .repo-branch svg {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
}
.git-ui .repo-branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- Resaltado de coincidencias de la búsqueda ------------------------------
   EL COLOR DEL PERFIL, no un ámbar ni el azul apagado de antes. La pregunta "¿de
   qué color es lo mío?" ya la responde el perfil en toda la ventana (ver --perfil
   en estiloShell), y el resaltado de una búsqueda es justo eso: lo tuyo, dentro de tu
   perfil. --search-match queda de reserva para cuando el perfil no tiene color.

   Letra CASI NEGRA y no un inherit: la tinta de perfil vive en una banda de
   luminosidad alta a propósito (LUM 53-64, ver features/pestanas/colorPerfil), así que el texto
   claro que hereda la fila se perdía encima. Es el mismo par que ya usa la lista de
   "Buscar en archivos", y por el mismo motivo. */
.git-ui .commit-hit {
  background: var(--perfil-hit, var(--search-match));
  color: var(--perfil-hit-fg, inherit);
  border-radius: 2px;
  padding: 0 1px;
}
`
