# Las pestañas de datos deciden lo que ven con el descriptor del motor y dicen el siguiente paso

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/panesBd.ts`, `DbDatosPane.tsx`, `DbFuentePane.tsx`, `PildoraFilas.tsx`

## Contexto

La pestaña de tabla y la de fuente pintan lo que devuelve el main, pero hay decisiones que
toma el renderer y que se equivocan en silencio si nadie las fija con una prueba.

## Decisión

- El orden es ESTRUCTURA (`DbOrdenColumna[]`, lo cita el main), no un ORDER BY de texto en la
  barra: el texto solo reconocía una columna simple y obligaba a citar a mano por dialecto.
- Qué motor pagina sin estado (`sesion.paginasInestablesSinOrden`) y en qué lenguaje va su
  fuente salen de su descriptor, leído con una función que valida: un motor nuevo no cae en la
  rama de otro sin aviso.
- Cada motivo de error tiene su titular y su siguiente paso: un `sinSecreto` y un `driver` no
  se arreglan igual, y «no se pudo leer la tabla» deja al usuario sin salida.
- Un BLOQUEO (lectores que esperan a escritores, típico de una consola propia en Tx Manual)
  se dice y ofrece «Reintentar» y «Leer sin esperar» (READ UNCOMMITTED), con una marca en la
  barra mientras esos datos están a la vista. Tessera informa, no prohíbe.
- La cabecera se mide en SU fuente (la de la interfaz, seminegrita) y las celdas en la suya:
  con una sola medida, una cabecera larga quedaba cortada por unos píxeles.

## Descartes

- Traer `sinOrdenEstable` del main: ampliaba un contrato cerrado por una regla que el renderer
  sabe aplicar con lo que ya tiene (motor, orden aplicado y clave primaria).
- Leer sin esperar por defecto (enseñaría datos que quizá nunca existan sin pedirlo) o esperar
  sin tope.
