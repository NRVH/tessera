# Los JSON de estado se escriben crash-safe desde una copia en memoria, y una versión más nueva se archiva antes de degradarla

- **Estado:** vigente
- **Ámbito:** `src/main/util/atomicWrite.ts`, `src/main/workspace/workspaceStateStore.ts`, `src/main/profiles/store.ts`

## Contexto

`workspace-state.json` (pestañas por perfil y ajustes globales) y `profiles.json` son datos del
usuario. El equipo hiberna a diario y hay cortes de luz; el zoom y los cambios de pestaña
disparan ráfagas de guardados; y un build viejo puede abrir un archivo que escribió uno más nuevo.

## Decisión

- `writeFileAtomic`: tmp completo + `fsync`; el destino actual se copia a `<target>.bak` solo si
  es un JSON legible (nunca se pisa un respaldo bueno con un primario corrupto); `rename` atómico
  con reintentos ante `EPERM`/`EBUSY` transitorios de Windows; `fsync` del directorio. El tmp
  tiene nombre fijo por destino: quien escribe el mismo archivo serializa sus escrituras.
- Toda lectura cae al `.bak` si el principal no se puede parsear, y un archivo irrecuperable
  arranca limpio en vez de lanzar.
- El estado de workspace vive en memoria; cada guardado lo muta y programa UNA escritura
  asíncrona con debounce de 200 ms, serializadas en una cadena. `flushWorkspaceState` la fuerza
  al cerrar. Esqueleto y ajustes son dos slices del mismo archivo: guardar uno preserva el otro.
- Si el archivo persistido es de una versión de esquema MAYOR que la del build, se archiva una
  copia intacta en `workspace-state.v<N>.json` (una sola vez) antes de normalizarlo.
- Al cargar se podan los proyectos cuya carpeta no está, con `stat` en paralelo. `ENOENT` es
  ambiguo (una carpeta borrada o un volumen sin montar dan lo mismo): si la raíz del volumen
  tampoco está, el proyecto se conserva y se avisa, igual que ante un error de permiso.
- Los perfiles se editan en `userData/profiles.json`, sembrado la primera vez desde la semilla
  empaquetada (de solo lectura); las `configDir` de los agentes siguen relativas a la app.

## Consecuencias

- Ni una clave, ni el formato, ni el debounce cambian sin revisar esto: hay datos escritos. El
  main lee el archivo SÍNCRONO en el arranque (`loadWorkspaceSettings` desde `componerBd`, la
  integración con el sistema, la ventana y el updater), antes de cualquier `load` del renderer.

## Descartes

- Read-modify-write síncrono por guardado (el main se notaba parado en cada ráfaga de zoom) y
  podar por `existsSync` (un disco externo desenchufado borraba sus proyectos para siempre).
