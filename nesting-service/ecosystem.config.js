const path = require('node:path');

const appRoot = process.env.NESTING_SERVICE_ROOT || '\\\\Mac\\Home\\Desktop\\Tehnolog\\nesting-service';
const appPath = (...parts) => path.win32.join(appRoot, ...parts);

module.exports = {
  apps: [
    {
      name: 'nesting-api',
      cwd: appRoot,
      script: appPath('dist', 'server.js'),
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      max_memory_restart: '512M',
      error_file: appPath('logs', 'api-error.log'),
      out_file: appPath('logs', 'api-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      autorestart: true,
    },
    {
      name: 'step-worker',
      cwd: appRoot,
      script: appPath('dist', 'workers', 'step-worker.js'),
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      restart_delay: 3000,
      error_file: appPath('logs', 'step-worker-error.log'),
      out_file: appPath('logs', 'step-worker-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      autorestart: true,
    },
    {
      name: 'nesting-worker',
      cwd: appRoot,
      script: appPath('dist', 'workers', 'nesting-worker.js'),
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      restart_delay: 3000,
      error_file: appPath('logs', 'nesting-worker-error.log'),
      out_file: appPath('logs', 'nesting-worker-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      autorestart: true,
    },
  ],
};
