#!/usr/bin/env node

/**
 * ULTIMATE UPTIME GUARDIAN
 * Multi-layered protection against bot sleep/crashes
 * User observation: Discord embeds stop updating = bot went to sleep
 */

import { spawn, exec } from 'child_process';
import fs from 'fs';

class UltimateUptimeGuardian {
  constructor() {
    this.embedCheckInterval = 1000; // Check embed updates every 1 second
    this.aggressiveRestartInterval = 20 * 60 * 1000; // Restart every 20 minutes (more aggressive)
    this.healthCheckInterval = 2 * 60 * 1000; // Health check every 2 minutes
    this.lastEmbedUpdate = Date.now();
    this.restartCount = 0;
    this.isRestarting = false;
    this.startTime = Date.now();
  }

  async start() {
    console.log('🛡️ ULTIMATE UPTIME GUARDIAN ACTIVATED');
    console.log('🎯 MISSION: Prevent Discord embed from ever stopping updates');
    console.log('👀 User insight: When Discord embed stops updating = bot went to sleep');
    console.log(`🚀 Guardian started at: ${new Date().toLocaleTimeString()}`);
    
    this.startEmbedMonitoring();
    this.startAggressiveRestarts();
    this.startHealthMonitoring();
    this.startMultiLayerProtection();
    this.setupProtection();
  }

  startEmbedMonitoring() {
    console.log('👁️ Starting Discord embed update monitoring EVERY SECOND...');
    
    setInterval(() => {
      this.checkEmbedFreshness();
    }, this.embedCheckInterval);
  }

  checkEmbedFreshness() {
    try {
      // Check if bot ping file is being updated (indicates bot activity)
      if (fs.existsSync('last-bot-ping.json')) {
        const pingData = JSON.parse(fs.readFileSync('last-bot-ping.json', 'utf8'));
        const timeSinceLastPing = Date.now() - (pingData.timestamp || 0);
        
        if (timeSinceLastPing > 5000) { // 5 seconds without ping = bot sleeping
          console.log(`🚨 EMBED UPDATE STOPPED - Last bot ping ${Math.floor(timeSinceLastPing/1000)}s ago`);
          console.log('💤 BOT WENT TO SLEEP - EMERGENCY RESTART!');
          this.emergencyRestart('bot stopped pinging - embed updates ceased');
          return;
        }
        
        // Update our tracking
        this.lastEmbedUpdate = pingData.timestamp;
        console.log(`✅ Discord embed healthy - Last update ${Math.floor(timeSinceLastPing/1000)}s ago`);
      } else {
        console.log('⚠️ No bot ping file - potential sleep state detected');
        this.emergencyRestart('no bot ping file found - possible sleep');
      }
      
    } catch (error) {
      console.error('❌ Embed monitoring error:', error.message);
      this.emergencyRestart('embed monitoring system failure');
    }
  }

  startAggressiveRestarts() {
    console.log('⚡ Setting up aggressive preventive restarts every 20 minutes...');
    
    setInterval(() => {
      const minutesRunning = Math.floor((Date.now() - this.startTime) / 60000);
      console.log(`⚡ AGGRESSIVE PREVENTIVE RESTART - Running for ${minutesRunning} minutes`);
      console.log('🎯 Restarting BEFORE sleep can occur');
      this.emergencyRestart('aggressive 20-minute preventive restart');
    }, this.aggressiveRestartInterval);

    console.log('⏳ Next aggressive restart in 20 minutes');
  }

  startHealthMonitoring() {
    console.log('💚 Starting intensive health monitoring every 2 minutes...');
    
    setInterval(() => {
      this.performHealthCheck();
    }, this.healthCheckInterval);
  }

  performHealthCheck() {
    try {
      const currentTime = new Date().toLocaleTimeString();
      console.log(`💚 Intensive health check at ${currentTime}`);
      
      let alertCount = 0;
      const alerts = [];
      
      // Check 1: Bot ping freshness (critical)
      if (fs.existsSync('last-bot-ping.json')) {
        const pingData = JSON.parse(fs.readFileSync('last-bot-ping.json', 'utf8'));
        const timeSinceLastPing = Date.now() - (pingData.timestamp || 0);
        
        if (timeSinceLastPing > 45000) { // 45 seconds = early warning
          alertCount++;
          alerts.push(`Bot ping ${Math.floor(timeSinceLastPing/1000)}s old (DANGER ZONE)`);
        }
      } else {
        alertCount += 2;
        alerts.push('No bot ping file (CRITICAL)');
      }

      // Check 2: Runtime duration (prevent long runs)
      const minutesRunning = Math.floor((Date.now() - this.startTime) / 60000);
      if (minutesRunning > 15) { // Earlier intervention
        alertCount++;
        alerts.push(`Running ${minutesRunning} minutes (approaching sleep risk)`);
      }

      // Check 3: Memory/resource indicators
      if (minutesRunning > 18) { // Very aggressive prevention
        alertCount++;
        alerts.push(`${minutesRunning} minutes runtime - PREVENTIVE RESTART NEEDED`);
      }

      if (alertCount > 0) {
        console.log(`🚨 HEALTH ALERTS: ${alertCount} issues detected`);
        alerts.forEach(alert => console.log(`   ⚠️ ${alert}`));
        
        if (alertCount >= 2) {
          console.log('🛑 MULTIPLE ALERTS - TRIGGERING PREVENTIVE RESTART');
          this.emergencyRestart(`${alertCount} health alerts: ${alerts.join(', ')}`);
        }
      } else {
        console.log(`✅ Health perfect - Runtime: ${minutesRunning}m, Bot active`);
      }
      
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
      this.emergencyRestart('health monitoring system failure');
    }
  }

