// =============================================================================
// Primitivas de Configuración: los ladrillos con los que se arma cualquier ajuste
// (Grupo, Fila, Stepper, Interruptor, Selector, Radios, CampoTexto y Casillas).
// Un ajuste = una `Fila`: etiqueta a la izquierda, control a la derecha, ayuda debajo
// de la etiqueta; un tipo de control por clase de ajuste (tamaños = steppers, fuentes =
// selects, ON/OFF = interruptores, excluyentes = radios). La tarjeta solo sobrevive en
// `Radios` (una unidad que se elige entera) y en los bloques de actualización (que actúan).
// =============================================================================

/** Cabecera de grupo + sus filas. El grupo es lo que da jerarquía, no las cajas. */
export function Grupo({
  titulo,
  ayuda,
  children
}: {
  titulo: string
  /**
   * Describe el GRUPO entero ("la de Claude Code y Codex"). Vive aquí y no
   * colgada de la primera fila porque ahí desaparecía en cuanto el buscador
   * filtraba esa fila, y quedaba un "Tamaño" suelto sin decir de qué terminal.
   */
  ayuda?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="ajustes-grupo">
      <h3 className="ajustes-grupo-titulo">{titulo}</h3>
      {ayuda !== undefined && <div className="ajustes-grupo-ayuda">{ayuda}</div>}
      {children}
    </section>
  )
}

/**
 * LA fila canónica de un ajuste.
 *
 * `modificado` + `onRestablecer` sirven para los valores que HEREDAN: mientras la fila
 * hereda no se enseña nada, y en cuanto tiene valor propio aparece la flecha para volver
 * atrás. Evita un desplegable "igual / propio" al lado de cada stepper.
 */
export function Fila({
  etiqueta,
  ayuda,
  control,
  sangrada = false,
  modificado = false,
  onRestablecer,
  tituloRestablecer = 'Volver al valor heredado'
}: {
  etiqueta: string
  ayuda?: React.ReactNode
  control: React.ReactNode
  /** Sangra la fila para que se lea como dependiente de la de arriba. */
  sangrada?: boolean
  /** Tiene valor propio (no hereda): se ofrece deshacer. */
  modificado?: boolean
  onRestablecer?: () => void
  /**
   * Qué dice el tooltip de la flecha. Es un parámetro y no un literal porque
   * `Fila` es genérica: hoy solo heredan tamaños de letra, pero en cuanto herede
   * cualquier otra cosa —un tema, una anchura— un "volver a seguir el tamaño de
   * la interfaz" clavado en la primitiva estaría mintiendo.
   */
  tituloRestablecer?: string
}): React.JSX.Element {
  return (
    <div className={`ajustes-fila${sangrada ? ' sangrada' : ''}`}>
      <div className="ajustes-fila-texto">
        <span className="ajustes-fila-etiqueta">{etiqueta}</span>
        {ayuda !== undefined && <span className="ajustes-fila-ayuda">{ayuda}</span>}
      </div>
      <div className="ajustes-fila-control">
        {control}
        {/* El hueco del botón se reserva SIEMPRE (visibility, no display): si
            apareciera y desapareciera, el control saltaría de sitio al tocarlo. */}
        {onRestablecer !== undefined && (
          <button
            type="button"
            className="ajustes-restablecer"
            style={{ visibility: modificado ? 'visible' : 'hidden' }}
            onClick={onRestablecer}
            tabIndex={modificado ? 0 : -1}
            aria-hidden={!modificado}
            title={tituloRestablecer}
            aria-label={`Restablecer ${etiqueta}`}
          >
            <IconoRestablecer />
          </button>
        )}
      </div>
    </div>
  )
}

/** Cómo se LEE el valor de un stepper. Por defecto, píxeles (el caso de siempre). */
const PIXELES = (v: number): string => `${v}px`

/** Stepper −/+ con su valor. */
export function Stepper({
  valor,
  min,
  max,
  onChange,
  etiqueta,
  formato = PIXELES
}: {
  valor: number
  min: number
  max: number
  onChange: (v: number) => void
  /** Para los aria-label de los dos botones ("Reducir el tamaño de X"). */
  etiqueta: string
  /**
   * Cómo se escribe el valor. Existe porque no todo stepper cuenta píxeles: el
   * zoom se mueve por NIVELES discretos (−3…5) pero nadie piensa en niveles, se
   * piensa en "120%", así que la fila traduce nivel → porcentaje aquí y no
   * necesita un estado paralelo para enseñarlo. El default conserva el
   * comportamiento de siempre, así que ninguna llamada anterior cambia.
   */
  formato?: (v: number) => string
}): React.JSX.Element {
  const acotar = (v: number): number => Math.max(min, Math.min(max, v))
  return (
    <div className="ajustes-stepper">
      <button
        type="button"
        className="ajustes-stepper-btn"
        onClick={() => onChange(acotar(valor - 1))}
        disabled={valor <= min}
        aria-label={`Reducir ${etiqueta}`}
      >
        −
      </button>
      <span className="ajustes-stepper-valor">{formato(valor)}</span>
      <button
        type="button"
        className="ajustes-stepper-btn"
        onClick={() => onChange(acotar(valor + 1))}
        disabled={valor >= max}
        aria-label={`Aumentar ${etiqueta}`}
      >
        +
      </button>
    </div>
  )
}

