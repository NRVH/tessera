# La consola de Redis confirma lo peligroso y la producción de uno en uno, y cada comando viaja con la marca que le corresponde

- **Estado:** vigente
- **Ámbito:** `claves/DbConsolaClavesPane.tsx`, `useEstadoConsolaClaves.ts`, `useArchivoConsolaClaves.ts`,
  `useEjecucionClaves.ts`, `loteClaves.ts`, `useCierreConsolaClaves.ts`, `RegistroClaves.tsx`; el protocolo
  de archivo es el común de `consola/archivoConsola.ts` y `consola/useArchivoConsola.ts`

## Contexto

El main clasifica los comandos y decide la política (ver [claves-controlador.md](claves-controlador.md));
lo peligroso se confirma SIEMPRE, también sin solo lectura. El renderer no clasifica: manda el
comando y pregunta lo que el main devolvió sin enviar. Un comando puede ser a la vez peligroso y de
producción, y el main los devuelve de uno en uno.

## Decisión

- **Preguntar por comando.** Ante `peligroso` se pregunta «¿Ejecutar FLUSHDB?» y se reenvía con
  `confirmadoPeligroso`; ante `produccion`, la confirmación de las otras consolas y `confirmado`.
  Cada marca se pone SOLO tras el diálogo de su motivo y se reenvía tal cual; como mucho, dos vueltas.
  Si el usuario rechaza, el comando queda «No se envió» y el lote para. Un rechazo por solo lectura
  impuesta se enseña y se para (la casilla `readonly` de la conexión es de los agentes).
- **Un comando por línea y registro propio** (ver [ui-claves-comandos-y-registro.md](ui-claves-comandos-y-registro.md)).
- **Stop** cancela por el `peticionId` del comando: el trabajador abandona la conexión o, si el
  comando bloquea (`BLPOP`), lo suelta con `CLIENT UNBLOCK`. Pasado `ESPERA_STOP_MS` el registro
  ofrece «Forzar», que pide confirmación antes de cerrar la conexión.
- **El registro conserva su autodesplazamiento en el componente que no se desmonta**: el ref de «pegado
  al fondo» sobrevive a vaciar la lista.
- **Mismas reglas de orden y de dueños que la consola de MongoDB** (ver
  [ui-documentos-consola.md](ui-documentos-consola.md)): hooks en el orden de sus efectos, modelo del
  hook y editor del pane, portal para diálogos y selector. Comparte con ella lo idéntico.

## Consecuencias

El aviso de guardado y de lectura va al registro, no a la Salida. Es el único rasgo propio del archivo
de consola de Redis: el protocolo es el mismo de las tres consolas, con el destino del aviso como
parámetro. Un arreglo de guardar o leer va al común, no a `useArchivoConsolaClaves.ts`.
