import axios from 'axios';
import * as cheerio from 'cheerio';

async function test() {
  try {
    const url = "https://moutamadris.ma/%d8%b3%d9%88%d8%b1%d8%a9-%d8%a7%d9%84%d9%83%d9%87%d9%81-%d8%ac%d8%af%d8%b9-%d9%85%d8%b4%d8%aa%d8%b1%d9%83/";
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    const $ = cheerio.load(res.data);
    
    const iframes = [];
    $('iframe').each((i, el) => {
      iframes.push($(el).attr('src'));
    });
    
    const pdfLinks = [];
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('.pdf')) {
        pdfLinks.push(href);
      }
    });

    console.log("Iframes:", iframes);
    console.log("PDF Links:", pdfLinks);
    
  } catch (e) {
    console.error(e.message);
  }
}

test();
