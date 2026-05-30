import { execSync } from 'child_process';
import fs from 'fs';
try {
  execSync('git checkout server.ts');
  console.log("Restored server.ts");
} catch (e) {
  console.log("Git error:", e);
}
