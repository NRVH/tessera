# Los estados vacíos son un componente, distinguen «aún no sé» de «no hay» y nunca escriben

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/comun/EstadoVacio.tsx` y sus usos

## Contexto

El mismo patrón de «no hay nada que enseñar» sale en varios paneles; copiado a mano en cada uno,
diverge, y dos situaciones equivalentes se pintan distinto.

## Decisión

- Un solo componente: icono grande, título y una línea de pista, centrados.
- Su `accion`, si la lleva, solo ABRE algo que ya existe en la app; nunca escribe en los archivos del
  usuario («Inicializar repositorio» no va aquí): al vacío se llega por accidente, y es el peor sitio
  para un botón que crea cosas.
- Los estados TRANSITORIOS («Cargando…») no se centran: van como línea, porque centrarlos hace saltar
  el layout al llegar el contenido.
- Afirmar un vacío exige haber terminado de mirar: `null` es «aún no sé» y `[]` es «miré y no hay».
  Colapsarlos dice, durante un instante, que una carpeta no está versionada o que un repo no tiene
  commits.
- El contenedor centra con `min-height`, no con `height: 100%`: dentro de una columna flex sin alto
  resuelto, el porcentaje colapsa a cero y el mensaje desaparece.

## Consecuencias

Un panel nuevo con vacío usa `EstadoVacio`; uno con carga, una línea aparte. Un vacío dentro de la
cabecera de una lista virtual no se centra como en un flex normal: va fuera de ella.
