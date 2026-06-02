import axios from "axios";
import https from "https";

async function run() {
  try {
    const resp = await axios.get("https://moutamadris.ma/%D8%A7%D9%88%D9%84%D9%89-%D8%A8%D8%A7%D9%83/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
      timeout: 30000,
      validateStatus: (status) => status < 500,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
    console.log("Status:", resp.status);
    console.log("Body preview:", (resp.data || "NO DATA").substring(0, 200));
  } catch (err: any) {
    console.log("Error:", err.message);
  }
}

run();
