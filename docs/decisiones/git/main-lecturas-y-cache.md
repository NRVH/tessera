# Los blobs se leen con un `cat-file --batch` por repo y la rama actual se cachea por HEAD

- **Estado:** vigente
- **Ámbito:** `src/main/git/blobs.ts`, `historial.ts` y `adaptadores/{catFileLote,procesoCatFile}.ts`

## Contexto

En Windows, con el antivirus delante, el coste de un diff está en ARRANCAR `git.exe`, no en los
bytes: con un `.jar` de 2,1 MB, dos lados con un proceso cada uno cuestan 206/265/270 ms y en un
solo `cat-file --batch`, 160/164/191 ms. Y un repo de 50.000 commits no se recorre por cada fila.

## Decisión

- Los lados del diff que salen de git se piden en UN `cat-file --batch` por repo y por lote; los de
  `worktree` se leen de disco (puede no estar en ningún objeto, y hay que enseñar lo que hay ahora).
  `blobBytes` es fachada de `blobsBytesLote`: un solo camino. Va fuera de la cola y sin techo de
  tiempo; lo cierra `child.kill()`.
- Dos topes que protegen cosas distintas: 2 MiB en texto (a Monaco) y 50 MiB en binario (a la
  memoria del renderer, con el mismo tope que `FileService`).
- El tope obliga a cortar: un objeto que se pasa se marca truncado, se mata el proceso antes de que
  git vuelque 300 MB y lo que venía detrás se pide en otra tanda.
- El parser (`catFileLote`) es aparte para que los cortes del flujo los decida la prueba. Dos
  trampas con víctima: el salto que separa dos objetos puede abrir el trozo siguiente (se leía como
  cabecera vacía y se perdía el lote) y NO se concatena por trozo (un blob de 40 MB se volvía
  cuadrático).
- `commitsRamaActual`: `rev-list HEAD` en un solo recorrido, cacheado por (repo, sha de HEAD): si
  HEAD se mueve la clave deja de casar y no hace falta invalidar. LRU de 4 repos (cada entrada es la
  historia entera, ~4 MB en 50.000 commits) y se recorta a los hashes que se pintan. Nunca lanza.
- `branchesContaining`: solo «el commit no existe» vale `[]`, y se reconoce porque el HASH aparece
  en el stderr (git traduce sus mensajes). Lo demás sube: `[]` diría «en ninguna rama» de un commit
  que está en `main`.
- Formatos: el separador es `%x00` (Node rechaza un NUL literal en el argv); `%D` va antes de `%s`
  porque `%s` es lo único de una línea; `--decorate=short` explícito (`log.decorate=full` del
  usuario rompería los chips de rama); `--untracked-files=all` en el estado (sin él, una carpeta
  nueva llega como una entrada terminada en `/` y el diff falla con EISDIR).

## Descartes

- Un `cat-file -s` previo por blob: dos arranques de git por lado.
- Devolver la historia entera al renderer: 50.000 cadenas por montaje para una pregunta de pertenencia.
