# Estándar de código de Tessera

Cómo se escribe y se organiza el código. Lo que se puede medir lo comprueban ESLint y cuatro
guardias (ver «Cómo certificar un área»); lo demás, la revisión.

## Idioma e identificadores

- Español en identificadores, comentarios, textos de la interfaz y mensajes de commit.
- Los identificadores ingleses que ya existen (`GitService`, `useTabs`…) no se traducen solo
  por idioma. Lo nuevo, en español.
- **Nunca** cambian los nombres de los canales IPC ni las claves que se persisten
  (`workspace-state.json`, conexiones, ajustes): hay datos ya escritos que dependen de ellos.

## Cabecera de módulo

Todo archivo de código (`.ts`, `.tsx`, `.mts`, `.cts`, `.mjs`, `.cjs`, `.js`, `.d.ts`),
pruebas incluidas, abre con una cabecera corta:

```ts
// =============================================================================
// Qué hace el módulo, en una o dos frases.
// De qué depende (y quién lo usa, si eso aclara algo).
// Decisiones: docs/decisiones/<dominio>/<tema>.md
// =============================================================================
```

- Entre 3 y 8 líneas de contenido; los delimitadores no cuentan. Antes solo puede ir un shebang.
- Sin historia ni descartes: lo que pesa va a un ADR; lo demás está en git.
- La línea `Decisiones:` solo si hay ADR, y la ruta tiene que existir.

## JSDoc

En los exports que se usan fuera de su carpeta (servicios, stores, hooks, contratos de
`src/shared/`): una frase. `@param` y `@returns` solo si el tipo no lo dice ya.

## Comentarios

- Un comentario dice el porqué que el código no puede decir. No narra lo que hace la línea
  siguiente ni cómo se llegó a ella («se probó…», «antes…», fechas, incidentes).
- Fuera de la cabecera y del JSDoc, **ningún bloque pasa de 10 líneas** (una racha de `//`
  seguidas o un `/* */`, también en JSX y en CSS). Si hace falta más, es un ADR. JSDoc es solo
  el `/** */` pegado a una declaración; uno que no documenta nada cuenta como bloque.
- Nada de referencias personales ni de empresa: nombres, usuarios, rutas de un equipo,
  direcciones internas.
- El código muerto se borra, no se comenta.

## Menciones a otros productos

Los comentarios no nombran otros productos: IDEs y editores, clientes de bases de datos y de
git, terminales ni sistemas de diseño. Una convención de interfaz se describe por lo que hace
(«Mayús+clic extiende la selección, como en los gestores de archivos»), no por quién la tiene.
Si una decisión lo necesita, va una línea en su ADR, también sin nombrar el producto.

- Se permiten los **formatos** que Tessera implementa (`psql`, `sqlcmd`, `mongosh`, SQL*Plus)
  y los nombres de paquete o de proveedor de una dependencia.
- La regla es para comentarios. Los textos visibles de la interfaz son otra cosa y no los
  mira la guardia.
- La guardia (`test:menciones`) no trae la lista de productos escrita: la recibe de un archivo
  de patrones que no se versiona (ver «Cómo certificar un área»). Sin él, no busca nada y su
  VEREDICTO lo dice («SIN PATRONES: NO SE HA BUSCADO NINGUNA MENCIÓN»).

## Decisiones de peso (ADR)

En `docs/decisiones/<dominio>/<tema>.md`, con la plantilla y el índice de
[`decisiones/README.md`](decisiones/README.md); 40 líneas como mucho. Una decisión es de peso
si revertirla rompería algo que no se ve leyendo el código (un fallo medido, una plataforma,
un dato, la seguridad) o si un colaborador sensato la «arreglaría» por error.

## Límites

| Qué | Límite: aviso | Doble: error |
|---|---|---|
| Archivo (líneas de código) | 400 | 800 |
| Función (líneas de código) | 60 | 120 |
| Complejidad ciclomática | 15 | 30 |

- Se cuentan líneas de **código**: ni blancos ni comentarios. La prosa la vigilan las guardias.
- Pasar el límite se tolera si partir empeora la lectura; pasar el doble, no. Una excepción
  al doble va en `eslint.config.mjs`, para ese archivo y con su motivo.
