# Los esquemas visibles se cuentan en un módulo compartido, con el esquema por defecto como parámetro

- **Estado:** vigente
- **Ámbito:** `src/shared/dbEsquemas.ts`, `src/shared/db-ipc.ts` (`DbEsquemasVisibles`)

## Contexto

El «N de M» del explorador lo pintan el renderer (insignia, popover con la casilla «Todos», árbol) y lo
calcula el main (`nVisibles`, qué esquemas entran en el índice de autocompletado). Si cada mitad tuviera su
versión, la insignia diría «3 de 40» y el árbol pintaría cuatro.

## Decisión

- Lógica pura en `shared/`, neutral y ES2020.
- `porDefecto` es dinámico («el esquema actual de la sesión»): las funciones reciben su nombre como
  parámetro y no lo guardan, para que cambiar el usuario de la conexión no deje marcado el esquema del
  anterior. Al quitar un esquema desde «Todos» queda una lista con todos menos él, con el por defecto
  representado por la bandera y no por su nombre.
- `resolverVisibles` devuelve solo esquemas que existen, en el orden de `todos`: un nombre guardado que ya no
  existe no cuenta ni se pinta («5 de 4» no puede pasar).
- `contarVisibles` sin la lista completa estima (cuenta los guardados y acota a M): la insignia se pinta
  antes de conectar con `DbConnection.introspeccion`. En cuanto hay lista, manda la lista.
- La casilla «Todos» sigue la convención de toda casilla tri-estado: llena a vacía; vacía o parcial a llena.
- `normalizarEsquemasVisibles` descarta lo inválido entero (modo desconocido, `esquemas` que no es array,
  `porDefecto` que no es booleano) y sanea lo demás (trim, sin vacíos ni duplicados, tope). Un nombre con NUL
  se descarta: el árbol usa NUL como separador de sus claves y los motores no lo admiten.

## Descartes

- Que al desmarcar «Todos» vuelva a «solo el por defecto»: la casilla quedaría en «parcial» justo después
  de pulsarla, que se lee como un fallo.
