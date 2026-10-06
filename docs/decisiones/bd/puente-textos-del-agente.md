# Los textos que lee el agente: catálogo frente a montado, producción y quién impone el solo lectura

- **Estado:** vigente
- **Ámbito:** `src/main/db/agentMemoryBlock.ts`, `briefingAgente.ts`, `agentMemory.ts`

## Contexto

El agente no tiene otra forma de saber cómo funcionan las bases que estos textos: el bloque gestionado del
`CLAUDE.md`/`AGENTS.md` del espacio de datos y el aviso de arranque de cualquier agente lanzado por Tessera.
Cambiarlos cambia su conducta; los fijan `test-agent-memory` y `test-entorno-bd-agente` al carácter.

## Decisión

- Sin ninguna base montada, el aviso de arranque no se omite: va uno corto (`AVISO_SIN_BASES`) que dice que
  `tdb` existe, que al arrancar no había ninguna y que se comprueba con `tdb ls` y `tdb help`. `tdb` está en el
  PATH de todo agente lanzado por Tessera, y sin aviso el agente no sabía qué era cuando el usuario lo nombraba.
  Dice «no había ninguna» para que no se ponga a buscarlas, y lo que hay ahora lo da `tdb ls`, porque se montan
  en caliente. Sin puente no se anuncia: `tdb` no podría atender.
- La tabla es el catálogo del perfil, no la lista de lo consultable: el agente ve solo lo montado, y el texto lo
  manda a `tdb ls` (lo vigente, el montaje cambia en caliente) y a pedir que le monten la que falte. Sin decirlo,
  diagnosticaría una avería que no existe cuando `tdb` falle.
- La regla de producción va siempre, también sin ninguna marcada (el bloque solo se regenera al cambiar el registro):
  `tdb` no pasa por el diálogo de confirmación de Tessera, así que la da el texto. La tabla lleva el entorno.
- Con el registro en un formato que esta versión no reconoce, el catálogo dice que no se puede leer, cita el aviso
  del main y producción dice que no se sabe cuáles son. No se descartó reescribir el bloque sin más («ninguna
  configurada» y «ninguna de producción» serían falsas, la segunda justo la que protege las escrituras) ni
  conservar el de la última vez (un espacio nuevo se quedaría sin instrucciones y uno viejo enseñaría un catálogo
  que `tdb` no ve).
- `consolas/` es del usuario: el agente las lee y no las edita salvo que se lo pidan, o le aparecería «el archivo
  cambió fuera de Tessera».
- La primera línea del aviso tiene dos redacciones: en un proyecto, el texto de siempre; en el espacio de datos, el
  agente se llama «agente de datos» y no «este proyecto» (buscaría un proyecto que no abrió). No se nombra el
  espacio por su carpeta interna.
- Quién impone el solo lectura sale del descriptor del motor (`quienImponeSoloLectura`): el servidor, Tessera (base
  de archivo), el clasificador de `tdb` (SQL Server, con su garantía real: un usuario con solo `db_datareader`) o la
  lista blanca (MongoDB, Redis). Sin ningún motor de esas familias el texto no cambia ni un carácter.
- Los destinos salen de `destinoLegible` del descriptor, no de copias a mano: un motor sin host habría salido «:0».

## Consecuencias

- Cambiar una frase aquí obliga a revisar `src/tdb/tdb.cjs`, que hace las mismas distinciones en sus mensajes.
