# Las raíces gestionadas viven en la VM en Windows y bajo `userData` en macOS

- **Estado:** vigente
- **Ámbito:** `src/main/sandbox/rutasSandbox.ts`, `src/main/sandbox/gestor/nombres.ts` (macOS: sin verificar aquí)

## Contexto

`/workspace` se monta desde una raíz gestionada preparada como `rshared` en el namespace del daemon, y cada proyecto
entra después en caliente con `mount --bind`: así un contenedor vivo ve aparecer proyectos sin recrearse (recrearlo
mataría la sesión del agente). En Windows la raíz está dentro de la VM (`/mnt/wsl/tessera-mm`). Docker Desktop para
Mac RECHAZA montar una ruta que solo existe en la VM («mounts denied: … is not shared from the host»).

## Decisión

- macOS: las raíces son rutas REALES del host bajo `userData` (cuelga de `/Users`, compartida de fábrica). Medido:
  `nsenter -t 1 -m` entra igual, `/Users` existe en la VM con la misma ruta (por eso `aRutaDelDaemon` es la
  identidad), `--make-rshared` y el bind en caliente funcionan. Desde macOS la carpeta del perfil se ve vacía: el
  aislamiento no se degrada.
- Proyectos y credenciales son árboles SEPARADOS y hermanos, sin prefijo común, en las dos plataformas: las guardas
  de limpieza por prefijo de uno no confunden montajes del otro.
- `fijarBaseGestionada(userData)` se llama ANTES de construir el `SandboxManager`. Hay UNA variable de raíces; su
  respaldo `~/.tessera` es el de las pruebas, que no pasan por el main (en Windows se ignora).
- Toda ruta que va a un `sh -c` pasa por `citarSh`: la raíz de Mac lleva un espacio (y en Windows un proyecto en
  `D:\Mis Cosas` también).
- `normalizarRutaResuelta`: solo Windows cambia `\` por `/`; en POSIX la barra invertida es un carácter de nombre.
  Es UNA función para el sandbox y la terminal (dos copias divergentes dejaban el proyecto «sin encontrar»).
- La plataforma es el último parámetro, con la actual por defecto; una ruta que no se sabe traducir LANZA.

## Consecuencias

Nada de esto se ve en Windows: la raíz no tiene symlink ni espacios. `test:rutas-sandbox` fija las dos plataformas
desde cualquiera; la ejecución real en Mac es de `test:sandbox` allí.
