import fs from "fs";
let code = fs.readFileSync("server.ts", "utf8");

// Fix `aiResponse.text`
code = code.replace(/aiResponse\.text/g, "aiResponse.choices[0].message.content");

// Fix extra_body by adding @ts-ignore
code = code.replace(/extra_body/g, "// @ts-ignore\\n        extra_body");

fs.writeFileSync("server.ts", code);
