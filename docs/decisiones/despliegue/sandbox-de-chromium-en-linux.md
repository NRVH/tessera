# En Linux, un lanzador quita el sandbox de Chromium solo donde no puede arrancar

- **Estado:** vigente
- **Ámbito:** `scripts/lanzadorLinux.mjs` (gancho `afterPack`), `electron-builder.yml` (`linux`), `src/main/shell/escritorioLinux.ts`

## Contexto

Chromium arranca su sandbox con espacios de nombres sin privilegios o, si no puede, con `chrome-sandbox`
como SUID de root. Ubuntu 23.10+ restringe los espacios de nombres con AppArmor
(`kernel.apparmor_restrict_unprivileged_userns=1`), y algunos sistemas los tienen apagados
(`kernel.unprivileged_userns_clone=0` en Debian, o `user.max_user_namespaces=0`, que deja el tope de espacios de
usuario en ninguno). Un AppImage no puede llevar un `chrome-sandbox` con SUID de root,
así que en esos sistemas Tessera moriría al arrancar sin decir nada útil.

## Decisión

- El ejecutable `tessera` del paquete es un guion `sh` que lanza el binario real (`tessera-bin`). Solo
  añade `--no-sandbox` si los espacios de nombres están restringidos o apagados Y `chrome-sandbox` no es
  SUID de root. En cualquier otro Linux, el sandbox completo.
- «Abrir con Tessera» apunta al AppImage o, sin él, al lanzador, nunca al binario real.

## Consecuencias

- En los Ubuntu recientes el renderer corre sin el sandbox del sistema. El renderer va con
  `contextIsolation` y sin Node, y solo carga el contenido de la propia app.
- WSL no aplica AppArmor: la decisión del guion se prueba con interruptores falsos
  (`test:lanzador-linux`), no con un Ubuntu de escritorio. El tope de espacios de usuario sí existe en WSL: con él a
  0, el binario real muere con el mismo FATAL del sandbox que en esos Ubuntu y el lanzador arranca (medido con el
  paquete de Linux bajo Xvfb).

## Descartes

- `--no-sandbox` siempre (lo que hacen muchas apps empaquetadas como AppImage): quita el sandbox también
  donde funciona.
- Un perfil de AppArmor propio: es lo correcto en un paquete del sistema, pero exige root al instalar y un
  AppImage no instala nada.
