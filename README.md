# LoL Account Manager

Aplicativo desktop para gerenciar múltiplas contas de League of Legends com segurança, com painel de **scouting de partidas ao vivo**, histórico de elo e análise detalhada de jogadores. Construído com Electron.

![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D4?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/License-ISC-blue)

---

## Funcionalidades

### Gerenciamento de Contas
- **Contas completas** — armazena login e senha com criptografia AES-256-GCM
- **Contas monitoradas** — acompanha contas sem precisar de credenciais
- Adicionar, editar, remover e reordenar contas via **drag & drop**
- Bloqueio de **contas duplicadas** (mesmo Riot ID + servidor)
- Notas livres por conta
- Visualização em **tabela** ou **cards**, com filtros por fila, elo, servidor e tag
- **Comparação lado a lado** de qualquer número de contas
- Cópia de login/senha para a área de transferência (auto-limpa em 30s)

### Sistema de Tags Personalizável
- Crie, edite (nome e **cor**) e exclua suas próprias tags em **Configurações → Tags**
- **Múltiplas tags por conta** (seleção por chips, com busca)
- Renomear uma tag reflete automaticamente em todas as contas
- Excluir uma tag remove apenas a associação — as contas não são apagadas
- Contador de contas por tag + ordenação alfabética ou por uso
- As tags (nomes e cores) são incluídas no backup `.lam`

### Análise de Partida ao Vivo (Live Game)
- Botão por conta (🟢 quando em partida) que abre a análise dos **10 jogadores**
- Times separados (**Aliados** 🟦 / **Inimigos** 🟥), carregamento progressivo (X/10)
- Por jogador: Riot ID, nível, campeão, elo da fila (Solo/Duo ou Flex), LP, V/D, win rate
- Detecta **modo streamer** (jogador anônimo) sem erros
- Ordenação por Time / Elo / Win Rate e filtro Aliados / Inimigos / Todos