/** Desplegable de un ajuste. */
export function Selector({
  valor,
  opciones,
  onChange,
  etiqueta
}: {
  valor: string
  opciones: readonly { label: string; value: string }[]
  onChange: (v: string) => void
  etiqueta: string
}): React.JSX.Element {
  return (
    <select
      className="ajustes-select"
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      aria-label={etiqueta}
    >
      {opciones.map((o) => (
        <option key={o.label} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/**
 * Elegir entre opciones EXCLUYENTES que no son un número.
 *
 * Es lo único que un `Stepper` no sabe representar y el único ajuste que no pasa
 * por `Fila`: aquí la TARJETA sí está justificada —encierra una unidad que se
 * elige entera, y el borde de acento es lo que dice cuál está activa—, y la
 * ayuda pertenece a cada opción, no a la fila.
 */
export function Radios<T extends string>({
  nombre,
  valor,
  opciones,
  onChange
}: {
  /** El `name` del grupo de radios: sin él dos grupos en la misma pantalla se pisan. */
  nombre: string
  valor: T
  opciones: readonly { id: T; label: string; hint: string }[]
  onChange: (id: T) => void
}): React.JSX.Element {
  return (
    <div className="ajustes-radios">
      {opciones.map((o) => (
        <label key={o.id} className={`ajustes-radio${valor === o.id ? ' checked' : ''}`}>
          <input
            type="radio"
            name={nombre}
            checked={valor === o.id}
            onChange={() => onChange(o.id)}
          />
          <span className="ajustes-radio-body">
            <span className="ajustes-fila-etiqueta">{o.label}</span>
            <span className="ajustes-fila-ayuda">{o.hint}</span>
          </span>
        </label>
      ))}
    </div>
  )
}

/** Interruptor ON/OFF. `role="switch"` de verdad, no una casilla disfrazada. */
export function Interruptor({
  activo,
  onChange,
  etiqueta,
  deshabilitado = false
}: {
  activo: boolean
  onChange: () => void
  etiqueta: string
  /**
   * Apagado Y SIN RESPONDER. Existe porque hay un ajuste —la integración con el
   * Explorador— que sencillamente no se puede aplicar en algunos entornos (en
   * desarrollo, en la versión portable). Ignorar el clic en silencio no basta: un
   * interruptor con aspecto normal que no se mueve se lee como que la app está rota.
   */
  deshabilitado?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      disabled={deshabilitado}
      className={`ajustes-switch${activo ? ' on' : ''}`}
      onClick={onChange}
    >
      <span className="ajustes-switch-knob" aria-hidden="true" />
    </button>
  )
}

/**
 * Campo de texto libre de una línea. Es la única primitiva que NO representa una
 * elección cerrada, y existe para el único ajuste que no puede serlo: la lista de
 * paquetes a instalar en el sandbox, que es abierta por definición (no hay un
 * desplegable con todo Debian dentro).
 *
 * Deliberadamente sin validación en vivo: el saneado corre al construir el
 * `--build-arg` (`shared/sandboxExtras`), y marcar en rojo mientras tecleas un
 * nombre a medias sería pelearse con el usuario a cada letra.
 */
export function CampoTexto({
  valor,
  onChange,
  onConfirmar,
  etiqueta,
  placeholder
}: {
  valor: string
  onChange: (v: string) => void
  /**
   * Se llama al SALIR del campo o al pulsar Intro, no en cada tecla. Para el ajuste
   * cuyo efecto es CARO o tiene consecuencias fuera de la app: aplicar por pulsación
   * dejaría en el registro claves de cada prefijo a medio teclear (`.b`, `.ba`), que el
   * borrado no retira porque son del sistema. Con `onChange` se pinta y con
   * `onConfirmar` se actúa.
   */
  onConfirmar?: (v: string) => void
  etiqueta: string
  placeholder?: string
}): React.JSX.Element {
  return (
    <input
      type="text"
      className="ajustes-texto"
      value={valor}
      aria-label={etiqueta}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onConfirmar?.(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onConfirmar?.(e.currentTarget.value)
      }}
    />
  )
}

/**
 * Rejilla de casillas independientes (no excluyentes), para elegir VARIOS de un
 * conjunto pequeño y conocido: hoy, qué extensiones de archivo se asocian a Tessera.
 *
 * No es `Radios` (que elige UNA) ni un `CampoTexto` (que obliga a saber de memoria qué
 * marcar): enseña las opciones. El campo libre sigue al lado para las que no estén.
 * Son `<label>` con `<input type="checkbox">` real: teclado, lector de pantalla y clic
 * en el texto funcionan sin código propio.
 */
export function Casillas({
  opciones,
  marcadas,
  onToggle,
  etiqueta,
  deshabilitado = false
}: {
  opciones: readonly string[]
  marcadas: ReadonlySet<string>
  onToggle: (valor: string) => void
  etiqueta: string
  deshabilitado?: boolean
}): React.JSX.Element {
  return (
    <div className="ajustes-casillas" role="group" aria-label={etiqueta}>
      {opciones.map((o) => (
        <label
          key={o}
          className={`ajustes-casilla${marcadas.has(o) ? ' on' : ''}${deshabilitado ? ' off' : ''}`}
        >
          <input
            type="checkbox"
            checked={marcadas.has(o)}
            disabled={deshabilitado}
            onChange={() => onToggle(o)}
          />
          <span>{o}</span>
        </label>
      ))}
    </div>
  )
}

/** Flecha de "volver al valor heredado". Sin tamaño inline: lo pone el CSS. */
function IconoRestablecer(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" strokeLinecap="round" />
      <path d="M3 4.5V9h4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
