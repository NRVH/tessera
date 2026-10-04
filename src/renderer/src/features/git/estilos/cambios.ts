// =============================================================================
// CSS de git: la barra lateral de Cambios (raíz `.git-panel`): secciones por repo,
// subsecciones de cambios y sus botones de acción.
// Es un trozo de la hoja que `estilosGit.ts` concatena en orden fijo e inyecta una vez:
// el orden de los trozos es el de la cascada. Un acento grave en el CSS va escapado.
// Decisiones: docs/decisiones/git/estilos-inyectados.md
// =============================================================================
import { META, MICRO } from './escalera'

/** CSS de la barra lateral de Cambios (`.git-panel`). */
export const CSS_CAMBIOS = `
/* Nombre del repo en el header, solo cuando hay UNO (con varios lo dice cada
   sección colapsable). Encogible: en columnas estrechas cede ancho en vez de
   empujar el botón de recarga fuera del header. */
.git-panel .repo-label {
  color: var(--fg-muted);
  font-size: ${META};
  text-transform: none;
  letter-spacing: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}

/* El cuerpo es la lista de cambios: se queda con todo el alto. */
.git-panel .sidebar-body {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 0;
}
.git-panel .working-changes {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.git-panel .working-changes > .working-changes-list,
.git-panel .working-changes > .repo-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

/* SECCIÓN POR REPO: una cabecera colapsable por repo, con su nombre, su rama y su
   conteo. Solo aparece con 2+ repos; con uno solo el panel se pinta plano. */
/* SEPARADOR POR SOMBRA, no por borde, y sin el selector de hermanos.
   Dos motivos, los dos por la virtualización: la lista envuelve cada sección en su
   propio div posicionado, así que el selector de hermano adyacente ya no casa nunca
   (dejaron de serlo) y la línea desaparecía; y un borde superior sumaría un píxel al
   alto de la caja, que es justo lo que la lista virtual tiene que poder predecir.
   La sombra inset dibuja DENTRO: se ve igual y no mide nada.
   (Sin comillas invertidas en este comentario: el archivo entero es un template
   literal y una sola lo parte en dos.) */
.git-panel .repo-section {
  box-shadow: inset 0 -1px 0 var(--border-soft);
}
/* Las transitorias de una sección ANIDADA miden lo que la lista virtual reservó
   para ellas (una fila). Un error largo se recorta con puntos suspensivos y se lee
   entero en el tooltip: es preferible a que dos renglones desplacen a los repos de
   abajo, que en una lista virtual se ve como un salto del scroll. */
.git-panel .repo-section .git-state-inline,
.git-panel .repo-section .git-error {
  height: var(--ui-row-h);
  padding-top: 0;
  padding-bottom: 0;
  display: flex;
  align-items: center;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.git-panel .repo-header {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  /* ALTURA POR VARIABLE, no un 28px clavado. La lista de repos está virtualizada y
     eso obliga a saber cuánto mide una fila ANTES de montarla: el JS lo calcula con
     altoCabecera(fuente) y esta variable sale de la MISMA función. Con el 28
     literal que había aquí, el JS reservaba 26 y la fila medía 28, así que cada repo
     se comía dos píxeles del siguiente y con cien repos el desfase era una pantalla
     entera. Medido con la app abierta: reservado 26 contra real 28. */
  height: var(--ui-head-h);
  padding: 0 8px 0 4px;
  border: none;
  background: transparent;
  color: var(--fg);
  font-family: inherit;
  font-size: var(--ui-font);
  text-align: left;
  cursor: pointer;
  user-select: none;
}
.git-panel .repo-header:hover {
  background: rgba(255, 255, 255, 0.04);
}
.git-panel .repo-header:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -2px;
}
/* El repo ACTIVO (el que grafica el log de abajo) lleva una barra de acento a la
   izquierda: dice, sin ruido, "el historial que ves es de este". */
.git-panel .repo-section.active > .repo-header {
  box-shadow: inset 2px 0 0 var(--sel);
}
.git-panel .repo-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
/* Conteo de cambios del repo: nunca se encoge ni se sale del header. */
.git-panel .repo-count {
  flex: 0 0 auto;
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--fg);
  font-size: ${MICRO};
  font-weight: 600;
  line-height: 16px;
  text-align: center;
}

/* Encabezados de subsección ("Preparados" / "Cambios"): jerarquía tenue. Alto
   FIJO desde ALTO_CABECERA_SUBSECCION, interpolado (ver su comentario: crecer al
   aparecer los botones haría saltar el scroll al marcar una casilla). */
.git-panel .working-subsection-header {
  height: var(--ui-head-h);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 12px;
  color: var(--fg-faint);
  font-size: ${MICRO};
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  user-select: none;
}
/* La etiqueta cede el sitio a los botones de lote, no al revés: si no cabe, se
   corta ella (los botones dicen qué se puede hacer y no pueden desaparecer). */
.git-panel .working-subsection-header .subseccion-titulo {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Nº de archivos marcados: se lee como parte del título, no como un botón. */
.git-panel .working-subsection-header .subseccion-marcadas {
  flex: 0 0 auto;
  color: var(--accent);
}
/* Acciones en lote. Aparecen SOLO con selección; el hueco ya estaba reservado. */
.git-panel .subseccion-acciones {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
.git-panel .subseccion-btn {
  height: 18px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted);
  font-family: inherit;
  font-size: ${MICRO};
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: none;
  cursor: pointer;
  white-space: nowrap;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
.git-panel .subseccion-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--fg);
}
.git-panel .subseccion-btn:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
/* Descartar BORRA trabajo sin commitear: rojo, la misma convención que su ítem
   del menú contextual. Los porcentajes que se calibraron aquí son los que ahora
   viven en los tokens --danger-*, y el botón de confirmar de los diálogos también
   los consume: este botón fue el patrón, no la excepción. */
.git-panel .subseccion-btn.danger {
  color: var(--red);
  border-color: var(--danger-filete);
}
.git-panel .subseccion-btn.danger:hover {
  background: var(--danger-tinte);
  color: var(--red-hi);
}
`
