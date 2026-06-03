# LoL Account Manager

Aplicativo desktop para gerenciar múltiplas contas de League of Legends com segurança, construído com Electron.

![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D4?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/License-ISC-blue)

---

## Funcionalidades

### Gerenciamento de Contas
- **Contas completas** — armazena login e senha com criptografia AES-256-GCM
- **Contas monitoradas** — acompanha contas sem precisar de credenciais
- Adicionar, editar, remover e reordenar contas via drag & drop
- Tags personalizadas (ex: Vigiando) para organização
- Notas livres por conta
- Visualização em **tabela** ou **cards**
- **Comparação lado a lado** de qualquer número de contas selecionadas

### Integração com a Riot API
- Busca automática de rank **Solo/Duo** e **Flex** via Riot Games API
- Exibe divisão, LP, vitórias, derrotas e winrate
- Busca de maestria de campeões (top 50)
- Foto de perfil carregada via Data Dragon
- Atualização automática em intervalo configurável (padrão: 15 min)
- Rate limiter interno (respeita os limites de 20 req/s e 100 req/2min da Riot)
- Suporte a chaves de desenvolvimento com fallbacks automáticos

### Histórico de Elo
- Gráfico interativo de evolução de rank por conta
- Registra apenas quando há mudança real de tier, divisão ou LP
- Até 100 pontos históricos por conta
- Seletor de conta com preview de elo e foto de perfil

### Ferramentas
- **Encerrar processos Riot** — mata RiotClient, LeagueClient e LoL.exe
- **Limpar cache do cliente** — remove Cache e GPUCache do Riot Client
- **Reparar cliente** — remove lockfile do Riot Client e do LoL
- **Abrir pasta de dados** — abre a pasta onde o `lam-data.json` é salvo

### Notificações
Notificações nativas do Windows (e toast interno) para:
- Subida de divisão
- Descida de divisão
- Conta em série de promoção
- API Key próxima de expirar

Cada tipo pode ser ativado ou desativado individualmente nas Configurações.

### Backup e Restauração
- Exporta todas as contas para um arquivo `.lam` (formato proprietário criptografado)
- A criptografia do backup é **portátil** — pode ser importado em qualquer máquina
- Importação ignora duplicatas automaticamente (por ID de conta)
- Requer confirmação de senha mestre para exportar

### Segurança
- **Senha mestre** com hash bcrypt (custo 12)
- Dados criptografados com **AES-256-GCM** + IV aleatório por operação
- Chave derivada com **PBKDF2** (100.000 iterações, SHA-256) vinculada ao hardware da máquina
- Backup portátil usa derivação sem machine ID para ser importável em outro PC
- Bloqueio automático após **5 tentativas** incorretas (lockout de 5 minutos)
- Clipboard auto-limpo após **30 segundos** ao copiar credenciais

### Interface
- Tema escuro por padrão
- Barra de título personalizada (sem frame nativo)
- Minimizar para a **bandeja do sistema** (system tray) com menu de acesso rápido
- Atalho global: `Ctrl + Shift + L` para trazer a janela ao foco
- Auto-update integrado via `electron-updater`

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18 ou superior
- [Riot Games Developer API Key](https://developer.riotgames.com/) (Development ou Personal)

---

## Instalação e Execução

```bash
# 1. Clone o repositório
git clone https://github.com/rotriguin/lol-account-manager.git
cd lol-account-manager

# 2. Instale as dependências
npm install

# 3. Execute em modo desenvolvimento
npm start
```

---

## Build (Distribuição)

```bash
# Gera instalador NSIS + versão portátil para Windows x64
npm run build

# Apenas instalador
npm run build:installer

# Apenas portátil
npm run build:portable
```

Os arquivos gerados ficam na pasta `dist/`.

> **Ícone:** o script `scripts/generate-icon.js` gera o `build/icon.ico` automaticamente antes do build.

---

## Configuração da API Key

1. Acesse [developer.riotgames.com](https://developer.riotgames.com/) e gere uma **Development Key** (válida por 24h) ou solicite uma **Personal API Key**
2. Abra o app, faça login e vá em **Configurações**
3. Cole a chave no campo "API Key" e clique em Salvar
4. A chave é validada automaticamente contra a Riot API antes de ser armazenada

> **Chaves de desenvolvimento** têm restrições de endpoint. Se ao atualizar uma conta aparecer a mensagem `PUUID_REQUIRED`, edite a conta e preencha o campo PUUID manualmente (disponível no API Explorer do portal da Riot).

---

## Estrutura do Projeto

```
lol-account-manager/
├── main.js              # Processo principal Electron (IPC, Riot API, criptografia, tray)
├── preload.js           # Bridge segura entre main e renderer (contextBridge)
├── updater.js           # Lógica de auto-update (electron-updater)
├── package.json
├── scripts/
│   └── generate-icon.js # Gerador de ícone para build
└── src/
    ├── index.html       # Interface principal
    ├── login.html       # Tela de login / setup de senha mestre
    ├── css/
    │   ├── global.css   # Reset, variáveis CSS, layout base
    │   └── components.css # Todos os componentes UI
    └── js/
        ├── renderer.js  # Lógica da interface principal (contas, modais, navegação)
        ├── utils.js     # Helpers (rank, toast, winrate, badges, tempo)
        ├── charts.js    # Gráfico de histórico de elo (Canvas API)
        ├── tools.js     # Aba de ferramentas
        └── apiKeyManager.js # Gerenciamento de API Key na UI
```

---

## Onde os dados são salvos

O arquivo `lam-data.json` fica na pasta de dados do usuário do Electron:

```
C:\Users\<SeuUsuário>\AppData\Roaming\lol-account-manager\lam-data.json
```

Logins e senhas das contas são **sempre** armazenados criptografados. Nunca são salvos em texto puro.

---

## Tipos de Conta

| Tipo | Credenciais | Rank | Histórico |
|------|------------|------|-----------|
| **Completa** | Login + Senha (criptografados) | ✅ | ✅ |
| **Monitorada** | Sem credenciais | ✅ | ✅ |

Contas monitoradas são úteis para acompanhar contas de outras pessoas ou contas secundárias das quais você não quer salvar a senha.

---

## Tecnologias Utilizadas

| Tecnologia | Uso |
|-----------|-----|
| [Electron 28](https://www.electronjs.org/) | Framework desktop |
| [electron-builder](https://www.electron.build/) | Empacotamento e distribuição |
| [electron-updater](https://www.electron.build/auto-update) | Auto-update |
| [bcryptjs](https://github.com/dcodeIO/bcrypt.js) | Hash da senha mestre |
| Node.js `crypto` | AES-256-GCM, PBKDF2 |
| Riot Games API | Dados de rank e campeões |
| Data Dragon CDN | Fotos de perfil e assets |
| Canvas API | Gráfico de histórico de elo |

---

## Licença

ISC
