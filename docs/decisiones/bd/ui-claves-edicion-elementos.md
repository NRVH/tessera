# El visor de Redis edita list, set, zset y stream, y crea claves, con un comando por acción y sin pisar nada

- **Estado:** vigente
- **Ámbito:** `claves/edicionElementos.ts`, `claves/edicionClaves.ts`, `claves/accionesEdicionClave.tsx`,
  `claves/DialogoNuevaClave.tsx`, `claves/DialogoEdicionClave.tsx`, `arbolMenu.tsx`

## Contexto

El visor edita un string y un hash con el molde de [ui-claves-visor.md](ui-claves-visor.md): cada acción
produce UN comando de la consola de Redis, el diálogo enseña ese comando exacto y el main decide la política
(producción, peligrosos, solo lectura impuesta). Los otros cuatro tipos con elementos y la creación de una
clave desde el árbol siguen el mismo molde.

## Decisión

- **Mismo molde, otro módulo.** Los tipos con elementos y la creación viven en `edicionElementos.ts`;
  `edicionClaves.ts` delega en él lo que no es suyo. Ningún tipo nuevo de canal: todo va por la consola.
- **Qué se ofrece por tipo.**
  - list: añadir al final (`RPUSH`), editar por índice (`LSET`), borrar por valor (`LREM … 1`).
  - set: añadir (`SADD`) y borrar (`SREM`).
  - zset: añadir con puntuación (`ZADD`), cambiar la puntuación (`ZADD … XX`, que no resucita un miembro que
    ya no está) y borrar (`ZREM`).
  - stream: añadir una entrada con id automático (`XADD … *`) y borrar por id (`XDEL`). Una entrada no se
    edita: Redis no lo permite.
- **`LREM` quita la PRIMERA coincidencia**, no la de la fila. Con otro elemento igual antes, borrar la fila
  se llevaría otra y el resultado dejaría la lista distinta de la que el usuario espera: la acción se
  deshabilita con el motivo y se remite a la consola.
- **Un valor que no es texto no se edita aquí** (`textoEditable`): se reescribiría como otro texto. Borrarlo sí
  se puede: el comando lleva sus bytes exactos.
- **Crear una clave** (menú de la base, «Nueva clave…»): nombre, tipo y el primer elemento. Antes de enviar
  se lee la clave: si existe, no se envía (un `HSET`, `RPUSH`… sobre una clave que ya existe la ampliaría en
  silencio). El string además va con `NX`, por si apareciera entre la comprobación y el envío. Al terminar, el
  árbol se vuelve a pedir y se abre la pestaña de la clave nueva.
- **Confirmaciones.** Las mismas del resto de ediciones (`useEdicionClave`): en producción el botón del
  diálogo ya dice «Ejecutar en producción» y es la confirmación; si el main devuelve el comando sin enviar,
  el diálogo lo dice y el siguiente clic lo confirma. Tessera informa y pide confirmar; no prohíbe.
- **Borrar el último elemento borra la clave** (lo hace el servidor): tras un `quitar*` el árbol se vuelve a pedir.

## Descartes

- Un canal propio de edición con el valor en estructura: obligaría al main a conocer cada tipo y se saltaría
  la política de la consola, que es el único sitio que clasifica comandos.
- Borrar un elemento de una lista por índice (`LSET` a un marcador y `LREM`): escribe una clave temporal en el
  valor y falla a medias si algo se cuela entre los dos comandos.
- Editar el miembro de un set o de un zset: es borrar y añadir, y el diálogo no puede hacerlo atómico.
- Elegir la caducidad al crear: ya está en «Caducidad…» de la pestaña de la clave.
