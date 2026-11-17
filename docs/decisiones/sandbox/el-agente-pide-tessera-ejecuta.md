# El agente pide y Tessera ejecuta: los secretos y el acceso al host no entran al contenedor

- **Estado:** vigente
- **Ámbito:** el diseño de toda función que comparta datos, credenciales o acceso con los agentes del contenedor; hoy,
  `src/tssh/`, `src/tdb/`, los puentes de `src/main/ssh/controlador/` y `src/main/db/`, y los montajes de
  `src/main/sandbox/gestor/`

## Contexto

El contenedor del agente es la frontera que promete Tessera: el agente puede trabajar en los proyectos del perfil y
usar sus conexiones, pero no tocar el resto del equipo. Un agente puede seguir instrucciones escondidas en un repo, así
que lo que haya dentro del contenedor hay que darlo por leído. La auditoría de seguridad lo confirmó: los fallos graves
salieron donde un secreto entraba al contenedor como archivo (las claves SSH) o donde el host se fiaba de lo que el
contenedor escribe (enlaces del proyecto, configuración de git: `proyecto-montado-no-confiable.md`). Donde el agente
pide y Tessera ejecuta (`tssh`, `tdb`), el secreto nunca estuvo al alcance.

## Decisión

- **Los secretos no entran al contenedor.** Contraseñas, claves privadas y cadenas de conexión se quedan en el host (el
  llavero del sistema o los almacenes de Tessera). El agente pide la operación por una orden de Tessera (`tssh`,
  `tdb` y las que se añadan) y el proceso de Tessera en el host la hace con el secreto en el momento. La respuesta
  trae el resultado de la operación, nunca el secreto ni cómo se obtuvo. Las rutas del equipo dicen quién es el usuario
  y dónde guarda Tessera sus datos: la orden lanzada para un contenedor lleva una marca con la que su diagnóstico no
  imprime ninguna y sus errores salen sin la carpeta personal ni las rutas que Tessera conoce (las de sus conexiones y
  las que entrega a ssh). Una ruta que el sistema o un driver escriban de otra forma puede pasar.
- **Pedir no es poder pedirlo todo.** Cada orden comprueba qué puede pedir quien llama: las conexiones de su perfil, el
  modo de cada una (solo lectura o escritura), la huella confirmada del servidor, y deja registro de lo pedido. Un
  token del puente vale para su contenedor y su perfil, nunca para otro.
- **Lo que el contenedor escribe no decide qué hace el host.** Lo que tiene que estar montado con escritura (el código
  de los proyectos, la configuración del propio agente) el host lo trata como no confiable: no sigue sus enlaces al
  escribir ni ejecuta su configuración (`proyecto-montado-no-confiable.md`).
- **Lo que no puede ir por pedido se justifica.** El código del proyecto está montado porque el agente trabaja sobre
  él, y la sesión del CLI del agente vive en su carpeta de cuenta porque el CLI la necesita (`contenedor-por-cuenta.md`
  la aísla por cuenta). Cualquier otra excepción se escribe en el ADR de esa función.
- **La frontera es el perfil.** Dentro de un perfil, sus proyectos comparten bases y conexiones por diseño (un perfil es
  una empresa); entre perfiles no se comparte nada, tampoco los secretos del usuario que no son de ninguno.

## Consecuencias

- Una función nueva que dé a los agentes datos, credenciales o acceso pasa por una orden de Tessera, o su ADR dice por
  qué no (regla de `CLAUDE.md`).
- SSH cumple el principio mediante el agente de Tessera (`../ssh/agente-del-contenedor.md`): el contenedor
  solicita identidades y firmas, el host comprueba el permiso del perfil y conserva todas las claves privadas.

## Descartes

- Aislar dentro del contenedor (usuarios y permisos por sesión): todos los procesos del contenedor corren con el mismo
  usuario y las carpetas montadas desde Windows no respetan permisos.
- Cifrar los secretos dentro del contenedor: la clave para descifrarlos tendría que estar también dentro.
