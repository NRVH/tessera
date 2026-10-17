# Lo que cambia de un motor a otro es un descriptor de datos, en una unión por familia

- **Estado:** vigente
- **Ámbito:** `src/shared/motores/` (`tipos.ts`, `definir.ts`, `index.ts`, `autenticacion.ts`, `destinoRed.ts`), `src/tdb/motores.cjs`, `src/shared/sql/dialectosSql*.ts` y quien lee `REGLAS`

## Contexto

Decidir por motor con `motor === 'oracle' ? A : B` hace que cada motor nuevo caiga en silencio en la
rama de otro; comparar el dialecto con su nombre (`d === 'oracle'`) tiene el mismo fallo, y un índice a
pelo (`REGLAS[d]`) con un valor mal validado da un TypeError anónimo. El descriptor pone cada decisión
como una capacidad con nombre, y `MOTORES` tiene una entrada por `DbMotor`: un motor nuevo no compila
hasta tenerlas todas. Léxico, divisor, clasificador, parámetros y avisos son uno para todos los
motores SQL; lo que cambia es dato.

## Decisión

- Solo entra lo que sustituye una decisión que el código toma hoy, como valores y funciones puras pequeñas:
  el código por motor que genera SQL vive en el main y en `shared/escrituraSql/`, y lo léxico en `REGLAS`.
- **Unión discriminada por `familia`** (`sql`, `documentos`, `claves`): lo común es la identidad y la
  `conexion`; lo SQL no se aplica a las otras familias por construcción. Quien está en un camino SQL
  pide `descriptorSql(m)`, que lanza con otra familia. `REGLAS`, `ESCRITURA_SQL` y
  `MOTORES_EXPLORADOR` van por `DbMotorSql`.
- **Dialecto = motor** (`MOTORES[m].sql.dialecto === m`), fijado por el tipo y por `test-motores`: quien
  solo tiene el dialecto a mano no hereda en silencio las capacidades de otro motor. Un motor que
  reutilice una gramática tiene su propia fila en `REGLAS`, copiada (`{ ...REGLAS_BASE }`).
- Lo derivado no se declara: `definirMotor` deriva `validarDestino` (de `obligatorios` y
  `excluyentes`, con sus mensajes), `tieneSinonimos`, `forma` y `deArchivo`. Un obligatorio sin su
  mensaje, o al revés, lanza al cargar el módulo y no en el guardado de un usuario.
- Uniones y no booleanos donde la respuesta no es sí/no (`candadoSoloLectura`, `identidadSinPk`,
  `FormaPaginado`): un `switch` con `nunca` deja de compilar con un valor nuevo; la guardia
  [registro-motores-guardia-de-motores-sueltos.md](registro-motores-guardia-de-motores-sueltos.md) las lee.
- `descriptor()` lanza con un motor fuera del registro; uno que llega de fuera se comprueba con `esMotor`
  (`hasOwnProperty`, no `in`: «constructor» no es un motor).
- La forma de esperar un bloqueo (`FormaEsperaBloqueo`) es de la sesión de cada motor, con su SQL: no queda
  copia en el descriptor. `destinoLegible` no unifica las formas de `tdb ls` y del bloque de memoria: las
  leen agentes que ya las conocen.
- **Lo que cambia del LENGUAJE SQL es una tabla de banderas** (`REGLAS`, en `src/shared/sql/dialectosSql*.ts`):
  cada diferencia es una bandera sí/no o una unión cerrada, y el `switch` que la lee cierra con
  `nunca`. Las tablas por dialecto (`REGLAS`, `RESERVADAS`, `PALABRAS_CLAVE`, `SEGURO`) son `Record`s
  exhaustivos. Lo que depende del motor y no del lenguaje (catálogo, sesión, formulario) vive en el
  descriptor.
- `deDialecto` valida la clave con `hasOwnProperty` (con `'constructor'` o `'toString'`, `in` encuentra
  lo heredado de `Object.prototype`) y lanza «Dialecto desconocido: "x".». Lo llama cada entrada
  exportada al empezar, no cada lectura; `test-sql-dialecto-desconocido` exige que todo export con
  `DialectoSql` esté en su tabla.
- Las reglas de identificadores: la caja sin comillas es un modo (`mayus`, `minus`, `insensible`,
  `insensibleUnicode`); SQL Server escribe corchetes porque `"x"` depende de QUOTED_IDENTIFIER.
- `ReglasDialecto` debe seguir en `dialectosSql.ts`: `test-motores-sueltos` lee de ahí las uniones.

## Descartes

- Una clase por motor con métodos para el lenguaje: escondería en qué se parecen dos motores.
- Guardar el paginado en `REGLAS`: depende de la versión del servidor y vive en el descriptor.
- Deducir el dialecto del texto: un `BEGIN` es un bloque en Oracle y una transacción en PG.
- Descriptor plano con grupos opcionales (`sql?`, `documentos?`): cada lector comprobaría lo que le
  falta y un `?.` olvidado es el fallo en silencio que se quiere evitar.
- Fundir `DialectoSql` con `DbMotor`: MongoDB y Redis no tienen dialecto y `REGLAS` les exigiría fila.
- Un registro aparte para las familias nuevas: el formulario y `tdb ls` las tratan igual.
