# Los resultados de la consola se sustituyen por lote y releen en la sesión de su consola

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/resultados/*.ts`, `DbResultados.tsx`, `resultados/DbResultadosRejilla.tsx`, `PlanExplain.tsx`

## Contexto

La consola ejecuta sentencia a sentencia (un invoke por sentencia, con ✓/✗ y cronómetro), y cada
resultado abre un cursor en el servidor, con un tope por sesión. Bajo la consola hay una «Salida»
fija y una pestaña por conjunto de filas o plan; cada rejilla pide cosas a su dueño (exportar,
releer una celda recortada, traer todas) que dependen de la sesión de la consola.

## Decisión

- Orden `[Salida, ...fijadas, ...nuevas]`; «Salida» no es una pestaña más (no se cierra, fija ni
  mueve). Las no fijadas se SUSTITUYEN en cada ejecución: diez ejecuciones no dejan diez
  pestañas. Sustituir devuelve su LECTOR para cerrarlo, o cada ejecución dejaría un cursor vivo.
  Hasta 20 fijadas.
- El lote va por NÚMERO: los resultados del mismo lote llegan de uno en uno y solo se sustituyen
  las no fijadas de OTROS lotes. Explicar un plan sustituye solo los planes anteriores.
- Activación: con error, «Salida» (ahí están el error y su posición); si no, la última nueva,
  SALVO que el usuario haya elegido otra durante el lote: arrebatarle la vista es hostil.
- Títulos: `ESQUEMA.TABLA` de una sentencia de una tabla, plegada con la caja del motor
  (`plegarSinComillas`), o `Resultado k`; repetidos con ` (2)`.
- El valor completo de una celda recortada solo se ofrece sin duda: una tabla, esquema conocido,
  con PK y todas sus columnas en el resultado; si no, el visor dice por qué. Se pide por la
  sesión de SU consola: en `datos`, en Manual una fila recién insertada «ya no existía» y una
  actualizada enseñaba en silencio el valor viejo confirmado.
- El plan tiene dos vistas, árbol y texto del servidor (generado desde el árbol si no hay), para
  que el conmutador nunca lleve a una vista vacía. Sus números con el formato de la rejilla;
  al copiar, sin formato. Sus metadatos van en la cabecera de resultados, como los de cualquier
  pestaña (en la barra del plan saldrían repetidos); es un `<table role="treegrid">` y no una lista
  virtual (decenas de pasos, columnas alineadas solas), abierto entero, y copia lo que se VE.
  Desplegar y plegar se deshabilitan CON SU MOTIVO en la vista de texto.
- **Cada resultado es una pestaña dueña de su rejilla o su plan.** La tira es propia
  (`.db-resultados-tabs`) aunque las pestañas sean `.terminal-tab`: la zona de la terminal lleva
  `container-type`, que implica `contain`, y un menú `fixed` dentro de un ancestro con contención se
  posiciona contra él y no contra la ventana. El menú va por portal. La chincheta se ve en la
  pestaña, porque lo no fijado se sustituye en la próxima ejecución.
- Las rejillas ocultas siguen montadas (`visible` a false): volver conserva desplazamiento y
  selección. La memoria la sujetan las filas, no el DOM, y de eso se encarga el presupuesto.
- Cada pestaña tiene SU `useExportarBd`: una exportación por pestaña, y cerrarla la cancela. El
  origen es la CONSULTA entera en la sesión de la consola (ve su transacción) si se puede
  releer, con sus parámetros (sin ellos el main la rechaza); si no (un RETURNING, una llamada),
  lo cargado.
- La clave para el valor completo sale del catálogo y se pide SOLO si hay celdas recortadas y la
  pestaña se ve. En SQL Server el «esquema» de la sesión es la base: una tabla sin esquema no
  ofrece el valor completo.
- «Traer todas» lo corre la consola; al tope de memoria se dice por qué, sin «Volver a
  ejecutar». Los conjuntos extra («Resultado k.2», de un EXEC o un lote) llegan sin lector: ni
  cargan más ni se re-ejecutan. El tooltip dice con qué parámetros se ejecutó.

## Consecuencias

La comprobación de la PK es por NOMBRE: `SELECT nombre AS id` engañaría; se asume (es raro) y el
main comprueba lo demás.

`DbResultados` y `PlanExplain` van con `memo`: la consola y `DbArea` repintan por cosas que no
les tocan (diálogos, historial, esquema, transacción, redimensionar), y la Salida lleva hasta mil
filas y cada pestaña su rejilla, también las ocultas; lo que les llega conserva su identidad entre
renders. Están fuera del ciclo de importación: sus piezas no importan de una feature del ciclo.

## Descartes

- Un indicador «ya sustituí» en el estado: con el número de lote la regla cabe en una línea.
- Desactivar el valor completo con una transacción pendiente: quita la función justo al editar.
