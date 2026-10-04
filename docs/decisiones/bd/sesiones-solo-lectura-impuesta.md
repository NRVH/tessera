# La solo lectura del explorador es la que se le impone, no la casilla de la conexión

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/soloLecturaImpuesta.ts` y quien la inyecta (gestores y controlador)

## Contexto

La casilla «Solo lectura» de una conexión (`DbConnection.readonly`) existe para que los agentes,
que consultan por `tdb`, no editen ni borren. Leída también por el explorador limitaba al humano
con una casilla pensada para el agente.

## Decisión

- En el explorador la casilla no limita al usuario: edita, inserta, borra, confirma y abre
  SQLite en lectura-escritura. `tdb` y su guardia la siguen leyendo igual.
- La maquinaria de solo lectura del explorador (guardia, candado por sentencia, Auto forzado,
  trabajador en solo lectura) NO se borra: queda detrás de UNA función inyectada que en el
  producto no impone ninguna (`sinSoloLecturaImpuesta`).
- La inyectan el humo remoto contra una base real por la VPN (`soloLecturaEnTodas`: es su
  PRIMER candado, y su centinela `lecturaSegura.ts` exige lo mismo por su cuenta, así que si
  alguien quitara la inyección el humo falla en vez de escribir) y las pruebas que fijan esa
  maquinaria (`(c) => c.readonly`).
- Se mantiene para el humano lo que no es la casilla: la confirmación de producción, la de los
  comandos peligrosos de Redis y los topes técnicos.

## Consecuencias

- Cada lectura del explorador pregunta a la función de forma explícita: el compilador obliga a
  decidir en cada sitio.

## Descartes

- Pasar al explorador una COPIA de la conexión con `readonly` cambiado: el explorador devuelve
  cosas al registro (verificada, introspección, esquemas) y la copia acabaría pisando la casilla
  de los agentes.
