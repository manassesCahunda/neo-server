import WebSocket, { WebSocketServer } from 'ws';

export  async function sendWebSocketMessage(url: string) {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url);

    ws.onopen = () => {
      ws.close();
      resolve();
    };

    ws.onerror = (error: any) => {
      reject(new Error(`WebSocket error: ${error?.message || error}`));
    };

    ws.onclose = (event) => {
      if (!event.wasClean) {
        reject(new Error('WebSocket closed uncleanly'));
      }
    };

    setTimeout(() => {
      if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }
    }, 5000);
  });
}
