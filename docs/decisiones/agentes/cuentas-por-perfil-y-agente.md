# Las cuentas de agente son privadas de un (perfil, agente) o globales, las que quiera el usuario, y con solo metadatos en el registro

- **Estado:** vigente
- **Ámbito:** `src/main/agents/AccountStore.ts`, los canales de `AGENT_ACCOUNT_CHANNELS` (`src/main/agents/ipc.ts`) el selector de cuenta del agente (`MenusAgentPane.tsx`, `useCuentasAgente.ts`) y las cuentas de Configuración › Agentes (`CuentasConfiguracion.tsx`, `useLoginCuenta.ts`, `accionesCuentas.ts`)

## Contexto

Un agente en Docker monta en cada sesión la carpeta de credenciales de una cuenta. Uno nativo usa el
login personal del host, sin cuentas; qué agente corre en cuál lo decide él (`modo-por-agente.md`). Quien tiene varias suscripciones del mismo agente quiere
trabajar con ellas a la vez en el mismo perfil; cada cuenta corre en su propio contenedor
(`sandbox/contenedor-por-cuenta.md`), así que no se pisan.

## Decisión

- Varias cuentas por (perfil, agente), reutilizables por los agentes en Docker de todos los proyectos del perfil.
  El nombre no se repite entre las que un selector enseña juntas (las de un (perfil, agente) y las globales del agente), sin distinguir
  mayúsculas, y tiene como mucho 40 caracteres: el selector no puede enseñar dos iguales. Se puede
  renombrar (salvo la predeterminada, que lleva el nombre del idioma): es solo su etiqueta, y la
  carpeta y el contenedor van por id.
- Cada pestaña de agente elige su cuenta en el selector de la cabecera: la lista con la actual
  marcada, «Nueva cuenta…» y, en cada una, renombrarla, cerrar su sesión o eliminarla (detalle en
  `modo-por-agente.md`). Cambiar de cuenta
  suelta la sesión y la reabre con la nueva. Crear una explica, según su disponibilidad, dónde se usa y qué ve;
  que cada una cuenta para el límite de contenedores (`sandbox/limite-de-contenedores.md`) lo dice la Academy. Si falla
  (un nombre repetido), se dice por qué y la pestaña sigue con la que tenía. Sin cuenta elegida, un agente toma la
  primera privada del perfil antes que una global.
- **Cuentas globales**: el equivalente en Docker de la cuenta nativa, para quien tiene más cuentas de las que admite
  su sistema. Claude Code y Codex; se elige al crearla, y no se cambia después porque implicaría mover su carpeta y
  sus conversaciones. Una sola carpeta (`.tessera/cuentas-globales/<sub>/<id>`, fuera de los perfiles) y un solo
  inicio de sesión, con historial y configuración comunes. Su id empieza por `global-`, porque quien decide el
  contenedor solo conoce ese dato. Viven en `agent-accounts-globales.json`: en el registro de las privadas, una versión
  anterior las borraría al arrancar por no tener perfil. `list` sigue devolviendo solo las privadas (lo usa la copia
  de la configuración, en la que no viajan) y `disponibles`, las que un perfil puede usar.
- `agent-accounts.json` guarda solo id, nombre, agente y perfil; las credenciales viven en su
  carpeta del host, resuelta contra `dataRoot`: la predeterminada en la del perfil y las creadas en
  una hermana (`<sub>-cuentas/<id>`), nunca dentro (`sandbox/contenedor-por-cuenta.md`). La
  predeterminada no se borra. Escritura atómica con `.bak`; el `.bak` solo se lee
  si el primario falta o está corrupto (vaciar el registro a mano no resucita cuentas).
- Al construir se borran las cuentas «global» heredadas (registro y carpeta) y las que no tienen
  perfil: sin él, la carpeta resolvería a `…/perfiles/undefined/…`.
- Los agentes manuales también tienen cuentas: la predeterminada es su carpeta del perfil, sin
  entrada en el registro (`CUENTA_AGENTE_MANUAL`), y siempre sale primera; las creadas van al registro
  como las demás. No se puede cerrar su sesión (no se sabe qué archivos son su credencial), solo
  eliminar las creadas. Abrir una sesión con la cuenta de otro agente o de otro perfil se rechaza.
- La cuenta «Predeterminada» se crea solo para los (perfil, agente) que ya tienen login en disco;
  un perfil nuevo queda sin cuenta y la interfaz ofrece «Iniciar sesión». La predeterminada
  respeta el `configDir` declarado del perfil.
- Cerrar sesión y borrar una cuenta cierran antes sus sesiones vivas en cualquier perfil (para
  forzar el re-login o desmontar y poder borrar) y olvidan el uso cacheado.
- **Dos entradas, las mismas cuentas y acciones**: el selector de la cabecera del agente y Configuración › Agentes, que
  despliega las cuentas de Docker de cada agente aunque esté oculto. Ocultar un agente (porque se usa solo para
  delegarle tareas) no puede dejar sin crear, administrar ni iniciar sesión en sus cuentas. La lista dice si cada cuenta
  tiene la sesión iniciada (`conSesion`, mirado en el disco al listar); su uso no se enseña aquí.
- **Iniciar sesión sin pestaña**: un diálogo abre una sesión del agente con esa cuenta en el proyecto activo, con su
  terminal, porque el login de los dos CLIs corre ahí. Se confirma y se cierra solo cuando la cuenta tiene la sesión
  iniciada, y cerrarlo cierra la sesión: no deja ninguna abierta. Enseña en qué punto va y cuánto lleva esperando. Codex
  se autoriza en el navegador, así que su terminal queda plegada y disponible para consultar el enlace; en los demás,
  el inicio de sesión se completa en ella y permanece a la vista.

## Consecuencias

- Los lectores de uso y contexto resuelven la misma carpeta con `get` y `hostDirFor`.
- `test:cuentas-varias` fija la creación de varias, las globales, los nombres y el orden; `test:cuentas-carpetas`,
  que renombrar valida el nombre igual que crear y no mueve la carpeta (va por id).