### Análise Detalhada de Jogador (Scouting)
Clique em qualquer conta **ou** em qualquer jogador do live game para abrir um painel completo:
- **Elo Atual** — Solo/Duo e Flex lado a lado, destacando o maior elo
- **Champion Stats** — desempenho por campeão (jogos, win rate, V/D, KDA, CS médio, posição) das ranqueadas recentes, com botão "Ver mais campeões"
- **Desempenho recente** — win rate, sequência de vitórias/derrotas e perfil de jogo automático (Mono campeão, Versátil, Em ascensão/queda)
- **Histórico recente** — últimas partidas com resultado (vitória/derrota/**remake**), KDA, fila e duração

### Integração com a Riot API
- Rank **Solo/Duo** e **Flex** (divisão, LP, V/D, win rate, série de promoção)
- Foto de perfil e ícones de campeão via Data Dragon
- Atualização automática em intervalo configurável (padrão: 15 min)
- **Rate limiter concorrente** — dispara várias requisições em paralelo respeitando os limites da Riot
- Detecção de "em partida" durante o refresh
- Suporte a Development Key com fallbacks automáticos (busca de PUUID manual quando necessário)

### Histórico de Elo
- Gráfico interativo com a **linha colorida por tier** (Ouro dourado, Platina azul-esverdeado, etc.) — a cor muda exatamente na promoção/rebaixamento
- Pontos verdes (ganho) / vermelhos (perda); tooltip com promoção/rebaixamento
- Alternância entre **Solo/Duo** e **Flex** e por período (7 dias / 30 dias / Tudo)
- **Reconstrução da temporada** — preenche o gráfico com o histórico de partidas ranqueadas anterior à instalação (trecho tracejado, LP aproximado, claramente identificado)

### Notificações
Notificações nativas do Windows (e toast interno) para subida/descida de divisão, série de promoção e API Key prestes a expirar — cada tipo ativável individualmente.

### Atualizações
- Auto-update via **GitHub Releases** (electron-updater)
- Verificação manual ou automática ao iniciar (configurável)
- Mostra versão instalada, última verificação, nova versão, data e changelog
- Download iniciado por botão, com barra de progresso, e integridade verificada (SHA512)

### Ferramentas
- **Encerrar processos Riot** (RiotClient, LeagueClient, LoL.exe)
- **Limpar cache do cliente** (Cache + GPUCache do Riot Client)
- **Reparar cliente** (remove lockfile travado)
- **Abrir pasta de dados** + log de execução das ferramentas

### Backup e Restauração
- Exporta contas, configurações **e tags** para um arquivo `.lam` criptografado
- Criptografia **portátil** — pode ser importado em outra máquina com a senha mestra
- Importação ignora duplicatas (por ID) e mescla as definições de tags

### Segurança
- **Senha mestre** com hash bcrypt (custo 12)
- Dados criptografados com **AES-256-GCM** + IV aleatório por operação
- Chave derivada com **PBKDF2** (100.000 iterações, SHA-256) vinculada ao hardware
- Backup com derivação portátil (sem machine ID)
- Bloqueio após **5 tentativas** incorretas (lockout de 5 min, **persistente** entre reinícios)
- Escrita em disco **atômica** (`.tmp` + rename) — sem corrupção em quedas de energia

### Interface
- Tema **escuro** e **claro**
- Barra de título personalizada (sem frame nativo)
- Minimizar para a **bandeja do sistema** com menu de acesso rápido
- Atalho global `Ctrl + Shift + L` para focar a janela
- Opção de iniciar com o Windows

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18 ou superior
- [Riot Games API Key](https://developer.riotgames.com/) — **Personal Key recomendada** (a Development Key bloqueia o live game e o histórico de partidas)

---

## Instalação e Execução

```bash
# 1. Clone o repositório
git clone https://github.com/RodrigoFass/lol-account-manager.git
cd lol-account-manager

# 2. Instale as dependências
npm install

# 3. Execute em modo desenvolvimento
npm start
```

---

## Build (Distribuição)

```bash
# Instalador NSIS + versão portátil (Windows x64)
npm run build

# Apenas instalador  |  apenas portátil
npm run build:installer
npm run build:portable

# Publicar release no GitHub (gera latest.yml para o auto-update)
npm run release
```

Os arquivos ficam em `dist/`. O ícone é gerado automaticamente por `scripts/generate-icon.js`.

> **Build alternativa "watcher"** (`npm run build:watcher`) — mesma aplicação com ícone de olho, para distribuir a terceiros.

---

## Configuração da API Key

1. Acesse [developer.riotgames.com](https://developer.riotgames.com/) e gere uma **Development Key** (24h) ou solicite uma **Personal API Key**
2. Abra o app, faça login e vá em **Configurações**
3. Cole a chave no campo "API Key" e clique em **Validar e Salvar**

> Após gerar uma chave nova, aguarde ~2 minutos antes de usá-la (propagação da Riot).
>
> **Development Key** tem restrições de endpoint. Se aparecer `PUUID_REQUIRED`, edite a conta e clique em 🔍 Buscar (ou preencha o PUUID manualmente). Live game e Champion Stats exigem **Personal Key**.

---

## Estrutura do Projeto

```
lol-account-manager/
├── main.js              # Processo principal (IPC, Riot API, criptografia, tray, updater)
├── preload.js           # Bridge segura main↔renderer (contextBridge)
├── updater.js           # Auto-update (electron-updater)
├── package.json
├── electron-builder.watcher.json   # Config da build alternativa
├── scripts/
│   ├── generate-icon.js            # Ícone padrão (espada)
│   └── generate-icon-watcher.js    # Ícone alternativo (olho)
└── src/
    ├── index.html       # Interface principal
    ├── login.html       # Login / setup de senha mestre
    ├── css/             # global.css + components.css
    └── js/
        ├── renderer.js       # Contas, modais, navegação, tags, live game, detalhes
        ├── charts.js         # Gráfico de histórico de elo (Chart.js, bundled)
        ├── chart.umd.min.js  # Chart.js empacotado localmente (offline)
        ├── utils.js          # Helpers (rank, toast, winrate, badges, tags, tempo)
        ├── apiKeyManager.js  # Gerenciamento da API Key na UI
        └── tools.js          # Aba de ferramentas
```

---

## Onde os dados são salvos

```
C:\Users\<SeuUsuário>\AppData\Roaming\lol-account-manager\lam-data.json
```

Logins e senhas são **sempre** criptografados — nunca salvos em texto puro.

> ⚠️ **Vínculo com o hardware:** a chave de criptografia é derivada desta máquina (hostname, usuário e CPU). Se você **trocar de PC, reinstalar o Windows, mudar o hostname ou a CPU**, o `lam-data.json` se torna **irrecuperável**. Antes de qualquer mudança, **exporte um backup `.lam`** (Configurações → Backup e Restauração) — ele usa derivação portátil e abre em qualquer máquina com sua senha mestra.

---

## Tipos de Conta

| Tipo | Credenciais | Rank | Histórico | Scouting |
|------|------------|------|-----------|----------|
| **Completa** | Login + Senha (criptografados) | ✅ | ✅ | ✅ |
| **Monitorada** | Sem credenciais | ✅ | ✅ | ✅ |

Contas monitoradas são úteis para acompanhar contas de terceiros ou secundárias sem guardar a senha.

---

## Tecnologias Utilizadas

| Tecnologia | Uso |
|-----------|-----|
| [Electron 28](https://www.electronjs.org/) | Framework desktop |
| [electron-builder](https://www.electron.build/) | Empacotamento e distribuição |
| [electron-updater](https://www.electron.build/auto-update) | Auto-update via GitHub Releases |
| [Chart.js](https://www.chartjs.org/) | Gráfico de histórico de elo (bundled, offline) |
| [bcryptjs](https://github.com/dcodeIO/bcrypt.js) | Hash da senha mestre |
| Node.js `crypto` | AES-256-GCM, PBKDF2 |
| Riot Games API | Rank, partidas, espectador (live game), campeões |
| Data Dragon CDN | Fotos de perfil e ícones de campeão |

---

## Limitações conhecidas

- A Riot **não fornece LP histórico** — o histórico anterior à instalação é *reconstruído* das partidas (aproximado, tracejado). Apex (Mestre+) não é reconstruído.
- **Live game** e **Champion Stats** exigem Personal API Key (Development Key retorna 403).
- Suporte oficial apenas para **Windows**.

---

## Licença

ISC
