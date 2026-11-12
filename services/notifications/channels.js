// Canales de notificación. Cada canal es un adaptador con la misma forma: send(mensaje).
// Agregar un canal nuevo (p. ej. SMS) = agregar un adaptador aquí; ni Ingesta ni Alertas cambian.

// Canal LOG: siempre disponible, sirve como evidencia en la demo.
export function logChannel(log) {
  return {
    name: 'log',
    async send(msg) {
      log.info('notify.log', { alertId: msg.alertId, to: 'operadores', text: msg.text });
    },
  };
}

// Canal EMAIL simulado. En el sistema real lo cubre Resend (ya implementado en el backend).
// Para la demo se puede "apagar" el proveedor con una llave en Redis y observar los reintentos.
export function emailChannel(redis, log) {
  return {
    name: 'email',
    async send(msg) {
      if (await redis.exists('sim:email:down')) throw new Error('Proveedor de email no disponible (simulado)');
      await new Promise((r) => setTimeout(r, 20)); // latencia simulada del proveedor
      log.info('notify.email', { alertId: msg.alertId, to: 'supervisor@finca.example', subject: msg.subject });
    },
  };
}

// Canal SMS simulado — ejemplo del escenario E3 (modificabilidad): un canal nuevo es UN adaptador
// más. No hay que tocar Ingesta ni Alertas. Se activa con NOTIFY_CHANNELS=log,email,sms
export function smsChannel(log) {
  return {
    name: 'sms',
    async send(msg) {
      await new Promise((r) => setTimeout(r, 15));
      log.info('notify.sms', { alertId: msg.alertId, to: '+57 300 000 0000', text: msg.text.slice(0, 80) });
    },
  };
}
