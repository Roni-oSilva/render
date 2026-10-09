# 🛡️ Render Guardian

Monitor pessoal de sites/serviços web. **Executor** Node.js/TypeScript rodando no **GitHub Actions** (agendado), **persistência** no **Supabase (PostgreSQL)** e **painel** React/Vite/Tailwind publicado no **GitHub Pages**. Funciona sem navegador aberto e sem seu computador ligado.

## Arquitetura

```
GitHub Actions (cron */5) ──► src/monitor ──► Supabase (service_role, só no Actions)
                                  │  alertas: Discord / webhook / e-mail (Resend)
                                  └► ping opcional healthchecks.io (supervisão independente)
GitHub Actions (watchdog 2x/h) ──► checa heartbeat no banco ──► alerta + job vermelho
Painel (GitHub Pages) ──► Supabase (chave anon + login + RLS)
```

| Pasta | Função |
|---|---|
| `src/monitor/` | verificação HTTP, retries/backoff, execução em lote, watchdog |
| `src/security/` | validação de URL, classificação de IPs, resolução DNS fixada (anti-SSRF/rebinding) |
| `src/services/` | regras de incidente (abertura, recuperação, dedupe) |
| `src/database/` | `Repository`, implementação Supabase e implementação em memória (testes) |
| `src/alerts/` | Discord, webhook genérico, e-mail (Resend) |
| `src/dashboard/` | painel React |
| `src/shared/` | tipos, validação, CSV, logger com redação de segredos |
| `supabase/migrations/` | esquema SQL, RLS, funções de lease/retenção |
| `.github/workflows/` | `monitor`, `watchdog`, `ci`, `deploy-dashboard` |

### Como funciona
- O cron roda a cada 5 min; cada serviço só é verificado quando seu **intervalo próprio** (5–30 min) venceu (tolerância de 90 s).
- **Concorrência**: `concurrency` do workflow + *lease* atômico no banco (`acquire_lease`) — execuções sobrepostas são ignoradas. Lease expira em 10 min (recupera de travamentos).
- Cada serviço é processado isoladamente (`try/catch` + pool de concorrência); timeout total por verificação inclusive corpo/redirecionamentos.
- **Retries** só para erros transitórios (timeout, conexão recusada/interrompida, DNS temporário, 429/500–504), backoff 1 s, 2 s, 4 s… (máx. 10 s) e no máximo `max_attempts`.
- **Incidentes**: aberto ao atingir N falhas consecutivas (índice único garante 1 aberto por serviço); alerta de queda só para quem criou o incidente; alerta de recuperação só para quem o encerrou (atômico).
- **Heartbeat/execuções**: tabela `monitor_runs` (início, fim, status, processados, falhas internas, duração) e `monitor_state.last_heartbeat_at`.
- **Retenção**: cada execução apaga histórico mais antigo que `retention_days` (padrão 30).
- Status do site ≠ status do monitor: o painel mostra os dois separadamente.

## Instalação passo a passo

### 1. Repositório
Faça fork/push deste código para **seu** repositório GitHub (**público recomendado**: Actions é gratuito e ilimitado em repositórios públicos; em privado o plano gratuito tem cota mensal — veja Limitações). Nenhum segredo fica no código.

### 2. Supabase
1. Crie um projeto em <https://supabase.com> (plano Free).
2. **SQL Editor** → cole e execute `supabase/migrations/0001_init.sql` (ou `supabase db push` com a CLI).
3. **Authentication → Users → Add user**: crie **seu** usuário (e-mail + senha). Depois, em **Authentication → Sign In / Providers**, **desative “Allow new users to sign up”**. As políticas RLS permitem acesso total a *qualquer usuário autenticado* e nenhum acesso anônimo — por isso o cadastro aberto deve ficar desligado.
4. **Project Settings → API**: anote `Project URL`, a chave **anon/publishable** (vai no painel) e a **service_role** (vai somente em segredos do Actions; nunca no navegador).

### 3. Segredos do GitHub (Settings → Secrets and variables → Actions)
**Secrets**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; alertas (use os que quiser): `DISCORD_WEBHOOK_URL`, `GENERIC_WEBHOOK_URL`, `RESEND_API_KEY` + `ALERT_EMAIL_FROM` + `ALERT_EMAIL_TO`; supervisão externa: `HEARTBEAT_URL`.
**Variables** (tab *Variables*): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (valores públicos).

- Discord: Canal → Editar → Integrações → Webhooks → copiar URL.
- E-mail: conta em <https://resend.com>; o remetente precisa de domínio verificado.
- Supervisão independente: crie um check em <https://healthchecks.io> (grátis) com período 5 min e tolerância ~10 min, e use a URL de ping como `HEARTBEAT_URL`. Se o GitHub parar de executar o monitor, o healthchecks.io avisa — algo que o próprio Actions não consegue fazer.

