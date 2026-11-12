// Logs estructurados en JSON, una línea por evento. Fáciles de leer en vivo y de filtrar.
export function createLogger(service) {
  const write = (level, event, fields = {}) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, service, event, ...fields });
    (level === 'error' ? console.error : console.log)(line);
  };
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}
