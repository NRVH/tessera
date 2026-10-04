// =============================================================================
// Estilos del menú contextual (`.ctx-menu*`), inyectados una sola vez en el <head> y
// acotados bajo `.ctx-menu`. Reutilizan los tokens del tema y no tocan la hoja global.
// Los usa `ContextMenu.tsx`.
// Decisiones: docs/decisiones/renderer/menu-contextual.md
// =============================================================================

const CTX_STYLES_ID = 'context-menu-styles'

const CTX_STYLES = `
.ctx-menu {
  position: fixed;
  z-index: 1000;
  min-width: 200px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.ctx-menu:focus {
  outline: none;
}
.ctx-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg);
  font-family: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.ctx-menu-item:hover:not(:disabled),
.ctx-menu-item:focus-visible:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
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
/* Columna del icono: se reserva en todo el menú si alguna opción trae icono. Va tenue y hereda
   el color de la fila al apuntarla y en la destructiva. */
.ctx-menu-icono {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: 8px;
  color: var(--fg-faint);
}
.ctx-menu-icono svg {
  width: 14px;
  height: 14px;
}
.ctx-menu-item:hover:not(:disabled) .ctx-menu-icono,
.ctx-menu-item:focus-visible:not(:disabled) .ctx-menu-icono,
.ctx-menu-item.danger .ctx-menu-icono {
  color: inherit;
}
/* Columna del check, aparte de la del icono: se reserva en todo el menú si alguna opción es
   conmutable. El margen separa la etiqueta del símbolo. */
.ctx-menu-check {
  flex: 0 0 auto;
  display: inline-block;
  width: 16px;
  margin-right: 4px;
  color: var(--accent);
}
.ctx-menu-separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--border-soft, var(--border));
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
