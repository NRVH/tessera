# El historial de consultas es privado de Tessera, en JSON Lines por perfil, y tapa los secretos al anotar

- **Estado:** vigente
- **Ámbito:** `HistorialStore.ts`

## Contexto

Cada sentencia de consola que llegó al servidor (bien, con error o detenida) se anota por perfil.
Contiene lo que el usuario tecleó contra bases reales durante meses.

## Decisión

- **Fuera del espacio de datos:** vive en `<userData>/db-historial/`, no en la carpeta que lee el
  agente. Que el agente lo vea no se decide por defecto.
- **Un archivo por perfil, JSON Lines, la entrada más reciente al final:** añadir es un
  `appendFile` de una línea, sin reescribir megas por cada SELECT de un guion.
- **Compactar** al pasar de `tope + margen` entradas o de `topeBytes`, con `writeFileAtomic`, y
  recortar a la misma proporción en las dos cotas. Recortar hasta el mismo `topeBytes` que dispara
  la compactación reescribía el archivo entero en cada sentencia (182 reescrituras en 200).
- **Una cadena de escritura por perfil** (`KeyedMutex`): `writeFileAtomic` usa un `.tmp` de nombre
  fijo y un borrado no puede adelantarse a un añadido en vuelo.
- La primera operación de un perfil lee el archivo (con tope) y desde ahí se sirve de memoria. Una
  línea ilegible (la última, a medio escribir) se salta, y el siguiente añadido empieza con un
  salto de línea.
- **`anotar` tapa las contraseñas** (`taparSecretosSql`) antes de guardar, aquí y no en quien llama.
  Una sentencia más larga que `topeSql` no se guarda: recortarla dejaría un SQL roto que parecería
  re-ejecutable.
- **Borrar** (por ids o todo el perfil) borra también el `.bak` del escritor atómico.

## Consecuencias

No se usa un JSON entero (reescribirlo en cada sentencia) ni SQLite (una dependencia nativa más para
una lista).
