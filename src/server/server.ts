import { redis } from '@/packages/redis/client'
import { db } from '@/drizzle/client'
import { client } from '@/drizzle/schema'
import { eq } from 'drizzle-orm'

redis.setMaxListeners(20)

const extractContent = (message: any): string => {
  const msg = message?.message || message
  if (!msg) return ''

  if (msg.conversation) return msg.conversation.trim()
  if (msg.text) return msg.text.trim()
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text.trim()
  if (msg.imageMessage) return 'image'
  if (msg.audioMessage) return 'audio'
  if (msg.videoMessage) return 'video'
  if (msg.documentMessage) return 'document'
  if (msg.buttonsMessage?.contentText) return msg.buttonsMessage.contentText.trim()
  if (msg.listMessage?.description) return msg.listMessage.description.trim()

  return 'unsupported'
}

const formatMessages = (msgs: any[]) => {
  return msgs
    .map((msg) => {
      const content = extractContent(msg.message)
      const ts = Number(msg.timestamp)
      if (!content || isNaN(ts) || ts <= 0) return null

      return {
        ...msg,
        content,
        times: new Date(ts * 1000).toISOString()
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.times).getTime() - new Date(b.times).getTime())
}

const getClientData = async (key: string, msgs: any[]) => {
  const clientId = key.split(':')[3]
  const record = await db.select()
    .from(client)
    .where(eq(client.keyname, clientId))
    .limit(1)
  const status = record[0]?.status === 0

  let name = 'Desconhecido'
  for (const msg of msgs) {
    if (msg?.from === false && msg?.role !== 'assistant' && msg?.name) {
      name = msg.name
      break
    }
  }

  return {
    id: clientId,
    name,
    phone: clientId.replace(/\D/g, ''),
    messages: formatMessages(msgs),
    status
  }
}

const processSingleJid = async (session: string, remoteJid: string) => {
  const key = `wa:history:${session}:${remoteJid}`
  const raw = await redis.hvals(key)
  const msgs = raw.map((m) => JSON.parse(m) || m)
  const data = await getClientData(key, msgs)
  return [data]
}

const processAllJids = async (session: string) => {
  const keys = await redis.keys(`wa:history:${session}:*`)
  if (!keys.length) return []
  return Promise.all(keys.map(async (key) => {
    const raw = await redis.hvals(key)
    const msgs = raw.map((m) => JSON.parse(m) || m)
    return getClientData(key, msgs)
  }))
}

/**
 * Retorna um array com os históricos de mensagens formatados.
 *
 * @param session – identificador da sessão WhatsApp
 * @param remoteJidFilter – (opcional) se informado, só retorna para esse JID
 */
export const streamMessages = async ({
  session,
  remoteJidFilter
}: {
  session: string
  remoteJidFilter?: string
}) => {
  if (remoteJidFilter) {
    return processSingleJid(session, remoteJidFilter)
  } else {
    return processAllJids(session)
  }
}
