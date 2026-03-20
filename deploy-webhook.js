const http = require('http');
const { execSync } = require('child_process');
const crypto = require('crypto');

const PORT = 9000;
const SECRET = process.env.WEBHOOK_SECRET || 'qs-auto-deploy-2026';
const REPO_DIR = '/opt/quant-scanner';

function verifySignature(payload, signature) {
  if (!signature) return false;
  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(payload);
  const digest = 'sha256=' + hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

function deploy() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Starting deployment...`);
  
  try {
    // Pull latest code
    console.log('Pulling latest code...');
    execSync('git pull origin main', { cwd: REPO_DIR, stdio: 'pipe' });
    
    // Build backend
    console.log('Building backend...');
    execSync('cd backend && npm run build', { cwd: REPO_DIR, stdio: 'pipe', timeout: 120000 });
    
    // Build frontend
    console.log('Building frontend...');
    execSync('cd frontend && npm run build', { cwd: REPO_DIR, stdio: 'pipe', timeout: 120000 });
    
    // Restart the app
    console.log('Restarting app...');
    execSync('pm2 restart quant-scanner', { stdio: 'pipe' });
    
    console.log(`[${timestamp}] Deployment successful!`);
    return { success: true, message: 'Deployed successfully' };
  } catch (err) {
    console.error(`[${timestamp}] Deployment failed:`, err.message);
    if (err.stdout) console.error('stdout:', err.stdout.toString());
    if (err.stderr) console.error('stderr:', err.stderr.toString());
    return { success: false, message: err.message };
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const signature = req.headers['x-hub-signature-256'];
      
      if (!verifySignature(body, signature)) {
        console.log('Invalid webhook signature — rejecting');
        res.writeHead(401);
        res.end('Unauthorized');
        return;
      }
      
      try {
        const payload = JSON.parse(body);
        if (payload.ref === 'refs/heads/main') {
          console.log(`Push to main by ${payload.pusher?.name || 'unknown'}`);
          res.writeHead(200);
          res.end('Deploying...');
          // Deploy async so we don't block the response
          setTimeout(() => deploy(), 100);
        } else {
          res.writeHead(200);
          res.end('Not main branch — skipping');
        }
      } catch (e) {
        res.writeHead(400);
        res.end('Bad request');
      }
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end('Deploy webhook running');
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Deploy webhook listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
