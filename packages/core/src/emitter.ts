type Handler<T> = (payload: T) => void;

/**
 * Minimal typed event emitter. Written here instead of using node:events so the
 * core stays runnable in a browser or worker without shims.
 */
export function createEmitter<Events extends Record<string, unknown>>() {
  const handlers = new Map<keyof Events, Set<Handler<never>>>();

  return {
    on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler as Handler<never>);
      return () => set?.delete(handler as Handler<never>);
    },
    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
      const set = handlers.get(event);
      if (!set) return;
      for (const handler of set) (handler as Handler<Events[K]>)(payload);
    },
  };
}
