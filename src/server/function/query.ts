import WebSocket from 'ws';
import { redis } from '@/packages/redis/client';
import { db } from "@/drizzle/client";
import { client } from "@/drizzle/schema";
import { eq } from 'drizzle-orm';

redis.setMaxListeners(20);

const extractContent = (message: any): string => {
  const msg = message?.message || message;
  if (!msg) return "";

  if (msg.conversation) return msg.conversation.trim();
  if (msg.text) return msg.text.trim();
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text.trim();
  if (msg.imageMessage) return "image";
  if (msg.audioMessage) return "audio";
  if (msg.videoMessage) return "video";
  if (msg.documentMessage) return "document";
  if (msg.buttonsMessage?.contentText) return msg.buttonsMessage.contentText.trim();
  if (msg.listMessage?.description) return msg.listMessage.description.trim();

  return "unsupported";
};

const formatMessages = (msgs: any[]) => {
  return msgs.map((msg) => {
    const content = extractContent(msg.message);
    const timestamp = Number(msg.timestamp);

    let times = null;
    if (!isNaN(timestamp) && timestamp > 0) {
      try {
        times = new Date(timestamp * 1000).toISOString();
      } catch (e) {
        console.warn("Invalid timestamp:", timestamp, e);
      }
    }

    return content && times
      ? { ...msg, content, times }
      : null;
  }).filter(Boolean);
};

const getClientData = async (key: string, msgs: any[]) => {
  const clientId = key.split(':')[3];
  const status = clientId
    ? (await db.select().from(client).where(eq(client.keyname, clientId)).limit(1))[0]?.status
    : 'unknown';

  let name = "Desconhecido";
  for (const msg of msgs) {
    if (msg?.from === false && msg?.role !== "assistant" && msg?.name) {
      name = msg.name;
      break;
    }
  }

  return {
    id: clientId,
    name,
    phone: clientId.replace(/[^0-9]/g, ''),
    messages: formatMessages(msgs).sort((a, b) => new Date(a.times).getTime() - new Date(b.times).getTime()),
    status: status === 0 ? true : false,
  };
};

export const streamMessages = async ({ ws, session, remoteJidFilter }: { ws: WebSocket; session: string; remoteJidFilter?: string }) => {
  let messageSent = false;  

  const sendMessages = async () => {
    if (messageSent) return; 

    try {
      console.log(`PROCESSANDO MENSAGENS PARA A SESSÃO ${session}`);
      const allData = remoteJidFilter
        ? await processSingleJid(session, remoteJidFilter)
        : await processAllJids(session);

      if (allData && allData.length > 0) {
        console.log("ENVIANDO DADOS PARA O WEBSOCKET...");
        ws.send(JSON.stringify({ type: 'all', data: allData }));
      } else {
        console.warn(`NO DATA TO SEND FOR SESSION: ${session}`);
        ws.send(JSON.stringify({ type: 'all', data: [] }));
      }

      ws.send(JSON.stringify({ type: 'end' }));
      ws.close();
      messageSent = true; 
      console.log(`MENSAGENS ENVIADAS COM SUCESSO PARA A SESSÃO ${session}`);
    } catch (error) {
      console.error('ERROR WHILE PROCESSING OR SENDING MESSAGES:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Failed to process messages' }));
      ws.close();
      messageSent = true; 
    }
  };


  ws.on('open', () => {
    sendMessages();  
  });

  ws.on('close', () => {
    console.log("WEBSOCKET CLOSED.");
  });

  ws.on('error', (err) => {
    console.error("WEBSOCKET ERROR:", err);
    ws.close(); 
  });

  const processSingleJid = async (session: string, remoteJidFilter: string) => {
    const key = `wa:history:${session}:${remoteJidFilter}`;
    const raw = await redis.hvals(key);
    const msgs = raw.map((m) => JSON.parse(m) || m);
    return [{
      id: remoteJidFilter,
      name: msgs.find((msg) => msg?.from === false && msg?.role !== "assistant" && msg?.name)?.name || "Desconhecido",
      phone: remoteJidFilter.replace(/[^0-9]/g, ''),
      messages: formatMessages(msgs),
    }];
  };

  const processAllJids = async (session: string) => {
    const keys = await redis.keys(`wa:history:${session}:*`);
    return keys.length
      ? await Promise.all(keys.map(async (key) => {
        const raw = await redis.hvals(key);
        const msgs = raw.map((m) => JSON.parse(m) || m);
        return getClientData(key, msgs);
      }))
      : [];
  };
};
