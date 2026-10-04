// =============================================================================
// Reglas de ESLint para las fronteras que `no-restricted-imports` no sabe expresar.
// F1 busca los nombres de IPC del main, también en tipos; F4, F5 y F7 comparan la ruta
// RESUELTA del import relativo contra el archivo que importa, no el texto del import.
// Solo ven `import` y `export … from` estáticos. Las registra eslint.config.mjs.
// Estándar: docs/ESTANDAR_CODIGO.md («Fronteras»).
// =============================================================================
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ESTANDAR = 'Ver docs/ESTANDAR_CODIGO.md.'

/** Ruta de un archivo relativa al repo, con `/`. */
function rutaDelRepo(absoluta) {
  return path.relative(RAIZ, absoluta).replace(/\\/g, '/')
}

/** Módulo al que apunta un import relativo (sin extensión ni `/index`); null si no es relativo. */
export function resolverRelativo(archivo, especificador) {
  if (typeof especificador !== 'string' || !/^\.\.?(\/|$)/.test(especificador)) return null
  return rutaDelRepo(path.resolve(path.dirname(archivo), especificador))
    .replace(/\.(d\.)?[cm]?[jt]sx?$/, '')
    .replace(/\/index$/, '')
}

/** Los nombres que trae un `import`/`export … from`, marcando los que son solo de tipo. */
function nombresDe(n) {
  const todoTipo = n.importKind === 'type' || n.exportKind === 'type'
  if (n.type === 'ExportAllDeclaration') return [{ nombre: '*', tipo: todoTipo }]
  return (n.specifiers ?? []).map((s) => {
    const tipo = todoTipo || s.importKind === 'type' || s.exportKind === 'type'
    if (s.type === 'ImportDefaultSpecifier') return { nombre: 'default', tipo }
    if (s.type === 'ImportNamespaceSpecifier') return { nombre: '*', tipo }
    const origen = s.type === 'ImportSpecifier' ? s.imported : s.local
    return { nombre: origen.name ?? origen.value, tipo }
  })
}

/** Visitante que llama a `alVer(nodo, fuente, nombres)` en cada import/re-export estático. */
function visitarImports(alVer) {
  const ver = (n) => {
    if (n.source) alVer(n, n.source.value, nombresDe(n))
  }
  return { ImportDeclaration: ver, ExportNamedDeclaration: ver, ExportAllDeclaration: ver }
}

/** Una regla sin opciones cuyo `create` recibe el contexto y la ruta del archivo en el repo. */
function regla(crear) {
  return {
    meta: { type: 'problem', schema: [] },
    create: (context) => crear(context, rutaDelRepo(context.filename))
  }
}

const NOMBRES_IPC_MAIN = new Set(['ipcMain', 'IpcMain', 'IpcMainEvent', 'IpcMainInvokeEvent'])

/** F1: ipcMain y sus tipos, también como `import type`, `Electron.IpcMain` o `x.ipcMain`. */
const f1 = regla((context) => {
  const informar = (node, nombre) =>
    context.report({
      node,
      message: `F1: \`${nombre}\` solo en ipc.ts o en una raíz de composición; un servicio recibe un emisor de eventos, no ipcMain. ${ESTANDAR}`
    })
  return {
    ...visitarImports((n, fuente, nombres) => {
      if (fuente !== 'electron') return
      for (const { nombre } of nombres) if (NOMBRES_IPC_MAIN.has(nombre)) informar(n, nombre)
    }),
    'MemberExpression[computed=false] > Identifier.property[name="ipcMain"]': (n) => informar(n, 'ipcMain'),
    TSQualifiedName: (n) => NOMBRES_IPC_MAIN.has(n.right.name) && informar(n, n.right.name),
    TSImportType: (n) => {
      const q = n.qualifier
      const nombre = q?.type === 'Identifier' ? q.name : q?.right?.name
      if (NOMBRES_IPC_MAIN.has(nombre)) informar(n, nombre)
    }
  }
})

/** F4: un adaptador importa solo de otros adaptadores, `src/shared/` y `src/main/util/`. */
const PERMITIDO_EN_ADAPTADOR = /^src\/(shared|main\/util)(\/|$)|^src\/main\/(.+\/)?adaptadores(\/|$)/
const f4 = regla((context) =>
  visitarImports((n, fuente) => {
    const destino = resolverRelativo(context.filename, fuente)
    if (destino === null || PERMITIDO_EN_ADAPTADOR.test(destino)) return
    context.report({
      node: n.source,
      message: `F4: un adaptador no importa de su dominio (${destino}); solo de adaptadores/, src/shared/ y src/main/util/. ${ESTANDAR}`
    })
  })
)

/** F5: una feature importa otra solo por su `index.ts` (la carpeta o `…/index`). */
const FEATURE = /^src\/renderer\/src\/features\/([^/]+)(\/.*)?$/
const f5 = regla((context, archivo) => {
  const propia = FEATURE.exec(archivo)?.[1]
  return visitarImports((n, fuente) => {
    const m = FEATURE.exec(resolverRelativo(context.filename, fuente) ?? '')
    if (!propia || !m || m[1] === propia || !m[2]) return
    context.report({
      node: n.source,
      message: `F5: la feature «${m[1]}» se importa solo por su index.ts, no por ${m[1]}${m[2]}. ${ESTANDAR}`
    })
  })
})

/**
 * F7: lo que el renderer no puede importar de `src/shared/` porque llama a
 * `plataformaActual()` (en el renderer no hay `process`). Los tipos siempre se permiten.
 * `permitidos`: lo único que se puede importar como valor; `prohibidos`: lo que no.
 */
const RESTRICCIONES_RENDERER = {
  'src/shared/plataforma': { permitidos: ['plataformaDe', 'capacidadesDe'] },
  'src/shared/rutasHost': { permitidos: [] },
  'src/shared/rutasDesdeArgv': { permitidos: [] },
  'src/shared/dockerErrors': { prohibidos: ['pasosDocker', '*'] }
}

function vetado({ permitidos, prohibidos }, nombre) {
  return permitidos ? !permitidos.includes(nombre) : prohibidos.includes(nombre)
}

const f7 = regla((context) =>
  visitarImports((n, fuente, nombres) => {
    const destino = resolverRelativo(context.filename, fuente)
    const r = destino && Object.hasOwn(RESTRICCIONES_RENDERER, destino) ? RESTRICCIONES_RENDERER[destino] : null
    if (!r) return
    for (const { nombre, tipo } of nombres) {
      if (tipo || !vetado(r, nombre)) continue
      context.report({
        node: n,
        message: `F7: el renderer no importa \`${nombre}\` de ${destino}: llama a plataformaActual() y en el renderer no hay \`process\`; la plataforma llega por window.tessera.plataforma. ${ESTANDAR}`
      })
    }
  })
)

/** Las reglas, con el nombre que les da el plugin `calidad` de eslint.config.mjs. */
export const reglasFronteras = {
  'frontera-f1': f1,
  'frontera-f4': f4,
  'frontera-f5': f5,
  'frontera-f7': f7
}
