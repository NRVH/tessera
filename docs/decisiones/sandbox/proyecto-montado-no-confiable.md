# Lo que el contenedor puede escribir no decide qué hace el main en el host

- **Estado:** vigente
- **Ámbito:** `src/main/archivos/rutaReal.ts`, `src/main/archivos/ServicioArchivos.ts`, `src/main/db/memoriaAgente.ts`,
  `src/main/agentes/delegacion/ServicioDelegacion.ts`, `src/main/git/adaptadores/configSegura.ts`,
  `src/main/git/adaptadores/procesoGit.ts`, `src/main/git/adaptadores/procesoCatFile.ts`

## Contexto

El proyecto, el espacio de datos del perfil y la carpeta de la cuenta se montan con escritura en el contenedor del
agente. Un proceso de dentro (por ejemplo, un agente con instrucciones inyectadas desde un repo) puede dejar en
ellos enlaces simbólicos, junctions o configuración de git. El main lee y escribe en esas mismas carpetas desde el
host, con los permisos del usuario: si siguiera esos enlaces o ejecutara esa configuración, el contenedor tocaría el
host sin salir de su montaje.

## Decisión

- **Rutas del proyecto.** Lo que el main escribe, crea, copia, mueve, borra, abre con la app del sistema o arrastra
  comprueba, además de la guarda léxica, que la ruta sigue dentro del proyecto al seguir enlaces y junctions
  (`sigueDentroDeLaRaiz`): se resuelve la ruta real del ancestro que exista y se exige que caiga bajo la ruta real de
  la raíz. Un enlace colgante cuenta como fuera, porque escribir por él crearía su destino. Borrar, renombrar o mover
  el origen miran solo la carpeta que lo contiene: un enlace plantado tiene que poder quitarse sin tocar lo que hay al
  otro lado. Leer, listar y revelar siguen enlaces: lo leído solo lo enseña la ventana, no llega al contenedor, y así
  un `npm link` o un monorepo enlazado se pueden mirar. Solo se verifica: la ruta con la que se opera no cambia, así
  que un proyecto abierto por una ruta con enlaces (`/tmp` en macOS, una junction en Windows) sigue igual. Si la ruta
  real de la raíz no se puede resolver (algunos discos virtuales o de red), vale solo la guarda léxica: bloquear
  dejaría el proyecto inservible. Queda un hueco de carrera entre la comprobación y la operación.
- **Archivos que el main escribe en carpetas compartidas.** El `CLAUDE.md` y el `AGENTS.md` del contexto se leen sin
  seguir enlaces (con `O_NOFOLLOW` donde existe) y se escriben con un temporal de nombre imposible de adivinar, `wx`
  y `rename`, que sustituye un enlace en vez de seguirlo. La orden de una tarea delegada no se escribe si la carpeta
  de órdenes es un enlace, y se crea con `wx`.
- **Git en el host.** Antes de cada git del main (la cola, `rev-parse` fuera de ella y los `cat-file`) se lee la
  configuración con su ámbito (`--show-scope`), y las claves de los ámbitos del repo (`local` y `worktree`, el
  `config.worktree`) que hacen ejecutar algo (fsmonitor, filtros, drivers de diff y de merge, diff externo, firma: su
  programa, su formato, el comando de la clave y si se firma) se anulan con el valor del ámbito global o del sistema
  (así el filtro de LFS del usuario sigue funcionando) o con uno inocuo. Van por el entorno
  (`GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n`), que manda sobre el repo igual que `-c` pero no parte la clave en el primer
  `=`: un filtro llamado `a=b` se escaparía de `-c`. `textconv` y el diff externo se apagan además con `--no-textconv
  --no-ext-diff` en `diff`, `diff-tree`, `log` y `show`: un `textconv` vacío rompe el diff. Lo leído se cachea por repo
  mientras no cambie ninguno de sus archivos de configuración ni los que incluye (por inode, tamaño, `mtime` y `ctime`:
  el contenedor puede devolver un `mtime` a su valor, el `ctime` no), y varias órdenes a la vez esperan la misma
  lectura. Si la configuración no se puede leer, se anulan al menos fsmonitor y el diff externo.
  En `ejecutarGit`, el entorno se prepara dentro de la cola, después de comprobar cancelación y vigencia;
  `git config` tiene un techo de veinte segundos y 8 MiB de salida. Las lecturas preparan y ejecutan en su
  misma tarea. Las escrituras preparan primero el entorno encolado, autorizan fuera de una plaza ocupada
  (la inspección tiene sus propias consultas encoladas) y encolan la ejecución. El preflight de los lotes
  también encola la preparación. `AsyncResource.bind` conserva el contexto de autorización en cada fase.
