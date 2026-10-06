# Preparar, descartar, commit e ignorar escriben en el repo del usuario: son datos

- **Estado:** vigente
- **Ámbito:** las escrituras de `src/main/git/` y `features/explorador/ofertaMenuArbol.ts`

## Contexto

Un fallo aquí borra o reescribe trabajo del usuario: ninguna de estas guardas es decorativa.

## Decisión

- **Un pathspec nombra UN archivo** (`rutasRepo.ts`): `relDeArchivo` (pura: `''`, `.`, `..`, barra
  final) y `repoPathDeArchivo` (el `''` traducido es `:/`, el repo ENTERO). Una carpeta sin barra la
  delata git (algo listado DEBAJO), uno y lote, al preparar, quitar y descartar. Sin recortar blancos.
  Pathspec `:(top,literal)p` (sin glob). **`-z` siempre** que git devuelva rutas (`core.quotePath`).
- **Un `writeLock` por repo** para preparar, quitar, descartar, commit e ignorar; lecturas fuera.
- **Descartar, uno o lote, clasifica igual** (`ls-files -t -s`, `ls-tree HEAD`, el disco): fuera de
  HEAD se borra (confirmando; rastreado, antes `rm --cached`); en HEAD, `checkout HEAD --` sin
  confirmar. Se RECHAZA lo que ese checkout pisaría o no toca: conflicto (etapa ≠ 0), `skip-worktree`,
  carpeta donde HEAD pone archivo o al revés, y la copia de un borrado preparado salvo que sus BYTES
  sean el blob crudo o lo que escribiría checkout (`cat-file --filters`; un enlace, crudo o `readlink`).
  Si git falla se ABORTA el repo: «sin seguimiento» propondría borrar lo que git tiene. «Sin commits»
  exige rama sin ref, sin `packed-refs` ni registro (una ref con basura también da `rev-parse` 1).
- **Lote:** bajo el candado de cada repo se clasifica y se REVIERTE con esa foto, antes del diálogo
  (que corre sin candado); UNA confirmación FUERA de todo candado y solo si hay algo que borrar;
  luego, bajo el candado, se RECLASIFICA lo que se iba a borrar («El archivo cambió de estado…»).
- **Ni el explorador ni el panel ofrecen descartar en conflicto** (`enConflicto`: eje `U`, AA o DD).
- **Ignorar no saca de la lista a lo rastreado** (va a `omitidos`). El universo de una carpeta
  «entera» viene de `ls-files --cached --others`; si falla, no colapsar (ignorar de menos).
- Un repo pedido por el renderer solo vale si es la contenedora o uno de los que ofrece el escaneo
  (`shared/reposAnidados.ts`): con `.git`, dentro de la profundidad, sin bajar por carpetas
  excluidas y sin otro repo por encima. El repo dueño de una ruta se decide con la misma regla, así
  que el main nunca opera en un repo que la vista de git no enseña.
- El canal `COMMIT` no tiene consumidor en la interfaz; se conserva porque lo recorre `test:git-stage`.

## Descartes

- Confirmar en vez de rechazar lo que el checkout pisaría: el diálogo dice «borrar», no «sustituir
  esta carpeta» ni «perder estos cambios», y tras mover o quitar de preparados el descarte normal vale.
- Mantener los candados durante el diálogo del lote: cada repo esperaría a los demás.
- Comparar con `hash-object` (lo que git ve tras el filtro clean: uno con pérdida o `ident` esconden
  trabajo) o con `cat-file --batch --filters` (en git 2.47 la cabecera da el tamaño SIN filtrar).
- `git rm --cached` para «ignorar» lo rastreado: modifica el repo y el equipo lo vería como borrado.
