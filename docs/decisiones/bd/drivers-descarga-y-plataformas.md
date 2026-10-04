# Clientes de base de datos: se descargan a `userData`, por plataforma, con una sola descarga con plazo de inactividad

- **Estado:** vigente
- **Ámbito:** `src/main/db/DriverManager.ts`, `descarga.ts`, `driverPacks.ts`

## Contexto

Tessera no empaqueta los clientes de base de datos (Instant Client). El usuario no sabe qué cliente exige su
servidor, y el día que la red corporativa bloquee el dominio de Oracle, un flujo que solo sepa descargar lo
deja tirado.

## Decisión

- Se sondea, se detecta y, si falta algo, se ofrece descargarlo, con una escotilla imprescindible: usar uno
  que ya se tiene (acepta la carpeta con el centinela o su padre).
- Lo descargado vive en `userData/drivers`, nunca en la carpeta de instalación: el instalador NSIS la borra en
  cada actualización, y decenas de MB de DLL alargarían las rutas hasta reventar el desinstalador (el accidente
  del error «2»).
- Todo lo que se publica, lista, instala o registra pasa por `packsDePlataforma(plataforma)`: en Mac nunca se
  ofrece el zip de Windows, y «Seleccionar carpeta» comprueba el centinela de esa plataforma. La plataforma es
  una opción del constructor con la actual por defecto, para que la prueba fije las dos. `status()` lleva el
  `aviso` del pack y, si el sistema no puede usar la descarga, `noDisponible` con el porqué.
- Publica `catalogo.json` para `tdb`, que corre en otro proceso; así el catálogo tiene una sola fuente.
- Dos formatos: el zip de Windows se descarga a memoria y se aplana por basename (corta también un `../`); el
  .dmg de Mac va por `instalarDmg.ts` (ver `drivers-instalar-desde-dmg.md`).
- Una sola descarga para los dos (`descargarConHuella`): porcentaje una vez por punto, SHA-256 al vuelo y plazo
  de INACTIVIDAD (60 s sin ningún byte), no plazo total: 66 MB por VPN pueden tardar minutos, y un CDN que dejaba
  de mandar bytes dejaba la barra en «Descargando…» para siempre y bloqueaba volver a pulsar. El temporizador se
  para mientras se escribe un trozo. `escritor.cerrar()` se llama siempre, y su fallo no tapa el de la descarga.

## Consecuencias

- Los packs de Windows se comportan como antes; una descarga parada ahora falla con su motivo.
