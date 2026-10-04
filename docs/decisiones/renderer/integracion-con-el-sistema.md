# La integración con el sistema es la única categoría que escribe fuera de Tessera, y por eso viene apagada

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/ajustes/categorias/Integracion.tsx` y las filas de la categoría en `catalogo.ts`

## Contexto

El resto de Configuración cambia cómo se ve o se comporta la app. Esta categoría toca el registro de
Windows o `~/Library/Services` en macOS, que son del usuario, y la escritura puede fallar por causas
ajenas a la app.

## Decisión

- Viene APAGADA de fábrica: una aplicación no escribe en el registro ni en el HOME porque sí.
- Cada cambio se aplica por su PROPIO canal y se espera la respuesta, en vez de colgarse del guardado
  de ajustes: ese canal no puede rechazar por un efecto secundario, y un interruptor que dice que sí
  y no hizo nada es peor que no tenerlo. Si falla, se cuenta en el propio panel y en claro.
- Los componentes NO preguntan por la plataforma: `catalogo.categoriasVisibles` ya poda las filas y
  el componente solo mira `ve(id)`. Preguntar además en el componente crearía dos fuentes de verdad,
  y mandaría la que no ve el buscador.
- Windows: Tessera no puede ser la aplicación predeterminada de una extensión. La elección vive en
  `UserChoice`, con un hash que firma el sistema por usuario y extensión, y cualquier escritura a mano
  la invalida. Solo se puede aparecer en «Abrir con», y el botón lleva al panel del sistema.
- macOS: «Abrir con › Tessera» sobre un archivo ya funciona sin interruptor (lo declara el paquete en
  `CFBundleDocumentTypes` y lo indexa Launch Services). Está escrito en la interfaz porque, sin esa
  frase, un interruptor donde Windows tiene cuatro parece media función.
- El interruptor del Finder se siembra con el disco (existe el `.workflow`), no con el ajuste
  persistido: el usuario puede borrarlo desde fuera.

## Consecuencias

- No mover el valor de fábrica a encendido ni ligar la escritura al guardado de ajustes.
- El campo libre de extensiones lleva estado local en crudo: con el valor normalizado como `value`
  el cursor salta al añadirse el punto en el mismo render.
- Los nombres de plataforma que aparecen a pelo en `Integracion.tsx` están exentos en
  `test-nombres-sistema.mts` por archivo: mover un bloque a otro archivo exige mover su exención.
