type MessageHandler = (data: Record<string, unknown>) => void;

export class Client {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () =>
        reject(new Error('Impossible de se connecter au serveur'));
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
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
