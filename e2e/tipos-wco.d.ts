// =============================================================================
// `navigator.windowControlsOverlay` (Window Controls Overlay), que TypeScript no declara:
// la fuente del hueco de los botones de la ventana que estas pruebas miden. Va aquí y no
// en el renderer porque producción solo usa `env()` desde CSS y `visible` con un tipo
// local (`theme/chromeVentana.ts`); declararla en `src/` invitaría a duplicar la fuente de
// verdad del hueco. Solo se declara lo que se usa.
// =============================================================================

interface WindowControlsOverlay {
  readonly visible: boolean
  getTitlebarAreaRect(): DOMRect
}

interface Navigator {
  readonly windowControlsOverlay?: WindowControlsOverlay
}
