import { pathToFileURL } from "node:url";
import { buildServer } from "./app.js";

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const app = buildServer();
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ host, port });
}
