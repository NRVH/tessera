# La configuración de un agente se edita en sus archivos reales, sin opciones propias de Tessera

- **Estado:** vigente
- **Ámbito:** `src/shared/configAgente-ipc.ts`, `src/main/agentes/configAgente/` (también `configCompartida.ts`,
  `propuestasConfig.ts` y `operacionConfigTctx.ts`), `registrarIpcConfigAgente` de `src/main/agentes/ipc.ts`, la apertura
  y la recarga en Docker (`terminalAgente/apertura.ts`, `recarga.ts`, `lineaArranqueAgente.ts`), `Profile.contextoGlobal`, `tctx config` en `src/tctx/` y, en
  `src/renderer/src/features/agentes/`, `EditorConfigAgente.tsx`, `CapaPropuestasConfig.tsx`, `useConfigAgente.ts`,
  `modeloConfigAgente.ts`, `enlacesConfigAgente.ts` y el diálogo de `contexto/`

## Contexto

Claude Code y Codex se configuran con archivos en su carpeta. En una cuenta de Docker esa carpeta está en el equipo y
se monta en el contenedor, pero el usuario no tiene ninguna forma de llegar a ella desde la aplicación. Las opciones
cambian con cada versión de los CLI, y Codex además tiene algunas que solo se pueden fijar en su archivo.

## Decisión

- **Se editan los archivos reales**, con Monaco: en una cuenta o en su equipo, dos pestañas, configuración
  (`settings.json`, `config.toml`) e instrucciones (`CLAUDE.md`, `AGENTS.md`); en las capas compartidas, solo la
  configuración. No hay formulario ni lista de opciones: la documentación oficial de cada CLI está a un enlace.
- **Tessera no añade ni cambia ninguna opción**, ni siquiera en una cuenta nueva: la configuración es la que deja el
  CLI más lo que escriba el usuario. Lo único propio es el bloque del sandbox, entre marcas, en las instrucciones de
  una cuenta de Docker ([contenedor-del-agente.md](../sandbox/contenedor-del-agente.md)), y el diálogo lo avisa.
- **Se editan en el diálogo del contexto de los agentes** ([contexto-de-los-agentes.md](contexto-de-los-agentes.md)): la
  capa global y la de cada perfil en su sección «Configuración de Docker», con el agente elegido arriba; cada cuenta,
  en esa misma sección de su perfil, eligiéndola en el ámbito; y el agente en su equipo, en «En su equipo». El menú
  «⋯» de una cuenta abre el diálogo con ella elegida.
- **Configuración compartida de Docker, en dos capas**: una global y una por perfil, guardadas en los datos de Tessera
  y nunca en una carpeta montada. Las tablas de las dos se funden, ganando la del perfil; una lista se sustituye
  entera, porque unirlas cambiaría el sentido de las ordenadas, como los argumentos de un servidor. Las capas no
  tienen instrucciones: lo común a varios agentes son reglas del contexto, que llegan en el aviso de arranque.
- **El CLI superpone las capas; Tessera no escribe en la cuenta.** Al abrir o relanzar una sesión en Docker se
  componen en un archivo propio en la carpeta de la cuenta (`ARCHIVO_CAPA`), que se rehace cada vez, vacío si no hay
  nada, y la línea de arranque se lo pasa al CLI, igual que el aviso ([sesion-linea-de-arranque.md](sesion-linea-de-arranque.md)):
  Claude Code con `--settings <archivo>` y Codex con `-p tessera`, que superpone `$CODEX_HOME/tessera.config.toml`.
  Así quitar una clave de una capa, o dejar de usar el global, se nota en la sesión siguiente; los comentarios y los
  valores propios de la cuenta no se tocan, y Claude Code suma las listas de permisos en vez de sustituir las de la
  cuenta. El precio: en Claude Code la capa queda también por encima de la configuración del proyecto, y en Codex
  `-p` solo superpone un archivo desde que tiene perfiles por archivo, así que va si su `--help` lo describe; con
  una versión anterior el agente arranca con la configuración de la cuenta. Si el archivo no se puede escribir, no se
  pasa y la sesión abre igual.
- **Cada perfil decide si aplica la global** (`Profile.contextoGlobal`, ausente es que sí), junto con el resto del
  contexto global; su propia capa se aplica siempre. Al editar una cuenta, un aviso dice qué claves aplica Tessera
  encima y de qué capa sale cada una.
- **Los agentes proponen, no escriben**: `tctx config` enseña los niveles del agente de la sesión y
  `tctx config proponer` deja el archivo de configuración entero nuevo de la capa global o de la de su perfil, nunca
  de otro, con su sintaxis ya comprobada. El usuario lo ve frente al actual y lo acepta o lo descarta; aceptar lo escribe en su capa.
  La capa global cambia los agentes de todos los perfiles, así que un agente no puede tocarla sin que el usuario lo vea.
  El archivo de su propia cuenta sí puede editarlo: está en su carpeta.
