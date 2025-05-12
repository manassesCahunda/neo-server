import { generateText } from "ai";
import { google, openai } from "@/packages/ai";
import { logger, task } from "@trigger.dev/sdk/v3";
import { user, client, appointment } from "@/drizzle/schema";
import { eq, and, not, gte } from "drizzle-orm";
import { env } from "@/env";
import { DateTime } from "luxon";
import { db , pg } from "@/drizzle/client";
import { getConversationHistory } from "@/packages/ai/tools";
import { sendWebSocketMessage } from "@/server/function/ws";
import { streamMessages } from "@/server/function/query";
import { v4 as uuidv4 } from 'uuid';



export const generateMessage = task({
  id: "GENERATE-MESSAGE",
  queue: { concurrencyLimit: 1 },
  run: async (payload: {
    message: string;
    messageId: string;
    userId: string;
    username: string;
    date: number;
    remoteJid: string;
  }) => {
    try {
      const { message, userId, username, remoteJid } = payload;

      const company = await db.select().from(user).where(eq(user.id, userId)).limit(1);
      if (!company.length) throw new Error(`USER WITH ID ${userId} NOT FOUND.`);

      if(company[0]?.refreshToken === "NULL") return true;

      let newClient;
      const existing = await db.select().from(client).where(eq(client.keyname, remoteJid)).limit(1);
      if (existing.length && existing[0].platform === "whatsapp") {
        newClient = existing[0];
      } else {
        const [created] = await db.insert(client).values({
          userId,
          platform: "whatsapp",
          level: "BASIC",
          keyname: remoteJid || "",
          username: username || "",
          status: 0,
          key: "null",
        }).returning();
        if (!created) throw new Error("CLIENT NOT CREATED");
        newClient = created;
      }
      if (newClient.status === 1) return;

      const clientId = newClient.id;
      const today = DateTime.now().toFormat("yyyy-MM-dd HH:mm:ss");

      const upcoming = await db.select()
        .from(appointment)
        .where(and(
          not(eq(appointment.appointment_status, 'completed')),
          gte(appointment.datetime_end, today)
        ));

        const conversations = await streamMessages({ session: userId, remoteJid });
        const allMessages: { content: string; timestamp: string }[] = [];
        
        for (const chat of conversations) {
          if (Array.isArray(chat.messages)) {
            chat.messages.forEach((message) => {
              if (typeof message.content === 'string' && message.times)
                allMessages.push({ content: message.content, timestamp: message.times });
            });
          }
        }
        
        const ordered = allMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        

        let filtered = ordered;
        if (today) {
          const now = new Date(today);
          filtered = ordered.filter((msg) => {
            const msgTime = new Date(msg.timestamp);
            const diffInMs = now.getTime() - msgTime.getTime();
            const diffInMinutes = diffInMs / (1000 * 60);
            return diffInMinutes <= 60 && diffInMinutes >= 0;
          });
        }
        
        const unique = Array.from(new Map(filtered.map(msg => [`${msg.timestamp}-${msg.content}`, msg])).values());
        const context = unique.map((msg) => `${msg.content}`);
        const formattedMessages = unique.slice(-3).map((msg) =>`${msg.timestamp} - ${msg.content}`);
        const time = upcoming.map((msg) =>`${msg?.datetime_end}`);

        const appoint = await db.select()
        .from(appointment)
        .where(and(
          not(eq(appointment.appointment_status, 'completed')),
          eq(appointment.id_client,clientId),
          gte(appointment.datetime_end, today)
        ));


        const systemPrompt = `
        ASSISTENTE DE ATENDIMENTO
        COM BASE NESTAS INSTRUÇÕES ${company[0].prompt}, AJA CONFORME O TIPO DE MENSAGEM DO CLIENTE.
        
        REGRAS DE INTERPRETAÇÃO:
        
         • SE A MENSAGEM RECEBIDA INDICA AGRADECIMENTO OU SATISFAÇÃO (ex: 'obrigado', 'é tudo', 'valeu', entre outras).
           • RESPONDER AGRADECENDO E DEFINIR "conversation": true (não prosseguir com as outras ordens).
           • Exemplo de resposta: "Obrigado, estamos à disposição! Até mais!"

        1. SE A MENSAGEM FOR UM PEDIDO DE AGENDAMENTO:
           • IDENTIFIQUE A DATA MENCIONADA (ex: "2025-05-13", "amanhã", "terça-feira")
           • USE OS HORÁRIOS DE TRABALHO (${company[0].prompt}) PARA IDENTIFICAR HORÁRIOS DISPONÍVEIS
           • REMOVA OS HORÁRIOS OCUPADOS NA DATA
           • SE RESTAREM HORÁRIOS → LISTAR DISPONIBILIDADE
           • SE TODOS OCUPADOS → SUGERIR OUTRO DIA
        
        2. SE A MENSAGEM FOR UM PEDIDO PARA VER AGENDAMENTOS:
           • LISTAR TODOS OS AGENDAMENTOS
           • SE NÃO HOUVER → INFORMAR "Você não tem agendamentos marcados no momento."
        
        3. SE A MENSAGEM FOR GENÉRICA OU SEM CONTEXTO CLARO:
           • NÃO ASSUMIR QUE É UM PEDIDO DE AGENDAMENTO
           • VERIFICAR CONTEXTO ANTERIOR (${formattedMessages || 'SEM CONTEXTO'})
        
        4. SE FOR UMA SAUDAÇÃO:
           • RESPONDER COM CUMPRIMENTO + SUGESTÃO DIRETA
        
        5. SE FOR UMA SOLICITAÇÃO FORA DO ESCOPO:
           • NEGAR EDUCAMENTE
           • DEFINIR: externalActionRequired.action = true
           • RETORNAR MENSAGEM: "Recebemos: '*{{mensagem_original_do_cliente}}*' e encaminhamos ao setor responsável."
        
        HORÁRIOS DE TRABALHO (BASE):
        • Extraído de: ${company[0].prompt}
        • Exemplo: 08:00 até 18:00 (horas cheias)
        
        HORÁRIOS OCUPADOS PARA A DATA MENCIONADA:
        ${time || 'SEM HORÁRIOS OCUPADOS'}
        
        VARIAÇÕES DE DATA:
        - "AMANHÃ" = [data de amanhã]
        - "HOJE" = [data atual]
        - "PRÓXIMA TERÇA" = próxima terça após hoje
        - "SEXTA QUE VEM", "SEGUNDA", etc. = calcular a data correta
        
       DATA ATUAL: ${today}
       AGENDAMENTOS EXISTENTES:
        ${JSON.stringify(appoint, null, 2)} 
        ORDEM DE EXECUÇÃO:
        1. VALIDAR CONTEXTO (${formattedMessages || 'SEM CONTEXTO'})
        2. DEFINIR TOM DE RESPOSTA
        3. OBTER HORÁRIOS DE TRABALHO DA EMPRESA
        4. FILTRAR HORÁRIOS OCUPADOS
        5. IDENTIFICAR HORÁRIOS DISPONÍVEIS
        6. RESPONDER DE FORMA OBJETIVA
        AÇÕES EXTERNAS SÃO NECESSÁRIAS SE:
        - PROBLEMAS QUE EXIJAM PESSOAS
        - O CLIENTE PEDIR SUPORTE, FINANCEIRO OU OUTRA ÁREA HUMANA
        - FALTAREM DADOS MÍNIMOS PARA QUALQUER AÇÃO AUTOMÁTICA
        - MENSAGEM QUE REQUEIRA INTERVENÇÃO HUMANA
        - PEDIDOS HUMANOS
        - SUPORTE, FINANCEIRO OU ÁREA ESPECIALIZADA
        - DADOS INSUFICIENTES PARA CONTINUAR
        - MENSAGEM FORA DO ESCOPO
        FECHAMENTO DE CONVERSA ("CONVERSATION": TRUE) SE:
          SE ELE CONFIRMOU CRIAR, ALTERAR, CANCELAR OU REMARCAR AGENDAMENTO.
          CASO O CLIENTE CONFIRME E ESTA MENSAGEM ${formattedMessages} SEJA SOBRE AGENDAMENTOS. SE NÃO FOR SOBRE AGENDAMENTOS, NÃO FAÇA "CONVERSATION": NULL.
          DEFINA "CONVERSATION": TRUE SOMENTE QUANDO NÃO HOUVER MAIS DÚVIDAS, PENDÊNCIAS OU SOLICITAÇÕES ABERTAS DO CLIENTE.
          ISSO INDICA QUE O ATENDIMENTO FOI CONCLUÍDO COM SUCESSO.
          USE "CONVERSATION": TRUE SE:
          - O CLIENTE CONFIRMOU QUE ESTÁ SATISFEITO OU AGRADECEU PELO ATENDIMENTO.
          - A SOLICITAÇÃO FOI TOTALMENTE RESOLVIDA E NÃO EXIGE MAIS AÇÕES.
          - FOI ENVIADA AO CLIENTE UMA RESPOSTA FINAL QUE ENCERRA LOGICAMENTE O ASSUNTO.
          - O CLIENTE APENAS INFORMOU OU CONFIRMOU ALGO, SEM PEDIR MAIS NADA.
          - A IA RESPONDEU COM SUCESSO E NÃO HÁ NOVAS MENSAGENS OU PERGUNTAS.
          CASO CONTRÁRIO, USE: "CONVERSATION": NULL.
       SE NÃO ESTIVER CLARO, DEFINIR: "conversation": null
       MODELO DE RESPOSTA OBRIGATÓRIO:
        {
          "answer": "mensagem clara, objetiva e educada sempre mensagem para cliente",
          "conversation": true | null,
          "externalActionRequired": {
            "action": true | false,
            "message": null | "Recebemos: '*{{mensagem_original_do_cliente}}*' e encaminhamos ao setor responsável."
          }
        }
        `;
        
        
        
        const userPrompt = `
        INFORMAÇÕES DA EMPRESA:
        ${company[0].prompt}
         DADOS DO CLIENTE:
        - NOME: ${username}
        - JID: ${remoteJid}
        - USER_ID: ${userId}
        - CONTEXTO: ${formattedMessages || 'SEM CONTEXTO'}
        - MENSAGEM RECEBIDA: ${message}
        REGRAS DE INTERPRETAÇÃO:
        1. MENSAGEM GENÉRICA OU CONFIRMAÇÃO SEM CONTEXTO:
           • VERIFICAR SE A MENSAGEM RECEBIDA INDICA AGRADECIMENTO OU SATISFAÇÃO (ex: 'obrigado', 'é tudo', 'valeu', entre outras).
           • RESPONDER AGRADECENDO E DEFINIR "conversation": true (não prosseguir com as outras ordens).
           • Exemplo de resposta: "Obrigado, estamos à disposição! Até mais!"
           • VERIFICAR SE CONTINUA ${formattedMessages || 'SEM MENSAGEM'}
           • SE NÃO CONTINUAR → PERGUNTAR: "Poderia me informar com o que posso te ajudar?"
        2. MENSAGEM DE CONFIRMAÇÃO (ex: "sim, pode confirmar"):
           • NÃO PERGUNTAR NOVAMENTE, PROSSEGUIR DIRETO COM A AÇÃO
        3. PEDIDO DE VER AGENDAMENTOS:
           • FILTRAR ARRAY DE AGENDAMENTOS
           • SE HOUVER: listar data e horário
           • SE NÃO HOUVER: "Você não tem agendamentos marcados no momento."
        4. PEDIDO DE DISPONIBILIDADE:
           • VERIFICAR DATA MENCIONADA
           • OBTER HORÁRIOS DE TRABALHO
           • SUBTRAIR HORÁRIOS OCUPADOS
           • LISTAR LIVRES
           • SE TODOS OCUPADOS: sugerir outro dia
        5. SAUDAÇÃO:
           • CUMPRIMENTAR + SUGESTÃO ÚTIL      
        6. MENSAGEM FORA DO ESCOPO:
           • NEGAR EDUCAMENTE
           • externalActionRequired.action = true
           • externalActionRequired.message = "Recebemos: '*{{mensagem_original_do_cliente}}*' e encaminhamos ao setor responsável."
        MENSAGENS DE ENCERRAMENTO (MESMO COM CONTEXTO):
        • SE O CLIENTE ENCERRA → DEFINIR: "conversation": true
        NUNCA INVENTAR HORÁRIOS, DADOS OU CONFIRMAÇÕES
        HORÁRIOS OCUPADOS PARA A DATA:
        ${time || "SEM HORÁRIOS OCUPADOS"}
        `;
        
        const { text } = await generateText({
          model: env.AI_DEFAULT_MODEL.includes("gemini")
            ? google(env.AI_DEFAULT_MODEL)
            : openai(env.AI_DEFAULT_MODEL),
          system: systemPrompt.trim(),
          prompt: userPrompt.trim(),
          tools: { getConversationHistory },
          maxSteps: 5,
        });
    

       const firstBrace = text.indexOf('{');
       const lastBrace = text.lastIndexOf('}');

       const json: {
       answer: string | null;
       conversation: boolean | null;
       externalActionRequired: {
         action: boolean | null;
         message: string | null ; 
       } } = JSON.parse(text.slice(firstBrace, lastBrace + 1));


       console.log(`RECEIVE:${json?.answer} - MESSAGE - ${message} `);

       if(json?.conversation){

         const id = uuidv4();

         const upcoming = await db.select()
         .from(appointment)
         .where(and(
           not(eq(appointment.appointment_status, 'completed')),
           eq(appointment.id_client,clientId),
           gte(appointment.datetime_end, today)
         ));
         const { text } = await generateText({
          model: env.AI_DEFAULT_MODEL.includes("gemini")
            ? google(env.AI_DEFAULT_MODEL)
            : openai(env.AI_DEFAULT_MODEL),
          system: `
        VOCÊ É UMA IA ESPECIALISTA EM GERAR QUERIES SQL APENAS PARA AGENDAMENTOS.
        SCHEMA -> TABELA DE AGENDAMENTOS;
        
        CREATE TYPE "public"."status_enum" AS ENUM('pending', 'completed', 'in_progress', 'cancelled');
        CREATE TABLE "appointments" (
          "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
          "id_client" uuid NOT NULL,
          "user_id" uuid NOT NULL,
          "datetime_start" timestamp NOT NULL,
          "datetime_end" timestamp NOT NULL,
          "status" "status_enum" NOT NULL,
          "value" numeric(10,2),
          "name" varchar(255),
          "description" varchar(255),
          "quantity" integer,
          "category" varchar(255),
          "price" numeric(10,2),
          "details" varchar(255)
        );
        
        REGRAS GERAIS:
         PARA QUERIRES DE INSER USA ESTE ID= ${id}
        1) VALIDAÇÃO DE INTENÇÃO:
           • INSERIR (NOVO AGENDAMENTO)
           • ATUALIZAR (STATUS -> 'completed' OU 'cancelled')
           • SE FOR OUTRA SOLICITAÇÃO, RETORNE [].
        
        2) INTERPRETAÇÃO DE DATAS:
           • "AMANHÃ" = data de amanhã
           • "HOJE" = data de hoje
           • "PRÓXIMA TERÇA", "SEXTA QUE VEM", etc. = data correta a partir de hoje
        
        3) VALIDAÇÃO DE DADOS (APERFEIÇOAR SÓ SE INTENÇÃO VÁLIDA):
           • TIPO DE SERVIÇO
           • DATA (YYYY-MM-DD)
           • HORA DE INÍCIO (HH:mm)
           • HORA DE TÉRMINO (HH:mm)
           ➞ SE FALTAR QUALQUER DADO, RETORNE [].
        
        4) VALIDAÇÃO DE CONFLITO DE HORÁRIO:
           • RECEBA A LISTA DE PRÓXIMOS AGENDAMENTOS (upcoming).
           • NÃO GERAR INSERT SE O NOVO HORÁRIO (start–end) SOBREPÕE QUALQUER AGENDAMENTO EXISTENTE.
           ➞ EM CASO DE CONFLITO, RETORNE [].
        
        5) GERAÇÃO DE QUERIES:
           • INSERT INTO appointments (...)
           • UPDATE appointments SET status = 'completed'|'cancelled' WHERE id = '...';
        
        6) FORMATO DE SAÍDA:
           • RETORNE APENAS UM ARRAY DE STRINGS, por exemplo:
             [
               "INSERT INTO appointments (...);",
               "UPDATE appointments SET status = 'completed' WHERE id = '...';"
             ]
           • NUNCA GERAR SELECT OU OUTRA INSTRUÇÃO.
          `,
          prompt: `
        -- CONTEXTO DO USUÁRIO --
        NOME: ${username}
        NÚMERO DO CLIENTE: ${remoteJid}
        ID_CLIENT: ${clientId}
        ID_USER: ${userId}
        DATA ATUAL: ${today}
        MENSAGENS ANTERIORES FORMATADAS:
        ${context}
        
        PRÓXIMOS AGENDAMENTOS DO CLIENTE (upcoming):
        ${JSON.stringify(upcoming, null, 2)}
          `,
          tools: { getConversationHistory },
          maxSteps: 5,
        });
        

         const firstBrace = text.indexOf('[');
         const lastBrace = text.lastIndexOf(']');
        
        
         let array: unknown;
        
         try {
           array = JSON.parse(text.slice(firstBrace, lastBrace + 1));
         } catch (err) {
           throw new Error("INVALID JSON PARSE.");
         }
        
         if (!Array.isArray(array)) {
           throw new Error("THIS IS NOT A VALID ARRAY.");
         }
        
         array.forEach((item) => {
           if (typeof item !== 'string') {
             throw new Error("INVALID QUERY ITEM.");
           }
           const query = pg.unsafe(item);
           if (!query) {
             throw new Error("QUERY PARSE FAILED.");
           }
         });
       }


       if (json?.externalActionRequired?.action) {
         const profile = await db.select().from(user).where(eq(user.id, userId)).limit(1);
         if (profile.length === 0) throw new Error('USER NOT FOUND.');
         const phone = profile[0].remoteJid || '0';

         const forwardedMessage = `➦ Mensagem Encaminhada\n +
           ━━━━━━━━━━━━━━━━━━━━━━━\n +
           - De: [ @${username} ]\n +
           - Data: [ ${today} ]\n\n +
           Conteúdo da Mensagem\n +
           ━━━━━━━━━━━━━━━━━━━━━━━\n +
           "${json.externalActionRequired.message}"\n +
           ━━━━━━━━━━━━━━━━━━━━━━━`;

        //  await sendWebSocketMessage(`ws:localhost:${process.env.SOCKET_PORT}/?session=${userId}&remotejid=${encodeURIComponent(`244925070708@whatsapp.net`)}&message=${encodeURIComponent(forwardedMessage)}`);
       }

      //  if (json?.answer) await sendWebSocketMessage(`ws:localhost:${process.env.SOCKET_PORT}/?session=${userId}&remotejid=${encodeURIComponent(remoteJid)}&message=${encodeURIComponent(json.answer)}`);
       

      return text;
    } catch (error) {
      logger.error("SEND-MESSAGE TASK FAILED", { error });
      throw error;
    }
  },
});
