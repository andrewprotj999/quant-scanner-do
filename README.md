# Quant Scanner — Standalone Memecoin Engine

A production-ready, self-hosted memecoin scanning and paper trading engine with an adaptive learning system, auto-tuning backtests, and health monitoring. Runs 24/7 on a $5-10 VPS with zero external dependencies.

---

## Architecture

```
quant-scanner-standalone/
├── backend/                  ← Node.js + Express API + Scanner Engine
│   ├── src/
│   │   ├── config.ts         ← Environment configuration
│   │   ├── server.ts         ← Express API server (entry point)
│   │   ├── core/
│   │   │   ├── paperEngine.ts    ← Scanner + qualification + position management
│   │   │   └── healthMonitor.ts  ← Health metrics + self-healing
│   │   ├── db/
│   │   │   ├── schema.ts     ← SQLite schema (Drizzle ORM)
│   │   │   ├── index.ts      ← Database connection
│   │   │   ├── queries.ts    ← Query helpers
│   │   │   └── migrate.ts    ← Auto-migration on startup
│   │   ├── services/
│   │   │   ├── dexscreener.ts    ← DexScreener API client
│   │   │   └── notify.ts        ← Telegram/Discord notifications
│   │   └── execution/
│   │       └── index.ts      ← Future trading interfaces (NOT active)
│   ├── ecosystem.config.cjs  ← PM2 process manager config
│   ├── package.json
│   └── tsconfig.json
├── frontend/                 ← React + Vite UI (deploy to Vercel)
│   ├── src/
│   │   ├── App.tsx           ← Routes + sidebar layout
│   │   ├── lib/api.ts        ← API client
│   │   └── pages/            ← Dashboard, Positions, History, Health, Settings
│   ├── package.json
│   └── vite.config.ts
├── .env.example              ← All configuration options
├── .gitignore
└── README.md                 ← This file
```

---

## Features

The engine includes every feature from the original Manus-hosted version, restructured for standalone operation.

| Feature | Description |
|---|---|
| Multi-source scanning | Pulls from 4 DexScreener endpoints across all chains every 30 seconds |
| 9-factor conviction scoring | Volume, liquidity, momentum, holder count, multi-timeframe confirmation |
| Rug-pull detection | Liquidity/FDV ratio analysis, suspicious liquidity upper bound filtering |
| Dynamic position sizing | Conviction-weighted allocation with configurable risk bounds |
| Trailing stop system | Pre-TP1, post-TP1, and big-win trailing stops with dynamic percentages |
| Circuit breaker | Emergency exit on >50% price crash between cycles |
| Volume dry-up detection | Exits when post-entry volume collapses below threshold |
| Adaptive learning | Tracks patterns by chain, volume tier, price range, and adjusts scoring weights |
| Auto-tuning backtests | Runs every 6 hours, analyzes performance, and adjusts 14 engine parameters |
| Health monitoring | Cycle metrics, API latency tracking, error rates, self-healing on failures |
| Telegram/Discord alerts | Trade notifications, auto-tune changes, and health warnings |
| Paper trading | Full position lifecycle simulation with realistic P&L tracking |
| Execution layer prep | Interfaces for Solana (Jupiter) and EVM (1inch) when ready for live trading |

---

## Quick Start

### Prerequisites

- Node.js 20+ (LTS recommended)
- npm or pnpm
- A VPS with 512MB+ RAM ($5-10/month on DigitalOcean, Hetzner, or Vultr)

### 1. Clone and Install

```bash
git clone https://github.com/YOUR_USERNAME/quant-scanner-standalone.git
cd quant-scanner-standalone

# Backend
cd backend
npm install
cp ../.env.example ../.env
cd ..

# Frontend
cd frontend
npm install
cd ..
```

### 2. Configure Environment

Edit `.env` in the project root:

```bash
nano .env
```

Required settings:

```env
PORT=3001
AUTO_START=true
SCAN_INTERVAL_MS=30000
```

Optional (recommended):

```env
# Generate an API key for security
API_KEY=$(openssl rand -hex 32)

# Telegram notifications (see Notifications section below)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### 3. Build and Run

```bash
# Build backend
cd backend
npm run build

# Start with PM2
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # Auto-start on reboot
```

### 4. Verify

```bash
# Check health
curl http://localhost:3001/api/health

# Check engine status
curl http://localhost:3001/api/engine

# View logs
pm2 logs quant-scanner
```

---

## VPS Deployment (Full Guide)

### Step 1: Provision a VPS

Any Ubuntu 22.04+ VPS with 512MB RAM works. Recommended providers:

- **Hetzner** — CX22 ($4.15/mo, 2 vCPU, 4GB RAM, EU)
- **DigitalOcean** — Basic Droplet ($6/mo, 1 vCPU, 1GB RAM)
- **Vultr** — Cloud Compute ($5/mo, 1 vCPU, 1GB RAM)

### Step 2: Server Setup

SSH into your VPS and run:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 22 (LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version  # Should show v22.x.x
npm --version

# Install PM2 globally
sudo npm install -g pm2

# Install build tools (for native modules)
sudo apt install -y build-essential python3
```

### Step 3: Deploy Code

```bash
# Clone your repo
cd /opt
sudo git clone https://github.com/YOUR_USERNAME/quant-scanner-standalone.git
sudo chown -R $USER:$USER quant-scanner-standalone
cd quant-scanner-standalone

# Configure environment
cp .env.example .env
nano .env  # Fill in your values

# Install and build backend
cd backend
npm install --production
npm run build
cd ..
```