- **Hooks.** Cada git recibe por entorno un `core.hooksPath` que apunta a una carpeta vacía de `userData`.
  Solo las escrituras del IPC de la interfaz abren un contexto de autorización; las escrituras de fondo,
  agentes, delegación y worktrees permanecen apagadas. La interfaz actual no ofrece checkout, merge ni rebase:
  cualquier futura acción que permita hooks debe abrir explícitamente ese contexto y resolver el pendiente.
  Los lotes inspeccionan todos sus repositorios antes de escribir; omitir apaga los hooks de toda la operación.
  La selección depende de la operación: preparar y despreparar solo pueden disparar `post-index-change`;
  descartar mediante checkout añade `post-checkout` y `reference-transaction`; commit incluye los del índice,
  pre-commit, prepare-commit-msg, commit-msg, post-commit, post-rewrite, reference-transaction y pre-auto-gc.
  Ignorar en .gitignore o exclude no abre un permiso: no escribe mediante git. Las órdenes desconocidas
  conservan todos los hooks. La tabla está en `hooksDeOperacion`; cualquier nueva escritura debe revisarla.
  La inspección se comparte una vez por petición y repo, también en lotes, y sus consultas pasan por la cola
  única con un techo de veinte segundos. La cola vincula cada trabajo al contexto de quien lo encola.
  Antes de ejecutar se lee la carpeta efectiva (incluidos `local` y `worktree`); una ruta relativa parte de la
  raíz del worktree, y sin configuración se usa `rev-parse --git-path hooks`. Un hooksPath efectivo de ámbito
  global o sistema solo se considera del usuario si su destino resuelto queda fuera del repo y directorio
  común: una ruta relativa interna o un enlace de vuelta al proyecto requieren permiso.
  Los permisos se guardan atómicamente en `userData`, por ruta real
  del git-common-dir, carpeta y nombre, con SHA-256 del contenido. Se comprueban también hooks sin permiso de
  ejecución en Windows, incluido el respaldo `.exe` cuando falta el nombre sin extensión. No se buscan
  `.cmd`, `.bat` ni `.com`: [find_hook de Git for Windows](https://github.com/git-for-windows/git/blob/v2.47.0.windows.2/hook.c)
  solo añade `STRIP_EXTENSION` (en esta plataforma, `.exe`); se reproduce con un ejecutable nativo en la prueba.
  El pendiente incluye una ficha de un uso, ligada al emisor, repo y argumentos, que
  caduca en dos minutos. Al resolverla se vuelve a leer el disco: contenido o carpeta distintos vuelven a pedir
  permiso. Una ficha caducada y todavía ligada a esa petición devuelve otro pendiente, tanto al aceptar como
  al omitir; el preload vuelve a mostrarlo mediante su bucle de reintentos. Las fichas ya consumidas, ajenas o
  con otros argumentos se rechazan. Omitir conserva los hooks apagados; cancelar no repite la escritura.
  Al emitir una ficha se barren las caducadas; se conservan como máximo 512, retirando las más antiguas.
  El contenido se muestra como texto en el diálogo, limitado a 32 KiB por archivo.
  Los bytes completos leídos y aceptados se copian a una carpeta privada por petición y repo en `userData`;
  `core.hooksPath` apunta a esa copia y se borra al terminar la petición. No se vuelve a copiar desde el proyecto
  después de comprobar la huella. Así cambiar el archivo original después de autorizar no cambia el ejecutado.
  Se copia la carpeta efectiva completa, también `.git/hooks` y un hooksPath local fuera del árbol: los
  auxiliares vecinos a `$0` conservan su disposición. Los `*.sample` que crea `git init` quedan fuera: git no
  los ejecuta, y un hook que los cargue falla en la copia en vez de correr algo sin aceptar. No se incluye un
  padre arbitrario. Para `.husky/_/`
  se incluyen esa carpeta y solo los archivos del padre que tengan nombre de hook; otros archivos del padre
  no forman parte del permiso. Se muestran también los auxiliares y la huella del conjunto incluye nombres,
  modos y contenido: cambios, adiciones y eliminaciones renuevan el permiso.
  La inspección usa `lstat`, rechaza enlaces y tipos especiales, y no sigue directorios internos enlazados fuera
  del repo. Los archivos se abren sin seguir enlaces donde el sistema lo admite y se comprueba su identidad.
  Se limitan a 256 archivos, 1 MiB por archivo, 8 MiB totales, 1024 entradas y 32 niveles. Las lecturas están
  acotadas incluso si crece un archivo; los `*.sample` también cuentan para el tope de entradas. Un enlace o
  cualquier exceso produce un pendiente incompleto (`HooksPendientes.incompleta`): el diálogo nombra el elemento
  que lo impide y no ofrece aceptar; se puede corregir la carpeta o continuar sin hooks. Un hook que sea un
  enlace (a un script versionado, por ejemplo) entra en este caso. No se copian bytes de esa inspección.
  Las rutas calculadas desde `$0` hacia el repo o fuera del conjunto copiado no se conservan; esos hooks
  requieren adaptar sus rutas. El directorio de trabajo de git sí sigue siendo el repo.
  Ejecutar un hook sigue siendo ejecutar código con acceso al host: puede abrir otras rutas del proyecto,
  lanzar programas o buscar scripts por el directorio de trabajo. No se intenta deducir todas sus dependencias
  ni aislarlo; ese código externo a la copia sigue siendo mutable. La aprobación debe tener en cuenta esas
  llamadas. Los hooks externos del usuario conservan su ruta y su responsabilidad de mantenimiento.

## Consecuencias

- Escribir por una ruta del proyecto que apunta fuera por un enlace da el mismo error que una ruta fuera del proyecto.
- En la vista de diferencias de Tessera no se aplican los `textconv` del usuario (por ejemplo, el de documentos de
  Office): se ve el diff del contenido tal cual.
- Cada git del main cuesta un `stat` por archivo de configuración, y un `git config` más cuando cambia uno.
- Los submódulos tienen su propia configuración: Tessera los trata como repos aparte (`escanearRepos`), cada uno con su
  neutralización.
- `test:ruta-real`, `test:agent-memory` y `test:config-segura` fijan las tres guardas con el disco y el git reales;
  la última incluye un control que demuestra que el mismo repo sí ejecuta lo plantado con git a secas.
