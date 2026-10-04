# La solo lectura del clasificador es una lista blanca estricta y un clasificador que duda rechaza

- **Estado:** vigente
- **Ámbito:** `src/shared/sql/clasificarSql*.ts`

## Contexto

El main aplica `permitidaEnSoloLectura` sentencia a sentencia, y el renderer la usa para el aviso
amarillo. En Oracle, `BEGIN COMMIT; UPDATE t …; COMMIT; END;` termina la transacción READ ONLY que
Tessera abre antes de cada sentencia, y el UPDATE corre en una nueva de lectura y escritura.

## Decisión

- Pasan solo las consultas, los comandos del cliente (no llegan al servidor) y unos parámetros de
  sesión inocuos por dialecto. Se rechaza TODO lo demás: PL/SQL, CALL/EXEC/DO, FOR UPDATE, el control
  de transacciones y lo que no se sabe clasificar (`otra`, que cuenta como que escribe).
- Formatos fijados (`formatoFijadoPorTessera`): se rechazan en TODOS los modos. Los fija el trabajador
  al abrir la sesión (NLS_*, DateStyle, `standard_conforming_strings`, los de T-SQL); cambiarlos rompe
  el orden local, la copia y el hex de binarios, y con `standard_conforming_strings = off` el
  servidor leería la barra como escape y el léxico clasificaría otra sentencia. El mensaje da el remedio
  por parámetro (`TO_CHAR`, `encode`, `E'…'`).
- Un CREATE de unidad PL/SQL es `ddl` con `plsql: true` (confirma implícitamente, invalida el
  catálogo); solo los bloques anónimos son `plsql`. `EXPLAIN ANALYZE` hereda la clase de lo que ejecuta.
- SQLite: un PRAGMA es consulta solo si está en `reglas.pragmas`, la misma lista que el autorizador
  del trabajador; `VACUUM … INTO` está cerrado siempre.

## Consecuencias

Un clasificador que se equivoca lo hace hacia «rechazado», nunca hacia «escrito». Límites aceptados:
no ve dentro de funciones con efectos, de `EXECUTE IMMEDIATE` ni de dblinks; la garantía real es un
usuario de solo lectura. Las diferencias entre motores se leen de `REGLAS`, y donde la respuesta no
es sí/no, un `switch` cierra con `nunca`.

## Descartes

- «Dejar pasar bloques y CALL; que decida el candado del servidor»: rompe con el ejemplo de Oracle.
