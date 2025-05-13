(global as any).crypto = require('crypto');

import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import url from 'url';
import pino from 'pino';
import {
  makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  WASocket,
  BaileysEventMap,
} from '@whiskeysockets/baileys';
import { useRedisAuthStateWithHSet, deleteHSetKeys } from 'baileys-redis-auth';
import { redis } from '@/packages/redis/client';
import { streamMessages } from './function/query';
import { db } from '@/drizzle/client';
import { client as clientSchema } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

const PORT = parseInt(process.env.SOCKET_PORT || '3001', 10);
const RECONNECT_DELAY = parseInt(process.env.RECONNECT_DELAY_MS || '1000', 10);
const PREFIX = (session: string) => `wa:session:${session}`;

type ServerMessageType = 'qr' | 'connection' | 'error' | 'messages' | 'active' | 'all';
interface ServerMessage {
  type: ServerMessageType;
  data: any;
}

const activeSessions = new Map<string, Set<WebSocket>>();
const baileysSockets: Record<string, WASocket> = {};
const lastQrs = new Map<string, string>();
const pendingConnections: Record<string, Promise<void>> = {};

const server = http.createServer();
const wss = new WebSocketServer({ server });

(server as any).setMaxListeners?.(50);

function broadcast(session: string, type: ServerMessageType, data: any) {
  const clients = activeSessions.get(session);
  if (!clients) return;
  const msg = JSON.stringify({ type, data });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
  console.log(`[${session}] BROADCAST ${type.toUpperCase()}`);
}

async function sendMsg(session: string, jid: string, text: string) {
  const sock = baileysSockets[session];
  if (!sock) {
    console.error(`[${session}] NO SOCKET AVAILABLE`);
    return;
  }
  try {
    await sock.sendMessage(jid, { text });
  } catch (err) {
    console.error(`[${session}] ERROR SENDING MESSAGE`, err);
  }
}

async function updateClientStatus(remoteJid: string, isActive: boolean) {
  await db
    .update(clientSchema)
    .set({ status: isActive ? 0 : 1 })
    .where(eq(clientSchema.keyname, remoteJid));
  console.log(`CLIENT ${remoteJid} STATUS UPDATED: ${isActive ? 'ACTIVE' : 'INACTIVE'}`);
}

function setupBaileysListeners(sock: WASocket, session: string, saveCreds: () => Promise<void>) {
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update: BaileysEventMap['connection.update']) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      lastQrs.set(session, qr);
      broadcast(session, 'qr', qr);
      broadcast(session, 'connection', false);
      console.log(`[${session}] QR GENERATED`);
    }
    if (connection === 'open') {
      lastQrs.delete(session);
      broadcast(session, 'connection', true);
      const msgs = await streamMessages({ session });
      console.log(`[${session}] MESSAGES ALL`,JSON.stringify(msgs, null, 2));
      broadcast(session, 'all', msgs);
      console.log(`[${session}] CONNECTION OPEN`);
    }
    if (connection === 'close') {
      broadcast(session, 'connection', false);
      const code = (lastDisconnect?.error as any)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        await deleteHSetKeys({ redis: redis, key: PREFIX(session) }).catch(e => console.error(`[${session}] ERROR CLEARING AUTH`, e));
        broadcast(session, 'error', 'SESSÃO DESLOGADA');
        console.error(`[${session}] LOGGED OUT`);
        cleanupSession(session);
        return;
      }
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(() => connectToWhatsApp(session), RECONNECT_DELAY);
      }
      console.log(`[${session}] DISCONNECTED`);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    if (!Array.isArray(messages) || messages.length === 0) return;
    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid;
      const messageId = msg.key.id;
      const role = msg.key.fromMe ? 'assistent' : 'user';
      if (!remoteJid?.endsWith('@s.whatsapp.net')) continue;
      const contentType = Object.keys(msg.message || {})[0] || '';
      if (['senderKeyDistributionMessage', 'protocolMessage'].includes(contentType)) continue;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
      if (!remoteJid || !messageId) continue;
      const messageData = {
        id: messageId,
        remoteJid,
        name: msg.pushName,
        from: msg.key.fromMe,
        role,
        rating: null,
        timestamp: msg.messageTimestamp,
        content: msg
      };
      const hashKey = `wa:history:${session}:${remoteJid}`;
      const pipeline = redis.pipeline();
      pipeline.hsetnx(hashKey, messageData.id, JSON.stringify(messageData));
      await pipeline.exec();
      if (!text) continue;
      if (!msg.key.fromMe) {
        broadcast(session, 'messages', {
          message: text,
          userId: session,
          username: msg.pushName,
          date: msg.messageTimestamp,
          remoteJid,
          messageId: msg.key.id,
        });
      }
      const history = await streamMessages({ session });
      console.log(`[${session}] MESSAGES ALL`);
      broadcast(session, 'all', history);
      console.log(`[${session}] MESSAGE UPSERTED`);
    }
  });

  setInterval(() => {
    const qr = lastQrs.get(session);
    if (qr) broadcast(session, 'qr', qr);
  }, 20000);
}

