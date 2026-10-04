# Los resultados de la consola se sustituyen por lote y releen en la sesión de su consola

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/resultados/*.ts`, `DbResultados.tsx`, `PlanExplain.tsx`

## Contexto

La consola ejecuta sentencia a sentencia (un invoke por sentencia, con ✓/✗ y cronómetro), y cada
resultado abre un cursor en el servidor, con un tope por sesión.

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
  al copiar, sin formato.

## Consecuencias

La comprobación de la PK es por NOMBRE: `SELECT nombre AS id` engañaría; se asume (es raro) y el
main comprueba lo demás.

## Descartes

- Un indicador «ya sustituí» en el estado: con el número de lote la regla cabe en una línea.
- Desactivar el valor completo con una transacción pendiente: quita la función justo al editar.
