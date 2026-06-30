import type { ClientMsg, ServerMsg } from "../shared/types.js";

export class Net {
  private ws: WebSocket | null = null;
  private url: string;
  private onMsg: (msg: ServerMsg) => void;
  private queue: ClientMsg[] = [];

  constructor(onMsg: (msg: ServerMsg) => void) {
    this.onMsg = onMsg;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.url = `${proto}://${location.host}/ws`;
    this.connect();
  }

  private connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      for (const m of this.queue) ws.send(JSON.stringify(m));
      this.queue = [];
    };
    ws.onmessage = (ev) => {
      try {
        this.onMsg(JSON.parse(ev.data) as ServerMsg);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      this.ws = null;
      setTimeout(() => this.connect(), 1000); // simple reconnect
    };
    ws.onerror = () => ws.close();
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }
}
