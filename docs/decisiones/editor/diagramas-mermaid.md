# Los diagramas mermaid se dibujan con sus etiquetas HTML y el SVG se sanea antes de insertarlo

- **Estado:** vigente
- **Ámbito:** `features/editor/mermaidRender.ts`, `mermaidTema.ts`, `useMermaid.ts`, `contenidoHtml.ts` (`CLASE_MERMAID`)

## Contexto

Un bloque `mermaid` de un Markdown, o un `.mmd` entero, se dibuja en la vista renderizada. El texto del diagrama
viene de un archivo del proyecto, que puede haber escrito cualquiera: no es de confianza. Mermaid pinta las
etiquetas de nodos, aristas y subgrupos como HTML dentro de `<foreignObject>`.

## Decisión

- Mermaid corre con `securityLevel: 'strict'` (sin `click` que lance código) y su SVG se sanea otra vez con
  DOMPurify antes de insertarlo, con los perfiles de SVG, filtros y HTML.
- `<foreignObject>` se admite como etiqueta **y** como punto de integración de HTML
  (`HTML_INTEGRATION_POINTS`). Admitir solo la etiqueta conserva el recuadro y borra su contenido: el diagrama
  sale con las cajas y sin ningún texto. El HTML de dentro pasa por el mismo saneado, que quita guiones y
  manejadores de eventos.
- El tema propio se lee de la configuración que mermaid devuelve al analizar el diagrama: frontmatter y
  directivas combinados; una directiva inválida no cuenta. Antes de cada dibujo se repone la configuración
  con la paleta de la app o, si trae tema propio, con una neutra para que el suyo no se mezcle con el de la app.
  Los dibujos van en fila porque esa configuración es global. El fondo es el `background` que declare,
  transparente si el tema es oscuro y, si no, blanco: los temas claros están pensados para una página clara.
  Mezclar las dos paletas deja textos del color de una sobre el fondo de la otra.
- Mientras se dibuja, el ancho que mide un `<div>` se redondea al entero si está a menos de una décima. Mermaid
  parte una etiqueta en líneas solo si su ancho es exactamente el máximo, y con el zoom de la ventana distinto de
  100 % el navegador devuelve 199,99: la etiqueta quedaría en una línea, cortada por su recuadro. El ajuste dura lo
  que el dibujo y se quita al acabar el último en curso.
- Un diagrama que no compila se enseña en su sitio con un aviso de error de sintaxis; un fallo al dibujar, con
  su mensaje. Nunca se lanza.

## Consecuencias

`test:mermaid-tema` comprueba el fondo de cada tema declarado.

`e2e/markdown-mermaid.spec.ts` fija que las etiquetas se leen, que el diagrama cabe en la ventana mínima, que
una etiqueta larga se parte en líneas con el zoom cambiado, el fondo de un tema propio y que lo que una etiqueta
intenta ejecutar no llega al documento. Va en `e2e/` porque mermaid mide el texto en el DOM.

## Descartes

- Detectar el tema con expresiones regulares sobre el texto, o anteponer una directiva con la paleta de la app:
  mermaid descarta todas las directivas si una no es válida, y el texto admite más formas de las que una expresión reconoce.
- Etiquetas de texto SVG (`htmlLabels: false`): pierden los saltos de línea y el formato que los diagramas ya
  usan, y cambian las medidas de todos los nodos.
- Parchear la librería para tolerar la décima: el parche se ata al nombre de un archivo interno que cambia con
  cada versión.
- Insertar el SVG de mermaid sin sanear: su saneado propio depende de la versión de la librería.
