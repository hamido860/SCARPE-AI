import fs from "fs";

let code = fs.readFileSync("server.ts", "utf8");

// We need to restore app.post("/api/chat") and analyzePdfContent correctly.
const fixString = `      const aiResponse = await nvidia.chat.completions.create({
        model: 'meta/llama-3.1-70b-instruct',
        messages: [{ role: 'user', content: prompt }]
      });

      res.json({
        answer: aiResponse.choices[0].message.content || '',
        sources: topK.map(c => ({ title: c.title, url: c.url, score: c.score, text: c.text }))
      });

    } catch (error: any) {
      console.error("[Chat Error]", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/kb-stats", (req, res) => {
    res.json({ totalChunks: vectorStore.length });
  });

  app.post("/api/kb-clear", (req, res) => {
    vectorStore.length = 0;
    res.json({ success: true });
  });

  async function analyzePdfContent(text: string) {
    if (!text || text.length < 50) return null;

    try {
      const prompt = \`Analyze the following PDF document content and provide a structured JSON response.
      Keep it short and concise.\`;
      
      const aiResponse = await nvidia.chat.completions.create({
        model: "meta/llama-3.1-70b-instruct",
        messages: [{ role: "user", content: prompt + "\\n\\nRespond strictly with JSON containing: summary, keyPoints (array), sentiment, entities (array), detectedCountry, languages (array), followUpQuestion, and source_type." }],
        response_format: { type: "json_object" }
      });

      return JSON.parse(aiResponse.choices[0].message.content || "{}");
    } catch (error) {
      console.error("PDF Analysis Error:", error);
      return null;
    }
  }`;

// I will just slice out the problematic area and replace it with fixString.
const before = code.split('Answer:`;')[0] + 'Answer:`;\n\n';
const after = code.split('  // Helper to scrape a single URL')[1];

fs.writeFileSync("server.ts", before + fixString + '\n\n  // Helper to scrape a single URL' + after);
console.log("Restored chat logic");
