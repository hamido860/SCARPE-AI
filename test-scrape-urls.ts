import axios from 'axios';

async function test(url: string) {
  try {
    console.log(`Testing ${url}...`);
    const res = await axios.post('http://localhost:3000/api/scrape', { url });
    console.log(`Success: ${res.data.title}`);
  } catch (e: any) {
    console.error(`Error for ${url}:`, e.response?.data || e.message);
  }
}

async function run() {
  await test('https://google.com');
  await test('http://example.com');
  await test('https://news.ycombinator.com');
}

run();
