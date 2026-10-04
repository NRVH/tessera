# Una cuenta de agente por (perfil, agente), privada del perfil, y solo metadatos en el registro

- **Estado:** vigente
- **Ámbito:** `src/main/agents/AccountStore.ts` y los canales de `AGENT_ACCOUNT_CHANNELS` (`src/main/agents/ipc.ts`)

## Contexto

En modo contenedor cada sesión monta la carpeta de credenciales de una cuenta. En modo nativo se
usa el login personal del host, sin cuentas.

## Decisión

- Como mucho UNA cuenta por (perfil, agente), reutilizada en todos los proyectos Docker del
  perfil. No hay cuentas globales ni multicuenta: crear una segunda es un error.
- `agent-accounts.json` guarda solo id, nombre, agente y perfil; las credenciales viven en su
  carpeta del host, resuelta contra `dataRoot`. Escritura atómica con `.bak`; el `.bak` solo se lee
  si el primario falta o está corrupto (vaciar el registro a mano no resucita cuentas).
- Al construir se borran las cuentas «global» heredadas (registro y carpeta) y las que no tienen
  perfil: sin él, la carpeta resolvería a `…/perfiles/undefined/…`.
- La cuenta «Predeterminada» se crea solo para los (perfil, agente) que ya tienen login en disco;
  un perfil nuevo queda sin cuenta y la interfaz ofrece «Iniciar sesión». La predeterminada
  respeta el `configDir` declarado del perfil.
- Cerrar sesión y borrar una cuenta cierran antes sus sesiones vivas en cualquier perfil (para
  forzar el re-login o desmontar y poder borrar) y olvidan el uso cacheado.

## Consecuencias

- Los lectores de uso y contexto resuelven la misma carpeta con `get` y `hostDirFor`.
