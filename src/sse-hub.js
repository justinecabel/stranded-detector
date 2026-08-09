export class SseHub {
  constructor({ database, heartbeatMs = 15_000, now = Date.now }) {
    this.database = database;
    this.heartbeatMs = heartbeatMs;
    this.now = now;
    this.clients = new Set();
    this.heartbeat = null;
  }

  start() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        client.response.write(': heartbeat\n\n');
      }
    }, this.heartbeatMs);
    this.heartbeat.unref?.();
  }

  add(response, bbox) {
    const client = { response, bbox };
    this.clients.add(client);
    this.sendSnapshot(client);
    return () => this.clients.delete(client);
  }

  sendSnapshot(client) {
    const payload = {
      cells: this.database.heatCells(client.bbox, this.now()),
      generatedAt: new Date(this.now()).toISOString()
    };
    client.response.write(`event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  broadcast() {
    for (const client of this.clients) this.sendSnapshot(client);
  }

  close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const client of this.clients) client.response.end();
    this.clients.clear();
  }
}
