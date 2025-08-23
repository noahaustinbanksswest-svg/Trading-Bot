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
    log(`🌐 Enhanced web server running on port ${port}`);
    log(`🔗 Keep-alive endpoints available: /api/health, /api/ping`);
    log(`📊 Bot management endpoints: /api/bot/status, /api/bot/ping`);
    
    // Enhanced bot management with crash detection
    let botProcess: ChildProcess | null = null;
    let restartCount = 0;
    let lastPingTime = Date.now();
    const MAX_RESTARTS = 25; // Increased restart attempts
    const PING_TIMEOUT = 300000; // 5 minutes without ping = restart (much more reasonable)
    
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
    
    function scheduleRestart(reason = 'unknown') {
      if (restartCount >= MAX_RESTARTS) {
        console.error(`🛑 Max restarts (${MAX_RESTARTS}) reached. Stopping bot auto-restart.`);
        return;
      }
      
      // CRITICAL: Kill all existing processes first to prevent multiples
      if (botProcess) {
        log(`🔪 Force killing existing bot process before restart`);
        botProcess.kill('SIGKILL');
        botProcess = null;
      }
      
      restartCount++;
      const delay = Math.min(10000 + (restartCount * 5000), 120000); // Much longer delays to prevent rapid spawning
      
      log(`🔄 Scheduling bot restart (reason: ${reason}, attempt ${restartCount}/${MAX_RESTARTS}) in ${delay}ms...`);
      
      setTimeout(() => {
        // Double-check no process exists before starting
        if (botProcess) {
          log(`⚠️ Bot process still exists, killing again...`);
          botProcess.kill('SIGKILL');
          botProcess = null;
        }
        
        log(`🚀 Restarting Discord bot (attempt ${restartCount}/${MAX_RESTARTS})...`);
        startBot();
      }, delay);
    }
    
    // Start the bot
    startBot();
    
    // Enhanced monitoring and restart system
    setInterval(() => {
      const timeSinceLastPing = Date.now() - lastPingTime;
      
      // Only restart if bot is truly unresponsive (much longer timeout)
      if (timeSinceLastPing > PING_TIMEOUT && botProcess) {
        log(`⚠️ Bot appears unresponsive (${Math.floor(timeSinceLastPing/1000)}s since last ping)`);
        
        // Try gentle restart first
        if (botProcess) {
          log(`🔄 Attempting graceful bot restart...`);
          botProcess.kill('SIGTERM'); // Gentle shutdown first
          setTimeout(() => {
            if (botProcess) {
              botProcess.kill('SIGKILL'); // Force kill only if needed
              botProcess = null;
            }
            scheduleRestart('ping timeout');
          }, 3000);
        }
      }
    }, 120000); // Check every 2 minutes instead of 30 seconds
    
    // Reset restart counter every 30 minutes (more frequent reset for stability)
    setInterval(() => {
      if (restartCount > 0) {
        log(`🔄 Resetting restart counter (was ${restartCount})`);
        restartCount = 0;
      }
    }, 1800000); // 30 minutes
    
    // Track ping updates through middleware
    app.use('/api/bot/ping', (req, res, next) => {
      lastPingTime = Date.now();
      next();
    });
    
    // Add Replit-specific keep-alive mechanism for 24/7 uptime
    if (process.env.REPLIT_DOMAINS) {
      log('🔄 Setting up Replit keep-alive system...');
      
      // Self-ping every 5 minutes to prevent Repl from sleeping
      setInterval(async () => {
        try {
          const domain = process.env.REPLIT_DOMAINS.split(',')[0];
          const response = await fetch(`https://${domain}/api/health`);
          if (response.ok) {
            log('💚 Replit keep-alive ping successful');
          } else {
            log('⚠️ Replit keep-alive ping failed:', response.status);
          }
        } catch (error) {
          log('❌ Replit keep-alive error:', error.message);
        }
      }, 5 * 60 * 1000); // Every 5 minutes
      
      // System monitor for continuous operation
      setInterval(() => {
        const memUsage = process.memoryUsage();
        log(`🔋 System alive - Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
      }, 10 * 60 * 1000); // Every 10 minutes
    }
    
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
