# La red del contenedor se decide en un diálogo con diagnóstico, y se confirma antes de persistir

- **Estado:** vigente
- **Ámbito:** `features/pestanas/RedContenedorModal.tsx`, `DialogosPerfil.tsx`, `useAccionesPerfil.ts`; el diagnóstico vive en `src/main/sandbox/redAnfitrion.ts`

## Contexto

La red del anfitrión (`--network host`) era un interruptor del menú del perfil y mentía por tres
sitios: al soltar solo persistía el flag (un contenedor vivo no cambia de red: se aplica al
recrearlo); no comprobaba sus requisitos de máquina (con «Enable host networking» apagado en
Docker Desktop, `docker run` devuelve 0 igual y los puertos se quedan en la VM); y no decía lo que
se pierde (`-p`, `--hostname`, y dos perfiles en este modo chocan por el puerto 1455 del login).

## Decisión

- Es un diálogo (el ítem sigue en el menú del perfil). «Aplicar» persiste el modo y recrea el
  contenedor hibernando el perfil: el despertar es perezoso y el siguiente nace con la red nueva.
- Los textos del diagnóstico llegan del main ya redactados: el renderer no tiene `process` y las
  cadenas específicas de sistema obligarían a exentar `test:nombres-sistema`.
- «Aplicar» NUNCA se deshabilita, ni con el prevuelo en rojo: la sonda puede dar un falso negativo
  y quitar una función que hoy funciona es peor que un aviso de más.
- Se confirma ANTES de persistir. Con un agente trabajando se pasa por la misma confirmación que
  «Hibernar perfil» y el modo se guarda al confirmar; guardar y luego preguntar dejaba, al cancelar,
  el perfil marcado con una red que su contenedor no tiene.
- La respuesta del prevuelo se descarta solo si el diálogo ya se cerró (ref de montaje), no con una
  limpieza por ejecución: ésta dejaba `midiendo` en true para siempre si se alternaba la elección
  mientras medía, y el candado impedía reintentar. Tampoco va `midiendo` en las dependencias.

## Consecuencias

Los dos candados del prevuelo (barato al abrir, medido al elegir anfitrión) no se fusionan: el aviso
«sigue con la red anterior» debe salir también al volver de anfitrión a aislada.
