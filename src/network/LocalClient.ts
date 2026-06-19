type MessageHandler = (data: Record<string, unknown>) => void;

export class LocalClient {
  private handlers = new Map<string, Set<MessageHandler>>();

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(msg: Record<string, unknown>) {
    switch (msg.type) {
      case 'submit-local':
        setTimeout(() => this.emit('resolve', { moves: msg.moves }), 200);
        break;
      case 'ready':
        setTimeout(() => this.emit('round-start', { duration: 30 }), 500);
        break;
      case 'game-over':
        break;
    }
  }

  start() {
    setTimeout(() => this.emit('round-start', { duration: 30 }), 300);
  }

  on(event: string, handler: MessageHandler): this {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }

  off(event: string, handler: MessageHandler): this {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  removeAllListeners(): this {
    this.handlers.clear();
    return this;
  }

  private emit(event: string, data: Record<string, unknown>) {
    this.handlers.get(event)?.forEach((h) => h(data));
  }
}
