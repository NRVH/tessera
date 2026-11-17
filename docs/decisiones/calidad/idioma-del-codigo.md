# El código se escribe en español, lo que se queda en inglés está escrito y una guardia impide añadir inglés propio

- **Estado:** vigente
- **Ámbito:** `scripts/calidad/test-idioma.mts`, `scripts/calidad/idioma*.mts`,
  `scripts/calidad/glosario-identificadores.tsv`, `scripts/calidad/excepciones-idioma.tsv`, `scripts/calidad/antesDelCommit.mjs`, `CONTRIBUTING.md`,
  `docs/ESTANDAR_CODIGO.md`

## Contexto

Una regla de idioma con una excepción abierta («lo que ya está en inglés se queda») no se sostiene: cada
nombre inglés autoriza al siguiente, y el mismo concepto acaba con dos nombres (`perfilId` y `profileId`)
que quien lee tiene que reconocer como uno solo. Hace falta lo contrario: escribir qué va en cada idioma,
con una frontera que se pueda comprobar, y que nada nuevo cruce esa frontera sin que alguien lo decida.

## Decisión

- **Español**: identificadores, nombres de archivo y carpeta, clases CSS, variables `--*`, atributos `data-*`,
  comentarios y mensajes de commit. Los textos de la interfaz, en español y en inglés
  ([app/idioma.md](../app/idioma.md)).
- Un identificador inglés se traduce con el glosario, `scripts/calidad/glosario-identificadores.tsv`. El rol
  va delante, en español (`ServicioGit`, `OpcionesBusqueda`), y los sufijos `Request` y `Result` no son una
  convención: se traducen (`PeticionDiff`, `ResultadoDiff`).
- Un dato guardado conserva su nombre de disco en el tipo que describe el archivo (`profileId`); el resto del
  código usa el español (`perfilId`). Las claves guardadas las fija
  [claves-persistidas.md](claves-persistidas.md).
- **Qué se queda en inglés**, y solo ello:

| Se queda en inglés | Qué entra | Ejemplos |
|---|---|---|
| 1. Lo impuesto | Opciones, propiedades, eventos y métodos de las API de Node, Electron, el DOM, React, Monaco, xterm, Zustand y Playwright, también cuando un tipo o una clase propios los implementan; las propiedades que copian un evento del DOM; las variables del sistema | `recursive`, `timeout` de `execFile`, `onClick`, `children`, `dispose`, `ctrlKey`, `HOME` |
| 2. Los nombres de otros programas | Las claves de un formato ajeno que Tessera lee y no escribe, aunque el tipo que las describe sea propio | `input_tokens`, `resets_at`, `session_id`, `winningPlan` |
| 3. Los contratos que ya existen | Cadenas de canal IPC; claves y literales guardados en disco; órdenes, banderas y códigos de `tdb` y `tssh`, también las nuevas, que siguen su vocabulario; variables `TESSERA_*`; etiquetas de Docker; ProgID; AppUserModelId | `profileId`, `secretEnc`, `openProjects`, `agent-accounts.json`, `tssh run` |
| 4. Las convenciones | El prefijo `use` de los hooks; el `on` de los callbacks en props (`onCerrar`); el `set` del setter de `useState` (`setAbierto`); `Props`, que va delante como las demás palabras de rol (`PropsAviso`); las constantes `XXX_CHANNELS`; los archivos `index.ts`, `app.ts`, `store.ts`, `ipc.ts`, `main.tsx`, `*-ipc.ts`, `test-*.mts`, `*.spec.ts`; las carpetas `src/main`, `src/preload`, `src/renderer`, `src/shared`, `scripts`, `features`; los scripts de npm de ciclo de vida y de herramienta (`build`, `dev`, `lint`, `typecheck`, `test:e2e`); el molde de las pruebas | `useBusqueda`, `onCerrar`, `setAbierto`, `hr`, `check`, `pass`, `evidence`, `results`, `allPass`, `failed`, `detail`, `VEREDICTO` |
| 5. Los términos del oficio | La lista cerrada de las filas `se-queda` y `abreviatura` del glosario, en minúscula y en su sitio español; las palabras que se escriben igual en español no se marcan nunca. Un término nuevo entra si el código español ya lo usa dentro de nombres españoles y el repo no tiene palabra para ese concepto | `commit`, `diff`, `hash`, `stage`, `worktree`, `shell`, `prompt`, `buffer`, `host`, `sandbox`, `workspace`, `driver`, `regex`, `editor`, `pane`, `popover`, `toast`, `placeholder`, `layout`, `scroll`, `zoom`, `login`, `cli`, `ok`, `info`, `log`, `dir`, `config`, `abs`, `ext`; abreviaturas admitidas: `req`, `res`, `msg`, `err`, `ev`, `deps`, `args`, `params`, `ctx`, `cfg`, `tmp`, `idx`, `len`, `buf`, `fn`, `cb` |
| **Todo lo demás, en español** | Las palabras de rol delante, las clases CSS y las variables `--*`, los `data-*` y las órdenes nuevas de `tctx` | `rutaArchivo`, `pestanasEditor`, `ultimoEventoEn`, `PeticionDiff` |

