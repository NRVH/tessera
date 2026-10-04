# Seleccionar es ver: la apertura del diff cuelga de un gesto, con antirrebote y un solo cursor

- **Estado:** vigente
- **Ámbito:** `features/git/useAperturaLog.ts`, `useTeclasLog.ts`, `modelo/autoAbrir.ts`, `atajoCopiarHash.ts`

## Contexto

Recorrer el historial con las flechas mueve el cursor en cada pulsación y debe abrir UN diff: el
del commit donde te paras. El resaltado de la lista de archivos tiene que decir siempre lo mismo
(lo que hay en el editor), venga del ratón o del teclado.

## Decisión

- Un clic o una flecha mueve el cursor Y abre el diff. `AUTO_ABRIR_MS` (180 ms) retiene solo la
  apertura, muy por encima de la autorrepetición del teclado y por debajo del umbral de pereza de
  un clic. Un único temporizador sirve a las dos listas. El doble clic y Enter abren YA y cancelan
  el pendiente, o el mismo diff se abriría dos veces.
- La apertura del primer archivo es una PETICIÓN con token monótono (una ref, no derivado del
  estado: al limpiar la selección un contador derivado volvería a 1 y una apertura se tragaría en
  silencio). Cuelga de un gesto, no de que cambie la selección: el rescate tras un filtro, el salto
  por hash, las coincidencias y restaurar el cursor al reabrir la franja no abren nada. El token se
  consume solo cuando el commit ya está en la lista visible.
- Las flechas no envuelven en los extremos y las CARPETAS son destino válido: sin poder posar el
  cursor en una, `←`/`→` no tendrían a qué aplicarse.
- Ctrl+C copia el hash COMPLETO, en un solo sitio para los dos teclados: solo el modificador
  principal de la plataforma, sin Shift (ya es «copiar» en las terminales) ni Alt (AltGr llega como
  Ctrl+Alt), por `key` o por `code`, sin autorrepetición, y cede el paso si hay texto seleccionado
  que toque la lista (por intersección de rangos; el ancla cae en `<body>` con Ctrl+A). Un atajo
  nuevo con otra tecla por plataforma va a `modelo/`, con la plataforma como parámetro.
- El acuse de copiado es UN hash para toda la vista, en el panel: las filas se desmontan al salir
  de la ventana virtual y perderían el estado. Copia por el portapapeles del main.
- Las filas no reciben foco (ni `tabIndex={-1}`: sigue siendo enfocable con el ratón y pinta un
  segundo marcador). El foco vive en el contenedor y la fila activa se nombra con
  `aria-activedescendant`. La canaleta de copiar es un span `aria-hidden`, no un botón.

## Descartes

- Un segundo parámetro `auto` en `onOpenDiff` y un segundo resaltado del archivo abierto: dos
  cajas encendidas para un solo cursor se leen como un fallo.
- `ctrlKey || metaKey`: convertía ⊞+C en copiar a escondidas.
