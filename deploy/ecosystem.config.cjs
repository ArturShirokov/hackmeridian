// PM2 app for https://doc2dpp.wisecraft.dev. Secrets come from /etc/doc2dpp/env via deploy/start.sh.
module.exports = {
  apps: [
    {
      name: "doc2dpp",
      cwd: "/opt/doc2dpp/app",
      script: "deploy/start.sh",
      interpreter: "bash",
      env: {
        HOST: "127.0.0.1",
        PORT: "3400",
        BASE_URL: "https://doc2dpp.wisecraft.dev",
        LEDGER: "trustless-work",
        STORAGE: "icp",
        CHALLENGE_WINDOW_MIN: "30",
      },
      max_memory_restart: "600M",
    },
  ],
};
