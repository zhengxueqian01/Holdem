import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  envDir: path.resolve(__dirname, "../../"),
  server: {
    port: 5173,
    host: true
  }
});
