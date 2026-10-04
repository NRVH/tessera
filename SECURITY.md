<p align="center">
  <a href="./SECURITY.en.md">Read in English</a>
</p>

# Política de seguridad

Tessera corre agentes de IA junto a tu código, tus credenciales y tus bases de datos, así que
los reportes de seguridad se toman en serio y se atienden antes que cualquier otra cosa.

## Reportar una vulnerabilidad

**Por favor, no abras un issue público por un problema de seguridad.**

Repórtalo en privado mediante los avisos de seguridad de GitHub (Security Advisories):
**[Reportar una vulnerabilidad](https://github.com/NRVH/tessera/security/advisories/new)**
(la pestaña **Security** del repositorio y después **Report a vulnerability**).

Incluye, en la medida de lo posible:

- qué podría hacer un atacante, y en qué condiciones;
- los pasos para reproducirlo, o una prueba de concepto;
- la versión de Tessera (**Configuración › Acerca de**), el sistema operativo y su versión,
  y si el proyecto estaba en modo Docker o en modo nativo.

Tessera lo mantiene una sola persona, así que recibirás respuesta lo antes posible, no en un
plazo fijo. Una vez confirmado el problema, el arreglo se prepara en privado, se publica en
una versión nueva y el aviso se hace público con tu crédito, salvo que prefieras quedar en el
anonimato.

## Versiones soportadas

Solo la **última versión** recibe arreglos de seguridad. Las copias instaladas se actualizan
solas, así que el arreglo llega a los usuarios por la actualización normal.

| Versión | Soportada |
| --- | --- |
| Última versión | Sí |
| Versiones anteriores | No |

## Qué es especialmente sensible

Estas áreas sostienen las promesas de seguridad de Tessera. Una debilidad en cualquiera de
ellas entra en el alcance:

- **El sandbox.** El contenedor de un espacio de trabajo solo debe ver los proyectos de ese
  espacio, sus propias credenciales del agente y, en solo lectura, las llaves SSH. Cualquier
  cosa que permita a un agente llegar a los archivos del equipo, al contenedor o las
  credenciales de otro espacio de trabajo, al daemon de Docker, u obtener privilegios más
  allá del contenedor (escapes por montajes, el ayudante con privilegios, la construcción de
  imágenes, el manejo del entorno o de las rutas) es una vulnerabilidad.
- **Las credenciales de los agentes.** Las sesiones de cada espacio de trabajo y agente se
  guardan por separado y se montan solo mientras el agente corre. Cualquier forma de que un
  espacio o un proyecto lea las credenciales de otro, o de que se filtren a los registros, es
  una vulnerabilidad.
- **El acceso a bases de datos y `tdb`.** Las contraseñas se cifran con el almacén de
  secretos del sistema, y los agentes consultan por `tdb` sin recibirlas. Las conexiones de
  solo lectura deben seguir siéndolo para los agentes. Filtrar una contraseña a un agente,
  saltarse la solo lectura, o usar desde fuera de Tessera el puente local con el que habla
  `tdb` es una vulnerabilidad.
- **La frontera entre la interfaz y el proceso principal.** La interfaz corre aislada y nunca
  debe manejar rutas del equipo. Recorrer rutas fuera de un proyecto (path traversal), o una
  forma de que el contenido de un archivo (Markdown, HTML, SVG, PDF, una clase descompilada)
  ejecute código en la app, es una vulnerabilidad.
- **Las actualizaciones.** Cualquier cosa que pueda hacer que Tessera instale una compilación
  que no salió de las releases de este repositorio.

Fuera del alcance: lo que un agente haga con el acceso que tú le das a propósito (un
proyecto en modo nativo corre con tus permisos por diseño), y los problemas de Claude Code,
Codex, Docker u otro software de terceros, que se reportan a sus mantenedores.
