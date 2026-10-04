# La banda de perfiles es una fila hermana de la barra de título y pinta el color cenizo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/pestanas/ProfileTabs.tsx` (y sus piezas), `features/layout/TabsBar.tsx`, `styles.css` (`.tabs-profiles`)

## Contexto

La ventana pinta su propia barra de título. Se probó fundir en una sola fila los perfiles (a la
izquierda) y los botones de ventana (a la derecha): las pestañas se reparten el ancho a partes
iguales, así que restarles el hueco de los botones dejaba un socavón al final y, plegada, una tira
de color que moría a dos tercios del ancho.

Con colores puros, cinco pestañas se volvían una guirnalda que competía con el contenido.

## Decisión

- La banda de perfiles es una fila PROPIA, hermana de `.titlebar`, nunca hija. La región de arrastre
  de la ventana (`-webkit-app-region: drag`) es solo `.titlebar`: dentro de ella Windows trata la
  zona como área no cliente y se come los eventos de ratón, y dejarían de responder el arrastre para
  reordenar, el menú contextual y el renombrado inline.
- Cada pestaña ocupa `flex: 1` (1 perfil = todo, N = 1/N). Lo que cuelga de la banda desaparece al
  colapsarla (`names-hidden`), así que nada que deba verse siempre (p. ej. el aviso de
  actualización) va dentro de ella.
- El color se PINTA cenizo con `tintaPerfil` (mismo matiz, menos intensidad): lo que protege de
  operar en el perfil equivocado es el matiz, no el grito. Lo guardado en `profiles.json` es siempre
  el color elegido, que es el que ve el `<input type="color">`.

## Consecuencias

- No mover la banda dentro de `.titlebar` ni sumarle `no-drag` para «arreglar» un hueco.
- No guardar el color ya apagado: cada edición lo apagaría más hasta llegar al gris.
- La hibernación con un agente trabajando pide confirmación con `danger` (enfoca «Cancelar»): el
  diálogo sale justo tras teclear, cuando un Enter suelto es más probable.
