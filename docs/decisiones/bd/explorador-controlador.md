# El controlador del explorador es una fachada sobre módulos por sección, y sus handlers nunca lanzan

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/ExploradorController.ts`, `ipc.ts` y `controlador/`

## Contexto

`ExploradorController` traduce cada petición del renderer (`DBX_CHANNELS`) a `GestorSesiones`,
`CacheCatalogo`, `ConsolasStore` y el SQL puro de `catalogoSql`/`sqlRejilla`. Crecía hasta las
2.100 líneas, mezclaba el registro de canales con la lógica y las pruebas lo conducen con `node`
a secas, sin Electron.

## Decisión

- **Fachada con estado, módulos por sección.** `ExploradorController.ts` guarda las piezas y un
  único dueño del estado (`EstadoExplorador`, en `estado.ts`) que los módulos de `controlador/`
  reciben por referencia; sus mapas son privados y solo se tocan por sus métodos.
- **`ipc.ts` es el único sitio con `ipcMain`.** Cada handler es una línea que llama a un método
  público, que es lo que se prueba; todo lo de Electron llega inyectado (ventana, diálogos, papelera).
- **Un handler nunca lanza.** El `invoke` de Electron pierde las propiedades de un `Error`; lo
  esperable vuelve como `DbRespuesta` y lo inesperado se registra y responde `motivo: 'interno'`
  con un texto genérico, porque un error de `fs` o de un driver puede traer una ruta del host.
- **El catálogo se invalida antes de responder.** Un DDL correcto, «Refrescar» y editar la
  conexión emiten `dbx:ev:catalogo` desde dentro del handler: el evento llega por delante de la
  respuesta.
- **Una consola está atada a su conexión y a su perfil.** El renderer solo manda perfil y consola;
  la conexión sale del índice y se comprueba que es del mismo perfil.
- **Este controlador es SQL de punta a punta.** Una petición SQL que nombra una conexión de otra
  familia responde `motivo: 'driver'` (`familias.ts`); los canales comunes (cancelar, forzar,
  desconectar, sesiones, archivos de consola) se delegan también a documentos y claves.
- **Toda consulta de catálogo se construye dentro de `construir(() => sqlX(…))`**, para que un
  fallo al construirla llegue con su motivo y no como «Error interno». Lo vigila
  `test-explorador-motores.mts` (caso 12) leyendo `controlador/*.ts`.

## Consecuencias

Un módulo nuevo que lea el catálogo tiene que entrar en la lista de archivos de esa guardia. No se
valida con un esquema declarativo (zod): una dependencia para una docena de formas planas.
