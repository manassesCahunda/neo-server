import  { Tool } from "ai";
import  { streamMessages  } from"@/server/function/query";
import  { sendWebSocketMessage  } from"@/server/function/ws";
import { z } from "zod";
import  { pg , db  } from "@/drizzle/client"
import { eq } from "drizzle-orm"
import  { user } from "@/drizzle/schema"

export const getConversationHistory: Tool = {
  description: `
    EXECUTADO
      SEMPRE QUE NAO TIVER CONTEXTO
      QUANDO PRECISAR DE UMA NOVA INFORMACAO
      SEMPRE QUE CLIENTE FALAR ALGO DO PASSADO
      SEMPRE QUE QUISER OBTER HISTORICO
  `,
  parameters: z.object({
    userId: z.string().nonempty().describe('ID DO USUÁRIO (NÃO PODE SER VAZIO OU INDEFINIDO)'),
    remoteJid: z.string().nonempty().describe('IDENTIFICADOR DO DESTINATÁRIO (USUÁRIO)'),
    keyword: z.string().optional().nullable().describe('PALAVRA-CHAVE PARA FILTRAR MENSAGENS RELEVANTES'),
    date: z.string().optional().nullable().describe('DATA NO FORMATO YYYY-MM-DD PARA FILTRAR MENSAGENS'),
    maxAgeMinutes: z.number().int().positive().optional().describe('IDADE MÁXIMA EM MINUTOS DAS MENSAGENS A SEREM CONSIDERADAS (PADRÃO: 1440, EQUIVALENTE A 24 H)'),
  }),
  execute: async ({ userId, remoteJid, keyword, date, maxAgeMinutes = 1440 }) => {
    if (!userId || !remoteJid) {
      throw new Error('Os parâmetros userId e remoteJid são obrigatórios e não podem ser vazios.');
    }

    console.log(
      `getConversationHistory chamado com userId=${userId}, remoteJid=${remoteJid}, date=${date}, keyword=${keyword}, maxAgeMinutes=${maxAgeMinutes}`
    );

    const jidClean = remoteJid.split('?')[0];
    const conversations = await streamMessages({ session: userId, remoteJid: jidClean });
    console.log(`Total de conversas recebidas: ${conversations.length}`);

    const allMessages: { content: string; timestamp: string }[] = [];
    for (const chat of conversations) {
      if (Array.isArray(chat.messages)) {
        for (const msg of chat.messages) {
          if (typeof msg.content === 'string' && typeof msg.times === 'string') {
            allMessages.push({ content: msg.content, timestamp: msg.times });
          }
        }
      }
    }

    const now = Date.now();
    const ageLimitMs = maxAgeMinutes * 60 * 1000;
    const recentMessages = allMessages.filter(msg => {
      const msgTime = new Date(msg.timestamp).getTime();
      return now - msgTime <= ageLimitMs;
    });

    const ordered = recentMessages.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    let filtered = ordered;
    if (date) {
      filtered = filtered.filter(msg => msg.timestamp.startsWith(date));
    }
    if (keyword) {
      const key = keyword.toLowerCase();
      filtered = filtered.filter(msg => msg.content.toLowerCase().includes(key));
    }

    const seen = new Set<string>();
    const unique = filtered.filter(msg => {
      const key = `${msg.timestamp}-${msg.content}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const formattedMessages = unique.map(
      msg => `${new Date(msg.timestamp).toLocaleString('pt-BR')} - ${msg.content}`
    );

    console.log(
      `QUERY-STORE: ${formattedMessages.join(' | ')}\nEXECUTE: ${userId} -- ${keyword ?? 'sem keyword'} -- ${date ?? 'sem data'} -- maxAgeMinutes=${maxAgeMinutes} -- ${jidClean}`
    );

    return formattedMessages.length > 0
      ? formattedMessages.join('\n')
      : 'Nenhuma mensagem relevante encontrada.';
  },
};


export const query: Tool = {
  description: `
    CREATE TYPE "public"."status_enum" AS ENUM('pending', 'completed', 'in_progress');
    CREATE TABLE "appointments" (
      "id" uuid DEFAULT gen_random_uuid() NOT NULL, PRIMARY KEY,  -- Gerar UUID automaticamente
      "id_client" uuid NOT NULL,                     -- Identificador único do cliente
      "user_id" uuid NOT NULL,                       -- Identificador do usuário (funcionário responsável)
      "datetime_start" timestamp,                    -- Data e hora de início do agendamento
      "datetime_end" timestamp,                      -- Data e hora de término do agendamento
      "status" "status_enum" NOT NULL,               -- Status do agendamento (pendente, concluído, em progresso)
      "value" numeric(10, 2),                        -- Valor do agendamento
      "name" varchar(255),                           -- Nome do agendamento (por exemplo, tipo de serviço)
      "description" varchar(255),                    -- Descrição do agendamento
      "quantity" integer,                            -- Quantidade de itens ou serviços no agendamento
      "category" varchar(255),                       -- Categoria do agendamento
      "price" numeric(10, 2),                        -- Preço do agendamento
      "details" varchar(255)                         -- Detalhes adicionais sobre o agendamento
    );
  `,
  parameters: z.object({
    query: z.string().nonempty('- A QUERY NÃO PODE SER VAZIA. FORNEÇA UMA QUERY VÁLIDA.'),
  }),
  execute: async ({ query }) => {
    const result = await pg.unsafe(query);
    console.log(`QUERIES-SQL: ${query} \nEXECUTE: ${result}`);
    return JSON.stringify(result);
  },
};



export const externalActionRequired: Tool = {
  description: `
`,
  parameters: z.object({
    userId: z.string().nonempty().describe('ID DO USUÁRIO PARA BUSCA DE PERFIL'),
    username: z.string().nonempty().describe('NOME DE USUÁRIO QUE ENVIOU A MENSAGEM'),
    message: z.string().nonempty().describe('CONTEÚDO DA MENSAGEM ENCAMINHADA'),
    date: z.string().nonempty().describe('DATA/HORA DA MENSAGEM'),
  }),
  execute: async ({ userId, username, message, date }) => {
    const profile = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    
    if (profile.length === 0) throw new Error('USER NOT FOUND.');
  
    const phone = profile[0].remoteJid || '0';

    const forwardedMessage = `➦ Mensagem Encaminhada\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━  \n` +
      `- De: [ @${username} ]\n` +
      `- Data: [ ${new Date(date).toLocaleString()} ]  \n\n` +
      `Conteúdo da Mensagem\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━  \n` +
      `"${message}"\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━  `;

    await sendWebSocketMessage(
      `ws://localhost:${process.env.SOCKET_PORT}/?session=${userId}&remotejid=${encodeURIComponent(
        phone
      )}&message=${encodeURIComponent(forwardedMessage)}`
    );

    console.log(`QUERY-ACTION: EXTERNAL ACTION REQUIRED  \n RESULT: ${userId} --  ${username} -- ${message} -- ${date}`);

    return forwardedMessage;
  },
};
