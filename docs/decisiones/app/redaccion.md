# Los textos en español son formales, tratan de usted y no dejan lugar a dudas

- **Estado:** vigente
- **Ámbito:** los `textos*.ts` de cada área, `src/shared/nombresSistema.ts`, `features/academy/contenido/`, los textos de `src/tdb/`, `src/tssh/` y `src/tctx/`

## Contexto

Tessera es un entorno de desarrollo para profesionales y equipos de empresa. Sus textos enseñan a usar la herramienta,
advierten de riesgos y explican errores: un texto coloquial o ambiguo le resta confianza y puede llevar a una decisión
equivocada.

## Decisión

**Tratamiento**
- Se trata de **usted**: «Seleccione la cuenta», «¿Desea guardar los cambios?», «su equipo». Nunca tú ni vos.
- Se prefiere la forma impersonal cuando la persona no es necesaria: «No se guardaron los cambios».
- Botones, menús, pestañas, títulos y etiquetas no se dirigen a nadie: infinitivo o sustantivo («Guardar cambios», «Historial»).

**Redacción**
- Frases completas, con sujeto y objeto claros; una idea por frase. Sin pronombres cuyo referente haya que adivinar («esto», «lo», «ahí»).
- Nada coloquial, de conversación ni de nota personal: sin humor, exclamaciones, disculpas ni frases hechas.
- Un error dice qué ocurrió, por qué si se sabe y qué puede hacerse. Un riesgo dice la consecuencia concreta.
- Se explica lo necesario para decidir sin consultar nada más. Una etiqueta es breve; su ayuda es una frase; lo extenso va a la Academy.
- Mismas palabras para lo mismo en toda la aplicación. Mayúscula solo inicial; nunca mayúsculas puras.

**Vocabulario**

| Se escribe | No se escribe |
|---|---|
| detener un contenedor o proceso | parar, tumbar, matar |
| hibernar, hibernado, reanudar | dormir, despertar |
| iniciar, ejecutar | arrancar, lanzar |
| manualmente | a mano |
| al mismo tiempo, simultáneamente | a la vez |
| espacio disponible, capacidad | sitio, hueco |
| falla, deja de responder | cae, se rompe, revienta |
| visible en pantalla | el que está mirando |
| seleccionar, elegir | escoger, tocar |
| hacer clic, pulsar una tecla | darle a, picar |
| comprobar, revisar | mirar, echar un ojo |
| en curso, sin terminar | a medias |

La tabla orienta y no sustituye al juicio: el término técnico consolidado se conserva (commit, rama, contenedor, sesión, token).

**Academy**
- Es material de aprendizaje: cada término propio se define o se enlaza al glosario la primera vez que aparece.
- Los procedimientos van en pasos numerados con su resultado esperado; las condiciones y excepciones se dicen de forma explícita.
- Cada etiqueta en negrita coincide exactamente con la de la interfaz (`test-academy.mts`).

**Inglés**
- Sigue el mismo criterio de claridad en registro neutro. Se ajusta cuando el español cambia de significado.

**Fuera de esta decisión**, como en `idioma.md`: las instrucciones a los agentes de IA, los registros de diagnóstico y el CHANGELOG.

## Glosario

| Concepto | Español | Inglés |
|---|---|---|
| Cuenta del agente en contenedor | cuenta de Docker | Docker account |
| Agente definido por el usuario | agente propio | custom agent |
| Perfil | perfil | profile |
| Agente de la vista de bases de datos | agente de bases de datos | database agent |
| Vista de bases de datos | Bases de datos | Databases |
| Panel del historial de Git | Git · Historial | Git · History |
| Mostrar en el gestor de archivos | Mostrar en ${gestor} | Show in ${gestor} |
| Ajustes de la aplicación | Configuración; un elemento es un ajuste | Settings |
| Volver a leer datos | Refrescar | Refresh |
| Contraer o expandir contenido | Contraer / Expandir | Collapse / Expand |
| Añadir elementos | Añadir | Add |
| Selector de archivo o carpeta | Seleccionar… | Choose… |
| Modo de transacción en frases | transacción automática / transacción manual | auto-commit / manual transaction |
| Proceso de Docker | motor de Docker | Docker engine |
| Entorno de los agentes | sandbox de Docker | Docker sandbox |

«Actualizar» se reserva para versiones. «Nativo» conserva su significado técnico y «Archivos» es el nombre del riel.
La barra de transacciones conserva las etiquetas «Tx: Auto» y «Tx: Manual».
No se usan «cuenta aislada», «agente manual», «espacio» como sinónimo de perfil, «agente de datos»,
«Preferencias», «Agregar», «Plegar», «Desplegar», «Recargar» ni «daemon» para estos conceptos.

## Convención

- Cada cambio de significado se refleja en español e inglés, y en las etiquetas citadas por Academy y las pruebas.
- Los botones se citan con «Haga clic en «Refrescar»» y “Click “Refresh””; «pulsar» se reserva para teclas.
- Los nombres de usuario y las etiquetas citadas van entre «comillas angulares» en español y “comillas tipográficas” en inglés.
  Se conserva la sintaxis de comillas de los comandos y los caracteres que se muestran literalmente.
- Los botones de selección dicen «Seleccionar…» / “Choose…”. Los títulos nativos usan infinitivo y objeto:
  «Seleccionar el archivo de configuración de OpenSSH» / “Choose the OpenSSH configuration file”.
- Una acción que abre un diálogo lleva «…»; una edición en línea y el botón que confirma un diálogo no lo llevan.
- Los plurales se resuelven dentro de la función del texto con `n === 1`; no se escriben «archivo(s)» ni «perfil(es)».
- Los atajos se añaden entre paréntesis: «Detener (Ctrl+Intro)» / “Stop (Ctrl+Enter)”.
- Los menús omiten el artículo: «Eliminar clave…». Los títulos identifican el objeto: «Eliminar la clave «sesión»».
  «Eliminar» destruye, «Borrar» vacía y «Quitar» saca de una lista sin destruir.
- Las pistas usan «Texto. Haga clic para cambiar», «Haga doble clic para ver las diferencias» y «Mayús+clic añade…».
  Un texto emergente de una sola frase no lleva punto final; si tiene varias, se puntúan como frases.
- El inglés evita contracciones como “couldn’t” y “doesn’t”. Las mayúsculas puras se reservan para siglas,
  nombres técnicos, comandos y formatos enumerados en `scripts/calidad/test-registro.mts`.
- `test:registro`, ejecutado por el pre-commit, comprueba tuteo, vocabulario, glosario, comillas, plurales,
  contracciones y mayúsculas con diagnósticos `archivo:línea`. Se excluyen los bloques de salida de terminal de `tdb`.

## Consecuencias

- `test:registro` falla si reaparecen formas de tuteo en un texto en español.
- Cambiar un texto puede cambiar un selector: las pruebas de interfaz buscan por el texto en español.

## Descartes

- Evitar siempre dirigirse a la persona: las instrucciones de la Academy se alargan y pierden claridad.
- Conservar el tuteo corrigiendo solo lo coloquial: no alcanza el registro formal que corresponde a un entorno profesional.
