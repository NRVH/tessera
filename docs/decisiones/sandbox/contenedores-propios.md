# Tessera solo para o borra un contenedor con su prefijo, nacido de su imagen y de su instancia

- **Estado:** vigente
- **Ámbito:** `src/main/sandbox/contenedoresPropios.ts`, `gestor/barrido.ts`, `gestor/contenedores.ts`, `gestor/nombres.ts`

## Contexto

El barrido de arranque, el cierre y la hibernación borran contenedores con `docker rm -f`. Se elegían por nombre con
`--filter name=tessera-`, que Docker casa por SUBCADENA: cada arranque y cada cierre borraban cualquier contenedor del
usuario con «tessera-» en el nombre (una base de datos local), y recrear un perfil borraba por nombre exacto sin
mirar de quién era.

Y varias Tessera pueden compartir un Docker: la del usuario y la de su arnés de pruebas, o dos usuarios de un equipo
Linux con el Docker del sistema. Cada una barría al arrancar los contenedores de las demás, y dos perfiles con el
mismo id en dos instancias compartían el nombre `tessera-<id>`.

## Decisión

- Es de Tessera si el nombre EMPIEZA por `tessera-` Y sale de `tessera-sandbox-base`: por la etiqueta
  `tessera.sandbox.version` que la imagen copia a cada contenedor o, para los anteriores a la etiqueta, por su
  `Config.Image`. Hacen falta las dos: el nombre solo es lo que fallaba; la imagen sola alcanzaría un contenedor que
  el usuario levantara a mano con otro nombre.
- Es de ESTA instancia si además lleva su sello en la etiqueta `tessera.instancia` (la huella de su `userData`, la
  misma de sus raíces: `raices-por-plataforma.md`). El nombre también lo lleva: `tessera-<sello>-<id del perfil>`.
  El cierre, la hibernación y el barrido solo tocan los suyos.
- Un contenedor sin sello es de una versión anterior: lo barre el arranque de la app (`heredados`), nunca el del
  arnés de pruebas, que podría estar corriendo junto a la Tessera abierta del usuario. En Linux tampoco: su Docker
  lo comparten los usuarios del equipo y ninguna versión publicada creó allí contenedores sin sello.
- Sin sello fijado (las pruebas que usan el `SandboxManager` sin pasar por el main) se barren todos, como antes.
- En Linux la imagen lleva el uid del usuario en la etiqueta (`tessera-sandbox-base:u<uid>`): dos usuarios de un
  Docker no se la rehornean el uno al otro con su uid en cada arranque.
- Un contenedor ajeno con el nombre de un perfil no se para ni se borra: se lanza un error que dice qué hacer.
- Un `ps` que falla es «no se sabe» (`null`), no «ninguno»: el cierre no desmonta raíces con contenedores vivos.
- `pruebas-*` no son de Tessera y el barrido no los ve.

## Consecuencias

El primer arranque tras actualizar desde una versión sin sello barre los contenedores de la anterior y los recrea
con el nombre nuevo. Mientras el usuario siga con una versión sin sello, su arnés de pruebas ya no le borra los
contenedores (no barre los heredados), pero la versión vieja sí borraría los del arnés al arrancar.

## Descartes

- Solo anclar el filtro (`^tessera-`): sigue borrando un `tessera-postgres` del usuario.
- La etiqueta de instancia SOLA, sin la de la imagen: no cubre los contenedores de versiones anteriores.
- `--filter ancestor=`: resuelve a la imagen ACTUAL y deja fuera los creados antes de rehornearla.
- Un sello por usuario del sistema en vez de por `userData`: no separa la app de su arnés de pruebas, que corren
  con el mismo usuario.
