# Exportar lee con UN cursor vivo en una sesión efímera propia y escribe a un temporal

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/sesiones/exportarTabla.ts`, `sesiones/exportarConsulta.ts`, `exportacion.ts`, `controlador/exportar.ts`

## Contexto

Exportar paginando con LIMIT/OFFSET en `datos` tenía tres defectos medidos: coste cuadrático
(2 M filas: 20 s frente a 2 s del cursor), otra instantánea en cada página (un DELETE o INSERT
por debajo perdía o duplicaba filas) y, con empates en un ORDER BY del usuario, filas repetidas
y otras perdidas sin ninguna escritura (200 000 filas, 196 631 distintas).

## Decisión

- Una TABLA de PG u Oracle: UNA lectura con UN cursor vivo (`mantenerCursor`, `resultSet`) en
  una sesión EFÍMERA propia, con el SQL de la pestaña: ningún LRU de lectores la expulsa. Está en
  `porClave` (la encuentran el Stop, la pérdida y los ociosos) pero es `interna`: ni se emite ni
  se lista, y se cierra y se olvida SIEMPRE. Una CONSULTA: una operación de su consola.
- Sin cursor vivo, por páginas: SQLite (retendría el bloqueo del archivo y la aplicación dueña
  no podría confirmar) por la CLAVE; SQL Server por OFFSET/FETCH (una petición pausada deja
  bloqueos puestos). Sin clave o con ORDER BY del usuario, un aviso dice que puede faltar o
  repetirse una fila. La forma ROWNUM no tiene «sin límite»: se rechaza.
- La exportación se apunta en el MISMO turno de la petición, antes de leer el catálogo: un Stop
  en ese tramo (el de la pestaña al desmontarse) vale, y el diálogo no se abre sobre una pestaña
  cerrada. Tiene su marca propia: `enPreparacion` es del rol `datos` y este Stop llega con rol
  `exportacion`. La validación del origen va antes del diálogo.
- Se escribe a un temporal en la MISMA carpeta y se renombra al final (entre volúmenes no es
  atómico); si algo falla, se borra y el destino no se toca. CSV con BOM: sin él, Excel abre el
  UTF-8 como ANSI. Al renderer vuelven el nombre y un `token` opaco, nunca la ruta.

## Consecuencias

- Precio: una conexión más y, en PG, una tx con AccessShareLock (frena un DDL ajeno, no un DML).
- El `try/finally` de `volcar` cierra y borra el temporal en cualquier salida: no se parte en fases.

## Descartes

- Toda la exportación en un turno de `datos` (bloquearía las demás pestañas de la conexión), o
  su cursor vivo en `datos` entre turnos (el `ejecutar` de otra pestaña lo cierra).
- Keyset por la PK en PG: sin coste cuadrático, pero sin una sola instantánea.
