#!/usr/bin/env node

/**
 * INSTANT GUARDIAN - Ultra-fast workspace protection
 * Detects failures in seconds, not minutes
 */

const { spawn, exec } = require('child_process');
const http = require('http');

class InstantGuardian {
  constructor() {
    this.checkInterval = 5000; // Check every 5 seconds (much faster)
    this.healthTimeout = 3000; // 3 second timeout for health checks
    this.restartDelay = 2000; // 2 second restart delay
    this.maxRestarts = 50;
    this.restartCount = 0;
    this.lastHealthy = Date.now();
    this.isRestarting = false;
  }

  async start() {
    console.log('⚡ INSTANT GUARDIAN ACTIVATED');
    console.log('🎯 Mission: Zero-downtime workspace protection');
    console.log('⏱️ Health checks every 5 seconds');
    
    // Start immediate monitoring
    this.startFastMonitoring();
    
    // Setup process monitoring
    this.setupProcessHandlers();
  }

  startFastMonitoring() {
    console.log('🔍 Starting ultra-fast health monitoring...');
    
    setInterval(async () => {
      try {
        const isHealthy = await this.quickHealthCheck();
        
        if (isHealthy) {
          this.lastHealthy = Date.now();
          this.restartCount = 0; // Reset on success
          console.log('💚 System healthy - Guardian standing by');
        } else {
          const downtime = Date.now() - this.lastHealthy;
          console.log(`🚨 SYSTEM DOWN for ${Math.floor(downtime/1000)}s - Triggering instant restart`);
          await this.instantRestart('health check failed');
        }
      } catch (error) {
        console.error('❌ Guardian monitoring error:', error.message);
        await this.instantRestart('monitoring system error');
      }
    }, this.checkInterval);

    // Initial health check
    this.quickHealthCheck();
  }

  async quickHealthCheck() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, this.healthTimeout);

      try {
        const req = http.get('http://localhost:5000/api/health', (res) => {
          clearTimeout(timeout);
          
          if (res.statusCode === 200) {
            resolve(true);
          } else {
            resolve(false);
          }
        });

        req.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });

        req.setTimeout(this.healthTimeout, () => {
          clearTimeout(timeout);
          resolve(false);
        });

      } catch (error) {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  }

  async instantRestart(reason) {
    if (this.isRestarting) {
      console.log('🔄 Restart already in progress, skipping...');
      return;
    }

    if (this.restartCount >= this.maxRestarts) {
      console.error(`🛑 Max restart attempts reached (${this.maxRestarts})`);
      return;
    }

    this.isRestarting = true;
    this.restartCount++;

    console.log(`⚡ INSTANT RESTART #${this.restartCount}`);
    console.log(`🔍 Reason: ${reason}`);

    try {
      // Kill any hanging processes quickly
      await this.fastKill();
      
      // Very short delay
      await new Promise(resolve => setTimeout(resolve, this.restartDelay));
      
      // Start new process immediately
      this.spawnNewProcess();
      
      console.log('✅ Instant restart completed');
      
    } catch (error) {
      console.error('❌ Instant restart failed:', error.message);
    } finally {
      this.isRestarting = false;
    }
  }

  async fastKill() {
    return new Promise((resolve) => {
      // Kill processes aggressively but safely
      exec('pkill -f "tsx.*server" && pkill -f "npm.*dev"', (error) => {
        console.log('⚡ Fast process cleanup completed');
        resolve();
      });
    });
  }

  spawnNewProcess() {
    console.log('🚀 Spawning new server process...');
    
    const newServer = spawn('npm', ['run', 'dev'], {
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: false,
      cwd: process.cwd()
    });

    newServer.on('error', (error) => {
      console.error('💥 New process error:', error.message);
      // Try again in a few seconds
      setTimeout(() => {
        this.instantRestart('new process failed');
      }, 5000);
    });

    newServer.on('exit', (code) => {
      console.log(`💀 Server process exited with code ${code}`);
      // Restart immediately if it crashes
      setTimeout(() => {
        this.instantRestart('server process exit');
      }, 3000);
    });

    console.log(`🎯 New server PID: ${newServer.pid}`);
  }

  setupProcessHandlers() {
    // Handle guardian shutdown
    process.on('SIGINT', () => {
      console.log('🛑 Instant Guardian shutting down...');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('🛑 Instant Guardian terminated');
      process.exit(0);
    });

    // Guardian must never crash
    process.on('uncaughtException', (error) => {
      console.error('🚨 Guardian error:', error.message);
      console.log('🛡️ Guardian recovering in 3 seconds...');
      setTimeout(() => {
        this.startFastMonitoring();
      }, 3000);
    });
  }
}

// Start instant guardian
const guardian = new InstantGuardian();
guardian.start();