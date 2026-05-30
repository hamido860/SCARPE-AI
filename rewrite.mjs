import fs from "fs";

let code = fs.readFileSync("server.ts", "utf8");

// Replacements for embeddings
code = code.replace(/const embedResponse = await ai\.models\.embedContent\(\{\s*model: 'text-embedding-004',\s*contents: chunk\s*\}\);\s*(?:\/\/[^\n]*\n)*\s*const embedding = [^;]+;/g,
  `const embedResponse = await nvidia.embeddings.create({
          model: 'nvidia/nv-embedqa-e5-v5',
          input: chunk,
          encoding_format: "float",
          extra_body: { input_type: "passage" }
        });
        const embedding = embedResponse.data[0].embedding;`
);

code = code.replace(/const embedResponse = await ai\.models\.embedContent\(\{\s*model: 'text-embedding-004',\s*contents: query\s*\}\);\s*(?:\/\/[^\n]*\n)*\s*const queryEmbedding = [^;]+;/g,
  `const embedResponse = await nvidia.embeddings.create({
        model: 'nvidia/nv-embedqa-e5-v5',
        input: query,
        encoding_format: "float",
        extra_body: { input_type: "query", truncate: "START" }
      });
      const queryEmbedding = embedResponse.data[0].embedding;`
);

// Replacements for simple chat
code = code.replace(/const aiResponse = await ai\.models\.generateContent\(\{\s*model: [^,]+,\s*contents: prompt\s*\}\);/g,
  `const aiResponse = await nvidia.chat.completions.create({
        model: 'meta/llama-3.1-70b-instruct',
        messages: [{ role: 'user', content: prompt }]
      });`
);

code = code.replace(/const response = await ai\.models\.generateContent\(\{\s*model: [^,]+,\s*contents: \`\$\{prompt\}\\n\\nContent:\\n\$\{text\}\`\s*\}\);/g,
  `const response = await nvidia.chat.completions.create({
        model: 'meta/llama-3.1-70b-instruct',
        messages: [{ role: 'user', content: \`\$\{prompt\}\\n\\nContent:\\n\$\{text\}\` }]
      });`
);

code = code.replace(/res\.json\(\{ result: response\.text \}\);/g, "res.json({ result: response.choices[0].message.content });");
code = code.replace(/res\.json\(\{ text: aiResponse\.text \}\);/g, "res.json({ text: aiResponse.choices[0].message.content });");
code = code.replace(/answer: aiResponse\.text/, "answer: aiResponse.choices[0].message.content || ''");
code = code.replace(/const aiData = JSON\.parse\(aiResponse\.text\);/g, "const aiData = JSON.parse(aiResponse.choices[0].message.content || '{}');");

// Complex schema chats
// Analyze API:
code = code.replace(/const aiResponse = await ai\.models\.generateContent\(\{[\s\S]*?responseSchema: \{[\s\S]*?fullContent: \{ type: Type\.STRING \},[\s\S]*?\},[\s\S]*?\}\);/g,
  `const aiResponse = await nvidia.chat.completions.create({
        model: "meta/llama-3.1-70b-instruct",
        messages: [{ role: "user", content: prompt + "\\n\\nRespond strictly with JSON containing: summary, keyPoints (array), sentiment, entities (array), followUpQuestion, detectedCountry, languages (array), and fullContent." }],
        response_format: { type: "json_object" }
      });`
);

// Analyze PDF
code = code.replace(/const aiResponse = await ai\.models\.generateContent\(\{[\s\S]*?properties: \{[\s\S]*?source_type: \{ Type\.STRING \}[\s\S]*?\},[\s\S]*?\}\);/g,
  `const aiResponse = await nvidia.chat.completions.create({
        model: "meta/llama-3.1-70b-instruct",
        messages: [{ role: "user", content: prompt + "\\n\\nRespond strictly with JSON containing: summary, keyPoints (array), sentiment, entities (array), detectedCountry, languages (array), followUpQuestion, and source_type." }],
        response_format: { type: "json_object" }
      });`
);

// Vision API
code = code.replace(/const aiResponse = await ai\.models\.generateContent\(\{[\s\S]*?model: "gemma-4-preview"[\s\S]*?\},[\s\S]*?\}\);/g, 
  `const aiResponse = await nvidia.chat.completions.create({
              model: "meta/llama-3.2-90b-vision-instruct",
              messages: [{
                role: "user", 
                content: [
                  { type: "text", text: "Extract all the text from this image. Maintain the original language and structure. Output the result as JSON containing two fields: 'title' (the main heading or title) and 'fullContent' (all the text found in the image)." },
                  { type: "image_url", image_url: { url: \`data:\${contentType || 'image/jpeg'};base64,\${base64Image}\` } }
                ]
              }],
              response_format: { type: "json_object" }
            });`
);

code = code.replace(/return JSON\.parse\(aiResponse\.text\);/g, "return JSON.parse(aiResponse.choices[0].message.content || '{}');");

fs.writeFileSync("server.ts", code);
 console.log("Done");
