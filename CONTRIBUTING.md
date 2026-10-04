<p align="center">
  <a href="./CONTRIBUTING.en.md">Read in English</a>
</p>

# Contribuir a Tessera

Gracias por tu interés en Tessera. Los reportes de errores, las ideas y los pull requests son
bienvenidos. Esta guía explica cómo está escrito el proyecto y qué necesita un pull request.

## El código está en español

Los identificadores, los comentarios, los textos de la interfaz y los mensajes de commit se
escriben en español. Es una decisión deliberada del proyecto, y no tiene por qué frenarte:

- Puedes abrir issues y comentar pull requests **en español o en inglés**.
- Si no te sientes cómodo escribiendo en español, escribe tu código y tus comentarios como
  mejor puedas, en español o en inglés, y dilo en el pull request: la revisión ayudará con la
  redacción. Lo que importa es el cambio.
- Los identificadores que ya existen en inglés (`GitService`, `useTabs`…) se quedan como
  están. Los nuevos se escriben en español.
- Nunca renombres canales IPC ni claves que se guardan en disco (`workspace-state.json`,
  conexiones, configuración): de ellos dependen datos ya escritos en los equipos de los
  usuarios.

## Estándar de código

Las reglas están en [`docs/ESTANDAR_CODIGO.md`](./docs/ESTANDAR_CODIGO.md), y las decisiones
de diseño de peso se registran como ADR en [`docs/decisiones/`](./docs/decisiones/README.md).
Lee los ADR del área que vas a tocar antes de cambiarla: explican lo que se rompería sin que
se note en el código.

Lo esencial:

- **Cada archivo de código abre con una cabecera corta** (de 3 a 8 líneas) que dice qué hace
  el módulo y de qué depende, con un enlace a su ADR si lo tiene:

  ```ts
  // =============================================================================
  // Qué hace el módulo, en una o dos frases.
  // De qué depende (y quién lo usa, si ayuda).
  // Decisiones: docs/decisiones/<área>/<tema>.md
  // =============================================================================
  ```

- Un comentario dice el *porqué* que el código no puede decir, en 10 líneas como mucho. Un
  razonamiento más largo va a un ADR. Nada de historia, fechas ni referencias personales en
  los comentarios.
- Los comentarios no nombran otros productos (editores, clientes de bases de datos, clientes
  de Git…): describen la convención por lo que hace.
- Límites de tamaño: 400 líneas por archivo y 60 por función, 15 de complejidad ciclomática.
  ESLint falla al doble de esos límites.
- La lógica pura vive en módulos sin JSX ni DOM en sus imports, para que se pueda probar con
  `node` a secas.
- **La interfaz nunca ve ni envía rutas del equipo**, y cada canal IPC se declara en
  `src/shared/*-ipc.ts` y se expone por `src/preload/`.

## Windows y macOS son de primera clase los dos

Tessera corre en Windows y en macOS, y ninguno es un port del otro. Para un pull request esto
significa:

- **Piensa cada cambio para las dos plataformas**, aunque solo puedas ejecutar una. Responde
  dos preguntas en la descripción: qué hace esto en la otra plataforma, y si la degrada. Si
  algo no aplica allí, explica por qué en el código.
- Nunca compares `process.platform` directamente: usa `esWindows()` / `esMac()` de
  `src/shared/plataforma.ts`. En la lógica pura, la plataforma es un **parámetro** con el
  sistema actual por defecto, para que las pruebas cubran las dos plataformas desde
  cualquiera de las dos máquinas.
- En la interfaz (el renderer) no existe `process`: la plataforma llega por
  `window.tessera.plataforma`. Esto solo se rompe en la app empaquetada, así que es fácil que
  se escape.
- Los atajos de teclado se deciden en `src/renderer/src/util/atajos.ts`, con la plataforma
  como parámetro: a veces cambia la tecla misma, no solo el modificador.
- Los textos que nombran el sistema, su gestor de archivos, su shell o su almacén de secretos
  salen de `src/shared/nombresSistema.ts`, nunca escritos a mano.