## Cómo se hace cumplir

- Los identificadores exactos `set`, `get` y `has` se conservan como nombres de API de colección o almacén.
  El prefijo del setter se conserva también en su tipo (`SetEstado`); el resto del nombre se evalúa igual
  que en `setEstado`: `setQuery` se marca y propone `setConsulta`. `getWindow` propone `obtenerVentana`;
  `readWindow` propone `leerVentana`. `check` se conserva en el molde de pruebas; como verbo propio se
  traduce por `comprobar`.
- `npm run test:idioma` corre en el `pre-commit` (`--commit`). Compara las declaraciones de los archivos de
  código del índice con las de `HEAD` y cuenta los nombres en inglés propio que el commit añade y los que
  quita. Un nombre que cambia de archivo, o un archivo que se renombra, no cuenta.
- Un nombre es inglés propio solo con evidencia positiva: contiene una palabra que el glosario traduce, o una
  palabra inglesa conocida que no está en la lista de lo que se queda. Una palabra desconocida nunca es un
  hallazgo.
- Con un saldo de 1 o más el commit se detiene para impedir que aumente el inglés propio. Con un saldo de 0 o negativo pasa, pero
  si añade algún nombre en inglés propio (que no compense uno quitado) lo avisa igual y lista esos nombres: el
  criterio del saldo es que el total no suba, no que lo nuevo quede oculto. Cada nombre sale con su archivo y su
  línea y con la traducción que propone el glosario. La propuesta traduce las palabras y antepone el rol final
  en nombres Pascal o camel (`SearchService` → `ServicioBusqueda`, `searchOptions` → `opcionesBusqueda`).
  `Props` y el `store` de la biblioteca de estado conservan su convención. Conserva los dígitos, `_` o `#`
  inicial y el prefijo `data-`; si el orden es ambiguo o no puede formar un nombre válido, dice
  «sin propuesta automática» en vez de proponer otro. Se traduce el nombre o se declara el vocabulario o la
  excepción que corresponde, en el mismo commit. `se-queda` solo admite palabras válidas en todo el proyecto;
  las palabras inglesas propias entran como `se-traduce` con su traducción.
- Los nombres propios y formatos indivisibles se declaran como `compuesto` en el glosario, sin traducción.
  Se comparan con su escritura exacta y con límites de palabra dentro del identificador: no liberan sus
  palabras sueltas ni otras combinaciones de ellas.
- Se prefiere la exención estructural cuando el código demuestra el contrato: miembros de clases e interfaces
  que heredan tipos externos, atributos del DOM y claves persistidas. Lo que no se deduce se declara en
  `excepciones-idioma.tsv`: ruta exacta del archivo, contenedor con nombre más cercano (tipo, interfaz, clase
  o función; vacío en el módulo), identificador exacto y categoría obligatoria. Una función flecha toma el
  nombre de su variable. Las categorías son `api-ajena` para miembros impuestos por una API; `formato-ajeno`
  para nombres de un formato externo; `clave-guardada` para claves de disco; `cruza-proceso` para contratos
  entre procesos; y `nombre-propio` para nombres indivisibles de programas o formatos en ese ámbito.
  Una variable local o un parámetro solo admite `clave-guardada` o `cruza-proceso`.