### 4. Publicar o painel
Settings → Pages → *Source: GitHub Actions*. Faça push na `main` (ou rode o workflow **Deploy painel**). O painel fica em `https://SEU-USUARIO.github.io/SEU-REPO/`. Entre com o usuário criado no passo 2.

### 5. Validar a primeira execução
1. No painel → **Serviços** → cadastre um site (ex.: `https://example.com`).
2. GitHub → Actions → **Monitor** → *Run workflow* (force = true).
3. O job deve terminar verde; o log mostra `Concluída: 1 processados…`.
4. No painel (aba Painel) aparecem: monitor saudável, última execução, serviço operacional, latência.
5. Teste os alertas: cadastre uma URL inexistente (`https://naoexiste-teste-123.com`) com 1 falha consecutiva; um incidente abre e o alerta é enviado; corrija/exclua e confira a recuperação.
6. Rode **Watchdog** manualmente: deve ficar verde.

### Desenvolvimento local
```
cp .env.example .env     # preencha; para o painel use .env.local com VITE_*
npm install
npm run dev              # painel
npm run typecheck && npm test && npm run build
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run monitor
```

## Limitações reais (leia)
- **Sem garantia de 24/7 nem de “exatamente a cada 5 min”.** O cron do GitHub Actions é *best effort*: atrasos de vários minutos em horários de pico são comuns, execuções podem ser puladas, e o intervalo mínimo é 5 min. Intervalos curtos são nominais.
- Em repositório **público**, o GitHub **desativa workflows agendados após 60 dias sem atividade** no repositório; faça um commit/ação ocasional ou reative em Actions.
- Repositório **privado**: a cota gratuita (hoje ~2.000 min/mês) **não comporta** um cron de 5 min (~8.600 execuções/mês). Use repositório público ou aumente os intervalos/adote plano pago. Limites e preços mudam — confirme na documentação do GitHub.
- Supabase Free: banco de 500 MB e pausa de projetos inativos (o monitor gera atividade constante, mas confirme as políticas vigentes). Com 5 serviços a cada 5 min ≈ 1.440 linhas/dia; a retenção de 30 dias mantém o volume pequeno.
- O watchdog roda na mesma infraestrutura (GitHub). Para detecção realmente independente use o `HEARTBEAT_URL` (healthchecks.io ou similar).
- **Alternativa se precisar de garantias maiores**: executor dedicado (VPS pequeno/Fly.io/Railway com `node` + `cron`/systemd rodando `npm run monitor` a cada minuto) mais um monitor externo (UptimeRobot, Better Stack) como segunda opinião.
- Portas permitidas nos alvos: 80, 443, 8080, 8443. IPs privados/reservados, metadados de nuvem e hostnames internos são bloqueados (SSRF), inclusive após redirecionamentos; a conexão é feita no IP já validado (anti-DNS-rebinding). Resposta lida até 512 KB só se houver palavra-chave.
- Limite de 5 serviços imposto por *trigger* no banco (edite a função `enforce_service_limit` para ampliar) e no painel.
- Os testes de integração usam um repositório em memória com a mesma semântica atômica; **não** há teste automatizado contra um Postgres real — valide pela “primeira execução” acima.

## Diagnóstico e recuperação

| Sintoma | Causa provável / ação |
|---|---|
| Job `Monitor` vermelho: “Configuração ausente” | Faltam `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` nos *Secrets* |
| `Banco de dados (...): Invalid API key` / JWT | Chave service_role errada ou rotacionada; atualize o segredo |
| `relation "…" does not exist` | Migration não aplicada |
| Painel: “Monitor atrasado” | Veja Actions → Monitor; workflows agendados desativados (60 dias) → reative; fila do GitHub atrasada → aguarde |
| “Outra execução está em andamento” sempre | Lease preso: aguarde 10 min ou rode `update monitor_state set lock_holder=null, lock_expires_at=null;` |
| Alertas não chegam | Veja o log (“Falha ao enviar alerta via …”); confira segredo/URL. Falha de alerta nunca interrompe verificações; o incidente mantém `open_alert_sent=false` |
| Painel vazio / erro 401 | Variáveis `VITE_*` ausentes no build ou usuário não criado |
| Serviço “Erro de configuração” | URL aponta para destino bloqueado (privado/porta não permitida) |
| Histórico não aparece após exclusão | Excluir serviço apaga seu histórico (cascata) |

Logs nunca contêm segredos (redação automática de chaves, webhooks, JWT e Bearer).
