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

## Consecuencias

- `test:registro` falla si reaparecen formas de tuteo en un texto en español.
- Cambiar un texto puede cambiar un selector: las pruebas de interfaz buscan por el texto en español.

## Descartes

- Evitar siempre dirigirse a la persona: las instrucciones de la Academy se alargan y pierden claridad.
- Conservar el tuteo corrigiendo solo lo coloquial: no alcanza el registro formal que corresponde a un entorno profesional.
