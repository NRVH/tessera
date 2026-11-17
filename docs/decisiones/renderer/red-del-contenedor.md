# La red del contenedor se decide en un diálogo con diagnóstico, y se confirma antes de persistir

- **Estado:** vigente
- **Ámbito:** `features/pestanas/ModalRedContenedor.tsx`, `DialogosPerfil.tsx`, `useAccionesPerfil.ts`; el diagnóstico vive en `src/main/sandbox/redAnfitrion.ts`

## Contexto

La red del anfitrión (`--network host`) como un simple interruptor del menú del perfil mentiría por tres
sitios: solo persistiría el flag (un contenedor vivo no cambia de red: se aplica al recrearlo); no
comprobaría sus requisitos de máquina (con «Enable host networking» apagado en Docker Desktop,
`docker run` devuelve 0 igual y los puertos se quedan en la VM); y no diría lo que se pierde
(`--hostname`, y dos perfiles en este modo comparten el espacio de puertos del equipo).

## Decisión

- Es un diálogo (el ítem sigue en el menú del perfil). «Aplicar» persiste el modo y recrea el
  contenedor hibernando el perfil: el despertar es perezoso y el siguiente nace con la red nueva.
- Los textos del diagnóstico llegan del main ya redactados: el renderer no tiene `process` y las
  cadenas específicas de sistema obligarían a exentar `test:nombres-sistema`.
- «Aplicar» NUNCA se deshabilita, ni con el prevuelo en rojo: la sonda puede dar un falso negativo
  y quitar una función que hoy funciona es peor que un aviso de más.
- Se confirma ANTES de persistir, con la regla de «Hibernar el perfil» (`pestanas/confirmaciones.ts`),
  porque aplicar lo hiberna: un agente trabajando o una terminal que ejecuta algo. Pregunta su propio
  diálogo («Cambiar la red de…»), que nombra los dos motivos, y el modo se guarda al confirmar;
  guardar y luego preguntar dejaría, al cancelar, una red que su contenedor no tiene.
- La respuesta del prevuelo se descarta solo si el diálogo ya se cerró (ref de montaje), no con una
  limpieza por ejecución: ésta dejaría `midiendo` en true para siempre si se alterna la elección
  mientras mide, y el candado impediría reintentar. Tampoco va `midiendo` en las dependencias.

## Consecuencias

Los dos candados del prevuelo (barato al abrir, medido al elegir anfitrión) no se fusionan: el aviso
«sigue con la red anterior» debe salir también al volver de anfitrión a aislada.
