// =============================================================================
// CSS de git: la vista de historial de un archivo en la franja de Log: lista de commits y diff.
// Es un trozo de la hoja que `estilosGit.ts` concatena en orden fijo e inyecta una vez:
// el orden de los trozos es el de la cascada. Un acento grave en el CSS va escapado.
// Decisiones: docs/decisiones/git/estilos-inyectados.md
// =============================================================================
import { META } from './escalera'

/** CSS del historial de un archivo (`.git-historial-lista`, `.git-hist-*`). */
export const CSS_HISTORIAL_ARCHIVO = `/* --- HISTORIAL de un archivo: lista de commits + diff ------------------------ */
.git-historial-lista {
  min-width: 0;
  border-right: 1px solid var(--border-soft);
}
.git-historial-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
/* El DIFF ocupa lo que queda. El min-width de 0 es lo que impide que el visor de
   Monaco —que mide su contenido— empuje la lista fuera de la ventana.
   (Sin comillas invertidas aquí: esto vive dentro de un template literal.) */
.git-historial-diff {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
}
/* Fila de commit del historial: autor | fecha | asunto, en columnas de ancho fijo
   salvo el asunto, que se queda con el resto y trunca: así la lista se lee en vertical
   (los autores y las fechas forman columna) y no como un párrafo por fila. */
.git-hist-fila {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--ui-row-h);
  padding: 0 10px;
  color: var(--fg);
  font-size: var(--ui-font);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
.git-hist-fila:hover {
  background: rgba(255, 255, 255, 0.04);
}
.git-hist-fila.activa {
  background: var(--sel-fuerte);
}
.git-hist-autor {
  flex: 0 0 12ch;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--fg-muted);
  font-size: ${META};
}
.git-hist-fecha {
  flex: 0 0 auto;
  color: var(--fg-faint);
  font-size: ${META};
  font-variant-numeric: tabular-nums;
}
.git-hist-asunto {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

`
