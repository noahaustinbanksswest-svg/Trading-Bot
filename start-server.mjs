import { spawn } from "child_process";

// Use Node.js with experimental loader for TypeScript support
const serverProcess = spawn("node", [
  "--loader", "tsx/esm",
  "--experimental-loader", "tsx/esm", 
  "server/index.ts"
], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "development"
  }
});

serverProcess.on("error", (error) => {
  console.error("Server startup error:", error);
  process.exit(1);
});

serverProcess.on("exit", (code) => {
  console.log(`Server exited with code ${code}`);
  process.exit(code);
});