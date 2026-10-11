// =============================================================================
// Contrato IPC general: perfiles, abrir una URL externa y el informe de fallos del
// renderer hacia el log del main.
// Lo usan el preload, `main/index.ts`, `main/profiles/ipc.ts` y `main/app/ipc.ts`.
// =============================================================================
export const IPC_CHANNELS = {
  GET_PROFILES: 'profiles:getAll',
  /**
   * invoke: persiste el arreglo COMPLETO de perfiles (alta/nombre/orden/color). Profile[] -> void. Nunca
   * borra: un perfil que no venga en la lista se conserva.
   */
  SAVE_PROFILES: 'profiles:save',
  /** invoke: el usuario borró el perfil; sale de la lista y se borra lo suyo. string(id) -> void. */
  DELETE_PROFILE: 'profiles:delete',
  /**
   * invoke: abre una URL http(s)/mailto en el NAVEGADOR DEL SISTEMA (shell.openExternal).
   * El main valida el esquema; nunca navega el renderer. string(url) -> void.
   */
  OPEN_EXTERNAL_URL: 'shell:openExternalUrl',
  /**
   * send (renderer -> main): reporta un error GLOBAL del renderer (window.onerror /
   * unhandledrejection) para que el main lo vuelque al crash-log en disco. Best-effort,
   * sin respuesta. { tag, detail } -> void.
   */
  REPORT_CRASH: 'crash:report'
} as const

/** Mensaje del canal REPORT_CRASH (error global del renderer hacia el log del main). */
export interface CrashReport {
  /** Origen del incidente ('renderer:error' | 'renderer:unhandledrejection'). */
  tag: string
  /** Descripción ya aplanada del error (mensaje + stack si lo había). */
  detail: string
}
