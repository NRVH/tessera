# El clic derecho es de la aplicación cuando pide el ratón, y el portapapeles va por nuestro IPC

- **Estado:** vigente
- **Ámbito:** `features/terminales/comportamientoTerminal.ts`, `clipboardProvider.ts`, `clipboardPaste.ts` y los atajos de `TerminalPane`

## Contexto

Cuando la aplicación de dentro pide seguimiento del ratón, xterm le reenvía el clic derecho y ella
pega. Abrir además el menú propio dejaba el texto pegado y un menú que ofrecía «Pegar». Por otra
parte xterm ignora la secuencia OSC 52 con la que las TUIs copian, y `navigator.clipboard` es poco
fiable bajo `contextIsolation` y `sandbox`.

## Decisión

- El menú contextual solo se abre si la aplicación NO usa el ratón, o con Mayús (xterm no reenvía
  el clic con Mayús y sin esa salida no pasaría nada). Se decide por lo que la aplicación declara,
  nunca por el agente.
- El addon OSC 52 usa un provider propio que enruta por `window.tessera.clipboard`; solo atiende
  la selección `c`.
- El pegado sigue una prioridad: archivos (rutas), imagen (ruta de un PNG) y texto por
  `term.paste()`, que aplica el bracketed paste solo si la aplicación lo activó.
- El modificador de los atajos es uno por plataforma y exclusivo (`esModPrincipal`): Ctrl+C con
  selección copia y sin ella baja como ^C; en Mac Ctrl+F y Ctrl+V llegan al pty.

## Consecuencias

- Volver a `ctrlKey || metaKey` roba Ctrl+F a readline en Mac y deja Ctrl+V muerto.
- Nunca se inyectan marcadores `200~` a mano: una aplicación que no los entiende los mostraría.