- Las pruebas (`test-*.mts`, `*.spec.ts`) están exentas de tamaño y complejidad, no de
  cabecera, comentarios ni menciones. Los datos no tienen exención: se parten por secciones.

## Capas del main

```
src/main/<dominio>/
  ipc.ts          registrarIpc<Dominio>(deps): el único sitio con ipcMain del dominio; valida y delega
  <Servicio>.ts   la lógica, sin electron; recibe los adaptadores y el emisor de eventos
  adaptadores/    procesos (git, docker), sistema de archivos, drivers, APIs de electron
  componer.ts     (opcional) la parte de la raíz de composición que compone el dominio
src/main/app/     fontanería de Electron: ventana, menú, instancia única, registro de fallos
src/main/index.ts raíz de composición: crea adaptadores y servicios y registra los ipc.ts
```

Así un servicio se prueba con `node` a secas. Un servicio **no recibe `ipcMain`** ni registra
handlers: recibe un emisor de eventos, y su `ipc.ts` le traduce cada petición. Los canales se
declaran en `src/shared/*-ipc.ts`, y el renderer nunca ve ni envía rutas del host.

Las **raíces de composición** son `src/main/index.ts` (la app), `src/main/relevo/index.ts` (el
modo relevo: el mismo binario arrancado para aplicar una actualización cuando la app ya no
existe) y los `componer.ts` que figuran en `RAICES` de `eslint.config.mjs` (hoy `db/`, `ssh/` y
`agents/`). Solo ellas componen servicios con Electron y registran los `ipc.ts`. Un `componer.ts`
es un trozo de la raíz de la app sacado de `index.ts` para que no crezca: recibe `refs`,
`ipcMain` y lo ya compuesto, y **solo `index.ts` lo importa** (ni otro `componer.ts` ni el
relevo). Añadir uno es añadirlo a esa lista; un `componer.ts` fuera de ella no es raíz y F1-F3
le aplican.

## Renderer: features y estado

```
src/renderer/src/
  App.tsx, main.tsx   composición y arranque; App.tsx no guarda estado de dominio
  features/<dominio>/
    index.ts          API pública: lo único que importan las demás features
    app.ts            lo que solo compone App.tsx (hooks use*App, el shell); nadie más lo importa
    store.ts          estado compartido del dominio (Zustand)
    use*.ts           hooks de la funcionalidad
    *.tsx, *.css      componentes
    *.ts, test-*.mts  lógica pura, sin JSX ni DOM en su cadena de imports
  comun/              UI compartida (menú contextual, diálogos, avisos, lista virtual)
  util/, theme/
```

- Zustand: `create` y selectores (`useShallow` para leer varios campos). Sin `persist` (se
  persiste por IPC) ni `immer`.
- En el renderer no existe `process`: la plataforma llega por `window.tessera.plataforma`.

## Fronteras

| | Regla |
|---|---|
| F1 | `ipcMain` y sus tipos (`IpcMain`, `IpcMainEvent`, `IpcMainInvokeEvent`), también como `import type` o `Electron.IpcMain`, solo en `ipc.ts` y las raíces de composición (`index.ts`, `relevo/index.ts` y los `componer.ts` de `RAICES`). |
| F2 | `electron` solo en `ipc.ts`, `adaptadores/`, `src/main/app/` y las raíces de composición, las mismas de `RAICES` (los `import type`, en cualquier sitio). |
| F3 | Un `ipc.ts` o un `componer.ts` solo lo importa una raíz de composición, y un `componer.ts` solo lo importa `src/main/index.ts`. |
| F4 | `adaptadores/` importa solo de otros `adaptadores/`, `src/shared/` y `src/main/util/`; nunca de su dominio ni de un servicio, esté a la profundidad que esté. |
| F5 | Una feature importa otra solo por su `index.ts` (la carpeta de la feature o `…/index`). |
| F6 | `comun/`, `util/` y `theme/` no importan de `features/`. |
| F7 | El renderer no importa de `src/shared/` nada que llame a `plataformaActual()`: de `plataforma` solo tipos, `plataformaDe` y `capacidadesDe`; de `rutasHost` y `rutasDesdeArgv` solo tipos; de `dockerErrors`, `pasosDocker` no. |
| F8 | `src/shared/` no importa de main, renderer ni preload. |

