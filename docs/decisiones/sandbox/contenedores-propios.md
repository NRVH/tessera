# Tessera solo para o borra un contenedor con su prefijo Y nacido de su imagen

- **Estado:** vigente
- **Ámbito:** `src/main/sandbox/contenedoresPropios.ts`, `gestor/barrido.ts`, `gestor/contenedores.ts`

## Contexto

El barrido de arranque, el cierre y la hibernación borran contenedores con `docker rm -f`. Se elegían por nombre con
`--filter name=tessera-`, que Docker casa por SUBCADENA: cada arranque y cada cierre borraban cualquier contenedor del
usuario con «tessera-» en el nombre (una base de datos local), y recrear un perfil borraba por nombre exacto sin
mirar de quién era.

## Decisión

- Es nuestro si el nombre EMPIEZA por `tessera-` Y sale de `tessera-sandbox-base`: por la etiqueta
  `tessera.sandbox.version` que la imagen copia a cada contenedor o, para los anteriores a la etiqueta, por su
  `Config.Image`. Hacen falta las dos: el nombre solo es lo que fallaba; la imagen sola alcanzaría un contenedor que
  el usuario levantara a mano con otro nombre.
- Un contenedor ajeno con el nombre de un perfil no se para ni se borra: se lanza un error que dice qué hacer.
- Un `ps` que falla es «no se sabe» (`null`), no «ninguno»: el cierre no desmonta raíces con contenedores vivos.
- `pruebas-*` no son de Tessera y el barrido no los ve.

## Consecuencias

Un e2e que arranca la app empaquetada borra los `tessera-*` de las pruebas con Docker que corran a la vez: esas
pruebas no se lanzan en paralelo con el e2e.

## Descartes

- Solo anclar el filtro (`^tessera-`): sigue borrando un `tessera-postgres` del usuario.
- Una etiqueta propia en cada `docker run`: no cubre los contenedores de versiones anteriores.
- `--filter ancestor=`: resuelve a la imagen ACTUAL y deja fuera los creados antes de rehornearla.
