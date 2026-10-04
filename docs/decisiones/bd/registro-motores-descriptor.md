# Lo que cambia de un motor a otro es un descriptor de datos, en una unión por familia

- **Estado:** vigente
- **Ámbito:** `src/shared/motores/` (`tipos.ts`, `definir.ts`, `index.ts`, `autenticacion.ts`, `destinoRed.ts`), `src/tdb/motores.cjs`

## Contexto

Unos 190 sitios decidían por motor con `motor === 'oracle' ? A : B`; con un tercer motor cada uno caía en
silencio en la rama de PostgreSQL. El descriptor pone cada decisión como una capacidad con nombre, y
`MOTORES` tiene una entrada por `DbMotor`: un motor nuevo no compila hasta tenerlas todas.

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

## Descartes

- Descriptor plano con grupos opcionales (`sql?`, `documentos?`): cada lector comprobaría lo que le
  falta y un `?.` olvidado es el fallo en silencio que se quiere evitar.
- Fundir `DialectoSql` con `DbMotor`: MongoDB y Redis no tienen dialecto y `REGLAS` les exigiría fila.
- Un registro aparte para las familias nuevas: el formulario y `tdb ls` las tratan igual.
