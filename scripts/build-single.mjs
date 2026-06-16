import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const indexHtml = readFileSync(join(dist, "index.html"), "utf8");

const scriptMatch = indexHtml.match(/<script[^>]+src="\.\/([^"]+)"[^>]*><\/script>/);
const styleMatch = indexHtml.match(/<link[^>]+href="\.\/([^"]+)"[^>]*>/);

if (!scriptMatch || !styleMatch) {
  throw new Error("没有找到构建后的 JS 或 CSS 文件，请先运行 npm.cmd run build。");
}

const script = readFileSync(join(dist, scriptMatch[1]), "utf8");
const style = readFileSync(join(dist, styleMatch[1]), "utf8");

const singleHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>英语成长 Agent</title>
    <style>
${style}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
${script}
    </script>
  </body>
</html>
`;

writeFileSync(join(root, "英语成长Agent-双击打开.html"), singleHtml, "utf8");
console.log("已生成：英语成长Agent-双击打开.html");
