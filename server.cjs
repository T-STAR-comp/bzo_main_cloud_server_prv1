"use strict";

const fs = require("node:fs");
const path = require("node:path");

const entry = path.join(__dirname, "dist", "index.js");

if (!fs.existsSync(entry)) {
  console.error("Missing build output. Run `npm run build` before starting the server.");
  process.exit(1);
}

require(entry);