  startMultiLayerProtection() {
    console.log('🔒 Starting multi-layer protection systems...');
    
    // Layer 1: Heartbeat monitoring
    this.startHeartbeatMonitoring();
    
    // Layer 2: Process watching
    this.startProcessWatching();
    
    // Layer 3: File system monitoring
    this.startFileSystemMonitoring();
  }

  startHeartbeatMonitoring() {
    setInterval(() => {
      const heartbeatFile = 'heartbeat.json';
      const currentTime = Date.now();
      
      try {
        fs.writeFileSync(heartbeatFile, JSON.stringify({
          timestamp: currentTime,
          guardian: 'active',
          uptime: Math.floor((currentTime - this.startTime) / 1000)
        }));
      } catch (error) {
        console.error('💔 Heartbeat write failed:', error.message);
        this.emergencyRestart('heartbeat system failure');
      }
    }, 10000); // Every 10 seconds
  }

  startProcessWatching() {
    setInterval(() => {
      exec('ps aux | grep -E "(tsx|node.*server|discord-bot)" | grep -v grep', (error, stdout) => {
        if (error || !stdout.trim()) {
          console.log('🚨 CRITICAL: No app processes detected!');
          this.emergencyRestart('no application processes found');
        }
      });
    }, 30000); // Every 30 seconds
  }

  startFileSystemMonitoring() {
    setInterval(() => {
      const requiredFiles = ['last-bot-ping.json', 'trigger.json', 'dashboard.json'];
      let missingFiles = 0;
      
      requiredFiles.forEach(file => {
        if (!fs.existsSync(file)) {
          missingFiles++;
          console.log(`⚠️ Missing critical file: ${file}`);
        }
      });
      
      if (missingFiles > 1) {
        console.log(`🚨 ${missingFiles} critical files missing - system corruption detected`);
        this.emergencyRestart(`${missingFiles} critical files missing`);
      }
    }, 45000); // Every 45 seconds
  }

  async emergencyRestart(reason) {
    if (this.isRestarting) {
      console.log('🔄 Emergency restart already in progress...');
      return;
    }

    this.isRestarting = true;
    this.restartCount++;

    console.log('🚨🚨🚨 EMERGENCY RESTART TRIGGERED 🚨🚨🚨');
    console.log(`⚡ RESTART #${this.restartCount}`);
    console.log(`🔍 Reason: ${reason}`);
    console.log(`⏰ Uptime: ${Math.floor((Date.now() - this.startTime) / 60000)} minutes`);
    console.log('🎯 PREVENTING DISCORD EMBED FROM STOPPING');

    try {
      // Step 1: Kill everything immediately
      console.log('🔪 KILLING ALL PROCESSES IMMEDIATELY');
      await this.killAllProcesses();
      
      // Step 2: Short wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Step 3: Restart workflow via Replit
      console.log('🚀 EMERGENCY WORKFLOW RESTART');
      await this.restartWorkflow();
      
      // Step 4: Reset tracking
      this.startTime = Date.now();
      this.lastEmbedUpdate = Date.now();
      
      console.log('✅ EMERGENCY RESTART COMPLETED - Discord embed should resume updating!');
      
    } catch (error) {
      console.error('❌ Emergency restart failed:', error.message);
      // Retry in 15 seconds
      setTimeout(() => {
        console.log('🔄 RETRYING EMERGENCY RESTART...');
        this.isRestarting = false;
        this.emergencyRestart('retry after emergency restart failure');
      }, 15000);
    } finally {
      setTimeout(() => {
        this.isRestarting = false;
      }, 10000);
    }
  }

  async killAllProcesses() {
    return new Promise((resolve) => {
      const killCommands = [
        'pkill -f "tsx.*server"',
        'pkill -f "discord-bot"', 
        'pkill -f "node.*server"',
        'pkill -f "npm.*dev"'
      ];
      
      exec(killCommands.join(' ; '), (error) => {
        console.log('✅ Process termination completed');
        resolve();
      });
    });
  }

  async restartWorkflow() {
    return new Promise((resolve) => {
      console.log('🔄 Executing emergency workflow restart...');
      
      // Direct npm start
      const restart = spawn('npm', ['run', 'dev'], {
        stdio: 'inherit',
        detached: true
      });
      
      restart.unref();
      
      setTimeout(() => {
        console.log('⚡ Emergency workflow restart initiated');
        resolve();
      }, 3000);
    });
  }

  setupProtection() {
    process.on('uncaughtException', (error) => {
      console.error('🚨 Guardian uncaught exception:', error.message);
      console.log('🛡️ Guardian self-recovery in 3 seconds...');
      setTimeout(() => {
        this.start();
      }, 3000);
    });

    process.on('unhandledRejection', (reason) => {
      console.error('🚨 Guardian unhandled rejection:', reason);
      console.log('🛡️ Guardian continues protecting...');
    });

    process.on('SIGTERM', () => {
      console.log('🛑 Ultimate Uptime Guardian terminated');
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log('🛑 Ultimate Uptime Guardian shutting down...');
      process.exit(0);
    });
  }
}

// Start the Ultimate Uptime Guardian
console.log('🚀 Initializing Ultimate Uptime Guardian...');
console.log('🎯 Mission: Keep Discord embed updating FOREVER');
console.log('💡 Strategy: Multi-layered aggressive prevention');
const guardian = new UltimateUptimeGuardian();
guardian.start();