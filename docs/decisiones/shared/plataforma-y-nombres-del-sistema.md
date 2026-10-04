# La plataforma se consulta con `esWindows()`/`esMac()` y, en lo que comparte el renderer, entra por parámetro

- **Estado:** vigente
- **Ámbito:** `src/shared/plataforma.ts`, `src/shared/nombresSistema.ts`

## Contexto

El supuesto «esto es Windows» estaba repartido por todo el código: letras de unidad, PowerShell, el
registro, named pipes. Los módulos de `shared/` los importan a la vez el main, el preload, el renderer y
los `test-*.mts`, y el renderer va con `sandbox: true`: allí no existe `process`.

## Decisión

- `esWindows()` / `esMac()`, nunca `process.platform === 'win32'` suelto: se puede sustituir en un test y
  `grep esWindows` es la lista de lo que falta para Linux.
- Se elige la negación correcta: hay ramas «Windows y lo demás» (el registro) y ramas «macOS y lo demás»
  (el hueco de los botones de ventana). `esWindows() ? A : B` no equivale a `esMac() ? B : A` en cuanto
  entre Linux.
- La cadena es la de `process.platform`: existe en los cuatro entornos y es la que ya usan Node y Electron.
- Lo que una plataforma no puede hacer se declara en `CapacidadesPlataforma` y la UI pregunta. Esconder es
  el último recurso: antes se construye el equivalente nativo.
- Cuando una frase de la interfaz nombra el sistema, el gestor de archivos, la shell o el almacén de
  claves, el nombre sale de `nombresSistema.ts`. Allí la plataforma es OBLIGATORIA, sin valor por
  defecto: el defecto correcto del main (`plataformaActual()`) revienta en el renderer empaquetado.

## Consecuencias

- En el renderer la plataforma es `window.tessera.plataforma`; en el main, `plataformaActual()`.
- Un bloque que solo se monta en una plataforma sigue nombrando su sistema a pelo: ahí el nombre es el
  asunto (`features/ajustes/catalogo.ts` poda esos grupos por plataforma).
- `test:nombres-sistema` falla si el renderer escribe un nombre de sistema suelto fuera de sus excepciones.

## Descartes

- `os.platform()`: no existe en el renderer aislado.
- Fingir la función: una que en una plataforma devuelve `{}` en silencio deja en Configuración una casilla
  que se marca y no hace nada.
