// One event bus. The pipeline emits; the console sink (one-shot commands) and the TUI subscribe.
import { EventEmitter } from 'node:events';
export const bus = new EventEmitter();
bus.setMaxListeners(50);
export const emit = (type, data) => bus.emit('event', { type, ts: new Date().toISOString(), ...data });
export const on = (fn) => {
  bus.on('event', fn);
  return () => bus.off('event', fn);
};
