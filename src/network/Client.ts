type MessageHandler = (data: Record<string, unknown>) => void;

export class Client {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();

  async connect(url: string, maxRetries = 5): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.tryConnect(url);
        return;
      } catch {
        if (attempt === maxRetries) {
          throw new Error('Impossible de se connecter au serveur');
        }
        await new Promise((r) => setTimeout(r, 1000 + attempt * 1000));
      }
    }
  }

  private tryConnect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject();
      this.ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data as string); } catch { return; }
        if (!msg || typeof msg.type !== 'string') return;
        const handlers = this.handlers.get(msg.type);
        if (handlers) handlers.forEach((h) => h(msg));
      };
      this.ws.onclose = () => {
        const handlers = this.handlers.get('disconnected');
        if (handlers) handlers.forEach((h) => h({}));
      };
    });
  }

  send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
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
}
