# La consola de claves confirma siempre lo peligroso, y la lista de comandos vive una sola vez en el trabajador

- **Estado:** vigente
- **Ámbito:** `claves/ControladorClaves.ts`, `claves/ipc.ts`, `claves/GestorClaves.ts`

## Contexto

Redis comparte el esqueleto del controlador de documentos, pero sus formas no se parecen: SCAN no
deja estado en el servidor, la clave son bytes y hay comandos que no se pueden repetir a ciegas.

## Decisión

- `atender` valida la conexión (existe, es de claves, es del perfil), la FORMA (la base es un entero
  entre 0 y `MAX_BASE_CLAVES`, la clave va en base64 porque una clave de Redis no tiene por qué ser
  UTF-8, la cuenta de SCAN y los trozos del visor acotados, el cursor son cifras) y decide la
  política como en documentos más `confirmadoPeligroso`: lo peligroso se confirma SIEMPRE, también
  sin solo lectura. El trabajador la aplica con las marcas de `COMMAND INFO`.
- **La lista blanca de comandos vive UNA vez**, en `redisComun.cjs`, compartida con `tdb`: dos copias
  de una regla de seguridad divergen. Este controlador no clasifica comandos.
- **Sin lectores:** todos los canales nombran su conexión y el visor pide los trozos con su propio
  `desde`; el cursor de SCAN lo guarda el renderer.
- **Cada consola es una conexión propia** en el trabajador (su `SELECT`, su `MULTI`, su `CLIENT ID`
  para desbloquear). Cancelar abandona la conexión o, si el comando bloquea (BLPOP), lo suelta con
  `CLIENT UNBLOCK`.
- **Errores:** los mismos `TESSERA-*` que documentos, más «peligroso» (la interfaz pregunta y
  reenvía con `confirmadoPeligroso`) y «no admitido» (SUBSCRIBE, MONITOR… no se pueden pintar). La
  posición de un error de sintaxis se pasa de puntos de código a UTF-16 y se hace relativa a la
  consola sumando `desplazamiento`.

## Consecuencias

Las lecturas del árbol y del visor se reintentan una vez si se perdió la sesión; la consola nunca.
No hay un esqueleto genérico compartido con documentos: solo comparten lo que ya vive en
`familias.ts` y `politicaDe`.
