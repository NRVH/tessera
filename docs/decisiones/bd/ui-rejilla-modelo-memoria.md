# Las filas en memoria de todas las rejillas comparten un tope global de celdas

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/rejilla/{celdasRejilla,presupuestoCeldas,traerTodas}.ts`

## Contexto

Cada celda cargada es un string en el renderer. Con muchas pestañas de datos y resultados de
consola abiertos y la carga automática al desplazar, la memoria crecía sin techo.

## Decisión

- UN tope de 2 M celdas para TODAS las rejillas, por un registro de módulo: contado por dueño,
  N dueños llegaban a N × 2 M y el tope no era un techo.
- Al pasarse, las rejillas OCULTAS menos usadas sueltan lo que va tras su primera página y
  enseñan «Volver a ejecutar»; nunca la visible. Si ni así cabe, se deja de cargar sola.
- Se libera de UNA en UNA y se vuelve a medir: un `liberar()` real puede soltar menos (una
  pestaña recargando) o más que el plan. Un `avisar()` anidado durante el equilibrio no hace
  nada, y una rejilla ya liberada en la pasada no vuelve a ser candidata (evita el bucle sin fin).
- Cada dueño avisa cuando cambian sus filas o su visibilidad: la que deja de verse es justo la
  que pasa a ser candidata. Una pestaña con cambios sin enviar no suelta filas (sus cambios
  apuntan a posiciones de lo cargado).
- «Traer todas» pide páginas de 5000 (cada viaje por la VPN cuesta lo mismo con 500) y se para
  ANTES de pasarse: pide como mucho lo `alcanzable`. Al tope, «expórtalo a archivo»: volver a
  ejecutar se llenaría igual. No cuenta antes con COUNT(*), que cuesta lo que leer la tabla.
- Detener «Traer todas» no es perder el lector: el main sigue sirviéndolo desde donde iba, así
  que lo traído se queda y todo sigue disponible. Una página cancelada al desplazar sí se dice en
  la píldora: la rejilla no vuelve a pedirla sola.
- Las filas llegan como JSON opaco que ni el main ni el preload miran: `parsearPagina` valida
  la forma al llegar y lo dice, en vez de pintar un descuadre en silencio.
- Una celda pinta 300 unidades como mucho, cortadas ANTES de sustituir los saltos.

## Consecuencias

El registro guarda funciones que miden, no filas: nunca mira un dato viejo.

## Descartes

- Un contexto de React: obliga a pasar por un render para enterarse, y la pregunta es síncrona.
- Equilibrar solo al registrar o dar de baja: las celdas cambian con cada página.