- Lo que no puedas ejecutar en tu plataforma, déjalo escrito y listo (su prueba con la
  plataforma como parámetro) y di claramente en el pull request que allí queda sin verificar.

## Probar tu cambio

No hay `npm test`. Corre lo que tu cambio pueda afectar:

```bash
npm run typecheck                  # proceso principal, interfaz y suite e2e
npm run lint                       # o: npx eslint <rutas> para un área
npm run test:cabeceras -- <rutas>  # cabeceras de los archivos
npm run test:comentarios -- <rutas>
npm run test:menciones -- <rutas>
npm run test:<nombre>              # los scripts de prueba del área que tocaste
```

- Las pruebas unitarias son archivos `test-*.mts` junto al módulo que prueban, y corren con
  `node` a secas. Los imports necesitan extensión explícita (`'./modelo.ts'`) y nada de JSX
  ni DOM en la cadena. La forma habitual: helpers locales `hr(title)` y
  `check(name, pass, evidence)`, una línea final `VEREDICTO: n/m PASS` y
  `process.exit(allPass ? 0 : 1)`.
- `node scripts/pruebas/bateria.mjs <regex>` corre, uno tras otro, todos los scripts
  `test:*` cuyo nombre case. Algunos necesitan Docker levantado; nunca corras dos a la vez,
  porque comparten contenedores y carpetas temporales.
- Si tu cambio toca lo que vive en la frontera con el sistema operativo (menús, teclado,
  empaquetado, portapapeles, cualquier cosa que solo exista en el renderer de verdad),
  merece un caso en `e2e/`. La suite conduce la app **empaquetada**, así que compílala
  primero:

  ```bash
  npm run pack:dir        # Windows (npm run pack:mac:dir en macOS)
  npx playwright test e2e/<spec>.spec.ts
  ```

Una función nueva o un arreglo debería traer una prueba que falle sin él, siempre que la
lógica se pueda probar.

## Mensajes de commit

Los commits siguen `tipo(ámbito): descripción`, en español y en minúscula, y la descripción
habla del **efecto para el usuario**, no de la técnica:

- `feat(ámbito): …` una capacidad nueva.
- `fix(ámbito): …` algo que estaba roto ahora funciona.
- `perf(ámbito): …` el comportamiento no cambia; cambia lo que cuesta (tiempo, memoria,
  tamaño).
- `refactor(ámbito): …` no cambian ni el comportamiento ni el coste: se reorganiza el código
  para que un cambio que viene sea posible. La descripción dice qué se prepara y qué no
  cambia.

Por ejemplo: `fix(explorador): pegar varios archivos copiados en el Finder ya no pega solo el primero`.

Si escribir el mensaje en español te cuesta, escríbelo en inglés: se puede ajustar al
integrarlo.

## Proponer un cambio

1. Para cualquier cosa mayor que un arreglo pequeño, **abre primero un issue** para acordar
   el enfoque. Ahorra trabajo a las dos partes.
2. Haz un fork del repositorio y crea una rama desde `main`.
3. Haz el cambio, con sus pruebas, y corre las comprobaciones de arriba.
4. Abre un pull request con la plantilla: qué cambia para el usuario, cómo lo probaste y qué
   hace en la otra plataforma.

**Cómo entra un pull request aceptado.** El historial de `main` es un commit por versión
publicada, así que los pull requests no se integran con el botón de GitHub. Cuando un pull
request se aprueba, el mantenedor lo aplica al árbol de desarrollo contigo como autor, y sale
en el siguiente commit de versión. Las notas de la versión te dan el crédito, y el pull
request se cierra con un enlace a esa versión.

Al contribuir, aceptas que tu contribución se licencia bajo la [licencia MIT](./LICENSE) del
proyecto. Sigue, por favor, el [Código de conducta](./CODE_OF_CONDUCT.md). Para reportar una
vulnerabilidad **no** abras un issue público: consulta [SECURITY.md](./SECURITY.md).
