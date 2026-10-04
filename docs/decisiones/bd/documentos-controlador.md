# Documentos: el main valida la forma y decide la política, y el renderer solo ve ids de lector del main

- **Estado:** vigente
- **Ámbito:** `documentos/ControladorDocumentos.ts`, `documentos/ipc.ts`, `documentos/validacionPeticion.ts`, `documentos/GestorDocumentos.ts`

## Contexto

El contrato de documentos (`shared/db-documentos-ipc.ts`) no tiene catálogo de esquemas ni
transacciones que atraviesen sentencias: tiene su propio controlador y gestor, y el main enruta
por familia una vez, al registrar los canales. Una consulta de MongoDB deja un cursor vivo en el
trabajador, que se pierde con su sesión.

## Decisión

- `atender` es el punto único de las operaciones con conexión: comprueba que existe, es de
  documentos y es del perfil; valida la FORMA (tipos, textos acotados, enteros en rango), y lo que
  no cuadra es `interno` «Petición inválida» sin tocar el gestor; y decide la POLÍTICA.
- Política (`politicaDe`): `soloLectura` es la impuesta (`soloLecturaImpuesta.ts`; la casilla
  `readonly` es de los agentes), `produccion` sale del entorno y `confirmado` de la petición. La
  aplica el trabajador con su clasificador; el gestor solo la transporta.
- Filtro guiado y orden de cabecera se validan con el mismo compilador que usa el gestor; uno
  guiado junto a un `filtro` de texto no vacío es «Petición inválida».
- El renderer solo ve ids del main (`docs:<n>`) que apuntan a (conexión, sesión, lector del
  trabajador): un id no puede nombrar el cursor de otra sesión, y al perderse la sesión se olvidan
  todos a la vez (`alSoltarSesion`, un `WeakMap` por sesión). Tope `MAX_LECTORES_POR_SESION`.
- Un `CursorNotFound` lo relanza el trabajador con `skip`, que es quien tiene la consulta; «más»
  no recompila el filtro. La posición de un error de sintaxis se pasa de puntos de código a UTF-16.
- Solo se recuerdan los CAMPOS de la muestra de cada colección (cuestan un `$sample`); el árbol
  son dos listas baratas y no hay caché de catálogo como en SQL.
- «Enviar» es todo o nada con transacciones y, en un servidor suelto, uno a uno parando en el
  primer fallo y con confirmación si hay más de un cambio.

## Consecuencias

Hereda su ciclo de vida de `gestorFamilia.ts` (ver [explorador-familias.md](explorador-familias.md)).

## Descartes

- Que valide el gestor: recibe peticiones ya tipadas y se prueba con ellas. Parametrizar
  `GestorSesiones` por familia: 4.800 líneas que hablan de transacciones para no usar ninguna.