- Las excepciones no liberan homónimos en otro archivo o contenedor. Una fila mal formada, repetida, de categoría
  inválida o sin declaración actual hace fallar la guardia con su línea: una excepción sin uso podría autorizar
  por accidente un nombre futuro. El recuento valida todas las excepciones aunque se pida otra carpeta;
  el pre-commit valida contra el índice los archivos afectados y, si cambian las excepciones, todos sus archivos,
  en una lectura conjunta. El historial aplica los
  datos actuales sin exigir que las declaraciones actuales existan en versiones anteriores.
- Una palabra seguida de dígitos que el glosario conoce entera (`win32`, `base64`, `utf8`, `sha256`, `x64`) es ese
  término y no se marca; si el glosario no la conoce, se evalúa la palabra sin los dígitos.
- Mira variables, parámetros, funciones, clases, tipos, enumerados y miembros. No mira las propiedades de los
  objetos literales, la desestructuración ni las importaciones: su nombre lo fija el tipo o el módulo de
  origen, que se revisa donde se declara. Una clave guardada en disco solo se exime como propiedad de un tipo:
  una variable nueva `profileId` se marca.
- Por encima de 300 archivos de código en el commit, o de 15 segundos (las órdenes de git incluidas), no mide ni
  bloquea y lo dice: el coste crece con cada archivo (unos milisegundos cada uno) y un cambio de ese tamaño es un
  renombrado o una migración generada, con sus propias comprobaciones.
- Mientras hay un merge en curso (existe `MERGE_HEAD`) no mide ni bloquea y lo dice: el commit que lo cierra
  trae lo de la otra rama, que no escribe quien lo cierra. Las ramas se miden cuando se commitean.
- Un fallo propio de la guardia no detiene un commit: si el análisis de un archivo falla, se nombra ese archivo,
  se salta y el resto se mide. Una lista de claves o un glosario mal formados sí lo detienen, porque medir con
  datos a medias daría veredictos falsos. Los errores de excepciones tampoco se omiten como fallos de análisis.
- `npm run test:idioma -- <carpeta>` certifica que no queda inglés propio en esa carpeta, y sin argumentos
  informa del total del repo sin fallar. `-- --historial <n>` mide los últimos `n` commits que haya, hasta `n`
  (un clon superficial tiene pocos); `n` es un entero de 1 en adelante.
- Los datos son deterministas y viven en el repo: las excepciones, el glosario y `claves-persistidas.tsv`, que se lee y valida con
  el mismo lector que su guardia y de la que solo cuentan las claves vigentes. La guardia no lee nada de fuera ni
  usa la red.

## Consecuencias

- Los nombres ingleses que ya existen no se renombran por esta guardia: se traducen al tocarlos o en un
  cambio dedicado, y mientras tanto no cuentan porque están antes y después del commit.
- Una API ajena copiada en un tipo propio sin relación estructural explícita necesita una excepción con alcance.
- No ve lo que no declara: un nombre que llega por desestructuración o como propiedad de un objeto literal.
- La exención de las claves guardadas es más ancha que el tipo que describe cada archivo: exime cualquier
  propiedad o método, de cualquier tipo o clase, cuyo nombre coincida con el de alguna clave vigente de
  `claves-persistidas.tsv` (`name`, `type`, `kind`, `user`…), sin comprobar que ese tipo sea el que se guarda.
  Un nombre inglés que casualmente coincide con una de esas claves entra sin aviso como miembro; como variable
  o parámetro sí se marca. Estrecharla pide resolver tipos y, hecha a medias, llenaría de avisos los nombres más
  comunes.

## Descartes

- Marcar toda palabra que el glosario no conoce: la mayoría son términos propios del dominio o palabras
  españolas.
- Un archivo de recuentos por carpeta contra el que comparar: se desactualiza sin que nada falle. Comparar
  con `HEAD` no necesita estado.
- Leer diccionarios externos o la documentación instalada para decidir: el resultado cambiaría con el equipo.
