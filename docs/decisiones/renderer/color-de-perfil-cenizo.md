# El color de un perfil se guarda tal cual y se rebaja al pintar, dentro de una banda cenizo

- **Estado:** vigente
- **Ámbito:** `features/pestanas/colorPerfil.ts`, `paletaPerfiles.ts`

## Contexto

El color de perfil es la salvaguarda contra la cuenta equivocada: dice en qué espacio de trabajo se está y
debe reconocerse de un vistazo, pero no gritar. Con colores puros, cinco pestañas eran una
guirnalda que competía con el contenido y se salía del registro apagado y frío del tema.

## Decisión

- La tinta (`tintaPerfil`) acota saturación (`SAT_MAX`) y luminosidad (`LUM_MIN`..`LUM_MAX`) a una
  banda cenizo/quemado y conserva el matiz, que es lo que distingue un perfil de otro.
- Se aplica AL PINTAR, no al guardar: en `profiles.json` queda siempre el color elegido (es lo que
  muestra el `<input type="color">`). Persistir la tinta apagaría el color un poco más cada vez que
  alguien abriera el selector y guardara, hasta el gris, y nadie lo relacionaría con la causa.
- Es idempotente por construcción (acota, no multiplica): los colores de la paleta, que ya nacen
  dentro de la banda, pasan por la tinta sin cambiar, y el selector muestra lo que verá la pestaña.
- Los límites viven solo en `colorPerfil.ts` (`SAT_MAX`, `LUM_MIN`, `LUM_MAX`): no se repiten en la
  paleta ni en comentarios. El techo de saturación bajó al calibrar, porque a igual saturación los
  verdes y los rojos pesan más que los azules.
- El resaltado de búsqueda (`tintaResaltado`) usa `LUM_RESALTADO` = 72: sobre la tinta normal la
  letra casi negra del tema da 3,28:1 en el peor caso, bajo el 4,5:1 de WCAG AA; con 72 el peor caso
  de toda la banda es 7,27:1. Cambia de intensidad, no de matiz.
- Un gris (`s < 4`) se queda gris, y un hex inválido se devuelve tal cual: el color sale de un
  archivo editable a mano y aquí no se decide que un perfil se quede sin color.

## Consecuencias

- Un color puro en la paleta lo caza `test-color-perfil.mts`.
- Nunca persistir la tinta.
