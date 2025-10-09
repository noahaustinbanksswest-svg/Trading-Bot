import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { spawn, type ChildProcess } from "child_process";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    try {
      await setupVite(app, server);
    } catch (error) {
      log('Vite disabled due to setup error; using routes only');
    }
  } else {
    try {
      serveStatic(app);
    } catch (error) {
      log('Static serving disabled due to vite error; using inline dashboard');
    }
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`🌐 Enhanced web server running on port ${port}`);
    log(`🔗 Keep-alive endpoints available: /api/health, /api/ping`);
    log(`📊 Bot management endpoints: /api/bot/status, /api/bot/ping`);
    
    // Start Discord bot
    let botProcess: ChildProcess | null = null;
    let restartCount = 0;
    const MAX_RESTARTS = 25;
    
    function startBot() {
      if (botProcess) {
        botProcess.kill('SIGTERM');
        botProcess = null;
      }
      
      log('🤖 Starting Discord bot...');
      botProcess = spawn('node', ['discord-bot.js'], {
        stdio: 'inherit',
        cwd: process.cwd()
      });
      
      botProcess.on('error', (error) => {
        console.error('Discord bot error:', error);
        scheduleRestart();
      });
      
      botProcess.on('exit', (code, signal) => {
        console.log(`Discord bot exited with code ${code}, signal ${signal}`);
        botProcess = null;
        scheduleRestart();
      });
    }
    
    function scheduleRestart() {
      if (restartCount >= MAX_RESTARTS) {
        console.error(`🛑 Max restarts (${MAX_RESTARTS}) reached. Stopping bot auto-restart.`);
        return;
      }
      
      restartCount++;
      const delay = Math.min(10000 + (restartCount * 5000), 120000);
      
      setTimeout(() => {
        log(`🚀 Restarting Discord bot (attempt ${restartCount}/${MAX_RESTARTS})...`);
        startBot();
      }, delay);
    }
    
    // Start the bot
    startBot();
    
    // Add Replit-specific keep-alive mechanism for 24/7 uptime
    if (process.env.REPLIT_DOMAINS) {
      log('🔄 Setting up Replit keep-alive system...');
      
      // Self-ping every 10 seconds to keep web server awake on reserved VM
      setInterval(async () => {
        try {
          const domain = process.env.REPLIT_DOMAINS.split(',')[0];
          const response = await fetch(`https://${domain}/api/health`);
          if (response.ok) {
            log('💚 Web server keep-alive ping successful');
          }
        } catch (error: any) {
          log('❌ Web server ping failed:', error?.message || 'Unknown error');
        }
      }, 10 * 1000); // Every 10 seconds
    }

  });
})();
