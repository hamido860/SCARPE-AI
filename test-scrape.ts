import axios from 'axios';

async function test() {
  try {
    const res = await axios.post('http://localhost:3000/api/scrape', { url: 'https://example.com' });
    console.log(res.data);
  } catch (e: any) {
    console.error(e.response?.data || e.message);
  }
}

test();
