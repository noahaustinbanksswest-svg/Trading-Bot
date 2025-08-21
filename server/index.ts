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
    await setupVite(app, server);
  } else {
    serveStatic(app);
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
    log(`serving on port ${port}`);
    
    // Bot management with proper process tracking
    let botProcess: ChildProcess | null = null;
    let restartCount = 0;
    const MAX_RESTARTS = 10;
    
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
      const delay = Math.min(5000 * restartCount, 60000); // Exponential backoff, max 1 minute
      
      setTimeout(() => {
        log(`🔄 Restarting Discord bot (attempt ${restartCount}/${MAX_RESTARTS})...`);
        startBot();
      }, delay);
    }
    
    // Start the bot
    startBot();
    
    // Reset restart counter every hour
    setInterval(() => {
      restartCount = 0;
    }, 3600000);
    
    // Graceful shutdown
    process.on('SIGINT', () => {
      log('🛑 Shutting down gracefully...');
      if (botProcess) {
        botProcess.kill('SIGTERM');
      }
      process.exit(0);
    });
  });
})();
