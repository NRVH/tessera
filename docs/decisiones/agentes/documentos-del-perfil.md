# Los agentes leen los documentos del perfil con `tctx docs`, por su nombre, igual en nativo y en Docker

- **Estado:** vigente
- **Ámbito:** `src/shared/documentosPerfil.ts`, `src/shared/documentos-ipc.ts`, `src/main/documentos/`, `Profile.documentos`
  (`profiles/types.ts`, `validate.ts`), `ContextoGlobal.documentos`, `reglas/componer.ts`, `briefingCompuesto.ts`
  (`AVISO_DOCUMENTOS`), `src/tctx/` (`docs`) y, en el renderer, `agentes/contexto/PanelDocumentos.tsx` y la acción
  `setProfileDocumentos`

## Contexto

Las reglas del perfil tienen tope, así que lo largo (un contrato, una guía de trabajo) acaba en documentos que las
reglas citan por la ruta del equipo de quien las escribió. Un agente en Docker no tiene esa ruta: solo ve el proyecto
en el que se abrió. Montar la carpeta tampoco basta, porque la ruta citada seguiría sin existir dentro.

## Decisión

- **Cada nivel del contexto guarda carpetas**: el perfil (`Profile.documentos`) y el global, hasta 10 cada uno, que
  el usuario elige en el contexto de los agentes ([contexto-de-los-agentes.md](contexto-de-los-agentes.md)). Un
  agente ve las del global, si su perfil lo usa, y las del perfil, juntas y sin repetir. No se copia nada: Tessera
  lee los documentos en el momento en que se piden, así que se editan donde siempre.
- **`tctx docs`** los lista y **`tctx docs <nombre>`** entrega uno, por el mismo puente y el mismo buzón que el resto
  de `tctx`: funciona igual en nativo y en Docker, y el perfil sale del token de la sesión. Un agente solo ve los
  documentos de su perfil y, si este usa el contexto global, los del global.
- **Cada documento se nombra `<carpeta>/<ruta dentro de ella>`**, un nombre que vale igual en cualquier entorno, y
  basta el nombre del archivo si no se repite.
- **Solo lectura y solo lo listado**: el nombre pedido se busca en el listado, nunca se construye una ruta con él. El
  recorrido no sigue enlaces ni entra en lo oculto, llega a cuatro niveles y a 500 documentos, y solo cuenta las
  extensiones de texto. Al abrir, `O_NOFOLLOW`. Cada documento, 256 KiB como mucho.
- **El aviso de arranque lo anuncia** cuando el agente tiene carpetas, del perfil o del global, y dice que un
  documento citado por una ruta que no existe se busca por su nombre de archivo: así sirven las reglas y los
  `AGENTS.md` ya escritos con rutas.
- **Las carpetas no viajan en la copia de configuración**, ni al exportar ni al importar: son rutas de este equipo
  que los agentes del perfil leen, también en Docker, y una copia ajena podría nombrar cualquiera. Se eligen otra
  vez en el equipo de destino.
- **La carpeta elegida puede ser un enlace o una junction** (la eligió el usuario); dentro de ella no se sigue
  ninguno. Se entrega UTF-8, o UTF-16 con su marca, que es lo que escribe la redirección de PowerShell 5.1.
- **Escribirlos no es cosa de `tctx`**: un agente nativo los edita en el disco, como cualquier archivo; uno en Docker
  no puede cambiar el contrato que lo gobierna.

## Consecuencias

- Una carpeta que no existe en este equipo (una copia traída de otro) se dice, en el contexto de los agentes y en
  `tctx docs`.
- Los documentos se leen enteros en cada petición; con los topes, el coste es acotado.
- Lo fijan `test:documentos-perfil` (listado, nombres, ambigüedad, enlaces, tamaño, texto) y `test:tctx` (los
  argumentos de `docs`).

## Descartes

- **Montar las carpetas en el contenedor**: la ruta citada seguiría sin existir dentro, y habría que mantener un
  montaje más por perfil.
- **Subir el tope de las reglas**: el aviso viaja en la línea de arranque, que tiene un límite del sistema.
- **Copiar los documentos dentro de Tessera**: habría dos versiones que mantener a mano.