ESLint las comprueba sobre los `import` y `export … from` estáticos del código que no es prueba;
un `require` o un `import()` dinámico no los ve, así que tampoco se usan para saltárselas. F4,
F5 y F7 comparan la ruta **resuelta** del import, no su texto.

F7 solo ve el primer salto. Si un módulo de `shared/` que el renderer importa empieza a llamar
por dentro a `plataformaActual()`, compila y pasa los `test-*.mts` (bajo `node` sí hay
`process`), y lo caza el e2e contra la app empaquetada. Por eso la lógica de `shared/` que usa
el renderer recibe la plataforma por parámetro, y un módulo nuevo que la lea se añade a la
tabla de F7 en `scripts/calidad/fronteras.mjs`.

**Ciclos de importación.** Con F5, dos features que se importan entre sí forman un ciclo de
módulos a través de sus `index.ts`, y el ciclo arrastra a todo lo que cuelga de ambos barriles:
hubo uno de 77 módulos y 9 features. En un ciclo, un módulo que use **al cargarse** (fuera de
toda función que no corra ya) un binding del ciclo que no sea una declaración `function` —un
`const`, una `class`, un `memo(…)` o lo que lea una función del ciclo llamada al cargar— puede
encontrarlo sin inicializar: compila y pasa las pruebas puras, y en la app la ventana arranca en
blanco. Hoy **no hay ningún ciclo**, ni entre features ni de módulos, y se mantiene así:

- Lo que solo compone `App.tsx` (los hooks `use*App`, el shell de `layout`, `ColumnaAgente`,
  `AreaEditor`, `CentroBd`) va en el `app.ts` de su feature, no en el `index.ts`: esos módulos
  importan de media aplicación y, colgados del barril, cerraban el ciclo. Sus TIPOS sí siguen
  en el `index.ts`, como `export type`, que no crean arista en ejecución (esbuild los borra).
- Si dos features se necesitan de verdad, la que compone recibe lo de la otra por parámetro o
  por prop (`import type` + `typeof X` para tiparlo): así el historial de git pinta el visor de
  diff del editor, que le pasa la franja de `layout`.
- `npm run test:ciclos` falla si reaparece un ciclo entre barriles de más de una feature
  (`MAX_FEATURES_EN_CICLO`; subirlo es aceptar un ciclo, con sus features y su motivo aquí) y,
  dentro de cualquier ciclo de módulos que quede, si alguno usa al cargar lo que no debe.
  Decisión y descartes: `docs/decisiones/renderer/barriles-sin-ciclos.md`.

## Cómo certificar un área

```
npx eslint <rutas>
npm run test:cabeceras -- <rutas>
npm run test:menciones -- <rutas>
npm run test:comentarios -- <rutas>
npm run test:ciclos -- <rutas>
```

- ESLint falla con lo que este estándar trata como error: el doble de los límites, las
  fronteras y `react-hooks/exhaustive-deps`. Los avisos del límite simple se muestran, pero
  no hacen fallar (`--quiet` los oculta). Para un área es `npx eslint <rutas>`: `npm run lint`
  es `eslint .`, y `npm run lint -- <rutas>` sigue revisando el repo entero.
- Las guardias salen 1 ante cualquier hallazgo. `--detalle` lista todos y `--json <archivo>`
  los vuelca. `--estricto`, que antes activaba el fallo, se sigue aceptando y no hace nada.
  Una opción que no conocen la cortan con salida 2: nunca se toma por una ruta.
- `test:menciones` lee sus patrones de `--privados <archivo>` (o de la variable
  `TESSERA_PATRONES_PRIVADOS`; sin ninguna de las dos, de `.patrones-privados.txt`
  de la raíz, versionado solo en el repo privado): una expresión regular por línea con los productos y los datos
  que no deben acabar en el repo. `!` delante marca un patrón permitido (un nombre de paquete o
  de proveedor, que se tapa antes de buscar) y `(?i)` delante lo hace insensible a mayúsculas.
  Ese archivo no se versiona.
- `test:ciclos` arma siempre el grafo del renderer entero; las rutas solo filtran qué módulos
  se informan.
- Un área está certificada cuando los cinco comandos salen 0 sobre sus rutas, pruebas
  co-ubicadas incluidas.
