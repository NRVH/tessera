<p align="center">
  <a href="./CONTRIBUTING.md">Leer en español</a>
</p>

# Contributing to Tessera

Thank you for your interest in Tessera. Bug reports, ideas and pull requests are all
welcome. This guide explains how the project is written and what a pull request needs.

## The code is in Spanish

Identifiers, comments, interface texts and commit messages are written in Spanish. That
is a deliberate choice of the project, and it does not have to stop you:

- You can open issues and discuss pull requests **in English or in Spanish**.
- If you are not comfortable writing Spanish, write your code and comments the best you
  can, in Spanish or English, and say so in the pull request: the review will help with
  the wording. What matters is the change.
- Identifiers that already exist in English (`GitService`, `useTabs`…) stay as they are.
  New ones are written in Spanish.
- Never rename IPC channels or keys that are persisted to disk (`workspace-state.json`,
  connections, settings): data already written on users' computers depends on them.

## Code standard

The rules are in [`docs/ESTANDAR_CODIGO.md`](./docs/ESTANDAR_CODIGO.md), and the design
decisions with weight are recorded as ADRs in [`docs/decisiones/`](./docs/decisiones/README.md).
Read the ADRs of the area you are touching before changing it: they explain the things
that would break without being visible in the code.

The essentials:

- **Every code file opens with a short header** (3 to 8 lines) that says what the module
  does and what it depends on, with a link to its ADR if it has one:

  ```ts
  // =============================================================================
  // What the module does, in one or two sentences.
  // What it depends on (and who uses it, if that helps).
  // Decisiones: docs/decisiones/<area>/<topic>.md
  // =============================================================================
  ```

- A comment says the *why* that the code cannot say, in at most 10 lines. Longer
  reasoning goes to an ADR. No history, dates or personal references in comments.
- Comments do not name other products (editors, database clients, Git clients…): describe
  the convention by what it does.
- Size limits: 400 lines per file and 60 per function, 15 of cyclomatic complexity. ESLint
  fails at twice those limits.
- Pure logic lives in modules without JSX or DOM in their imports, so it can be tested with
  plain `node`.
- **The interface never sees or sends host paths**, and every IPC channel is declared in
  `src/shared/*-ipc.ts` and exposed through `src/preload/`.

## Windows and macOS are both first class

Tessera runs on Windows and macOS, and neither is a port of the other. For a pull request
this means:

- **Think every change through for both platforms**, even if you can only run one. Answer
  two questions in the description: what does this do on the other platform, and does it
  degrade it? If something does not apply there, say why in the code.
- Never compare `process.platform` directly: use `esWindows()` / `esMac()` from
  `src/shared/plataforma.ts`. In pure logic, the platform is a **parameter** with the
  current system as default, so tests can cover both platforms from either machine.
- In the interface (the renderer) `process` does not exist: the platform comes from
  `window.tessera.plataforma`. This breaks only in the packaged app, so it is easy to miss.
- Keyboard shortcuts are decided in `src/renderer/src/util/atajos.ts`, with the platform as
  a parameter: sometimes the key itself is different, not only the modifier.
- Texts that name the system, its file manager, its shell or its secret store come from
  `src/shared/nombresSistema.ts`, never written by hand.
- What you cannot run on your platform, leave written and ready (its test with the platform
  as a parameter) and say clearly in the pull request that it is unverified there.

## Testing your change

There is no `npm test`. Run what your change can affect:

```bash
npm run typecheck                  # main process, interface and e2e suite
npm run lint                       # or: npx eslint <paths> for one area
npm run test:cabeceras -- <paths>  # file headers
npm run test:comentarios -- <paths>
npm run test:menciones -- <paths>
npm run test:<name>                # the test scripts of the area you touched
```

- Unit tests are `test-*.mts` files next to the module they test, run with plain `node`.
  Imports need an explicit extension (`'./modelo.ts'`) and no JSX or DOM in the chain. The
  usual shape: local helpers `hr(title)` and `check(name, pass, evidence)`, a final
  `VEREDICTO: n/m PASS` line and `process.exit(allPass ? 0 : 1)`.
- `node scripts/pruebas/bateria.mjs <regex>` runs every `test:*` script whose name matches,
  one after another. Some of them need Docker running; never run two of these at the same
  time, they share containers and temporary folders.
- If your change touches what lives on the boundary with the operating system (menus,
  keyboard, packaging, clipboard, anything that only exists in the real renderer), it
  deserves a case in `e2e/`. The suite drives the **packaged** app, so build it first:

  ```bash
  npm run pack:dir        # Windows (npm run pack:mac:dir on macOS)
  npx playwright test e2e/<spec>.spec.ts
  ```

A new feature or a bug fix should come with a test that fails without it, whenever the
logic can be tested.

## Commit messages

Commits follow `type(area): description`, in Spanish and in lower case, and the
description talks about the **effect for the user**, not the technique:

- `feat(ámbito): …` a new capability.
- `fix(ámbito): …` something that was broken now works.
- `perf(ámbito): …` the behavior does not change; what it costs does (time, memory, size).
- `refactor(ámbito): …` neither behavior nor cost change: the code is reorganized to make a
  coming change possible. The description says what is prepared and what does not change.

For example: `fix(explorador): pegar varios archivos copiados en el Finder ya no pega solo el primero`.

If writing the message in Spanish is a problem, write it in English: it can be adjusted
when merging.

## Proposing a change

1. For anything bigger than a small fix, **open an issue first** to agree on the approach.
   It saves work on both sides.
2. Fork the repository and create a branch from `main`.
3. Make the change, with its tests, and run the checks above.
4. Open a pull request using the template: what changes for the user, how you tested it,
   and what it does on the other platform.

**How an accepted pull request lands.** The history of `main` is one commit per released
version, so pull requests are not merged with the GitHub button. Once a pull request is
approved, the maintainer applies it to the development tree with you as its author, and it
ships in the next release commit. The release notes credit you, and the pull request is
closed with a link to that release.

By contributing, you agree that your contribution is licensed under the
[MIT License](./LICENSE) of the project. Please follow the
[Code of Conduct](./CODE_OF_CONDUCT.en.md). To report a vulnerability, do **not** open a public
issue: see [SECURITY.en.md](./SECURITY.en.md).