### Step 4: Start with PM2

```bash
cd /opt/quant-scanner-standalone/backend
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # Follow the printed command to enable auto-start
```

### Step 5: Set Up Firewall

```bash
# Allow SSH and API port
sudo ufw allow 22
sudo ufw allow 3001
sudo ufw enable
```

### Step 6: Optional — Nginx Reverse Proxy with SSL

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

# Create Nginx config
sudo tee /etc/nginx/sites-available/quant-scanner << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/quant-scanner /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# SSL certificate
sudo certbot --nginx -d your-domain.com
```

---

## Frontend Deployment (Vercel)

### Step 1: Push to GitHub

Ensure the `frontend/` directory is in your repo.

### Step 2: Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click "New Project" and import your repository
3. Set the following:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Add environment variables:
   - `VITE_API_URL` = `https://your-domain.com` (your VPS backend URL)
   - `VITE_API_KEY` = your API key from `.env`
5. Click "Deploy"

### Step 3: Update CORS

In your `.env` on the VPS, set:

```env
FRONTEND_URL=https://your-vercel-app.vercel.app
```

Then restart: `pm2 restart quant-scanner`

---

## Notifications Setup

### Telegram

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts to create a bot
3. Copy the bot token to `TELEGRAM_BOT_TOKEN` in `.env`
4. Message [@userinfobot](https://t.me/userinfobot) to get your chat ID
5. Copy the chat ID to `TELEGRAM_CHAT_ID` in `.env`

You will receive notifications for:
- New positions opened
- Positions closed (with P&L)
- Auto-tune parameter changes
- Health warnings (degraded performance, high error rates)
- Engine restarts

### Discord

1. Go to your Discord server settings, then Integrations, then Webhooks
2. Create a new webhook and copy the URL
3. Set `DISCORD_WEBHOOK_URL` in `.env`

---

## API Reference

All endpoints are prefixed with `/api`. Protected endpoints require the `X-API-KEY` header (if `API_KEY` is set in `.env`).

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | No | System health status and uptime |
| GET | `/api/coins` | Yes | Ranked coins from latest scan |
| GET | `/api/positions` | Yes | Open paper positions |
| GET | `/api/history` | Yes | Closed trade history |
| GET | `/api/engine` | Yes | Engine state and dynamic params |
| POST | `/api/engine/start` | Yes | Start the scanning engine |
| POST | `/api/engine/stop` | Yes | Stop the scanning engine |
| GET | `/api/health/metrics` | Yes | Detailed health metrics and cycle history |
| GET | `/api/scans` | Yes | Recent scan logs |
| GET | `/api/params` | Yes | Current auto-tuned parameters |
| GET | `/api/patterns` | Yes | Learning system patterns |

### Example Requests

```bash
# Health check (no auth required)
curl http://localhost:3001/api/health

# Get open positions (with API key)
curl -H "X-API-KEY: your_key_here" http://localhost:3001/api/positions

# Start engine
curl -X POST -H "X-API-KEY: your_key_here" http://localhost:3001/api/engine/start

# Get ranked coins
curl -H "X-API-KEY: your_key_here" http://localhost:3001/api/coins?limit=10
```

---

## PM2 Commands Reference

```bash
# Start the scanner
pm2 start ecosystem.config.cjs

# View status
pm2 status

# View logs (live)
pm2 logs quant-scanner

# View logs (last 100 lines)
pm2 logs quant-scanner --lines 100

# Restart
pm2 restart quant-scanner

# Stop
pm2 stop quant-scanner

# Monitor (CPU/memory dashboard)
pm2 monit

# Save current process list (survives reboot)
pm2 save

# Set up auto-start on boot
pm2 startup
```

---

## Execution Layer (Future)

The `backend/src/execution/` directory contains prepared interfaces for live trading. When you are ready:

1. **Solana (Jupiter)**: Install `@solana/web3.js` and `@jup-ag/api`, implement `SolanaExecutor`
2. **EVM (1inch/Uniswap)**: Install `ethers`, implement `EVMExecutor`
3. Wire into `paperEngine.ts` by replacing paper position creation with actual swap calls

The interfaces define: `IWalletProvider` (balance, signing), `ITradeExecutor` (buy, sell, quote), and `IPositionSizer` (risk-based sizing). Start with very small amounts and monitor closely.

---

## Resource Usage

Designed for minimal infrastructure:

| Resource | Usage |
|---|---|
| CPU | <5% average (spikes during scan cycles) |
| RAM | ~80-150MB |
| Disk | <100MB (SQLite DB grows slowly) |
| Network | ~2-5MB/hour (DexScreener API calls) |
| Cost | $4-10/month VPS |

---

## Troubleshooting

**Engine not starting?**
```bash
pm2 logs quant-scanner --lines 50  # Check for errors
```

**Database locked?**
```bash
# SQLite WAL mode handles concurrency, but if issues persist:
pm2 restart quant-scanner
```

**API returning 401?**
```bash
# Check your API key matches
curl -H "X-API-KEY: $(grep API_KEY .env | cut -d= -f2)" http://localhost:3001/api/health
```

**High memory usage?**
```bash
# PM2 auto-restarts at 512MB (configurable in ecosystem.config.cjs)
pm2 restart quant-scanner
```

---

## License

Private — not for redistribution.
