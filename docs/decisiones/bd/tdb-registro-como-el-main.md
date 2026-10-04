# `tdb` lee el registro como el main y no usa lo que el main no usa

- **Estado:** vigente
- **Ámbito:** `src/tdb/tdb.cjs`, `tdbRegistro.cjs`, `tdbConexiones.cjs`, `tdbConectar.cjs`, `tdbContexto.cjs`

## Contexto

`tdb` es un CJS suelto que lee `db-connections.json` en cada invocación, sin el código del main.
Con la regla a medias, veía conexiones que la app no enseña (una `version: "2"`, un principal
corrupto con `.bak` bueno) y las usaba: una SQLite acabó en el adaptador de PostgreSQL y llegó a
un PG local; una SQL Server habló el protocolo de PG contra el 1433; una copia pegada a mano con
el id de otra abría el servidor de la otra con su contraseña (el secreto va por id).

## Decisión

- La lectura es una COPIA de la regla del main (`leerRegistroConexiones`): el `.bak` si el
  principal no es JSON, formato ajeno («no se interpreta nada») y registro ilegible, cada uno con
  su aviso. Un principal que no se deja abrir es ilegible aunque el `.bak` se lea, como en el main.
  `--json` lleva la misma marca (`formatoAjeno: true` más `aviso`) para las dos causas.
- Una entrada solo se usa si tiene motor con adaptador, la forma que el main reconoce
  (`tieneFormaDelMotor` de `motores.cjs`) y no repite el id de una anterior (`ID_REPETIDO`, un
  `WeakMap` para que `ls --json` saque la entrada tal cual). Se decide al BUSCAR la conexión, antes
  de la guardia de solo lectura y de la contraseña, cuyos consejos serían falsos para ella.
- Motor sin adaptador dice «actualiza Tessera»; forma no reconocida dice «versión más nueva o
  edición a mano», porque puede ser cualquiera de las dos; nunca se sugiere borrar. El error
  `--json` tiene el mismo contrato que la marca de `ls --json` (booleano, y el motor en `motor`).
- Una entrada sin alias ni id se nombra «(sin nombre)», nunca «undefined».

## Consecuencias

- Cambiar la regla del main obliga a cambiar la copia (`test-shim` y `test-motores-tdb` la fijan).
- La huella del destino y la contraseña por id están en `puente-huella-del-destino.md`.

## Descartes

- Un `require` de la regla del main: `tdb` corre sin él, con el Node de Electron y sin compilar.
- Distinguir por motor con `motor === …` suelto: por datos en `motores.cjs` (`tdb-motores-por-datos.md`).
