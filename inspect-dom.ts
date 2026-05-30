import axios from "axios";
import * as cheerio from "cheerio";

async function run() {
  const r = await axios.get("https://moutamadris.ma/%D8%A7%D9%84%D8%A7%D9%88%D9%84-%D8%A7%D8%A8%D8%aa%D8%AF%D8%A7%D8%A6%D9%8A/");
  const $ = cheerio.load(r.data);
  // find elements that contain دروس ملخصات تمارين
  $("h1, h2, h3, h4, caption, div").each((i, el) => {
    const t = $(el).text();
    if (t.includes("دروس ملخصات تمارين وامتحانات")) {
      console.log("FOUND HEADing tag:", el.tagName, "class:", $(el).attr('class'), "id:", $(el).attr('id'));
      
      // try to print following tags or children
      const parent = $(el).parent();
      console.log("PARENT tag:", parent[0].tagName, "class:", parent.attr('class'));
      
      const siblingLinks = $(el).nextAll('ul, div').find('a').map((i, a) => $(a).text() + ' => ' + $(a).attr('href')).get();
      if(siblingLinks.length > 0) console.log("Sibling Links:", siblingLinks);

      const parentLinks = parent.find('a').map((i, a) => $(a).text() + ' => ' + $(a).attr('href')).get();
      console.log("Parent Links:", parentLinks);
    }
  });

}
run();
