# Una guardia impide que el código común vuelva a dar por hecho un motor concreto

- **Estado:** vigente
- **Ámbito:** `src/shared/test-motores-sueltos.mts`, `src/shared/motores/`, `src/tdb/`

## Contexto

Antes del registro de motores, unos 150 sitios daban por hecho que solo hay Oracle y PostgreSQL con
un `motor === 'oracle' ? A : B`. Al sumar un motor, esos sitios caen en silencio en la rama de
PostgreSQL: compilan y pasan las pruebas que solo recorren dos motores. El compilador vigila los
`Record<DbMotor, …>` y los `switch` con `nunca(x)`; no ve un `=== 'oracle'` suelto nuevo.

## Decisión

`test:motores-sueltos` escanea `src/` (sin pruebas) y falla ante:

- una comparación con un literal de motor, un `case` de un `switch` sin `nunca`, una pertenencia a una
  lista escrita a mano o una lista de motores a mano (para eso está `IDS_MOTORES`);
- una capacidad comparada: las respuestas del descriptor que son uniones (`identidadSinPk`) se miran
  con `switch` y `nunca`, porque un `!== 'rowid'` compila con un tercer valor y lo manda en silencio
  al «si no». Las uniones se LEEN de `FUENTES_UNIONES` (`motores/tipos.ts`, `ReglasDialecto`,
  `escrituraSql/tipos.ts` y los contratos del código por motor del main): si esos archivos se mueven o
  pierden las uniones, `unionesDe` los salta sin ruido y la guardia queda ciega. Se compara por el
  nombre del campo: el literal a secas daba ruido (`'rowid'` es también el `tipo` de `DbIdentidadFila`);
- un nombre de producto («Oracle», «PostgreSQL»…, las etiquetas del registro) en un literal, en texto
  de JSX o en una plantilla de varias líneas de código común. Lo que es de un motor por diseño va en
  `EXCEPCIONES_NOMBRE` con su motivo, o con la marca `motor-fijo:` en su línea;
- la familia: un `d.familia === 'sql'` suelto es la misma trampa.

**Zonas**: quedan exentos los archivos de UN motor, los que llevan su id al final del nombre
(`esArchivoDeMotor`), en `motores/`, `escrituraSql/`, el código por motor del main y `src/tdb/` (una
zona de carpeta más los tres `*Comun.cjs` por ruta). La zona exime a su motor, no a los demás. Una marca
o una excepción que ya no eximen nada fallan: bendecirían la línea para siempre.

## Descartes

- Un parser de TypeScript: arrastra una dependencia; un error suele ser un falso positivo ruidoso.
- Zona por carpeta entera: eximía los comunes de al lado (`definir.ts`, `index.ts`, `tipos.ts`).
- Escanear `e2e/` y las pruebas: recorren motores concretos a propósito.
