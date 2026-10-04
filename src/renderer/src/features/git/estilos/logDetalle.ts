// =============================================================================
// CSS de git: la columna 3 de la franja de Log: el detalle del commit.
// Es un trozo de la hoja que `estilosGit.ts` concatena en orden fijo e inyecta una vez:
// el orden de los trozos es el de la cascada. Un acento grave en el CSS va escapado.
// Decisiones: docs/decisiones/git/estilos-inyectados.md
// =============================================================================
import { TITULO, META } from './escalera'

/** CSS del detalle del commit (columna 3 del Log). */
export const CSS_LOG_DETALLE = `/* --- Columna 3: detalle del commit ----------------------------------------- */
/* Dos zonas a lo alto: archivos (scroll propio) y el bloque de metadatos. El
   bloque se acota a la mitad de la columna para que los archivos —que es a lo
   que se le hace doble clic— nunca desaparezcan tras un mensaje largo. */
/* Mitades de la tercera columna. El reparto lo manda el DIVISOR: la lista lleva su
   alto en un style inline (flex-basis fijo) y la ficha se queda con lo que sobre.
   Antes era al revés —la lista con flex:1 y la ficha con max-height:50%—, que dejaba
   el mensaje de un commit largo en una rendija sin forma de agrandarlo. */
.git-detalle-archivos {
  flex: 0 0 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 0 4px;
}
.git-detalle-meta {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--border-soft);
  background: var(--bg-elevated);
}
.git-detalle-asunto {
  color: var(--fg);
  font-size: ${TITULO};
  font-weight: 600;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}
.git-detalle-cuerpo {
  margin-top: 6px;
  color: var(--fg-muted);
  font-size: var(--ui-font);
  line-height: 1.5;
  /* El cuerpo de un commit trae su propio formato (listas, sangrías): se respeta. */
  white-space: pre-wrap;
  word-break: break-word;
}
.git-detalle-fila {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  font-size: ${META};
  color: var(--fg-muted);
  min-width: 0;
}
/* El autor: color del perfil. Es el mismo caso que la rama —quién firma el commit
   es identidad, no un aviso—, y así la ficha de detalle queda en una sola familia
   con el chip del hash que tiene al lado. */
.git-detalle-autor {
  color: var(--perfil-claro);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.git-detalle-email,
.git-detalle-fecha {
  color: var(--fg-faint);
}
/* Chip del hash: monoespaciado y CLICABLE (copia el hash completo). El RECUADRO va
   del color del perfil (relleno y filete); el hash en sí se queda en --fg, porque
   es un dato que se lee carácter a carácter y ahí manda el contraste. */
.git-hash-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: ${META};
  color: var(--fg);
  background: var(--sel-glow);
  border: 1px solid var(--sel-borde);
  border-radius: 5px;
  padding: 2px 8px;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.git-hash-chip:hover {
  background: color-mix(in srgb, var(--perfil) 26%, transparent);
  border-color: color-mix(in srgb, var(--perfil) 48%, transparent);
}
.git-hash-chip .icono-copiar {
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
  opacity: 0.65;
}
.git-hash-chip:hover .icono-copiar {
  opacity: 1;
}
/* Confirmación efímera tras copiar. */
.git-hash-chip.copiado {
  color: var(--green);
  background: color-mix(in srgb, var(--green) 16%, transparent);
  border-color: color-mix(in srgb, var(--green) 42%, transparent);
}
/* "En N ramas": los chips van envueltos, aquí sí hay sitio para dos líneas. */
.git-detalle-ramas {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
  font-size: ${META};
  color: var(--fg-muted);
}
.git-detalle-ramas .ref-chip {
  height: 17px;
  line-height: 17px;
}
.git-detalle-mas {
  border: none;
  background: transparent;
  color: var(--accent);
  font-family: inherit;
  font-size: ${META};
  cursor: pointer;
  padding: 0 2px;
}
.git-detalle-mas:hover {
  text-decoration: underline;
}
`
