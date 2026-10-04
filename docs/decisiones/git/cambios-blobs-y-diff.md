# La caché de blobs solo retiene lo inmutable y el diff solo es editable si su lado es el disco

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/git/modelo/{blobCache,diffEditability,ladosDelDiff,resolveWorkingDiffTarget,statusBadge,estadoArchivo}.ts`

## Contexto

Abrir un diff pide dos blobs por IPC (un `git cat-file` por lado) y arrancar git es caro en
Windows: el clic tardaba 1-2 s. Pero servir un blob viejo es peor que tardar: enseña otro
contenido del que hay, y el editor puede guardarlo encima del archivo.

## Decisión

- SOLO se retiene lo inmutable: un blob de commit por su hash real (`c:<hash>:<ruta>`), en un LRU
  de 40. Lo mutable (disco, índice, el ref `HEAD`) no se retiene: se comparte la petición EN
  VUELO y se descarta al resolver, así que el siguiente open relee de git. Un fallo no se cachea.
- Las claves mutables llevan el ÁMBITO (contenedora y perfil): la ruta relativa se repite entre
  proyectos, y una petición en vuelo de otro proyecto entregaba su contenido como si fuera el
  propio. Prefijar la clave lo hace imposible; ampliar el dedupe "si el ámbito coincide" llegaría
  tarde. El hash real no lleva ámbito: un SHA es único, compartirlo es correcto.
- El prefetch por hover tiene tope de 4 simultáneos y descarta el exceso (el clic lo traerá); el
  lado de disco no se precalienta porque lo presta el registro de modelos, no esta caché.
- Solo la sección Cambios es editable: su lado derecho es el archivo real. El índice es un objeto
  interno del repo (escribir exigiría `hash-object` + `update-index`) y la historia no tiene
  destino en disco. Un borrado ya sale con lado vacío.
- El contenido en memoria (una entrada de dentro de un comprimido) manda sobre todo y se mira
  PRIMERO: el target sigue describiendo el archivo y, tomado por editable, Ctrl+S escribiría texto
  encima del binario. Y `after.path === target.path` impide que un resolver futuro escriba otro
  archivo.
- «De un solo lado» se deduce de `source === 'empty'`, no de la letra: un commit raíz, un rename
  o un alta de cada eje no se distinguen por la letra. No implica «solo lectura»: un alta del
  disco es de un lado y editable.
- La cabecera del visor nombra los lados («Índice ↔ Disco», «HEAD ↔ Índice») desde
  `etiquetaRevisiones`: `WORKTREE` y `STAGED` son centinelas del id de pestaña, no etiquetas.

## Consecuencias

- Una fuente nueva de lado entra en `classify` como mutable salvo que su identidad sea un hash.
