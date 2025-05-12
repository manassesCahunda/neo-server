# Neo-Server 🚀

Servidor rápido e escalável, utilizando Bailey *edge*, WebSocket para múltiplas conexões por sessão, e Fastify para um CRUD eficiente. Integrado com IA para analisar mensagens e gerar scripts SQL (insert, select, update) no banco de dados **PostgreSQL**.

### Funcionalidades:

- 🔗 **Bailey Edge** para otimizar o desempenho.
- ⚡ **WebSocket** para conexões em tempo real.
- ⚙️ **Fastify** para CRUD ágil.
- 🧠 **Inteligência Artificial** para analisar interações e gerar queries SQL.
- 🗃️ **PostgreSQL** para armazenamento robusto e escalável.

---

### 🚀 Instalação

1. Clone o repositório:
   ```bash
   git clone git@github.com:manassesCahunda/neo-server.git
   cd neo-server
   ```

2. Instale as dependências usando **pnpm**:
   ```bash
   pnpm install
   ```

### 🛠️ Scripts de Desenvolvimento

- **`dev:parallel`**: Executa todos os processos de desenvolvimento em paralelo.
  ```bash
  pnpm run dev:parallel
  ```

- **`watch:server`**: Observa mudanças no servidor (`server.ts`).
  ```bash
  pnpm run watch:server
  ```

- **`watch:socket`**: Observa mudanças no socket (`socket.ts`).
  ```bash
  pnpm run watch:socket
  ```

- **`watch:trigger`**: Executa o comando de desenvolvimento para triggers.
  ```bash
  pnpm run watch:trigger
  ```

- **`db:generate`**: Gera migrações do banco de dados.
  ```bash
  pnpm run db:generate
  ```

- **`db:migrate`**: Aplica as migrações no banco de dados.
  ```bash
  pnpm run db:migrate