- **El renderer nombra la cuenta y el tipo de archivo, nunca una ruta**, y el main solo acepta esos cuatro nombres:
  credenciales y estado interno no se pueden pedir. Los agentes manuales quedan fuera: Tessera no conoce sus archivos.
- **No se pisa un cambio ajeno**: el CLI también escribe en estos archivos, así que guardar compara el hash con lo
  leído. Si cambió, no guarda y el usuario elige entre cargar esa versión o sobrescribirla.
- **La sintaxis se comprueba antes de escribir** en los dos archivos de configuración, porque un archivo inválido
  puede impedir que el agente arranque. El error indica la línea; las instrucciones son texto libre.
- **Versión anterior**: antes de sustituir un archivo se copia a `<nombre>.tessera-anterior`. Recuperarla la carga en
  el editor como una edición, sin guardar y sin borrar el historial de deshacer.
- **Un archivo que no es UTF-8 no se abre**: decodificarlo y guardarlo lo destruiría, también en la copia anterior.
- **`developer_instructions` en `config.toml` avisa**: Tessera lo define con `-c` al abrir una sesión cuando tiene
  avisos para el agente, y el valor de la línea de órdenes gana. El aviso lleva a las reglas del contexto o al
  `AGENTS.md` de la cuenta.
- **La carpeta de una cuenta de Docker no es de fiar**: se monta con escritura en su contenedor, y un agente podría
  plantar un enlace que señale a otro archivo del equipo. No se lee un archivo que no sea regular: `lstat`, `O_NOFOLLOW`
  y `fstat` contra lo mirado, para que no lo cambien entre medias. Se escribe en un temporal de nombre aleatorio con
  `wx` y luego `rename`, que sustituye un enlace sin seguirlo. Lo mismo vale para la copia anterior y para el bloque
  del sandbox. 1 MiB como mucho, al leer y al guardar.
- **En la carpeta nativa un enlace es del usuario**, por ejemplo de un gestor de dotfiles: se edita su destino y el
  enlace se conserva. Allí no hay contenedor del que desconfiar.
- **Conserva los permisos** del archivo que sustituye, por si guarda secretos de un servidor MCP.

## Consecuencias

- El análisis de TOML añade una dependencia de producción, `smol-toml`, que solo se carga en el main.
- Una sesión abierta puede no enterarse del cambio; el diálogo dice cuántas tiene la cuenta y que la certeza está en
  abrir una nueva.
- Monaco quita el BOM y unifica los finales de línea mezclados: al editar y guardar un archivo así, queda normalizado.
- El archivo de la capa vive en una carpeta que el contenedor puede escribir: se escribe sin seguir enlaces y con
  permisos solo para su dueño, porque puede llevar secretos de un servidor MCP. Un agente que lo cambie solo afecta a
  su sesión: se rehace al abrir la siguiente.
- Las propuestas pendientes son una por nivel, perfil que la propone y agente: una propuesta global de un perfil no
  sustituye la de otro.
- Una propuesta aceptada llega a las cuentas al abrir su próxima sesión, no a las abiertas.
- Las capas global y de cada perfil viajan en la copia de la configuración, igual que los dos archivos de cada cuenta de
  Docker que escribe el usuario y las instrucciones de los nativos; ni el estado del CLI ni las credenciales
  ([exportar-importar.md](../configuracion/exportar-importar.md)).
- `test:config-agente` fija los archivos, la validación, no pisar, la versión anterior, los avisos, los permisos y los
  enlaces (en Windows, si el usuario puede crearlos); `test:config-compartida`, las capas, su archivo sin tocar el de
  la cuenta y `tctx config`; `test-linea-arranque-agente`, `--settings` y `-p tessera` en la línea; `test:modelo-config-agente`, el estado del editor; `e2e/config-agente.spec.ts`, el recorrido
  desde Configuración.

## Descartes

- **Un formulario con las opciones más usadas**: se queda atrás con cada versión y limita lo que el usuario puede hacer.
- **Una plantilla que sustituya el archivo de la cuenta al arrancar**: borraría lo que escribe el CLI (proyectos de
  confianza, avisos vistos).
- **Fundir las capas dentro del archivo de la cuenta**: lo escrito se queda aunque se quite de la capa o se deje de
  usar el global, una lista de la capa sustituye los permisos propios de la cuenta y reescribir pierde los
  comentarios.
- **Pasar la capa como valores en la línea** (`--settings '<json>'`, `-c clave=valor`): los secretos de un servidor
  MCP quedarían a la vista en la lista de procesos y una configuración grande no cabría en la línea.
- **Que un agente escriba directamente en la capa global o en la de su perfil**: cambiaría los agentes de otros
  perfiles sin que el usuario lo viera.
- **Valores por defecto de Tessera, como la ventana de contexto máxima**: gastan cuota de la cuenta sin que el usuario
  lo haya decidido.
- **Abrir los archivos en una pestaña del editor del proyecto**: el editor trabaja con rutas relativas al proyecto, y
  estos archivos están fuera de él.
