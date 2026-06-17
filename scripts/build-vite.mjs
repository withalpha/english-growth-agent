import { build } from "vite";
import react from "@vitejs/plugin-react";

await build({
  configFile: false,
  base: "./",
  plugins: [react()],
});
