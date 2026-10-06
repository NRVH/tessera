// =============================================================================
// ESLint (flat config): entornos, límites de tamaño y fronteras entre capas.
// Entornos: Node (main, preload, shared, scripts), navegador (renderer), CommonJS (`tdb`).
// Límites y fronteras F1-F8 según docs/ESTANDAR_CODIGO.md. Lo que el estándar trata como
// error (el doble de los límites, las fronteras, exhaustive-deps) falla `npm run lint`; el
// límite simple (400/60/15) solo avisa.
// El plugin local `calidad` reutiliza reglas del núcleo con otro nombre y añade las fronteras
// que comparan rutas resueltas (scripts/calidad/fronteras.mjs).
// Decisiones: docs/decisiones/calidad/react-hooks-dos-reglas.md
// =============================================================================
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import { builtinRules } from 'eslint/use-at-your-own-risk'
import { reglasFronteras } from './scripts/calidad/fronteras.mjs'

const nivelFinal = 'error'
const PRUEBAS = ['**/test-*.mts', '**/*.spec.ts']
const soloCodigo = { skipBlankLines: true, skipComments: true }
const ESTANDAR = 'Ver docs/ESTANDAR_CODIGO.md.'

// Dos bloques que configuran la MISMA regla para un archivo no se suman: el último
// pisa al anterior. Por eso cada límite «doble» y cada frontera es una regla propia.
const restringir = tseslint.plugin.rules['no-restricted-imports']
const calidad = {
  rules: {
    'max-lines-doble': builtinRules.get('max-lines'),
    'max-lines-per-function-doble': builtinRules.get('max-lines-per-function'),
    'complexity-doble': builtinRules.get('complexity'),
    ...Object.fromEntries(['f2', 'f3', 'f6', 'f8'].map((f) => [`frontera-${f}`, restringir])),
    ...reglasFronteras
  }
}

/** Un bloque de frontera: la regla `calidad/frontera-<f>` sobre `files`, sin las pruebas. */
function frontera(f, files, ignores, opciones) {
  return {
    files,
    ignores: [...PRUEBAS, ...ignores],
    rules: { [`calidad/frontera-${f}`]: opciones === undefined ? nivelFinal : [nivelFinal, opciones] }
  }
}

const patron = (regex, mensaje) => ({ patterns: [{ regex, message: `${mensaje} ${ESTANDAR}` }] })

const MAIN = ['src/main/**/*.{ts,mts}']
// Raíces de composición: la app (con los `componer.ts` de cada dominio, que la parten) y el modo
// relevo (el mismo binario arrancado para aplicar una actualización cuando la app ya no existe).
// LISTA EXPLÍCITA: añadir un `componer.ts` es añadirlo aquí (un glob volvería raíz cualquiera).
const COMPONER = ['src/main/db/componer.ts', 'src/main/ssh/componer.ts', 'src/main/agents/componer.ts']
const RAICES = ['src/main/index.ts', ...COMPONER, 'src/main/relevo/index.ts']
const IPC_MAIN = 'src/main/**/ipc.ts'

