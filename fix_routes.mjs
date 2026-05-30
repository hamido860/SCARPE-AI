import fs from "fs";

let code = fs.readFileSync("server.ts", "utf8");

const startStr = '  app.post("/api/ai/extract-content", async (req, res) => {';
const endStr = '      if (isZip) {';

const startIndex = code.indexOf(startStr);
const endIndex = code.indexOf(endStr);

if (startIndex !== -1 && endIndex !== -1) {
  let content = fs.readFileSync("fix_routes_content.txt", "utf8");
  code = code.substring(0, startIndex) + content + code.substring(endIndex);
  fs.writeFileSync("server.ts", code);
  console.log("Fixed main chunk!");
} else {
  console.log("Could not find boundaries");
}
