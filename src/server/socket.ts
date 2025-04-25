import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import url from 'url';
import pino from 'pino';
import {
  makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  WASocket
} from '@whiskeysockets/baileys';
import { useRedisAuthStateWithHSet, deleteHSetKeys } from 'baileys-redis-auth';
import { redis } from '@/packages/redis/client';
import { streamMessages } from './function/query';
import { db } from "@/drizzle/client";
import { client as clientSchema } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

const redisClient = redis;
const PREFIX = (session: string) => `wa:session:${session}`;

const sockets: Record<string, WASocket> = {};
const lastQrs = new Map<string, string | null>();
const activeSessions = new Map<string, Set<WebSocket>>();
const reconnectingSessions = new Set<string>();
const PORT = parseInt(process.env.SOCKET_PORT || '3001', 10);

type ServerMessage = { type: 'qr' | 'connection' | 'error' | 'messages' | 'active'; data: any };

const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req) => {
  const { session, remotejid, message: rawMsg } = url.parse(req.url || '', true).query as any;
  const message = rawMsg ? decodeURIComponent(rawMsg as string) : undefined;
  
  if (!session) {
    ws.send(JSON.stringify({ type: 'error', data: 'SESSION NOT FOUND' }));
    return ws.close();
  }

  if (!activeSessions.has(session)) activeSessions.set(session, new Set());
  activeSessions.get(session)!.add(ws);

  ws.once('close', () => {
    const conns = activeSessions.get(session)!;
    conns.delete(ws);
    if (conns.size === 0) activeSessions.delete(session);
    console.log(`[${session}] WS CLOSED`);
  });

  if (sockets[session]) {
    const sock = sockets[session]!;
    const isOpen = sock.ws?.isOpen;
    const hasQr = !!lastQrs.get(session);
    const connOk = isOpen && !hasQr;
    ws.send(JSON.stringify({ type: 'connection', data: connOk }));
    const qr = lastQrs.get(session);
    if (qr) ws.send(JSON.stringify({ type: 'qr', data: qr }));
    await streamMessages({ ws, session });
  } else {
    connectToWhatsApp(session).catch(console.error);
  }

  if (remotejid && message) {
    await sendMessageToWhatsApp(session, remotejid as string, message);
  }

  ws.on('message', async raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'send' && msg.data.remotejid && msg.data.content) {
        await sendMessageToWhatsApp(session, msg.data.remotejid, msg.data.content);
      } else if (msg.type === 'active' && msg.data.remotejid) {
        const statusVal = msg.data.status === true ? 0 : 1;
        await db.update(clientSchema).set({ status: statusVal }).where(eq(clientSchema.keyname, msg.data.remotejid));
      }
    } catch (err) {
      console.error(`[${session}] INVALID WS MSG`, err);
    }
  });
});

async function connectToWhatsApp(session: string) {
  if (reconnectingSessions.has(session)) return;
  reconnectingSessions.add(session);

  const { state, saveCreds } = await useRedisAuthStateWithHSet(redis.options, PREFIX(session));
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    connectTimeoutMs: 60000
  });

  sockets[session] = sock;
  console.log(`[${session}] SOCKET CREATED`);
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (connection === 'close') {
      broadcast(session, 'connection', false);
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        try {
          await deleteHSetKeys({ redis: redisClient, key: PREFIX(session) });
          console.log(`[${session}] AUTH STATE CLEARED DUE TO LOGOUT`);
        } catch (e) {
          console.error(`[${session}] ERROR CLEARING AUTH STATE`, e);
        }
        broadcast(session, 'error', 'SESSION LOGGED OUT');
        console.error(`[${session}] LOGGED OUT`);
        delete sockets[session];
        lastQrs.delete(session);
        reconnectingSessions.delete(session);
        return;
      }
      delete sockets[session];
      lastQrs.delete(session);
      reconnectingSessions.delete(session);
      setTimeout(() => connectToWhatsApp(session), 1000);
      return;
    }

    if (qr) {
      lastQrs.set(session, qr);
      broadcast(session, 'qr', qr);
      broadcast(session, 'connection', false);
      console.log(`[${session}] QR GENERATED`);
    }

    if (connection === 'open') {
      lastQrs.delete(session);
      broadcast(session, 'connection', true);
      streamMessagesToAll(session);
      console.log(`[${session}] FULLY CONNECTED`);
    }
  });

  sock.ev.on('messages.upsert', handleUpsert(session));

  setInterval(() => {
    const qr = lastQrs.get(session);
    if (qr) broadcast(session, 'qr', qr);
  }, 20000);
}

function streamMessagesToAll(session: string) {
  for (const ws of activeSessions.get(session) ?? []) {
    streamMessages({ ws, session }).catch(console.error);
  }
}

function handleUpsert(session: string) {
  return async ({ messages }: any) => {
    if (!Array.isArray(messages) || messages.length === 0) return;
    for (const msg of messages) {
      const jid = msg?.key?.remoteJid;
      if (!jid?.endsWith('@s.whatsapp.net')) continue;
      const contentType = Object.keys(msg.message || {})[0];
      if (['senderKeyDistributionMessage', 'protocolMessage'].includes(contentType)) continue;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

      if (!text) continue;

      const pipeline = redisClient.pipeline();
      const remoteJid = msg?.key?.remoteJid;
      const messageId = msg?.key?.id;

      if (!remoteJid || !messageId) continue;

      const role = msg.key.fromMe ? 'ASSISTANT' : 'USER';

      const messageData = {
        id: messageId,
        remoteJid,
        name: msg.pushName,
        from: msg.key.fromMe,
        role,
        rating: null,
        timestamp: msg.messageTimestamp,
        message: msg.message,
      };

      const hashKey = `wa:history:${session}:${remoteJid}`;
      pipeline.hsetnx(hashKey, messageId, JSON.stringify(messageData));

      await pipeline.exec();
      if (msg.key.fromMe) continue;

      broadcast(session, 'messages', {
        message: text.toUpperCase(),
        userId: session,
        username: msg.pushName,
        date: msg.messageTimestamp,
        remoteJid: msg.key.remoteJid,
        messageId: msg.key.id
      });
      console.log(`[${session}] MESSAGE SAVED AND BROADCASTED: ${text.toUpperCase()}`);
    }
    console.log(`[${session}] MESSAGES UPSERT`);
  };
}

async function sendMessageToWhatsApp(session: string, remotejid: string, message: string) {
  const sock = sockets[session];
  if (!sock) return console.error(`[${session}] NO SOCKET FOUND`);
  try {
    await sock.sendMessage(remotejid, { text: message });
    console.log(`[${session}] MESSAGE SENT TO ${remotejid}: ${message.toUpperCase()}`);
  } catch (err) {
    console.error(`[${session}] ERROR SENDING MESSAGE TO ${remotejid}:`, err);
  }
}

function broadcast(session: string, type: ServerMessage['type'], data: any) {
  for (const ws of activeSessions.get(session) ?? []) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, data }));
  }
  console.log(`[${session}] BROADCAST ${type.toUpperCase()}`);
}

server.listen(PORT, () => console.log(`[WS] LISTENING ON PORT ${PORT}`));
