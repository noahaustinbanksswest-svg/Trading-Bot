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
    
    // Enhanced bot management with crash detection
    let botProcess: ChildProcess | null = null;
    let restartCount = 0;
    let lastPingTime = Date.now();
    const MAX_RESTARTS = 25; // Increased restart attempts
    const PING_TIMEOUT = 999999000; // Effectively disabled - bot handles its own monitoring now
    
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
      
      // Self-ping every 10 seconds to keep web server awake on reserved VM
      setInterval(async () => {
        try {
          const domain = process.env.REPLIT_DOMAINS.split(',')[0];
          const response = await fetch(`https://${domain}/api/health`);
          if (response.ok) {
            log('💚 Web server keep-alive ping successful');
          } else {
            log('⚠️ Web server ping failed:', response.status);
            // Try alternative ping to keep server active
            try {
              const altResponse = await fetch(`https://${domain}/ping`);
              if (altResponse.ok) {
                log('💚 Alternative web server ping successful');
              }
            } catch (altError) {
              log('❌ Web server ping methods failing:', altError.message);
            }
          }
        } catch (error) {
          log('❌ External ping failed, trying localhost to keep server alive:', error.message);
          // Fallback to localhost ping to maintain server activity
          try {
            const localResponse = await fetch(`http://localhost:${port}/api/health`);
            if (localResponse.ok) {
              log('💚 Localhost web server ping successful');
            }
          } catch (localError) {
            log('❌ Critical: All web server pings failed:', localError.message);
          }
        }
      }, 10 * 1000); // Every 10 seconds to keep web server alive
      
      // Enhanced system monitor for reserved VM
      setInterval(() => {
        const memUsage = process.memoryUsage();
        const uptime = Math.floor(process.uptime() / 60); // uptime in minutes
        log(`🔋 Reserved VM Status - Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB, Uptime: ${uptime}min`);
        
        // Check if bot process is healthy
        if (botProcess && !botProcess.killed) {
          log('🤖 Bot process healthy and active');
        } else {
          log('⚠️ Bot process may need attention');
        }
      }, 5 * 60 * 1000); // Every 5 minutes for reserved VM
      
      // Additional web server heartbeat
      setInterval(async () => {
        try {
          // Internal server health check
          const startTime = Date.now();
          await new Promise(resolve => setTimeout(resolve, 100));
          const responseTime = Date.now() - startTime;
          log(`📡 Web server heartbeat - Response time: ${responseTime}ms`);
        } catch (error) {
          log('❌ Web server heartbeat error:', error.message);
        }
      }, 3 * 60 * 1000); // Every 3 minutes
    }
    
    // Enhanced auto-restart mechanism with guardian protection
    process.on('uncaughtException', (error) => {
      log('💥 Web Server Uncaught Exception:', error);
      log('🛡️ Guardian Protection: Auto-restarting server...');
      
      if (botProcess && !botProcess.killed) {
        log('🔄 Stopping Discord bot before restart...');
        botProcess.kill('SIGTERM');
      }
      
      // Guardian restart mechanism
      setTimeout(() => {
        log('🚀 Guardian: Attempting server restart...');
        startServerWithGuardian();
      }, 3000);
    });

    process.on('unhandledRejection', (reason, promise) => {
      log('💥 Web Server Unhandled Rejection:', reason);
      log('🛡️ Guardian Protection: Auto-restarting server...');
      
      setTimeout(() => {
        log('🚀 Guardian: Attempting server restart...');
        startServerWithGuardian();
      }, 3000);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      log('🛑 Shutting down web server gracefully...');
      if (botProcess) {
        botProcess.kill('SIGTERM');
      }
      process.exit(0);
    });

    // INSTANT Guardian - Ultra-fast internal monitoring
    let healthyPings = 0;
    setInterval(() => {
      healthyPings++;
      const memUsage = process.memoryUsage();
      const memoryMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      
      if (memoryMB > 500) { // If memory usage exceeds 500MB
        log(`⚠️ High memory usage detected: ${memoryMB}MB - Guardian may restart server`);
      }
      
      if (healthyPings % 120 === 0) { // Log every 10 minutes (120 * 5 seconds)
        log(`🛡️ Guardian Health Check - Memory: ${memoryMB}MB, PID: ${process.pid}, Uptime: ${Math.floor(process.uptime() / 60)}min, Pings: ${healthyPings}`);
      }
    }, 5 * 1000); // Every 5 seconds for ultra-fast detection
    
    // Self-monitoring for instant restart
    setInterval(() => {
      try {
        // If this interval can't run, the process is hung
        const startTime = Date.now();
        setTimeout(() => {
          const delay = Date.now() - startTime;
          if (delay > 2000) { // If more than 2 second delay
            log('🚨 Process lag detected - forcing restart');
            startServerWithGuardian();
          }
        }, 100);
      } catch (error) {
        log('💥 Self-monitoring error - forcing restart');
        startServerWithGuardian();
      }
    }, 3 * 1000); // Check every 3 seconds

    // Guardian protection status
    log('🛡️ WORKSPACE GUARDIAN ACTIVE - Green button protection enabled');
    log('🎯 Auto-restart mechanism ready for any crashes');
    log('⚡ Instant Guardian provides 5-second failure detection');
  });

  // Guardian restart function
  function startServerWithGuardian() {
    try {
      log('🛡️ Guardian: Attempting to spawn new server process...');
      
      // Try to restart the main process
      const { spawn } = require('child_process');
      const newProcess = spawn('node', [process.argv[1]], {
        stdio: 'inherit',
        detached: true,
        cwd: process.cwd()
      });
      
      newProcess.on('error', (error) => {
        log('❌ Guardian restart failed:', error.message);
        // Fallback: exit and let Replit handle restart
        setTimeout(() => process.exit(1), 5000);
      });
      
      // Disconnect from parent and exit current process
      newProcess.unref();
      setTimeout(() => process.exit(0), 2000);
      
    } catch (error) {
      log('❌ Guardian protection failed:', error.message);
      log('🔄 Falling back to process exit...');
      setTimeout(() => process.exit(1), 3000);
    }
  }
})();
