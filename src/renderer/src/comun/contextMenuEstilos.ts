// =============================================================================
// Estilos del menú contextual (`.ctx-menu*`), inyectados una sola vez en el <head> y
// acotados bajo `.ctx-menu`. Reutilizan los tokens del tema y no tocan la hoja global.
// Los usa `ContextMenu.tsx`.
// Decisiones: docs/decisiones/renderer/menu-contextual.md
// =============================================================================

const CTX_STYLES_ID = 'context-menu-styles'

/*
 * El menú es de la familia de lo que flota (`--bg-modal`), no de las capas de la ventana: sobre
 * `--bg-elevated` se confundía con el fondo y parecía una consola. Por eso republica los grises de
 * apoyo de modal, que son los que dan contraste AA sobre esa superficie. Lo único con color es el
 * resaltado de la fila, teñido con el del perfil: el menú dice en qué perfil estás.
 */
const CTX_STYLES = `
.ctx-menu {
  --fg-muted: var(--fg-muted-modal, #9a9eae);
  --fg-faint: var(--fg-faint-modal, #8c8f9c);
  --ctx-tinte: var(--perfil, var(--accent));
  position: fixed;
  z-index: 1000;
  min-width: 210px;
  max-width: 360px;
  padding: 5px;
  border: 1px solid var(--border-soft, var(--border));
  border-radius: 10px;
  background: var(--bg-modal);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--fg) 5%, transparent),
    0 1px 2px rgba(0, 0, 0, 0.3),
    0 12px 32px -6px rgba(0, 0, 0, 0.55);
  font-size: var(--ui-font);
  transform-origin: top left;
  animation: ctx-aparece 110ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes ctx-aparece {
  from {
    opacity: 0;
    transform: translateY(-3px) scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ctx-menu {
    animation: none;
  }
}
.ctx-menu:focus {
  outline: none;
}
.ctx-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: calc(var(--ui-row-h, 22px) + 6px);
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg);
  font-family: inherit;
  font-size: inherit;
  line-height: 1.3;
  text-align: left;
  cursor: pointer;
}
.ctx-menu-item:hover:not(:disabled),
.ctx-menu-item:focus-visible:not(:disabled) {
  background: color-mix(in srgb, var(--ctx-tinte) 28%, transparent);
  outline: none;
}
.ctx-menu-item:disabled {
  opacity: 0.4;
  cursor: default;
}
/* Opción destructiva: rojo en reposo y tinte rojo al enfocarla. Va aislada tras un separador. */
.ctx-menu-item.danger {
  color: var(--red);
}
.ctx-menu-item.danger:hover:not(:disabled),
.ctx-menu-item.danger:focus-visible:not(:disabled) {
  background: var(--danger-tinte);
  color: var(--red-hi);
}
/* Columna del icono: se reserva en todo el menú si alguna opción trae icono. Va tenue y toma el
   color del perfil al apuntar la fila; en la destructiva, el rojo. */
.ctx-menu-icono {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: 10px;
  color: var(--fg-faint);
}
.ctx-menu-icono svg {
  width: 15px;
  height: 15px;
}
/* Un icono de archivo (una imagen: el de los formatos de exportar): ocupa la columna entera, como en el
   explorador; su dibujo ya trae su propio margen. */
.ctx-menu-icono img {
  width: 16px;
  height: 16px;
}
.ctx-menu-item:hover:not(:disabled) .ctx-menu-icono,
.ctx-menu-item:focus-visible:not(:disabled) .ctx-menu-icono {
  color: color-mix(in srgb, var(--ctx-tinte) 70%, var(--fg));
}
.ctx-menu-item.danger .ctx-menu-icono {
  color: inherit;
}
/* Etiqueta con su segunda línea: el icono se alinea con la primera. */
.ctx-menu-item.con-detalle {
  align-items: flex-start;
  padding-top: 6px;
  padding-bottom: 6px;
}
.ctx-menu-item.con-detalle .ctx-menu-icono,
.ctx-menu-item.con-detalle .ctx-menu-check {
  margin-top: 1px;
}
.ctx-menu-textos {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.ctx-menu-detalle {
  color: var(--fg-faint);
  font-size: calc(var(--ui-font) - 1.5px);
  line-height: 1.35;
}
.ctx-menu-item.danger .ctx-menu-detalle {
  color: color-mix(in srgb, var(--red) 70%, var(--fg-faint));
}
/* Columna del check, aparte de la del icono: se reserva en todo el menú si alguna opción es
   conmutable. El margen separa la etiqueta del símbolo. */
.ctx-menu-check {
  flex: 0 0 auto;
  display: inline-block;
  width: 16px;
  margin-right: 4px;
  color: var(--ctx-tinte);
}
.ctx-menu-separator {
  height: 1px;
  margin: 5px 10px;
  background: var(--border-soft, var(--border));
  opacity: 0.7;
}
`

/** Inyecta (o actualiza) la hoja de estilos del menú contextual en el <head>. */
export function ensureCtxStyles(): void {
  let style = document.getElementById(CTX_STYLES_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = CTX_STYLES_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== CTX_STYLES) style.textContent = CTX_STYLES
}
