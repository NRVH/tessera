# Cada cuenta de agente corre en su propio contenedor

- **Estado:** vigente
- **Ámbito:** `src/main/sandbox/gestor/nombres.ts` (`perfilDeCuenta`, `idBase`), `gestor/contenedores.ts`, `SandboxManager.ts` (`stopContainer`, `programarParada`), `src/main/agents/terminalAgente/` (`credenciales.ts` `contenedorDe`, `apertura.ts`, `recarga.ts`, `cierre.ts`, `aperturaManual.ts`, `nativas.ts`), `agents/manuales/ipc.ts`, `agents/AccountStore.ts`, `agents/lineaArranqueAgente.ts`, `agents/loginCodex.ts`, `sandbox/adaptadores/docker.ts` (`unirConContenedor`)

## Contexto

Las credenciales de cada cuenta se montan en `/agent-config/<agente>/<cuenta>` y todos los procesos de
un contenedor corren con el mismo usuario. Con dos cuentas abiertas en el contenedor del perfil, el agente
de una podía leer el token de la otra. Separarlas por usuario y permisos no sirve: las carpetas montadas
desde Windows no los respetan.

## Decisión

- **Un contenedor por cuenta.** El gestor lo trata como el de un perfil con otro id
  (`<perfil>--<huella de la cuenta>`, `perfilDeCuenta`): tiene su contenedor, sus raíces, su buzón del
  puente y su candado sin código nuevo en el gestor. Lo que es del perfil, su capa de imagen, se busca por
  `idBase`. Cada contenedor monta solo su raíz de credenciales: el de otra cuenta no existe ahí.
- **La terminal de abajo no usa contenedor:** es siempre nativa (`agentes/modo-por-agente.md`).
- **Un agente manual también tiene cuentas:** la predeterminada es su carpeta del perfil, con su
  contenedor por agente; cada una que se cree tiene su carpeta (`<perfil>/<agente>-cuentas/<id>`) y su
  contenedor, como las de los de serie.
- **Ciclo de vida.** El de una cuenta nace con su primer agente y, al cerrarse el último, se programa su
  parada a los 2 minutos; un `ensureContainer` la cancela, así que cambiar de cuenta y volver no lo
  recrea. Parar el del perfil (hibernar, borrarlo, aplicar su capa) para también los de sus cuentas.
- **Login de Codex, por navegador y por un puente.** Si la cuenta no tiene `auth.json`, la línea de
  arranque empieza por `codex login` y solo arranca el agente si sale bien (se mira al arrancar, así que
  vale igual al relanzar). El navegador vuelve a `localhost:1455` del equipo: mientras ese login está
  pendiente, Tessera escucha ahí (solo en el loopback) y lleva cada conexión al 1455 del contenedor por la
  entrada y la salida de un `docker exec` (`agents/loginCodex.ts`). Con la sesión caducada, el login lo
  empieza el propio Codex y la apertura no se entera: el main mira la salida de cada Codex en contenedor
  (sin colores, espacios ni marcos, porque la terminal parte la URL) y, al ver el enlace de autorización
  con `redirect_uri` al 1455, abre el puente para esa sesión; si otro login lo tiene, avisa. Por eso el
  login termina cuando la credencial aparece o se reescribe, no cuando existe, y caduca a los 15 min si
  se abandona con la pestaña abierta. Ningún contenedor publica puertos,
  tampoco el del perfil. Codex fija el 1455, así que hay **un solo login a la vez**: abrir o relanzar otra
  cuenta sin credencial (o la misma en otra pestaña) se rechaza nombrando la pendiente, y se libera al
  aparecer su credencial (con 15 s de gracia para la página de «listo»), al cerrar su pestaña o si la
  apertura falla. Con la red del anfitrión el puente se abre igual: si Docker tiene esa función apagada
  es la única vuelta, y si la tiene encendida el 1455 ya lo ocupa su reenvío y se calla. Si el puerto no
  se puede tomar por otra causa (otro programa, o un rango que el sistema reserva), se avisa.
- **Carpetas.** Las cuentas creadas viven en `<perfil>/<sub>-cuentas/<id>`, hermanas de la predeterminada
  y no dentro de ella: anidadas, la predeterminada veía sus credenciales y borrarla las borraba. Las que
  estaban anidadas se mueven con su login al arrancar. La predeterminada no se borra (el main lo rechaza).

## Consecuencias

- Lo que un agente instala a mano en su contenedor no lo ven la terminal de abajo, que es nativa, ni las
  otras cuentas; los archivos del proyecto sí, porque son el disco del usuario.
- Un contenedor de cuenta sin agentes desaparece a los 2 minutos con lo que viviera solo en él (procesos
  de fondo, paquetes instalados a mano).
- `test:contenedores-de-cuenta` comprueba con Docker que una cuenta no llega a la credencial de otra ni con
  un `cat`; `test:cuentas-carpetas`, la migración de las carpetas; y `test:escenarios-multicuenta`, con
  cuentas y agentes falsos en contenedores reales, los escenarios de uso: varias cuentas a la vez, la
  misma en dos proyectos, el login de Codex por el puente (uno a la vez), dos perfiles, agentes manuales, hibernar, un contenedor
  matado desde fuera, aperturas simultáneas y el buzón del puente por contenedor.

## Descartes

- Todas las cuentas en el contenedor del perfil: comparten usuario y se leen las credenciales.
- Un contenedor por cuenta con los proyectos en la raíz compartida del perfil: la pizarra limpia de uno
  desmontaría los proyectos de los demás. Cada contenedor monta los suyos; es un bind por proyecto.
- El login por código de dispositivo: no necesita puerto, pero una cuenta de empresa puede tenerlo
  desactivado y entonces no hay forma de iniciar sesión.
- Publicar el 1455 en el contenedor que inicia sesión: el puerto se fija al crear el contenedor, así que
  habría que recrearlo para cada login, y el del perfil, que lo publicaba, se lo quitaba a todos.
- Un navegador dentro del contenedor: pesa cientos de MB, hay que enseñarlo con un visor remoto y no
  tiene los inicios de sesión, llaves ni la verificación en dos pasos del navegador del usuario.
