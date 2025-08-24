#!/usr/bin/env node

/**
 * TIMESTAMP GUARDIAN - Infinite Uptime System
 * Monitors bot ping timestamps and restarts when they stop updating
 * Uses Reserved VM principle - this process stays alive to monitor others
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');

class TimestampGuardian {
  constructor() {
    this.timestampFile = 'last-bot-ping.json';
    this.checkInterval = 10000; // Check every 10 seconds
    this.maxSilence = 30000; // If no ping for 30 seconds, restart
    this.restartCount = 0;
    this.isRestarting = false;
    this.startTime = Date.now();
  }

  async start() {
    console.log('🕐 TIMESTAMP GUARDIAN ACTIVATED');
    console.log('🎯 Mission: Infinite uptime via timestamp monitoring');
    console.log('⏰ Detects bot sleep via timestamp analysis');
    
    // Create initial timestamp if it doesn't exist
    this.updateLastSeen();
    
    // Start timestamp monitoring
    this.startTimestampMonitoring();
    
    // Setup process protection
    this.setupProtection();
  }

  startTimestampMonitoring() {
    console.log('🔍 Starting timestamp-based monitoring...');
    
    setInterval(() => {
      this.checkBotTimestamp();
    }, this.checkInterval);

    // Initial check
    this.checkBotTimestamp();
  }

  checkBotTimestamp() {
    try {
      // Read current timestamp from bot ping file
      const lastPing = this.readLastPing();
      const now = Date.now();
      const silenceDuration = now - lastPing;
      
      if (silenceDuration > this.maxSilence) {
        console.log(`🚨 BOT SILENT for ${Math.floor(silenceDuration/1000)}s - TIMESTAMP INDICATES CRASH`);
        console.log(`⏰ Last ping: ${new Date(lastPing).toLocaleTimeString()}`);
        console.log(`⏰ Current time: ${new Date(now).toLocaleTimeString()}`);
        
        this.restartBot('timestamp indicates bot crashed/sleeping');
      } else {
        const secondsAgo = Math.floor(silenceDuration / 1000);
        console.log(`💚 Bot alive - last ping ${secondsAgo}s ago`);
      }
    } catch (error) {
      console.error('❌ Timestamp check error:', error.message);
      console.log('🚨 Cannot read timestamp - assuming bot is down');
      this.restartBot('cannot read bot timestamp');
    }
  }

  readLastPing() {
    try {
      if (fs.existsSync(this.timestampFile)) {
        const data = JSON.parse(fs.readFileSync(this.timestampFile, 'utf8'));
        return data.timestamp || 0;
      } else {
        // File doesn't exist - bot definitely not running
        return 0;
      }
    } catch (error) {
      // Error reading file - assume bot is down
      return 0;
    }
  }

  updateLastSeen() {
    try {
      const timestamp = {
        timestamp: Date.now(),
        guardianStart: this.startTime,
        restartCount: this.restartCount
      };
      fs.writeFileSync(this.timestampFile, JSON.stringify(timestamp, null, 2));
    } catch (error) {
      console.error('❌ Could not update timestamp:', error.message);
    }
  }

  async restartBot(reason) {
    if (this.isRestarting) {
      console.log('🔄 Restart already in progress...');
      return;
    }

    this.isRestarting = true;
    this.restartCount++;

    console.log(`⚡ INSTANT BOT RESTART #${this.restartCount}`);
    console.log(`🔍 Reason: ${reason}`);
    console.log(`⏰ Guardian uptime: ${Math.floor((Date.now() - this.startTime) / 60000)} minutes`);

    try {
      // Kill all existing processes
      await this.killAllProcesses();
      
      // Short delay to ensure clean shutdown
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Spawn new server process
      this.spawnNewServer();
      
      console.log('✅ Bot restart sequence completed');
      
    } catch (error) {
      console.error('❌ Restart failed:', error.message);
    } finally {
      // Reset restart flag after delay
      setTimeout(() => {
        this.isRestarting = false;
      }, 10000);
    }
  }

  async killAllProcesses() {
    console.log('🔪 Killing all bot processes...');
    
    return new Promise((resolve) => {
      // Kill everything related to the bot
      const killCommands = [
        'pkill -f "tsx.*server"',
        'pkill -f "npm.*dev"', 
        'pkill -f "discord-bot"',
        'pkill -f "node.*server"'
      ];
      
      exec(killCommands.join(' && '), (error) => {
        console.log('⚡ Process cleanup completed');
        resolve();
      });
    });
  }

  spawnNewServer() {
    console.log('🚀 Spawning fresh server process...');
    
    const newServer = spawn('npm', ['run', 'dev'], {
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: false,
      cwd: process.cwd(),
      env: { ...process.env, GUARDIAN_RESTART: this.restartCount.toString() }
    });

    newServer.on('error', (error) => {
      console.error('💥 New server spawn error:', error.message);
      // Try again in 15 seconds
      setTimeout(() => {
        if (!this.isRestarting) {
          this.restartBot('new server spawn failed');
        }
      }, 15000);
    });

    newServer.on('exit', (code) => {
      console.log(`💀 Server exited with code ${code}`);
      // Restart immediately if it crashes
      setTimeout(() => {
        if (!this.isRestarting) {
          this.restartBot('server process exited');
        }
      }, 5000);
    });

    console.log(`🎯 New server PID: ${newServer.pid}`);
  }

  setupProtection() {
    // Guardian must never die - it's the last line of defense
    process.on('uncaughtException', (error) => {
      console.error('🚨 Guardian error:', error.message);
      console.log('🛡️ Guardian recovering in 5 seconds...');
      setTimeout(() => {
        this.startTimestampMonitoring();
      }, 5000);
    });

    process.on('unhandledRejection', (reason) => {
      console.error('🚨 Guardian rejection:', reason);
      console.log('🛡️ Guardian continues monitoring...');
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('🛑 Timestamp Guardian shutting down...');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('🛑 Timestamp Guardian terminated');
      process.exit(0);
    });
  }
}

// Start the Timestamp Guardian
console.log('🚀 Initializing Timestamp Guardian...');
const guardian = new TimestampGuardian();
guardian.start();