export default tseslint.config(
  {
    // Build, dependencias y carpetas ocultas de la raíz (datos locales como `.tessera/`,
    // que trae sus propios eslint.config y rompería la carga). `docker/`: el contexto de la
    // imagen del sandbox y el proyecto de prueba local que montan sus pruebas.
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'node_modules/**',
      'resources/**',
      '.*/**',
      'docker/**',
      // Restos locales de experimentos (no versionados): no se lintean.
      'spikes/**'
    ]
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  { plugins: { calidad } },

  {
    files: ['**/*.{ts,tsx,mts}'],
    rules: {
      // En TS lo cubre el compilador; aquí solo da falsos positivos con `declare`.
      'no-undef': 'off',
      // Su flujo no cruza callbacks: marca inicializadores que TS exige ("used before
      // being assigned") en variables que se rellenan dentro de un try o un handler.
      'no-useless-assignment': 'off',
      // `any` solo en fronteras de deserialización, estrechado acto seguido.
      '@typescript-eslint/no-explicit-any': 'warn',
      // `_` inicial: "lo recibo por posición pero no lo uso" (handlers IPC `(_e, req)`).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_'
        }
      ]
    }
  },

  {
    files: [
      'src/main/**/*.{ts,mts}',
      'src/preload/**/*.ts',
      'src/shared/**/*.ts',
      'scripts/**/*.{mjs,mts}',
      '*.config.{ts,mjs}'
    ],
    languageOptions: { globals: globals.node }
  },

  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': nivelFinal
    }
  },

  {
    // CLIs `tdb` y `tssh` y el programa de contraseñas de SSH: CommonJS plano que corre con ELECTRON_RUN_AS_NODE.
    files: ['src/tdb/**/*.cjs', 'src/tssh/**/*.cjs', 'src/askpass/**/*.cjs'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },

  {
    files: ['**/test-*.mts'],
    languageOptions: { globals: globals.node },
    rules: { '@typescript-eslint/no-explicit-any': 'off' }
  },

  {
    // Límites: aviso en el límite, `nivelFinal` al doble. Se cuentan líneas de CÓDIGO.
    files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    rules: {
      'max-lines': ['warn', { max: 400, ...soloCodigo }],
      'max-lines-per-function': ['warn', { max: 60, ...soloCodigo }],
      complexity: ['warn', { max: 15 }],
      'calidad/max-lines-doble': [nivelFinal, { max: 800, ...soloCodigo }],
      'calidad/max-lines-per-function-doble': [nivelFinal, { max: 120, ...soloCodigo }],
      'calidad/complexity-doble': [nivelFinal, { max: 30 }]
    }
  },

  {
    // Las pruebas, exentas de tamaño y complejidad (no de cabecera ni de comentarios).
    files: PRUEBAS,
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      complexity: 'off',
      'calidad/max-lines-doble': 'off',
      'calidad/max-lines-per-function-doble': 'off',
      'calidad/complexity-doble': 'off'
    }
  },

  {
    // `monacoEn` pasa a `page.evaluate` UNA función que debe bastarse sola (no puede importar ni
    // llamar a nada de fuera): localizar el editor y cada operación van dentro y no se parten.
    files: ['e2e/monaco.ts'],
    rules: {
      'max-lines-per-function': 'off',
      complexity: 'off',
      'calidad/max-lines-per-function-doble': 'off',
      'calidad/complexity-doble': 'off'
    }
  },

  // F1, F4, F5 y F7 son reglas propias (scripts/calidad/fronteras.mjs): sin opciones.
  frontera('f1', MAIN, [...RAICES, IPC_MAIN]),
  frontera('f2', MAIN, [...RAICES, IPC_MAIN, 'src/main/**/adaptadores/**', 'src/main/app/**'], {
    paths: [
      {
        name: 'electron',
        allowImportNames: ['ipcMain'],
        allowTypeImports: true,
        message: `F2: electron solo en ipc.ts, adaptadores/, app/ y las raíces de composición. ${ESTANDAR}`
      }
    ]
  }),
  frontera(
    'f3',
    MAIN,
    RAICES,
    patron(
      '^(?!.*(^|/)shared/ipc(\\.ts)?$)(.*/)?(ipc|componer)(\\.ts)?$',
      'F3: un ipc.ts o un componer.ts solo lo importa una raíz de composición.'
    )
  ),
  // Un `componer.ts` es raíz pero solo `index.ts` los importa: ni entre ellos ni desde el relevo.
  frontera(
    'f3',
    [...COMPONER, 'src/main/relevo/index.ts'],
    [],
    patron('(^|/)componer(\\.ts)?$', 'F3: un componer.ts solo lo importa src/main/index.ts.')
  ),
  frontera('f4', ['src/main/**/adaptadores/**/*.{ts,mts}'], []),
  frontera('f5', ['src/renderer/src/features/**/*.{ts,tsx}'], []),
  frontera(
    'f6',
    ['src/renderer/src/{comun,util,theme}/**/*.{ts,tsx}'],
    [],
    patron('(^|/)features(/|$)', 'F6: comun/, util/ y theme/ no importan de features/.')
  ),
  frontera('f7', ['src/renderer/**/*.{ts,tsx}'], []),
  frontera(
    'f8',
    ['src/shared/**/*.{ts,mts}'],
    [],
    patron('^(\\.\\./)+(main|renderer|preload)(/|$)', 'F8: shared/ no importa de main, renderer ni preload.')
  )
)
