# Lo de un perfil solo se borra con su orden explícita, nunca porque falte en la lista guardada

- **Estado:** vigente
- **Ámbito:** `src/main/profiles/ordenDeBorrado.ts`, `src/main/profiles/borradoDePerfil.ts`, `src/main/profiles/candadoDeBorrado.ts`, `src/main/profiles/llegadaDePerfiles.ts`, `src/main/util/carpetaDePerfil.ts`, `src/main/agents/componer.ts` (`SAVE_PROFILES`, `DELETE_PROFILE`), `src/renderer/src/features/pestanas/useAccionesTabs.ts`

## Contexto

El renderer guarda la lista COMPLETA de perfiles en cada cambio (alta, nombre, orden, color). Si el
borrado de un perfil se dedujera de esa lista (el que falta se da por borrado), con él se
borrarían en firme sus conexiones SSH (con sus contraseñas y claves) y su historial de consultas, y
una poda al arrancar se llevaría lo de todo perfil que no estuviera en `profiles.json`. Cualquier
guardado incompleto (un estado a medio cargar, un fallo del renderer, una función futura que
reconstruya la lista) o un `profiles.json` resembrado se llevaría datos sin que nadie hubiera pulsado
«borrar», y sin vuelta atrás.

## Decisión

- Un canal propio, `profiles:delete` (`IPC_CHANNELS.DELETE_PROFILE`), que el renderer solo envía al
  borrar un perfil. El main lo apunta en `userData/perfiles-borrados.json`, lo saca de la lista,
  persiste y borra lo suyo (`borrarPerfiles`, con su candado tomado en la misma vuelta). Al terminar,
  lo quita de pendientes.
- `SAVE_PROFILES` nunca borra: a la lista que llega se le devuelven, en su sitio, los perfiles que no
  trae (`listaAGuardar`), y se registra.
- Al arrancar no se poda nada por la lista: se terminan los borrados pendientes cuyo perfil ya no está
  en ella. Los que siguen (la orden no llegó a sacarlos) o se recrearon (mismo id, también con otra
  caja) se olvidan sin tocar nada.
- Las conexiones de bases de datos se borran con el perfil, como las SSH.
- **Las carpetas del perfil van a la PAPELERA del sistema, nunca en firme**, para que un borrado se
  pueda deshacer: la carpeta del agente de la terminal (`<userData>/terminal/<perfil>`, con sus notas)
  y su espacio de datos (`conexiones/<perfil>`, con sus consolas). Sus conexiones SSH y de bases de
  datos y su historial de consultas se borran aparte. Lo hace solo la orden de borrar el perfil
  (`profiles:delete`), tras cerrar sus sesiones, por una sola vía: los dos dueños (`EspacioTerminal` y
  `EspacioDatos`) le llegan como dependencia y cada uno lleva `shell.trashItem` inyectado UNA vez, al
  nacer en su composición. El diálogo de borrar el perfil lo dice, con el nombre de la papelera de cada
  sistema (`shared/nombresSistema.ts`).
- **Validación previa a la papelera**, la misma que al crear la carpeta (`util/carpetaDePerfil.ts`, común
  a las dos): en las dos plataformas, sin puntos ni espacios al final ni `:`; los nombres de dispositivo
  (`CON`, `aux`…) solo se rechazan en Windows, porque en macOS son carpetas normales y el perfil «Aux»
  tiene la suya. No se toca si un perfil vivo da la misma carpeta (mismo id con otra caja: los discos por
  defecto de Windows y macOS no la distinguen).
- **La papelera mueve la entrada tal cual.** Una carpeta con una unión dentro, una carpeta que ES una
  unión y un enlace simbólico de directorio llegan a la Papelera de reciclaje como enlaces y su destino
  no se toca (tampoco al vaciarla). Una carpeta con un archivo abierto sin compartir o que es el
  directorio de trabajo de un proceso vivo falla ENTERA, sin mover nada, así que no queda a medio
  borrar. Si falla, tres reintentos de 300 ms (una sesión que aún se está cerrando) y, si sigue, la
  carpeta SE QUEDA en su sitio y se registra; no rompe el guardado. En Windows, lo que no cabe en la
  Papelera se aborta en vez de borrarse. Las conversaciones de los agentes viven en la cuenta y no se
  tocan: recrear el perfil con el mismo id las reencuentra.
