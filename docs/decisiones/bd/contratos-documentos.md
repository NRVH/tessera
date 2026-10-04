# El contrato de documentos es aparte del SQL y sus valores cruzan como texto del shell

- **Estado:** vigente
- **Ámbito:** `src/shared/db-documentos-ipc.ts`, `src/main/db/documentos/`

## Contexto

`db-explorador-ipc.ts` es SQL de punta a punta (esquemas, carpetas por tipo, DML de «Enviar»,
binds, EXPLAIN); un documento no tiene nada de eso. Meter MongoDB allí obligaba a cada handler SQL
a preguntar por la familia.

## Decisión

- Contrato propio: el main enruta por familia una sola vez y cada contrato habla de su modelo. Se
  reutiliza lo común: la conexión (`db-ipc.ts`), `DbRespuesta` y `DbErrorSql`, `DBX_CHANNELS.CANCELAR`,
  `DESCONECTAR`, `SESIONES` y los archivos de consola del espacio de datos.
- Los documentos cruzan como TEXTO en notación del shell (`texto`), con los tipos numéricos
  explícitos ([mongodb-conexion-y-tipos.md](mongodb-conexion-y-tipos.md)). El renderer no carga `bson`.
- La tabla son los campos de primer nivel de una muestra (`$sample` de 100). Una columna puede traer
  varios tipos, así que el tipo va por celda (`DbDocCelda.tipo`), no por columna.
- La identidad de un documento es su `_id` en EJSON canónico (`idEjson`), que es lo que vuelve en
  «Enviar»: nunca el texto de la celda.
- Barreras, con el renderer preguntando y el main como segunda: escritura en producción sin
  `confirmado` responde `motivo: 'produccion'`; más de un cambio en un servidor sin transacciones y
  sin `confirmadoSinTransaccion`, `'sinTransaccion'`; escritura en una conexión de solo lectura,
  `'soloLectura'`. El renderer no clasifica sentencias: manda, y si vuelve `'produccion'` pide la
  confirmación y reenvía.
- Cancelar es `DBX_CHANNELS.CANCELAR` con el `peticionId`: el main aborta con `signal` y cada
  operación lleva `comment: 'tessera:<id>'` por si hiciera falta `killOp`.
- `posicion` de un `DbErrorSql` es relativa al texto de la consola (el main suma `desplazamiento`) o,
  con `campo` (`'filtro' | 'proyeccion' | 'orden'`), al texto de la barra de la colección.

## Consecuencias

Hoja del grafo de imports (solo `import type`) y ES2020: lo importan main, preload y renderer.
Controlador y política: [documentos-controlador.md](documentos-controlador.md).
