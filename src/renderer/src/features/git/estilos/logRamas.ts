// =============================================================================
// CSS de git: la columna 1 de la franja de Log: el árbol de ramas.
// Es un trozo de la hoja que `estilosGit.ts` concatena en orden fijo e inyecta una vez:
// el orden de los trozos es el de la cascada. Un acento grave en el CSS va escapado.
// Decisiones: docs/decisiones/git/estilos-inyectados.md
// =============================================================================
import { META, MICRO } from './escalera'

/** CSS del árbol de ramas (columna 1 del Log). */
export const CSS_LOG_RAMAS = `/* --- Columna 1: árbol de ramas --------------------------------------------- */
.git-ramas-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 4px 0 8px;
}
.git-rama-fila {
  display: flex;
  align-items: center;
  gap: 5px;
  height: var(--ui-row-h);
  padding-right: 8px;
  border: none;
  background: transparent;
  color: var(--fg);
  font-family: inherit;
  font-size: var(--ui-font);
  text-align: left;
  width: 100%;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.git-rama-fila:hover {
  background: rgba(255, 255, 255, 0.05);
}
.git-rama-fila:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
/* La rama por la que se está filtrando el log. */
.git-rama-fila.activa {
  background: var(--sel-glow);
  box-shadow: inset 2px 0 0 var(--sel);
}
.git-rama-nombre {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.git-rama-fila svg {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  color: var(--fg-faint);
}
.git-rama-fila .chevron {
  width: 14px;
  height: 14px;
  transition: transform 120ms ease;
}
.git-rama-fila .chevron.open {
  transform: rotate(90deg);
}
/* Conteo de ramas de una carpeta: tenue, a la derecha. */
.git-rama-total {
  margin-left: auto;
  padding-left: 6px;
  color: var(--fg-faint);
  font-size: ${MICRO};
  flex: 0 0 auto;
}
/* HEAD: la rama actual, arriba del todo y destacada, EN EL COLOR DEL PERFIL.
   Antes era el azul de acento, que en esta app significa "fíjate en este dato"
   (conteos, avisos, enlaces). La rama en la que estás no es un aviso: es identidad,
   la misma pregunta que responde el perfil en el resto de la ventana, y por eso se
   pinta con su matiz. Va por --perfil-claro y no por --sel porque esto es LETRA;
   la medida está en styles.css. */
.git-rama-head {
  color: var(--perfil-claro);
  font-weight: 600;
}
.git-rama-head svg {
  color: var(--perfil-claro);
}
/* Cabecera de grupo (Local / Remoto). */
.git-ramas-grupo {
  height: 22px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px 0 6px;
  border: none;
  background: transparent;
  width: 100%;
  color: var(--fg-faint);
  font-family: inherit;
  font-size: ${MICRO};
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  user-select: none;
  text-align: left;
}
.git-ramas-grupo:hover {
  color: var(--fg-muted);
}
.git-ramas-grupo .chevron {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  transition: transform 120ms ease;
}
.git-ramas-grupo .chevron.open {
  transform: rotate(90deg);
}

/* Botón de repo (solo multi-repo): sin él, con el sidebar en "Archivos" no
   habría forma de cambiar de repositorio con el log abierto. */
.git-repo-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  min-width: 0;
  height: 20px;
  padding: 0 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--fg-muted);
  font-family: inherit;
  font-size: ${META};
  text-transform: none;
  letter-spacing: normal;
  cursor: pointer;
}
.git-repo-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--fg);
}
.git-repo-btn .git-repo-nombre {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

`