- **Recrear un perfil con el mismo id mientras se borra no puede costarle nada al nuevo** (parar el
  contenedor tarda segundos y la papelera reintenta). Dos defensas (`profiles/borradoDePerfil.ts`): un
  CANDADO por id (`profiles/candadoDeBorrado.ts`, un `KeyedMutex`) que el guardado toma para todos los
  perfiles que quita antes de esperar nada y mantiene hasta el final de cada uno, y que esperan
  `ESPACIO_ASEGURAR`, `WORKSPACE_ENSURE` y la apertura de sesiones de ese id (terminal, SSH y agente;
  las sesiones solo esperan, no se lo quedan); y, justo antes de CADA paso irreversible (parar el
  contenedor, el historial, las conexiones SSH, cerrar sesiones y cada intento de papelera, también los
  reintentos), la lista de perfiles de ESE momento: si ha vuelto a existir, ni ese paso ni los
  siguientes. El RELOAD de una sesión abierta también espera al candado del perfil de esa sesión.
- **Al revés, un perfil RECIÉN creado:** el renderer guarda la lista con 250 ms de espera, así que su
  carpeta o su espacio de datos se pueden pedir antes de que el main lo conozca. `ESPACIO_ASEGURAR` y
  `WORKSPACE_ENSURE` esperan, fuera del candado y con tope de 2 s, a que `SAVE_PROFILES` lo traiga
  (`profiles/llegadaDePerfiles.ts`), y después decide la guarda de siempre: uno que no llega sigue
  siendo «Ese perfil no existe». `ESPACIO_ASEGURAR` rechaza además un perfil que el main no conoce: si
  no, uno recién borrado volvería a tener carpeta.

## Consecuencias

- Si la orden falla al guardar la lista, el perfil sigue en el main y vuelve a aparecer al reabrir: el
  fallo acaba en «no se borró», nunca en «se borró de más».
- Una conexión de un perfil ya borrado que dejó huérfana un cierre sucio se queda en su archivo sin
  que nadie la vea. Un perfil recreado con el mismo nombre volvería a verla.

## Descartes

- Forzar el guardado de la lista desde el renderer para que un perfil recién creado llegue antes: los
  dos caminos que piden el espacio de datos viven en pantallas distintas y bastaría olvidar uno.
- Conservar la carpeta del agente de la terminal al borrar el perfil: un perfil nuevo con el mismo
  nombre (mismo id) heredaría notas y un `CLAUDE.md` con conexiones ya borradas.
- Borrar las carpetas en firme (`rm`): con el borrado deducido de la lista guardada, un fallo del
  renderer perdería notas y consolas sin vuelta atrás.
- Solo comprobar la lista antes de cada paso, sin candado: no cubre lo que pasa DURANTE el paso (parar
  el contenedor tarda segundos), en que el perfil recreado ya podría abrir sesiones o sembrar su carpeta.
- Usar el `profileLock` del sandbox como candado del borrado: `stopContainer` lo toma dentro y no es
  reentrante.
- Caer al borrado en firme cuando la papelera falla: es justo el caso en que no se puede deshacer.
  Una carpeta que se queda ocupa poco y se ve en el registro.
- Mantener la deducción y endurecer solo el renderer: el riesgo está en que GUARDAR pueda BORRAR, y
  cualquier camino nuevo que guarde la lista lo heredaría.
- Podar al arrancar con la lista de perfiles: un `profiles.json` que falte se resiembra con
  los perfiles por defecto, y la poda se llevaría las conexiones de todos los demás.
