# Un proyecto que nace para ver un archivo desde el sistema nace con el agente diferido

- **Estado:** vigente
- **Ámbito:** `OpenProject.agenteDiferido` (`pestanas/tabsModel.ts`), `planAperturas.ts`, `agentes/useColumnaAgente.ts`, `useAgentesApp.ts`, `textosAgenteDiferido.ts`

## Contexto

Abrir un archivo suelto desde el gestor de archivos del sistema creaba un proyecto con su carpeta
y arrancaba su agente (con sus servidores MCP), para un archivo que solo se quería mirar. Cada uno
dejaba una sesión viva y una columna que le quitaba ancho al archivo.

## Decisión

- La marca `agenteDiferido` va en el PROYECTO y nace en la MISMA acción que lo crea
  (`openProject`), solo cuando la apertura es un ARCHIVO que no cae en nada abierto. Un proyecto
  ya abierto no la gana, y abrirlo después como CARPETA (o desde el diálogo) se la quita. Se guarda
  con el proyecto y muere con él; un conjunto en los ajustes sobreviviría al cierre del proyecto.
- El agente no arranca porque el target efectivo de la columna es `null` (como el agente de datos
  oculto): sin pane visible no hay latch ni sesión. No se tocan `visible` ni `seEstaMirando`.
- La columna se pliega SOLO en ese proyecto: la marca se suma al oculto en `useColumnaAgente`, como
  la vista dividida. No es un motivo de `ccOculto`, que es de la ventana.
- Desplegar con el conmutador de la barra de estado quita la marca y el agente arranca. Sin
  pestañas la columna llena el centro con un vacío propio y su botón «Iniciar…», que solo quita la
  marca: no toca el oculto de la ventana, o borraría un 'manual' elegido para los demás proyectos.
- La marca se quita también si ese agente arranca por otra vía (una casilla del mosaico, «Ir al
  proyecto»): si no, la columna diría que no se ha iniciado encima de una sesión viva. Y se lee
  del proyecto VIVO, no de la foto del objetivo confirmado, que puede ser de antes de cerrarlo.
- El archivo se abre en el mismo turno en que se confirma el proyecto, así que la columna no llega
  a pintarse antes de plegarse (medido en el e2e, por fotogramas y con una mutación que lo provoca).

## Consecuencias

- Pasar por un proyecto diferido cancela un maximizado, como la vista dividida
  (`layout/oculto-manda-sobre-maximizado.md`).
- Una versión anterior descarta la clave al normalizar y arrancaría el agente: compatible.

## Descartes

- Un estado «en espera del archivo» en la regla del centro: no hay destello que tapar.
- No montar el pane: la columna monta uno por target abierto (`agentes/columna-del-agente.md`).
