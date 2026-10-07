export interface NetworkSettings {
  delayMs: number;
  jitterMs: number;
  dropPercent: number;
}

/**
 * Degrades this client's uplink: each chunk is dropped with some probability,
 * or held for the delay plus a random share of the jitter. Chunks never
 * overtake each other, as on a real ordered connection.
 */
export function createNetworkSimulator(send: (pcm: Int16Array) => void) {
  let settings: NetworkSettings = { delayMs: 0, jitterMs: 0, dropPercent: 0 };
  let lastDue = 0;

  return {
    get settings(): NetworkSettings {
      return settings;
    },
    configure(changes: Partial<NetworkSettings>): void {
      settings = { ...settings, ...changes };
    },
    push(pcm: Int16Array): void {
      if (settings.dropPercent > 0 && Math.random() * 100 < settings.dropPercent) return;
      if (settings.delayMs === 0 && settings.jitterMs === 0) {
        send(pcm);
        return;
      }
      const now = performance.now();
      const due = Math.max(lastDue, now + settings.delayMs + Math.random() * settings.jitterMs);
      lastDue = due;
      setTimeout(() => send(pcm), due - now);
    },
  };
}
