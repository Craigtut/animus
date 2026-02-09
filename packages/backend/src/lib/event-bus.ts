/**
 * Event Bus — concrete implementation using Node.js EventEmitter.
 */

import { EventEmitter } from 'events';
import type { AnimusEventMap, IEventBus } from '@animus/shared';

class AnimusEventBus implements IEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof AnimusEventMap>(
    event: K,
    listener: (payload: AnimusEventMap[K]) => void
  ): void {
    this.emitter.on(event as string, listener);
  }

  off<K extends keyof AnimusEventMap>(
    event: K,
    listener: (payload: AnimusEventMap[K]) => void
  ): void {
    this.emitter.off(event as string, listener);
  }

  emit<K extends keyof AnimusEventMap>(event: K, payload: AnimusEventMap[K]): void {
    this.emitter.emit(event as string, payload);
  }

  once<K extends keyof AnimusEventMap>(
    event: K,
    listener: (payload: AnimusEventMap[K]) => void
  ): void {
    this.emitter.once(event as string, listener);
  }
}

/**
 * Create a new event bus instance.
 */
export function createEventBus(): IEventBus {
  return new AnimusEventBus();
}

/** Singleton event bus for the application. */
let globalBus: IEventBus | null = null;

export function getEventBus(): IEventBus {
  if (!globalBus) {
    globalBus = createEventBus();
  }
  return globalBus;
}
