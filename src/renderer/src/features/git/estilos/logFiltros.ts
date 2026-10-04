// =============================================================================
// CSS de git: la barra de filtros de la columna 2 de la franja de Log.
// Es un trozo de la hoja que `estilosGit.ts` concatena en orden fijo e inyecta una vez:
// el orden de los trozos es el de la cascada. Un acento grave en el CSS va escapado.
// Decisiones: docs/decisiones/git/estilos-inyectados.md
// =============================================================================
import { MICRO } from './escalera'

/** CSS de la barra de filtros del Log. */
export const CSS_LOG_FILTROS = `/* --- Columna 2: barra de filtros ------------------------------------------- */
.git-filtros {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border-soft);
  /* Que la barra NO se rompa en dos líneas: los desplegables ceden antes. */
  white-space: nowrap;
  overflow: hidden;
}
.git-buscador {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1 1 auto;
  min-width: 120px;
  max-width: 380px;
  height: 24px;
  padding: 0 4px 0 7px;
  border: 1px solid var(--border-soft);
  border-radius: 5px;
  background: var(--bg-deep, var(--bg-elevated));
}
.git-buscador:focus-within {
  border-color: var(--accent);
}
.git-buscador > svg {
  width: 13px;
  height: 13px;
  color: var(--fg-faint);
  flex: 0 0 auto;
}
.git-buscador input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--fg);
  font-family: inherit;
  font-size: var(--ui-font);
  outline: none;
}
.git-buscador input::placeholder {
  color: var(--fg-faint);
}
/* Contador de coincidencias dentro del propio buscador, como el find de un editor. */
.git-buscador-conteo {
  flex: 0 0 auto;
  color: var(--fg-faint);
  font-size: ${MICRO};
  font-variant-numeric: tabular-nums;
  padding: 0 2px;
}
.git-buscador .git-icon-btn {
  width: 18px;
  height: 18px;
}
.git-buscador .git-icon-btn svg {
  width: 12px;
  height: 12px;
}

/* Selector de filtro: etiqueta + caret. Es una ACCIÓN (abre un menú), no un
   campo: por eso sin borde de input, solo hover. */
.git-filtro-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 1 auto;
  min-width: 0;
  height: 24px;
  padding: 0 6px 0 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--fg-muted);
  font-family: inherit;
  font-size: var(--ui-font);
  cursor: pointer;
  white-space: nowrap;
  transition: background 140ms ease, color 140ms ease;
}
.git-filtro-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--fg);
}
.git-filtro-btn:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
/* Con un valor elegido, el filtro se ENCIENDE: hay que poder ver de un vistazo
   que la lista está acotada, o se lee como que el repo tiene menos commits.

   ENCENDIDO = EL PERFIL, OSCURO, CON LETRA CLARA DEL MISMO MATIZ. Antes era el
   lavado azul de acento, el único azul que quedaba en una ventana violeta. El plato
   hondo (--sel-hondo) es opaco y no un lavado porque el filtro se lee como una
   PIEZA puesta, no como una fila resaltada; y la letra en --perfil-sobre-tinte es
   el contraste claro/oscuro dentro de un solo color. Va por ESA variable y no por
   --perfil-claro justo porque el relleno es del propio perfil: sin perfil activo las
   dos caerían al mismo azul y el contraste se hundiría (ver styles.css). */
.git-filtro-btn.activo {
  background: var(--sel-hondo);
  color: var(--perfil-sobre-tinte);
}
.git-filtro-valor {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  max-width: 160px;
}
.git-filtro-btn svg {
  flex: 0 0 auto;
  opacity: 0.8;
}

`
