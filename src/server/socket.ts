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
import { useRedisAuthStateWithHSet } from 'baileys-redis-auth';
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
    const err = 'SESSION NOT FOUND';
    ws.send(JSON.stringify({ type: 'error', data: err }));
    console.error(`[${session || 'UNKNOWN'}] ERROR: ${err}`);
    return ws.close();
  }


  if (!activeSessions.has(session)) activeSessions.set(session, new Set());
  activeSessions.get(session)!.add(ws);
  ws.once('close', () => {
    const conns = activeSessions.get(session)!;
    conns.delete(ws);
    if (conns.size === 0) activeSessions.delete(session);
    console.log(`[${session}] CLOSED WS CONNECTION`);
  });


  if (sockets[session]) {
    const sock   = sockets[session]!;
    const isOpen = sock.ws?.isOpen;
    const hasQr  = !!lastQrs.get(session);
    const connOk = isOpen && !hasQr;

    ws.send(JSON.stringify({ type: 'connection', data: connOk }));
    console.log(`[${session}] ${connOk ? 'CONNECTED' : 'DISCONNECTED'} (reused socket)`);

    const lastQr = lastQrs.get(session);
    if (lastQr) {
      ws.send(JSON.stringify({ type: 'qr', data: lastQr }));
      console.log(`[${session}] RESEND QR`);
    }

    await streamMessages({ ws, session });
  } else {
    console.log(`[${session}] NEW SOCKET INIT`);
    connectToWhatsApp(session).catch(err => {
      const errMsg = 'FALHA NA CONEXÃO AO WHATSAPP';
      console.error(`[${session}] ERROR: ${errMsg}`, err);
      ws.send(JSON.stringify({ type: 'error', data: errMsg }));
    });
  }


  if (remotejid && message) {
    console.log(`[${session}] SENDING INITIAL MESSAGE`);
    sendMessageToWhatsApp(session, remotejid as string, message);
  }


  ws.on('message', async raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'send' && msg.data.remotejid && msg.data.content) {
        console.log(`[${session}] SENDING WS-TRIGGERED MESSAGE`, msg.data);
        await sendMessageToWhatsApp(session, msg.data.remotejid, msg.data.content);

      } else if (msg.type === 'active' && msg.data.remotejid) {
        console.log(`[${session}] ACTIVE `, msg.data);
        if (msg.data.status === true) {
          await db
            .update(clientSchema)
            .set({ status: 0 })
            .where(eq(clientSchema.keyname, msg.data.remotejid))
            .returning();
        } else {
          await db
            .update(clientSchema)
            .set({ status: 1 })
            .where(eq(clientSchema.keyname, msg.data.remotejid))
            .returning();
        }
      }
    } catch {
      console.error(`[${session}] INVALID WS MESSAGE`);
    }
  });
});

async function connectToWhatsApp(session: string, attempt = 0) {
  if (reconnectingSessions.has(session)) return;
  reconnectingSessions.add(session);

  try {
    if (attempt > 0) {
      const backoff = Math.min(30_000, 1000 * 2 ** attempt);
      console.log(`[${session}] RECONNECTING (attempt ${attempt}, backoff ${backoff}ms)`);
      await new Promise(r => setTimeout(r, backoff));
    }

    const { state, saveCreds } = await useRedisAuthStateWithHSet(redis.options, PREFIX(session));
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      defaultQueryTimeoutMs: undefined,
      connectTimeoutMs: 60_000
    });

    sockets[session] = sock;
    console.log(`[${session}] SOCKET CREATED (version ${version.join('.')})`);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {

      if (qr) {
        lastQrs.set(session, qr);
        broadcast(session, 'qr', qr);
        broadcast(session, 'connection', false);
        console.log(`[${session}] QR GENERATED`);
      }


      if (connection === 'open') {
        lastQrs.delete(session);
        broadcast(session, 'connection', true);
        console.log(`[${session}] FULLY CONNECTED`);

        for (const ws of activeSessions.get(session) ?? []) {
          await streamMessages({ ws, session });
        }
      }

      if (connection === 'close') {
        delete sockets[session];
        lastQrs.delete(session);
        console.log(`[${session}] DISCONNECTED`);

        const status = (lastDisconnect?.error as any)?.output?.statusCode;
        if (status !== DisconnectReason.loggedOut) {
          reconnectingSessions.delete(session);
          await connectToWhatsApp(session, attempt + 1);
        } else {
          broadcast(session, 'error', 'SESSÃO DESLOGADA');
          console.error(`[${session}] LOGGED OUT`);
        }
      }
    });


    setInterval(() => {
      const qr = lastQrs.get(session);
      if (qr) {
        broadcast(session, 'qr', qr);
        console.log(`[${session}] PERIODIC QR RESEND`);
      }
    }, 20_000);

 
    sock.ev.on('messages.upsert', async ({ messages }) => {
      if (!Array.isArray(messages) || messages.length === 0) return;

      for (const msg of messages) {
        const jid = msg?.key?.remoteJid || '';
        if (!jid.endsWith('@s.whatsapp.net')) continue;

        const contentType = Object.keys(msg.message || {})[0];
        if (['senderKeyDistributionMessage', 'protocolMessage'].includes(contentType)) continue;

        const remoteJid = msg.key.remoteJid!;
        const messageId = msg.key.id!;
        const role = msg.key.fromMe ? 'assistant' : 'user';

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
        const pipeline = redisClient.pipeline();
        pipeline.hsetnx(hashKey, messageId, JSON.stringify(messageData));
        await pipeline.exec();

        const text =
          msg.message?.extendedTextMessage?.text ||
          msg.message?.conversation ||
          msg.message?.extendedTextMessageWithParentKey?.extendedTextMessage?.text;

        if (!text || msg.key.fromMe) continue;

        for (const ws of activeSessions.get(session) ?? []) {
          await streamMessages({ ws, session });
        }

        broadcast(session, 'messages', {
          message: text,
          userId: session,
          username: msg.pushName,
          date: msg.messageTimestamp,
          remoteJid,
          messageId,
        });
      }

      console.log(`[${session}] MESSAGES UPSERT: ${messages.length} new`);
    });
  } finally {
    reconnectingSessions.delete(session);
  }
}

function sendMessageToWhatsApp(session: string, remotejid: string, message: string) {
  const sock = sockets[session];
  if (!sock) {
    console.error(`[${session}] NO SOCKET FOUND`);
    return;
  }
  sock
    .sendMessage(remotejid, { text: message })
    .then(() => console.log(`[${session}] MESSAGE SENT TO ${remotejid}`))
    .catch(err => console.error(`[${session}] FAILED TO SEND MESSAGE`, err));
}

function broadcast(session: string, type: ServerMessage['type'], data: any) {
  for (const ws of activeSessions.get(session) ?? []) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    }
  }
  console.log(`[${session}] BROADCAST ${type.toUpperCase()}`);
}

server.listen(PORT, () => {
  require('events').EventEmitter.defaultMaxListeners = 30;
  console.log(`[WS] SERVER LISTENING ON PORT ${PORT}`);
});
