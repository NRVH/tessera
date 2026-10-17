# Las raíces gestionadas viven en la VM en Windows y bajo `userData` en macOS, una por instancia

- **Estado:** vigente
- **Ámbito:** `src/main/sandbox/rutasSandbox.ts`, `src/main/sandbox/gestor/nombres.ts`, `gestor/barrido.ts`

## Contexto

`/workspace` se monta desde una raíz gestionada preparada como `rshared` en el namespace del daemon, y cada proyecto
entra después en caliente con `mount --bind`: así un contenedor vivo ve aparecer proyectos sin recrearse (recrearlo
mataría la sesión del agente). En Windows la raíz está dentro de la VM. Docker Desktop para Mac RECHAZA montar una
ruta que solo existe en la VM («mounts denied: … is not shared from the host»).

Varias Tessera pueden compartir un Docker: la del usuario y la de su arnés de pruebas (que arranca la app empaquetada
con otro `userData`), o dos usuarios de un mismo equipo Linux. El barrido de arranque y el cierre desmontan TODO lo que
cuelga de las raíces: si fueran las mismas, una instancia les quitaría a las otras los proyectos de sus contenedores.

## Decisión

- Cada instancia tiene sus raíces, por la huella de su `userData` (`huellaInstancia`).
- Windows: `/mnt/wsl/tessera-<huella>/sandbox-mm` y `…/sandbox-agentcfg`, dentro de la VM. Las de antes
  (`/mnt/wsl/tessera-mm` y `/mnt/wsl/tessera-agentcfg`, `RAICES_WINDOWS_HEREDADAS`) solo las limpia el barrido de
  arranque de la app, para los montajes que dejó una versión anterior, en el mismo auxiliar privilegiado que las
  suyas (uno más costaría un segundo en cada arranque); el del arnés de pruebas no, porque pueden ser los de la
  Tessera que el usuario tiene abierta.
- macOS: las raíces son rutas REALES del host bajo `userData` (cuelga de `/Users`, compartida de fábrica). Medido:
  `nsenter -t 1 -m` entra igual, `/Users` existe en la VM con la misma ruta (por eso `aRutaDelDaemon` es la
  identidad), `--make-rshared` y el bind en caliente funcionan. Desde macOS la carpeta del perfil se ve vacía: el
  aislamiento no se degrada.
- Linux: en `$XDG_RUNTIME_DIR/tessera-<huella>/` (`/run/user/<uid>`), no bajo `userData`. Con Docker nativo
  `nsenter -t 1 -m` entra en el espacio de nombres del PROPIO equipo y los montajes son rutas vivas del usuario con
  los proyectos dentro: bajo `~/.config` los recorrerían un `rm -rf` de la configuración, las copias de seguridad y
  los indexadores. El directorio de ejecución es un tmpfs que se vacía al reiniciar.
- Proyectos y credenciales son árboles SEPARADOS y hermanos, sin prefijo común, en todas las plataformas: las guardas
  de limpieza por prefijo de uno no confunden montajes del otro.
- `fijarBaseGestionada(userData)` se llama ANTES de construir el `SandboxManager` y fija también el sello de los
  contenedores (`contenedores-propios.md`). Hay UNA variable de raíces; su respaldo `~/.tessera` es el de las
  pruebas, que no pasan por el main.
- Toda ruta que va a un `sh -c` pasa por `citarSh`: la raíz de Mac lleva un espacio (y en Windows un proyecto en
  `D:\Mis Cosas` también).
- `normalizarRutaResuelta`: solo Windows cambia `\` por `/`; en POSIX la barra invertida es un carácter de nombre.
  Es UNA función para el sandbox y la terminal (dos copias divergentes dejaban el proyecto «sin encontrar»).
- La plataforma es el último parámetro, con la actual por defecto; una ruta que no se sabe traducir LANZA.

## Consecuencias

Nada de esto se ve en Windows: la raíz no tiene symlink ni espacios. `test:rutas-sandbox` fija las tres plataformas
desde cualquiera; la ejecución real en Mac es de `test:sandbox` allí. Al actualizar desde una versión con las raíces
compartidas, el primer arranque recrea los contenedores (ya lo hacía: el barrido de arranque los quita todos).
