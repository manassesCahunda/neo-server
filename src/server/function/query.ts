import { DateTime } from 'luxon';
import { redis } from '@/packages/redis/client';
import { db } from '@/drizzle/client';
import { client } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

redis.setMaxListeners(20);

export interface Conversation {
  id: string;
  name: string;
  date?: string;
  status: boolean;
  preview?: string;
  messages: Message[];
  type?: string;
  phone: string;
  avatar?: string;
  typingUsers?: string[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistent';
  content: string;
  times: string | number;
  raiting: 'like' | 'dislike' | '';
  name?: string;
}

export const streamMessages = async ({ session, remoteJid }: { session: string, remoteJid?: string }): Promise<Conversation[]> => {
  const keys = remoteJid 
    ? await redis.keys(`wa:history:${session}:${remoteJid}`) 
    : await redis.keys(`wa:history:${session}:*`);

  if (!keys.length) return [];

  return Promise.all(
    keys.map(async (key) => {
      const raw = await redis.hvals(key);
      const parsed: any[] = raw.map((m) =>
        typeof m === 'string' ? JSON.parse(m) : m
      );
      const clientId = key.split(':')[3] || '';
      const status =
        await db
          .select()
          .from(client)
          .where(eq(client.keyname, clientId))
          .limit(1);
      const name =
        parsed.find((m) => m.from === false && m.role !== 'assistent')?.name ||  clientId.replace(/\D/g, '');

      const msgs: Message[] = parsed
        .map((m) => {
          const wa = m.content?.message ?? m.message ?? {};
          const text =
            wa.conversation?.trim() ||
            wa.text?.trim() ||
            wa.extendedTextMessage?.text?.trim() ||
            wa.buttonsMessage?.contentText?.trim() ||
            wa.listMessage?.description?.trim() ||
            (wa.imageMessage && 'image') ||
            (wa.audioMessage && 'audio') ||
            (wa.videoMessage && 'video') ||
            (wa.documentMessage && 'document') ||
            'unsupported';
          const msgId =
            m.content?.key?.id?.toString() ||
            m.id ||
            `${clientId}-${m.timestamp}`;
          const tsNum = Number(
            m.content?.messageTimestamp ?? m.timestamp
          );
          if (isNaN(tsNum) || tsNum <= 0) return null;
          const times = DateTime.fromSeconds(tsNum, { zone: 'Africa/Luanda' }).toISO();
          const rating =
            m.rating === 'like'
              ? 'like'
              : m.rating === 'dislike'
              ? 'dislike'
              : '';
          return {
            id: msgId,
            role: m.role === 'assistent' ? 'assistent' : 'user',
            content: text,
            times,
            raiting: rating,
            name: m.name,
          } as Message;
        })
        .filter((m): m is Message => m !== null)
        .sort((a, b) => {
          const ta = DateTime.fromISO(a.times.toString()).toMillis();
          const tb = DateTime.fromISO(b.times.toString()).toMillis();
          return ta - tb;
        });

      const last = msgs[msgs.length - 1];
      const date = last
        ? DateTime.fromISO(last.times.toString(), { zone: 'Africa/Luanda' }).toISO()
        : undefined;

      return {
        id: clientId,
        name,
        date,
        status: status[0]?.status === 0 ? true : false,
        preview: last?.content,
        messages: msgs,
        type: 'chat',
        phone: clientId.replace(/\D/g, ''),
      } as Conversation;
    })
  );
};
