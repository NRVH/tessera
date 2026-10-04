# La vista previa de un .html va en un iframe con sandbox vacío, nunca en el DOM del renderer

- **Estado:** vigente
- **Ámbito:** `features/editor/useVistaDelPane.ts`, `useVistaHtml.ts`, `EditorPane.tsx`

## Contexto

Un .html abierto es contenido ajeno: inyectarlo con `innerHTML` lo ejecutaría dentro del origen
privilegiado de la app, junto al preload. Pasarlo por un saneador quitaría justo lo que se quiere ver.

## Decisión

- El texto se guarda en un estado aparte (`htmlCrudo`), distinto del HTML ya saneado del markdown
  (`mdHtml`): mezclarlos deja la distinción a la memoria de quien edite.
- Se pinta en un iframe con `sandbox=""`, sin `allow-scripts` ni `allow-same-origin`.
- Está medido: un iframe sobre `blob:` hereda la CSP del renderer y su `script-src 'self'` bloquea
  igualmente los scripts del archivo; con `allow-scripts` no llegó ningún mensaje a la ventana padre.

## Consecuencias

La página se ve sin JavaScript. Añadir `allow-scripts` no habría hecho funcionar ningún script y
solo aflojaría el sandbox; junto a `allow-same-origin` lo anula entero. Un aviso lista los recursos
que no van a cargar (relativos y de red).

## Descartes

- Sanear con DOMPurify y usar `innerHTML`: mata lo que se quiere ver y deja el DOM privilegiado expuesto.
