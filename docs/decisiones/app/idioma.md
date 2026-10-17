# La interfaz habla español o inglés, con textos tipados junto a su código, y el idioma se fija al arrancar

- **Estado:** vigente
- **Ámbito:** `src/shared/i18n.ts`, `src/main/app/idioma.ts`, `src/renderer/src/util/idiomaArranque.ts`, los `textos*.ts` de cada área, `src/tdb/`, `src/tssh/`

## Contexto

Todo el texto que ve el usuario nace en el código, repartido entre el renderer,
el main (diálogos nativos, menú de macOS, errores que llegan por IPC), `shared` y las órdenes `tdb` y
`tssh`. Hace falta el inglés, con el del sistema por defecto y elegible en Configuración.

## Decisión

- **Módulo propio en `shared/i18n.ts`, sin biblioteca.** Cada área declara sus textos con
  `crearTextos(es, en)` junto a su código; el tipo `Textos<T>` obliga al inglés a tener las mismas
  claves y las mismas firmas que el español, así que una traducción que falta no compila. Plurales e
  interpolación son funciones del propio texto; fechas y números, con `localeActual()`.
- **El idioma se fija una vez al arrancar.** El main lo resuelve tras `whenReady` (variable de las
  pruebas, ajuste guardado, idiomas preferidos del sistema: el primero que Tessera habla, si no
  inglés), lo pasa a la ventana como argumento y al entorno de `tdb` y `tssh`. Cambiarlo en
  Configuración pide reiniciar, y la fila ofrece hacerlo por el cierre ordenado.
- **Los textos se leen al usarse** (`tx().clave` dentro de la función o del componente), nunca en el
  nivel superior de un módulo: allí se evaluarían antes de fijar el idioma.
- **Fuera de la traducción:** las instrucciones y los bloques de memoria que Tessera da a los agentes
  de IA (las entienden igual en español), los registros de diagnóstico y el CHANGELOG.
- **Las pruebas de interfaz corren en español** (`TESSERA_FORZAR_IDIOMA`): sus selectores buscan el
  texto. Un spec propio lanza la app en inglés.

## Consecuencias

- Cambiar de idioma no reconstruye nada en caliente: ni el menú, ni los diálogos, ni las cadenas que
  el main ya devolvió.
- Un texto declarado con `crearTextos` sin su inglés no compila; uno escrito como literal fuera de
  los `textos*.ts` sí compila y sale solo en español.

## Descartes

- **Una biblioteca de i18n con claves de texto:** una clave que falta solo se ve en ejecución, y
  `tdb` (CommonJS, sin empaquetar) necesitaría otra solución igualmente.
- **Cambio en caliente:** obligaría a que cada texto del main y cada constante de módulo sea reactiva,
  por un gesto que se hace una vez.
