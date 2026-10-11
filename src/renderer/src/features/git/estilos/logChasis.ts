// =============================================================================
// CSS de git: el chasis de la franja inferior de Log (`.git-log-panel`) y sus pestañas de vista
// (Log / historial de un archivo).
// Es un trozo de la hoja que `estilosGit.ts` concatena en orden fijo e inyecta una vez:
// el orden de los trozos es el de la cascada. Un acento grave en el CSS va escapado.
// Decisiones: docs/decisiones/git/estilos-inyectados.md
// =============================================================================
import { META } from './escalera'

/** CSS del chasis de la franja de Log y sus pestañas de vista. */
export const CSS_LOG_CHASIS = `
/* Chasis: la franja inferior, hermana de la terminal. */
.git-log-panel {
  flex: 0 0 var(--panel-inferior-h);
  width: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border-top: 1px solid var(--border);
}
.git-log-panel.hidden {
  display: none;
}
/* --- Pestañas de VISTA de la franja (Log / Historial de un archivo) ----------
   Solo se pintan cuando hay un historial abierto: con una sola vista no hay nada que
   elegir. Alto FIJO derivado de --ui-head-h para acompañar al tamaño de la interfaz. */
.git-vistas-tabs {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  height: var(--ui-head-h);
  padding: 0 8px;
  /* Del color del panel y sin filete debajo: tira y contenido son una tarjeta. */
  background: var(--bg);
  overflow-x: auto;
}
.git-vista-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: min(calc(var(--ui-head-h) - 6px), 24px);
  padding: 0 10px;
  border: none;
  /* La misma cápsula que las pestañas de archivo y de terminal. */
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  font-family: inherit;
  font-size: ${META};
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
.git-vista-tab:hover {
  color: var(--fg);
  background: rgba(255, 255, 255, 0.04);
}
/* La ACTIVA lleva el color del perfil, como todo lo "puesto" en la app. La letra
   va por --perfil-claro y el relleno por --sel-glow: sobre un relleno del propio
   perfil, la tinta normal no se lee (ver el bloque de --perfil-claro en styles). */
.git-vista-tab.activa {
  color: var(--perfil-sobre-tinte);
  background: var(--sel-glow);
  box-shadow: inset 0 0 0 1px var(--sel-borde);
}
.git-vista-tab.activa:hover {
  background: var(--sel-fuerte);
}
.git-vista-tab-cerrar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  color: var(--fg-faint);
  font-size: ${META};
  line-height: 1;
}
.git-vista-tab-cerrar:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--fg);
}

`
