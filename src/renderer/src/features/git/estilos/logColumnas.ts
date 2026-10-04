// =============================================================================
// CSS de git: el cuerpo de la franja de Log: las tres columnas y sus cabeceras.
// Es un trozo de la hoja que `estilosGit.ts` concatena en orden fijo e inyecta una vez:
// el orden de los trozos es el de la cascada. Un acento grave en el CSS va escapado.
// Decisiones: docs/decisiones/git/estilos-inyectados.md
// =============================================================================
import { MICRO } from './escalera'

/** CSS de las tres columnas de la franja de Log. */
export const CSS_LOG_COLUMNAS = `/* Cuerpo: las 3 columnas. FLEX y no grid ni container-queries a propósito: los
   desplegables de los filtros son position:fixed (ContextMenu), y cualquier
   contain / container-type por encima los convertiría en hijos de este
   contenedor, dejándolos recortados dentro de una franja de 260px.
   (Sin acentos graves en estos comentarios: este CSS vive en un template
   literal de TS y un backtick suelto lo cerraría a media hoja.) */
.git-log-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: stretch;
}
.git-log-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.git-log-ramas {
  flex: 0 0 var(--git-log-ramas-w);
  border-right: 1px solid var(--border);
  overflow: hidden;
}
.git-log-centro {
  flex: 1 1 auto;
}
.git-log-detalle {
  flex: 0 0 var(--git-log-detalle-w);
  border-left: 1px solid var(--border);
  overflow: hidden;
}

/* Cabecera de columna: más baja y tenue que un panel-header, porque hay tres. */
.git-log-col-header {
  flex: 0 0 auto;
  height: 26px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px 0 10px;
  border-bottom: 1px solid var(--border-soft);
  color: var(--fg-faint);
  font-size: ${MICRO};
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  user-select: none;
}
.git-log-col-header .git-icon-btn {
  width: 20px;
  height: 20px;
  margin-left: auto;
}
.git-log-col-header .git-icon-btn svg {
  width: 13px;
  height: 13px;
}

`
