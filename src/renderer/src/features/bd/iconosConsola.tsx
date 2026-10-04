// =============================================================================
// iconosConsola: los glifos de la barra de la consola SQL y de la pestaña «Plan»
// (explicar el plan, la vista de texto del plan, desplegar y el chevrón de sus filas).
// Siguen el MOLDE de `iconosBd` (viewBox 24, trazo 1.6, `currentColor`, sin tamaño en
// línea: lo pone `.btn-icon svg`), así que pueden mudarse allí sin cambiar un trazo.
// Lo que ya existe en `iconosMenu` o `iconosBd` se reutiliza, no se redibuja.
// =============================================================================

/** Molde común: el de `iconosBd` (viewBox 24, trazo 1.6, color heredado). */
function Svg({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/**
 * Explicar el plan: un árbol de pasos (el nodo de arriba y dos ramas), que es lo que
 * enseña la pestaña que abre; una lupa se leería como «buscar».
 */
export function IconoPlan(): React.JSX.Element {
  return (
    <Svg>
      <rect x="4" y="3.5" width="7" height="4.5" rx="1" />
      <rect x="13" y="10" width="7" height="4.5" rx="1" />
      <rect x="13" y="16" width="7" height="4.5" rx="1" />
      <path d="M7.5 8v10.25H13M7.5 12.25H13" />
    </Svg>
  )
}

/** La vista de TEXTO del plan (DBMS_XPLAN): un documento con renglones. */
export function IconoVistaTexto(): React.JSX.Element {
  return (
    <Svg>
      <path d="M6 3.5h8.5L19 8v12.5H6Z" />
      <path d="M14 3.5V8h5M9 12h7M9 15.5h7M9 19h4" />
    </Svg>
  )
}

/** Desplegar todo: las dos flechas que se separan (la pareja de `IconoPlegarTodo`). */
export function IconoDesplegarTodo(): React.JSX.Element {
  return (
    <Svg>
      <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
    </Svg>
  )
}

/** El chevrón de una fila del árbol del plan (gira con `.open`, como el del árbol). */
export function IconoChevronPlan({ abierto }: { abierto: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={abierto ? 'open' : undefined}
    >
      <path d="m6 4 4 4-4 4" />
    </svg>
  )
}
