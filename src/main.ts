import { createServer } from "node:http";
import { publishCreatorImage } from "./property_service.js";
import { InfraiError } from "./infra_client.js";

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/publish") { res.writeHead(404); res.end("Not found"); return; }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const output = await publishCreatorImage(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(output));
  } catch (error) {
    const status = error instanceof InfraiError && error.status >= 400 && error.status < 500 ? error.status : 400;
    res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Request rejected" }));
  }
});

server.listen(Number(process.env.PORT ?? 3000), () => console.log("Property publisher listening on port 3000"));
