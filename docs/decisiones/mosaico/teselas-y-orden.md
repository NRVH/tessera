# Las teselas del mosaico son claves en orden canónico, una por proyecto y estables mientras está abierto

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/mosaico/mosaicoTeselas.ts` y su prueba

## Contexto

El mosaico sirve para vigilar varios proyectos a la vez y encontrar cada agente sin leer. Cada
cambio de pertenencia reparte la rejilla y redimensiona las terminales de todos los agentes.

## Decisión

- **Una casilla por proyecto.** Los dos agentes de un proyecto nunca son dos teselas; el agente se
  cambia dentro de la casilla. Lo defienden `seleccionInicial`, `alternar` y `reemplazar`.
- **El estado son claves** (`string[]`); los candidatos se derivan en cada render de las pestañas,
  y si `orden` y `vivos` discrepan manda `orden`.
- **Orden canónico, nunca de selección:** perfil, pestaña del proyecto, agente y la clave como
  desempate. La clave se compara con `<`, no con `localeCompare`, para ordenar igual en las dos
  plataformas; un índice NaN va al final de su nivel para no romper la transitividad de `sort`.
- **Al entrar, solo lo que trabaja**; si no trabaja nadie, la activa (o la primera): nunca vacío. Si
  trabajan más de las que caben, prioridad (activa, turno sin mirar, resto) decide quién entra.
- **Pertenencia estable:** una tesela cuyo target existe se queda aunque su sesión muera (pinta su
  reinicio); solo sale si el target desaparece. Nada entra solo: lo mete el usuario.
- **Alternar con el mosaico lleno sustituye la menos reciente**; sin rastro de uso, la última en
  orden canónico. Reemplazar hacia un destino que ya es tesela no hace nada.
- **Visto** = solo la tesela enfocada, para que el aviso de «terminó y no lo has revisado» salga.
- **Tope** `max` ≤ `MAX_TESELAS`; al bajar, se recortan primero las que no están vivas.
- Sin cambios se devuelve la misma referencia `prev`.

## Consecuencias

- No se deriva la pertenencia de «vivos» ni se ordena por selección: rompe la memoria espacial y
  hace refluir la rejilla de todos por la salida de uno.

## Descartes

- Guardar candidatos enteros (el orden quedaría viejo al reordenar perfiles), rellenar hasta el tope
  por prioridad, deshabilitar la casilla al llegar al tope y marcar como vista toda tesela pintada.
