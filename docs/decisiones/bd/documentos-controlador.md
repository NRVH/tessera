# Documentos: contrato propio, valores como texto del shell, el main valida la forma y decide la política, y el renderer solo ve ids de lector del main

- **Estado:** vigente
- **Ámbito:** `src/shared/db-documentos-ipc.ts`, `src/main/db/explorador/documentos/`
  (`ControladorDocumentos.ts`, `ipc.ts`, `validacionPeticion.ts`, `GestorDocumentos.ts`)

## Contexto

`db-explorador-ipc.ts` es SQL de punta a punta (esquemas, carpetas por tipo, DML de «Enviar»,
binds, EXPLAIN); un documento no tiene nada de eso, ni catálogo de esquemas, ni transacciones que
atraviesen sentencias. Meter MongoDB en aquel contrato obligaba a cada handler SQL a preguntar por
la familia. Una consulta de MongoDB deja además un cursor vivo en el trabajador, que se pierde con
su sesión.

## Decisión

- Contrato, controlador y gestor propios: el main enruta por familia una sola vez, al registrar los
  canales, y cada contrato habla de su modelo. Se reutiliza lo común: la conexión (`db-ipc.ts`),
  `DbRespuesta` y `DbErrorSql`, `DBX_CHANNELS.CANCELAR`, `DESCONECTAR`, `SESIONES` y los archivos de
  consola del espacio de datos.
- Los documentos cruzan como TEXTO en notación del shell (`texto`), con los tipos numéricos
  explícitos ([mongodb-conexion-y-tipos.md](mongodb-conexion-y-tipos.md)). El renderer no carga `bson`.
- La tabla son los campos de primer nivel de una muestra (`$sample` de 100). Una columna puede traer
  varios tipos, así que el tipo va por celda (`DbDocCelda.tipo`), no por columna.
- La identidad de un documento es su `_id` en EJSON canónico (`idEjson`), que es lo que vuelve en
  «Enviar»: nunca el texto de la celda.
- `atender` es el punto único de las operaciones con conexión: comprueba que existe, es de
  documentos y es del perfil; valida la FORMA (tipos, textos acotados, enteros en rango), y lo que
  no cuadra es `interno` «Petición inválida» sin tocar el gestor; y decide la POLÍTICA.
- Política (`politicaDe`): `soloLectura` es la impuesta (`soloLecturaImpuesta.ts`; la casilla
  `readonly` es de los agentes), `produccion` sale del entorno y `confirmado` de la petición. La
  aplica el trabajador con su clasificador; el gestor solo la transporta. Barreras, con el renderer
  preguntando y el main como segunda: escritura en producción sin `confirmado` responde
  `motivo: 'produccion'`; más de un cambio en un servidor sin transacciones y sin
  `confirmadoSinTransaccion`, `'sinTransaccion'`; escritura en una conexión de solo lectura,
  `'soloLectura'`. El renderer no clasifica sentencias: manda, y si vuelve `'produccion'` pide la
  confirmación y reenvía.
- Filtro guiado y orden de cabecera se validan con el mismo compilador que usa el gestor; uno
  guiado junto a un `filtro` de texto no vacío es «Petición inválida».
- El renderer solo ve ids del main (`docs:<n>`) que apuntan a (conexión, sesión, lector del
  trabajador): un id no puede nombrar el cursor de otra sesión, y al perderse la sesión se olvidan
  todos a la vez (`alSoltarSesion`, un `WeakMap` por sesión). Tope `MAX_LECTORES_POR_SESION`.
- Un `CursorNotFound` lo relanza el trabajador con `skip`, que es quien tiene la consulta; «más»
  no recompila el filtro. La posición de un error de sintaxis se pasa de puntos de código a UTF-16.
- Cancelar es `DBX_CHANNELS.CANCELAR` con el `peticionId`: el main aborta con `signal` y cada
  operación lleva `comment: 'tessera:<id>'` por si hiciera falta `killOp`.
- `posicion` de un `DbErrorSql` es relativa al texto de la consola (el main suma `desplazamiento`) o,
  con `campo` (`'filtro' | 'proyeccion' | 'orden'`), al texto de la barra de la colección.
- Solo se recuerdan los CAMPOS de la muestra de cada colección (cuestan un `$sample`); el árbol
  son dos listas baratas y no hay caché de catálogo como en SQL.
- «Enviar» es todo o nada con transacciones y, en un servidor suelto, uno a uno parando en el
  primer fallo y con confirmación si hay más de un cambio.

## Consecuencias

El contrato es hoja del grafo de imports (solo `import type`) y ES2020: lo importan main, preload y
renderer. Hereda su ciclo de vida de `gestorFamilia.ts` (ver [explorador-familias.md](explorador-familias.md)).

## Descartes

- Que valide el gestor: recibe peticiones ya tipadas y se prueba con ellas. Parametrizar
  `GestorSesiones` por familia: 4.800 líneas que hablan de transacciones para no usar ninguna.
