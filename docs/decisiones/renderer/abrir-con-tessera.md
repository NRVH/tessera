# «Abrir con Tessera» se recoge de la cola del main y se ejecuta esperando al momento correcto

- **Estado:** vigente
- **Ámbito:** `features/pestanas/useAperturasExplorador.ts`, `planAperturas.ts`, `main/shell/abiertosEfectivos.ts`

## Contexto

El main resuelve la ruta (existe, archivo o carpeta, de qué contenedora) y la deja en una cola.
El renderer solo la ejecuta, y el trabajo real es esperar: si se actúa antes de tiempo, la ruta se
pierde en silencio, que es el peor desenlace para un clic del usuario.

## Decisión

- No se recoge antes de que los ajustes estén cargados: el modo de los proyectos llega en el
  mismo efecto que `settingsLoaded` y fijarlo antes lo pisaría al resolver la carga.
- Se recoge sin esperar a las pestañas restauradas, pero diciéndolo (`pestanasCargadas`): hasta
  entonces el main resuelve también contra los proyectos PERSISTIDOS. Esperar al `init` para
  recoger arrancaría siempre el agente del proyecto restaurado antes de cambiar al pedido.
- No se abre nada sin pestañas cargadas ni sin perfil («cero perfiles» es un estado legítimo): se
  espera y, si no llegan, se AVISA. Lo que el renderer ve abierto se activa, diga lo que diga el
  main (`planApertura`); solo lo que no está abierto en ningún perfil nace nuevo y nativo, y si es
  para ver un archivo, con el agente diferido (`agentes/agente-diferido.md`).
- Abrir el proyecto se hace en `procesar`, no en `recoger`: dentro de un `if (perfil !== null)` de
  `recoger`, una apertura que llegaba antes de haber perfil no abría nada y nunca se confirmaba.
- El archivo o el árbol se tocan solo cuando `confirmado` es el objetivo esperado: las pestañas de
  editor cuelgan del target confirmado y `openTab` es un no-op silencioso si aún es el anterior.
- Si el proyecto ya estaba abierto en OTRO perfil, se cambia también el perfil activo:
  `confirmedTarget` sigue al perfil activo y, sin cambiarlo, el proyecto se activaba en la sombra.
- La cola del main se vacía de una vez (una recarga no repite aperturas) y una recogida en vuelo no
  se solapa: un aviso intermedio se anota y se repite al terminar.
- El temporizador de respaldo (20 s) se arma en `procesar`, no en un efecto: lo que añade pendientes
  no cambia las dependencias de ningún efecto.

## Consecuencias

- Mover la apertura a `recoger` o el respaldo a un efecto reabre la pérdida silenciosa de aperturas.
- Sin la unión con lo persistido o sin la defensa de `planApertura`, abrir un archivo en frío saca
  del contenedor (modo nativo) a un proyecto restaurado, o abre un duplicado nativo encima.
- «Nuevo» significa «no abierto en ningún perfil ahora»: un proyecto cerrado no deja rastro de su
  modo, y el diálogo de carpeta usa el mismo criterio.
