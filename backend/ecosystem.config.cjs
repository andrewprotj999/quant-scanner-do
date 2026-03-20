/**
 * PM2 Ecosystem Configuration
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 stop quant-scanner
 *   pm2 restart quant-scanner
 *   pm2 logs quant-scanner
 *   pm2 monit
 *
 * Auto-start on reboot:
 *   pm2 startup
 *   pm2 save
 */

module.exports = {
  apps: [
    {
      name: "quant-scanner",
      script: "dist/server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 5000,

      // Environment
      env: {
        NODE_ENV: "production",
      },

      // Logging
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/error.log",
      out_file: "./logs/output.log",
      merge_logs: true,
      log_file: "./logs/combined.log",

      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,

      // Health monitoring
      exp_backoff_restart_delay: 100,
    },
  ],
};
