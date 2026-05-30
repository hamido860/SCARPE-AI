import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';

async function test() {
  const url = "https://marocmaths.com/tronc-commun/";
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
    const $ = cheerio.load(res.data);
    const links = [];
    $('a').each((i, el) => {
      links.push($(el).attr('href'));
    });
    console.log("Found links:", links.filter(l => l && l.includes('pdf')));
  } catch (e) {
    console.error("Error:", e.response ? e.response.status : e.message);
  }
}

test();
