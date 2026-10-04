# Lo que cambia por motor en las sesiones es una capacidad con nombre o un método del motor

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/sesiones/` (`reglas`, `tabla`, `consola`, `explicar`, `resultadoSentencia`), `motores/sesion*.ts`, `consolaSql.ts` y `bindsConsola.ts`

## Contexto

Oracle, PostgreSQL, SQLite y SQL Server comparten el gestor. Comparar el dialecto con un
literal (`d === 'oracle'`) dejaba que un motor nuevo cayera en silencio en la rama de otro.

## Decisión

- Lo que es un VALOR que también lee el renderer es una CAPACIDAD de `descriptor(m).sesion`
  (`src/shared/motores/`): forma de paginado, `mantenerCursor`, candado de solo lectura, esquema
  transaccional, salida del servidor, versión mínima; las uniones, con un `switch` y `nunca`.
- El SQL y los algoritmos que solo usa el main son métodos de `SesionExplorador` en
  `motores/sesion<Motor>.ts`. El Explain recibe un `ContextoExplicar`, la lista cerrada de lo que
  necesita del gestor: el motor no recibe la `Sesion` ni el `Proceso` (podría tocar la máquina de
  estados), y sumar un motor no obliga a editar `GestorSesiones`.
- La espera de bloqueos de «Enviar» es UNA unión discriminada (`EsperaBloqueoEnvio`: `porFila`,
  `porTransaccion`, `porArchivo`), no una bandera del descriptor más un método que la contradiga.
- Los errores de compilación se leen si `sqlErroresCompilacion` no es null (el servidor GUARDA
  los de la unidad: Oracle sí, PG falla en el acto), no por la bandera léxica `bloquesPlsql`.
- DBMS_OUTPUT de Oracle también tras `dml` y `ddl` (DOS viajes): el buffer no se vacía solo y la
  línea de un trigger la enseñaría la siguiente sentencia que lee.
- SQL Server: varios conjuntos por sentencia; la lectura en flujo corta con attention solo en una
  consulta pura sin nada detrás (cortar el primer conjunto aborta el resto del lote).
- Parámetros (`bindsConsola.ts`): el main los vuelve a sacar del texto que se ENVÍA y solo viajan
  los usados (node-oracledb rechaza uno de más). Oracle por clave en MAYÚSCULAS salvo `:"Id"`
  citado; PG posicional con tope 65535 (un `$1000000000` agotaba la memoria del main). El EXPLAIN
  de Oracle en thick no admite binds y en thin exige todos (van como NULL). Medido en 11.2 y 21c.

## Consecuencias

- Sumar un motor es un caso en cada `switch` y un archivo de sesión, que no compilan sin decidir.

## Descartes

- Métodos con el motor como parámetro en un único objeto (el `d === 'oracle'` de antes); meter en
  el motor `trasReaplicarEsquema` o `decidirIdentidad` enteros (reglas comunes con un dato por motor).
