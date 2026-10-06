# Las consolas son archivos del espacio de datos, versionadas por su contenido y escritas por una cola por consola

- **Estado:** vigente
- **Ámbito:** `ConsolasStore.ts` y `controlador/consolasStore*.ts`

## Contexto

El agente del espacio de datos tiene la carpeta del perfil como directorio de trabajo: si las
consolas son archivos, ve lo que el usuario consulta sin que nadie se lo copie. Pero el agente
también las puede editar, y `writeFileAtomic` usa un `.tmp` de nombre fijo.

## Decisión

- `<espacio del perfil>/consolas/<nombre>.sql|.js|.redis` más `indice.json` con `{id, conexionId,
  nombre, creadaEn, esquema?, extension?}`. El índice existe porque el nombre es del usuario y la
  conexión no se deduce del archivo. Los nombres son únicos en toda la carpeta (menor `consola_N`
  libre), comparando `NFC` y minúsculas; los reservados de Windows solo se rechazan allí (la
  plataforma es un parámetro).
- **La versión es el contenido** (`<bytes>:<SHA-256>`). La hora y el tamaño no sirven: un cambio
  del agente del mismo tamaño en el mismo tic del reloj no daba conflicto y el usuario lo pisaba en
  silencio. `escribir` no recibe versión base: el store recuerda la última que leyó o escribió y
  devuelve `{conflicto, texto, version}` solo si el disco difiere. La versión de lo escrito sale
  de los bytes mandados, no de releer el disco.
- **Serialización en dos capas:** una cola por consola que funde las escrituras (gana la última) y
  un `KeyedMutex` por perfil alrededor de toda operación que toca el disco. Se usa el escritor
  atómico asíncrono: el síncrono hace `fsync` en el hilo principal.
- **Renombrar:** primero el archivo, después el índice. `listar` empareja una entrada sin archivo con
  un archivo sin entrada solo si son exactamente uno y uno de la misma extensión; los archivos sin
  entrada nunca se borran solos. `leer` y `escribir` no reconcilian (una herramienta que reescribe
  sin atomicidad dejaría un hueco en el que se perdería la consola).
- **Borrar** va a la papelera inyectada (una consola vacía, `unlink`); si la papelera falla no se
  borra en firme.
- Al renderer solo llega la ruta relativa POSIX; los errores de `fs` se reescriben sin rutas.

## Consecuencias

Comprobar el disco antes de escribir cuesta leerlo entero (de ~2,2 a ~2,8 ms con 4 KiB; ~20 ms en el
tope de 5 MiB), dentro del debounce del tecleo. El historial de consultas (`HistorialStore`) vive
fuera del espacio de datos a propósito: es privado de Tessera y el agente no debe leerlo.

Al borrar el perfil, su espacio de datos entero, consolas incluidas, va a la papelera del sistema,
igual que una consola suelta y nunca en firme (decisión del usuario del 5-oct-2026): el borrado
se deduce de la lista de perfiles guardada (E70), así que tiene que poder deshacerse. Si la papelera
falla, el espacio se queda en su sitio y se registra. El porqué, las guardas y lo medido, en
`docs/decisiones/agentes/agente-de-la-terminal.md`. El diálogo de borrar el perfil lo dice, con el
nombre de la papelera de cada sistema (`shared/nombresSistema.ts`).
