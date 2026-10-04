# El proceso decide al cargar si es el relevo o Tessera, y solo Tessera toma el cerrojo de instancia única

- **Estado:** vigente
- **Ámbito:** `src/main/app/proceso.ts`, `src/main/app/instanciaUnica.ts`, `src/main/app/devUserData.ts`, `src/main/index.ts` (macOS: sin verificar aquí)

## Contexto

El mismo binario arranca como Tessera o como el relevo que aplica una actualización cuando la app ya no existe. Hay
cosas que solo sirven si se hacen al CARGAR el módulo, antes de `whenReady`: después Chromium ya tiene abiertos
archivos bajo `userData`, la ventana ya existe y los primeros eventos del sistema ya pasaron. Dos procesos con un
mismo `userData` se pisan: el atajo `tdb` y los temporales de nombre fijo de la escritura atómica.

## Decisión

- Al cargar, en este orden: ¿hay encargo de relevo?; aislar el `userData` de desarrollo; y después una de dos ramas.
- En desarrollo `userData` es `Tessera-dev`: con el mismo nombre de app compartía carpeta con la instalada. La primera
  vez se siembra por lista blanca, sin las cachés de Chromium y CON `Local State` (guarda la clave de safeStorage: sin
  ella las contraseñas copiadas no se descifran). El cerrojo va por `userData`, así que dev e instalada conviven.
- **Relevo:** NO pide el cerrojo de instancia única y usa su propio `userData` (`<userData>-relevo`). Con cerrojo
  moría al arrancar (la Tessera que se cierra aún lo tiene) y, al revés, mientras su ventana espera al usuario
  bloquearía abrir Tessera con el icono. En `whenReady` sale por `arrancarRelevo` sin tocar nada más.
- **Tessera:** fija el AppUserModelID (`com.noe.tessera`, `.dev` en desarrollo: la instalada y la de `npm run dev`
  no se agrupan en la barra de tareas); lee las rutas de «Abrir con Tessera» del `argv`; si llegan CON ruta y hay un
  relevo en vuelo, sale (en Windows un proceso lanzado desde la carpeta de instalación impide renombrarla, el
  «error 2»); reclama el cerrojo; encola las rutas; y registra `second-instance` y `open-file`.
- `second-instance` y `open-file` se registran al cargar, no en `whenReady`: en frío pasan segundos entre el cerrojo
  y la ventana, y en macOS el `open-file` que abrió la app llega antes de `ready`. Las dos vías van a la MISMA cola.
- `open-file` no mira el relevo en vuelo: en macOS la actualización sustituye el `.app` y no hay carpeta bloqueada.
- Un SEGUNDO oyente de `open-file` (`registrarAperturaMac`), registrado al final del arranque, trae la ventana al
  frente o la crea si no queda ninguna. Va después para no crear dos ventanas en frío; en Windows no se registra.

## Consecuencias

Nada de esto se puede mover a `whenReady` ni reordenar sin reabrir un fallo que solo se ve instalando una versión
nueva o abriendo carpetas desde el sistema con la app cerrada.

## Descartes

- Negarse a arrancar con el icono mientras hay un relevo: el remedio es peor; solo se filtran las aperturas con ruta.
- Pedir el cerrojo en desarrollo sin mirar `userData`: impediría probar con `npm run dev` y la instalada abierta.
