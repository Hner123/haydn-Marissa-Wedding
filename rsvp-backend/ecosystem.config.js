// PM2 config:  pm2 start ecosystem.config.js
// Change RSVP_ADMIN_KEY to your own secret before starting.
module.exports = {
  apps: [
    {
      name: 'rsvp',
      script: 'server.js',
      cwd: __dirname,
      env: {
        PORT: 3007,
        RSVP_ADMIN_KEY: 'change-me-to-a-secret',
      },
      autorestart: true,
      max_memory_restart: '128M',
    },
  ],
};
