# MongoDB y Redis heredan un núcleo común de gestor y un rechazo común de conexiones ajenas

- **Estado:** vigente
- **Ámbito:** `gestorFamilia.ts`, `controlador/gestorFamiliaTipos.ts`, `familias.ts`,
  `documentos/GestorDocumentos.ts`, `claves/GestorClaves.ts`

## Contexto

El registro tiene motores de tres familias (`sql`, `documentos`, `claves`). `GestorSesiones` es SQL
de punta a punta (transacciones, esquema de sesión, exportación, candado de archivo) y no sirve
para las otras dos. Sus ciclos de vida de proceso son, en cambio, casi iguales entre sí.

## Decisión

- **`GestorFamilia` es el núcleo común** de los gestores no SQL: un proceso de sesión por conexión
  (`sesion.cjs` + `ProcesoTrabajador`), sesiones `meta`, `datos` y una por consola, cola por sesión
  (cancelar va fuera de la cola), reapertura tras una pérdida (con `reintentar`, solo lecturas y
  una vez; la consola nunca: repetir una escritura a ciegas no es aceptable), forzar, desconectar,
  barrido de lo ocioso, topes (`MAX_PROCESOS`, `MAX_CONSOLAS_VIVAS_POR_CONEXION`) y estado con
  `txModo: 'auto'` y `tx: 'ninguna'`. Lo que cambia por familia va en la configuración del
  constructor y en dos ganchos (`alSoltarSesion`, `alDesconectar`).
- **La configuración va por el constructor, no en campos abstractos:** un campo de la subclase se
  inicializa después de `super()`, y con el type-stripping de `node` redeclararlo lo deja `undefined`.
- **La conexión viaja con el cifrado efectivo** (`tlsEfectivo`); el secreto es opcional (sin
  contraseña guardada se abre con `''`; guardada e ilegible, `sinSecreto`).
- **`familias.ts`:** un camino SQL que recibe una conexión de otra familia no lanza el trabajador:
  responde `motivo: 'driver'` con «Todavía no se puede conectar a <etiqueta> desde esta versión»;
  un controlador de documentos o claves que recibe una conexión ajena responde `motivo: 'interno'`.
  La etiqueta sale del descriptor, nunca de un nombre escrito a mano.

## Consecuencias

No se clona el gestor de documentos para Redis (un ciclo de vida sutil que habría que arreglar dos
veces) ni se mete Redis dentro de él con un `if` por familia.
