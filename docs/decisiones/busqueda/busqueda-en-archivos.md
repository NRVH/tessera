# La búsqueda en archivos es siempre del proyecto activo y cada barrido se cancela en cuanto deja de hacer falta

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/busqueda/` (`useBusquedaEnArchivos`, `useEfectosBusqueda`, `AmbitoBusqueda`, `useCarpetasBusqueda`)

## Contexto

El main resuelve toda ruta contra UNA sola raíz: la del proyecto activo. El modal ofrece dos
ámbitos (todo el proyecto o una carpeta, de cualquier proyecto abierto) y busca mientras se teclea.

## Decisión

- Elegir una carpeta de otro proyecto lo ACTIVA primero, como pulsar su pestaña. Mientras la
  carpeta y la raíz activa no coinciden NO se lanza ninguna búsqueda: una carpeta de B contra la
  raíz de A no encuentra nada o encuentra lo que no es. Sin proyecto activo sí se lanza, para que
  el main conteste «No hay proyecto activo» en vez de dejar el modal mudo.
- Borrar el recuadro cancela el barrido en marcha y pone `idRef` a 0; cerrar el modal también lo
  cancela. El estado se reinicia al ARRANCAR la nueva búsqueda, no al teclear.
- `search.iniciar` devuelve el `fin` cuando la búsqueda terminó antes de arrancar: por el canal de
  fin llegaría antes de conocer su id y se descartaría, dejando «Buscando…» para siempre.
- La carga de carpetas del ámbito NO se cancela al cambiar de ámbito, solo al desmontar; cada
  respuesta se valida contra la firma de proyectos. Cancelarla dejaba el desplegable deshabilitado
  para siempre si se volvía a «En una carpeta» con el barrido aún en vuelo.
- La fuente del modal se guarda como tamaño ya derivado (`fontBusqueda`), no como ancho de
  ventana: arrastrar el borde produce cientos de anchos y cuatro tamaños.
- Un select nativo con `<optgroup>` por proyecto, y la sangría con espacios duros
  (`String.fromCharCode(160, 160)`), porque un `<option>` no admite CSS.

## Consecuencias

- Al partir el modal, los efectos siguen en este orden: resize, suscripción, lanzar, carpeta
  huérfana, activar proyecto, foco. Cambiarlo cambia cuándo se cancela un barrido.
- No se puede lanzar en el ámbito «carpeta» sin que la raíz activa coincida.

## Descartes

- Buscar en una carpeta de otro proyecto sin activarlo: el main no tiene otra raíz.
- Un árbol desplegable propio para elegir carpeta: teclado, foco y virtualización para un clic.