function cleanupSession(session: string) {
  delete baileysSockets[session];
  lastQrs.delete(session);
  const clients = activeSessions.get(session);
  if (clients) activeSessions.delete(session);
  delete pendingConnections[session];
}

async function connectToWhatsApp(session: string) {
  const existing = baileysSockets[session];
  if (existing && existing.ws.isOpen  && WebSocket.OPEN){
    console.log(`[${session}] AN EXISTING OPEN SOCKET WAS FOUND; REUSING THE INSTANCE.`);
    const msgs = await streamMessages({ session });
    console.log(`[${session}] MESSAGES ALL`);
    broadcast(session, 'all', msgs);
    return;
  }
  if (session in pendingConnections) return pendingConnections[session];
  pendingConnections[session] = (async () => {
    if (existing) {
      ['connection.update', 'messages.upsert', 'creds.update'].forEach(evt => existing.ev.removeAllListeners(evt));
    }
    const { state, saveCreds } = await useRedisAuthStateWithHSet(redis.options, PREFIX(session));
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      connectTimeoutMs: 60000,
    });
    baileysSockets[session] = sock;
    console.log(`[${session}] SOCKET CREATED`);
    setupBaileysListeners(sock, session, saveCreds);
  })().finally(() => delete pendingConnections[session]);
  return pendingConnections[session];
}

wss.on('connection', async (ws, req) => {
  const { session, remotejid, message: raw } = url.parse(req.url || '', true).query as Record<string, string>;
  if (!session) ws.send(JSON.stringify({ type: 'error', data: 'NO SESSION' }));
  console.log(`[${session}] WS CONNECTED`);
  const clients = activeSessions.get(session) || new Set<WebSocket>();
  clients.add(ws);
  activeSessions.set(session, clients);
  ws.on('close', () => {
    console.log(`[${session}] WS CLOSED`);
    clients.delete(ws);
    if (clients.size === 0) activeSessions.delete(session);
  });
  await connectToWhatsApp(session);
  const sock = baileysSockets[session];
  const qr = lastQrs.get(session);
  ws.send(JSON.stringify({ type: 'connection', data: Boolean(sock?.ws?.isOpen && !qr) }));
  if (qr) ws.send(JSON.stringify({ type: 'qr', data: qr }));
  if (remotejid && raw) {
    const text = decodeURIComponent(raw);
    await sendMsg(session, remotejid, text);
  }
  ws.on('message', async rawMsg => {
    try {
      const { type, data } = JSON.parse(rawMsg.toString());
      if (type === 'send') {
        await sendMsg(session, data.remotejid, data.content);
      } else if (type === 'active') {
        await updateClientStatus(data.remotejid, data.status);
      }
    } catch (err) {
      console.error(`[${session}] INVALID WS MESSAGE`, err);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[WS] LISTENING ON PORT ${PORT}`);
});
