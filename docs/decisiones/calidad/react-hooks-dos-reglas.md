# De react-hooks se activan dos reglas elegidas a mano, no su preset

- **Estado:** vigente
- **Ámbito:** `eslint.config.mjs`, bloque del renderer

## Contexto

Desde su versión 7, el preset `recommended` de `eslint-plugin-react-hooks` arrastra todo el
conjunto de reglas del compilador de React (`immutability`, `purity`, `static-components`,
`use-memo`…). Sobre el código ya escrito producen cientos de errores de estilo que tapan los
dos tipos de fallo que de verdad importan.

## Decisión

Se registra el plugin y se activan dos reglas:

- `rules-of-hooks`, error siempre: un hook bajo una condición es un fallo, sin excepciones.
- `exhaustive-deps`, error también: una dependencia que
  falta deja un efecto trabajando con estado viejo. Las omisiones deliberadas (efectos que
  corren una sola vez, dependencias sustituidas por una clave de contenido) se marcan con
  `eslint-disable-next-line` y su motivo.

## Consecuencias

Activar otra regla del plugin es una decisión aparte, que se mide antes sobre el código
entero. Extender el preset «para estar al día» devuelve el ruido de golpe.

## Descartes

- Extender `recommended` y silenciar lo que sobre: cientos de supresiones sin un fallo real
  detrás, y las supresiones acaban tapando también los avisos buenos.
