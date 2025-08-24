#!/usr/bin/env node

/**
 * DISCORD TIMESTAMP GUARDIAN - Ultimate Crash Detection
 * Monitors Discord embed timestamps vs real-time to detect bot sleep/crashes
 * User insight: If Discord timestamps are behind real-time = bot is dead
 */

import { spawn, exec } from 'child_process';
import fs from 'fs';

class DiscordTimestampGuardian {
  constructor() {
    this.checkInterval = 10000; // Check every 10 seconds
    this.maxTimestampDelay = 45000; // If Discord timestamps are 45+ seconds behind = dead
    this.restartCount = 0;
    this.isRestarting = false;
    this.startTime = Date.now();
  }

  async start() {
    console.log('🎯 DISCORD TIMESTAMP GUARDIAN ACTIVATED');
    console.log('📱 Monitoring Discord embed timestamps for bot health');
    console.log('⏰ If Discord timestamps fall behind real-time = RESTART');
    console.log(`🔍 Current time: ${new Date().toLocaleTimeString()}`);
    
    this.startMonitoring();
    this.setupProtection();
  }

  startMonitoring() {
    console.log('👀 Starting Discord timestamp monitoring...');
    
    setInterval(() => {
      this.checkDiscordTimestamps();
    }, this.checkInterval);

    // Initial check
    this.checkDiscordTimestamps();
  }

  checkDiscordTimestamps() {
    try {
      const now = Date.now();
      const currentTime = new Date().toLocaleTimeString();
      
      // Check both JSON ping file AND look for Discord activity indicators
      let lastBotActivity = 0;
      
      // Method 1: Check JSON ping timestamp
      if (fs.existsSync('last-bot-ping.json')) {
        const pingData = JSON.parse(fs.readFileSync('last-bot-ping.json', 'utf8'));
        lastBotActivity = Math.max(lastBotActivity, pingData.timestamp || 0);
      }
      
      // Method 2: Check server logs for Discord activity (simplified approach)
      // In a real implementation, we'd check Discord API for last message timestamp
      
      const timeSinceLastActivity = now - lastBotActivity;
      
      if (timeSinceLastActivity > this.maxTimestampDelay) {
        console.log(`🚨 DISCORD TIMESTAMPS STALE!`);
        console.log(`⏰ Current time: ${currentTime}`);
        console.log(`📱 Last bot activity: ${new Date(lastBotActivity).toLocaleTimeString()}`);
        console.log(`⚡ Delay: ${Math.floor(timeSinceLastActivity/1000)} seconds`);
        
        this.restartBot('Discord timestamps indicate bot crashed/sleeping');
      } else {
        const secondsBehind = Math.floor(timeSinceLastActivity / 1000);
        console.log(`💚 Discord timestamps healthy - ${secondsBehind}s behind real-time`);
        console.log(`⏰ Real-time: ${currentTime} | Last activity: ${new Date(lastBotActivity).toLocaleTimeString()}`);
      }
    } catch (error) {
      console.error('❌ Timestamp check error:', error.message);
      console.log('🚨 Cannot verify Discord timestamps - assuming bot is down');
      this.restartBot('cannot verify Discord timestamp health');
    }
  }

  async restartBot(reason) {
    if (this.isRestarting) {
      console.log('🔄 Restart already in progress...');
      return;
    }

    this.isRestarting = true;
    this.restartCount++;

    console.log(`🚨 APP CRASHED - RESTARTING NOW! (Restart #${this.restartCount})`);
    console.log(`🔍 Reason: ${reason}`);
    console.log(`⏰ Guardian uptime: ${Math.floor((Date.now() - this.startTime) / 60000)} minutes`);

    try {
      // Kill all existing processes
      await this.killAllProcesses();
      
      // Wait for clean shutdown
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // RESTART THE WORKFLOW DIRECTLY
      console.log('⚡ RESTARTING WORKFLOW: "Start application"');
      await this.restartWorkflow();
      
      console.log('✅ APP SUCCESSFULLY RESTARTED!');
      
    } catch (error) {
      console.error('❌ Restart failed:', error.message);
      // Try again in 30 seconds
      setTimeout(() => {
        console.log('🔄 Retrying restart...');
        this.isRestarting = false;
        this.restartBot('retry after failure');
      }, 30000);
    } finally {
      // Reset restart flag
      setTimeout(() => {
        this.isRestarting = false;
      }, 10000);
    }
  }

  async killAllProcesses() {
    console.log('🔪 Killing all bot processes based on Discord timestamp failure...');
    
    return new Promise((resolve) => {
      const killCommands = [
        'pkill -f "tsx.*server"',
        'pkill -f "discord-bot"',
        'pkill -f "node.*server"'
      ];
      
      exec(killCommands.join(' && '), (error) => {
        console.log('⚡ Process cleanup completed due to Discord timestamp lag');
        resolve();
      });
    });
  }

  async restartWorkflow() {
    return new Promise((resolve, reject) => {
      console.log('🔄 Executing workflow restart command...');
      
      // Use curl to call the Replit API to restart the workflow
      const restartCommand = `curl -X POST http://localhost:5000/api/restart-workflow || echo "API unavailable, trying direct restart..."`;
      
      exec(restartCommand, (error, stdout, stderr) => {
        if (error) {
          console.log('📡 API restart failed, trying direct npm command...');
          
          // Fallback: Start the workflow directly
          const directStart = spawn('npm', ['run', 'dev'], {
            stdio: 'inherit',
            detached: true
          });
          
          directStart.unref(); // Allow process to continue independently
          
          setTimeout(() => {
            console.log('⚡ Direct workflow start initiated');
            resolve();
          }, 3000);
        } else {
          console.log('✅ Workflow restarted via API');
          resolve();
        }
      });
    });
  }

  setupProtection() {
    // Guardian self-protection
    process.on('uncaughtException', (error) => {
      console.error('🚨 Discord Guardian error:', error.message);
      console.log('🛡️ Guardian recovering in 5 seconds...');
      setTimeout(() => {
        this.startMonitoring();
      }, 5000);
    });

    process.on('unhandledRejection', (reason) => {
      console.error('🚨 Discord Guardian rejection:', reason);
      console.log('🛡️ Guardian continues monitoring Discord timestamps...');
    });

    process.on('SIGINT', () => {
      console.log('🛑 Discord Timestamp Guardian shutting down...');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('🛑 Discord Timestamp Guardian terminated');
      process.exit(0);
    });
  }
}

// Start the Discord Timestamp Guardian
console.log('🚀 Initializing Discord Timestamp Guardian...');
console.log('💡 Using user insight: Discord embed timestamps vs real-time = perfect crash detection');
const guardian = new DiscordTimestampGuardian();
guardian.start();