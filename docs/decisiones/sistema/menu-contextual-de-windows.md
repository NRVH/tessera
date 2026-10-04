# «Abrir con Tessera» en Windows se escribe en HKCU con `reg.exe`, valor a valor, desde un estado en memoria

- **Estado:** vigente
- **Ámbito:** `src/main/shell/IntegracionShellService.ts`, `src/main/shell/RegistroWindows.ts`, `src/shared/integracionShell.ts`

## Contexto

El menú contextual del Explorador son claves de `HKCU\Software\Classes` (verbo de carpetas, de
archivos y un ProgID por extensión). Hay que encenderlo y apagarlo en caliente, saber qué BORRAR
al desmarcar algo, y que reinstalar en otra carpeta no deje el menú lanzando un `.exe` que no existe.

## Decisión

- `reg.exe` por `execFile`, una operación por valor. Sin shell nada interpreta las comillas del
  `command` ni el `*` de `Classes\*\shell`, que `exec` expandiría contra el directorio actual. Un
  fallo dice exactamente qué clave falló, y no se para al primero: borrar va antes que escribir.
- Todo es `HKCU` por construcción (el plan no puede elegir otra colmena): nada pide elevación.
- Existencia por el CÓDIGO DE SALIDA de `reg query`, nunca por el mensaje: están traducidos, y en
  un Windows en español retirar lo ya retirado se contaba como fallo.
- El estado aplicado vive en memoria, sembrado con los ajustes persistidos: es la base de todos
  los borrados. Se actualiza aunque algo falle (lo escrito está escrito).
- Las aplicaciones se serializan en una cola: dos en vuelo leen el mismo estado, sus `reg.exe` se
  intercalan y quedan ProgIDs que el servicio ya no sabe que existen y nunca podrá borrar.
- Al arrancar, si hay integración activa, se sondea una clave y si el `command` apunta a otro
  ejecutable se reescribe todo (solo escrituras: la misma configuración con otra ruta). Sin
  integración no se paga nada. Ese sondeo es la ÚNICA lectura y va por PowerShell, no por
  `reg query`: `reg.exe` imprime en la página OEM, `José` sale `Jos?`, nunca casaría con
  `execPath` y se reescribiría el registro en cada arranque.
- No disponible sin empaquetar (sería `electron.exe`) ni en el target portable (`%TEMP%`).

## Consecuencias

- El desinstalador tiene su propia copia del borrado en `build/installer.nsh`: cuando corre ya no
  hay app. La aplicación predeterminada de una extensión no se puede fijar (`UserChoice` lleva
  un hash del sistema); el canal correspondiente abre el panel de Windows.

## Descartes

- Un `.reg` importado: UTF-16LE con BOM o se pierden los acentos, doble escapado de barras y
  todo-o-nada sin decir qué falló. PowerShell para escribir: cientos de ms por llamada y hay decenas.
