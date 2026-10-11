# En las alpha, las caídas nativas dejan un volcado local que el siguiente arranque anota en `crash.log`

- **Estado:** vigente
- **Ámbito:** `src/main/app/volcados.ts`, `src/main/app/volcadosPuro.ts`, `features/ajustes/categorias/Experimental.tsx`

## Contexto

`crash.log` recoge las excepciones y las promesas sin capturar, que el blindaje del main sobrevive. Un fallo NATIVO
(un módulo de C++ o el propio motor) mata el proceso sin pasar por ahí: sin el registrador de Electron no queda
volcado, y Windows tampoco anota nada en su visor de eventos para estos procesos. Así murió Tessera a mitad del
cierre para actualizarse, justo después de matar las pseudoconsolas, sin ninguna pista de dónde.

## Decisión

- Solo en las versiones alpha y con su interruptor de «Experimental» encendido (de fábrica, sí), como el registro de
  salud: las alpha son las que se diagnostican, y en la pública nadie va a entregar el archivo. El ajuste se lee al
  cargar el proceso y vale al reiniciar: el registrador no se puede parar una vez arrancado. Se lee del archivo a
  pelo, y solo en alpha: pasar por el almacén del estado lo sembraría antes de su carga normal, que es la que
  archiva un archivo de una versión más nueva. Apagados, el arranque BORRA los que quedaran: llevan datos de la
  memoria y nadie los va a mirar. La regla es la de todo «Experimental» (`opcionExperimentalActiva`, la misma
  del registro de salud). En el arnés de interfaz, cuyo paquete no es alpha, `TESSERA_VOLCADOS=1` junto a su
  marca hace las veces de alpha, pero el ajuste sigue mandando: así se prueba también el interruptor.
- `crashReporter.start({ uploadToServer: false })` al cargar el módulo del main, justo DESPUÉS de `prepararProceso`:
  antes, la carpeta de volcados se resolvía con el `userData` de fábrica, el de la app instalada, y una Tessera de
  desarrollo o el relevo habrían anotado y borrado los volcados de esa. Por lo mismo `crashDumps` se fija a mano a
  `<userData>/Crashpad`. Así tampoco arranca el registrador en la segunda instancia que sale nada más cargar. Cubre
  el main, el renderer, la GPU y los procesos de utilidad, también en el relevo (en su propio `userData`, que nadie
  revisa: sus volcados se buscan a mano). Nada sale del equipo.
- Los volcados quedan en `<userData>/Crashpad`; los que el registrador aún escribe (`new/`) no se tocan. El arranque anota
  en `crash.log` los posteriores a la última revisión (`logs/volcados.json`), con su fecha y ruta, y conserva
  los 10 más recientes: cada uno pesa unos MB.
- Un volcado es una copia de la memoria del proceso y puede contener secretos en uso (una contraseña de BD que se
  estaba usando). Por eso solo vive en el equipo del usuario, y quien lo pida para diagnosticar lo sabe.
- Se leen con los símbolos públicos de Electron de la misma versión; los de los módulos nativos, con los suyos.

## Consecuencias

Una caída nativa deja una línea en `crash.log` al siguiente arranque, y el volcado dice el módulo y la función.
Revisar cuesta un recorrido de una carpeta casi vacía en cada arranque.
