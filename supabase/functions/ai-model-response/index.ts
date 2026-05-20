import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// Mock response data (same as in modelPrompt.ts)
const getMockResponse = (input: string): Array<{category: string; words: string[]}> => {
  const mockResponses: Record<string, Array<{category: string; words: string[]}>> = {
    "default": [
      {
        category: "רגשות",
        words: ["שמחה", "עצב", "כעס", "פחד", "אהבה", "תסכול", "הקלה", "געגוע", "תקווה", "דאגה"]
      },
      {
        category: "פעולות",
        words: ["ללכת", "לדבר", "לנוח", "לחשוב", "להרגיש", "לאכול", "לישון", "לראות", "לשמוע", "לגעת"]
      },
      {
        category: "משפחה",
        words: ["אישה", "ילדים", "אבא", "אמא", "אח", "אחות", "סבא", "סבתא", "דוד", "דודה"]
      }
    ],
    "ספורט": [
      {
        category: "ענפי ספורט",
        words: ["כדורגל", "כדורסל", "שחייה", "טניס", "ריצה", "אופניים", "יוגה", "הליכה", "גולף", "אתלטיקה"]
      },
      {
        category: "ציוד ספורט",
        words: ["כדור", "נעליים", "בגדים", "מחבט", "משקולות", "מזרן", "שעון", "בקבוק", "כפפות", "קסדה"]
      },
      {
        category: "תחושות",
        words: ["התלהבות", "מאמץ", "הזעה", "עייפות", "סיפוק", "כוח", "גמישות", "מהירות", "דופק", "נשימה"]
      }
    ],
    "אוכל": [
      {
        category: "סוגי מזון",
        words: ["פירות", "ירקות", "בשר", "דגים", "מאפים", "חלב", "גבינות", "דגנים", "קטניות", "ממתקים"]
      },
      {
        category: "טעמים",
        words: ["מתוק", "חמוץ", "מלוח", "מר", "חריף", "עשיר", "רענן", "מעודן", "עמוק", "קל"]
      },
      {
        category: "ארוחות",
        words: ["בוקר", "צהריים", "ערב", "חטיף", "מנה", "תוספת", "עיקרית", "קינוח", "מרק", "סלט"]
      }
    ],
    "משפחה": [
      {
        category: "בני משפחה",
        words: ["אישה", "בעל", "ילד", "ילדה", "אבא", "אמא", "סבא", "סבתא", "אח", "אחות"]
      },
      {
        category: "פעילויות משפחתיות",
        words: ["טיול", "משחק", "שיחה", "ארוחה", "מפגש", "חגיגה", "לימוד", "צפייה", "קריאה", "בילוי"]
      },
      {
        category: "רגשות משפחתיים",
        words: ["אהבה", "דאגה", "גאווה", "הערכה", "תמיכה", "הגנה", "געגוע", "שמחה", "חום", "ביטחון"]
      },
      {
        category: "זכרונות",
        words: ["ילדות", "חתונה", "לידה", "חגים", "מסורת", "טקסים", "אלבום", "סיפורים", "ירושה", "מורשת"]
      }
    ]
  };
  
  return mockResponses[input.toLowerCase()] || mockResponses["default"];
};

// Parse OpenAI response
const parseOpenAIResponse = (content: string): Array<{category: string; words: string[]}> => {
  try {
    // Strip markdown code fences if present
    let cleanContent = content.trim();
    const fenceMatch = cleanContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fenceMatch) {
      cleanContent = fenceMatch[1].trim();
    }

    const jsonResponse = JSON.parse(cleanContent);

    // Primary format from Structured Outputs schema: { categories: [{category, words}] }
    if (jsonResponse.categories && Array.isArray(jsonResponse.categories)) {
      return jsonResponse.categories;
    }

    // Fallback: direct array
    if (Array.isArray(jsonResponse)) {
      return jsonResponse.map(item => {
        // Handle legacy category1/category2/... keys
        const categoryKey = Object.keys(item).find(key => key.match(/^category\d+$/));
        if (categoryKey && Array.isArray(item.words)) {
          return { category: item[categoryKey], words: item.words };
        }
        return item;
      });
    }

    // Fallback: any top-level array property
    for (const key in jsonResponse) {
      if (Array.isArray(jsonResponse[key]) && jsonResponse[key].length > 0) {
        const first = jsonResponse[key][0];
        if (first.category || Object.keys(first).some(k => k.match(/^category\d*$/))) {
          return jsonResponse[key];
        }
      }
    }

    return [];
  } catch (error) {
    console.error("Error parsing OpenAI response:", error);
    return [];
  }
};

const defaultSystemJsonInstruction = `
===== System Instructions =====
Return multiple categories (at least 3) of relevant words based on the patient's input.
Each category must have a "category" name and a "words" array of 8–10 words.
Do NOT return only a single category.
`;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  
  try {
    const { prompt, useOpenAI = true, systemPrompt = "", isStreaming = false } = await req.json();
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    
    console.log('Received request:', { useOpenAI, isStreaming, hasApiKey: !!OPENAI_API_KEY });
    
    // If not using OpenAI or no API key, return mock data
    if (!useOpenAI || !OPENAI_API_KEY) {
      console.log('Using mock response');
      const mockData = getMockResponse(prompt);
      
      if (isStreaming) {
        // Simulate streaming for mock data
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            // Send each category as a separate chunk
            mockData.forEach((category, index) => {
              setTimeout(() => {
                const chunk = `data: ${JSON.stringify({
                  type: 'category',
                  data: category
                })}\n\n`;
                controller.enqueue(encoder.encode(chunk));
                
                // Send done signal after last category
                if (index === mockData.length - 1) {
                  setTimeout(() => {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                  }, 300);
                }
              }, index * 300);
            });
          }
        });
        
        return new Response(stream, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          }
        });
      } else {
        return new Response(JSON.stringify({
          categories: mockData
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }
    
    console.log('Making request to OpenAI with prompt:', prompt.substring(0, 100) + '...');
    
    // Construct full system prompt
    const fullSystemPrompt = `${systemPrompt}\n\n${defaultSystemJsonInstruction}`;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: fullSystemPrompt
          },
          {
            role: 'user',
            content: "מילים מהמטופל: " + prompt
          }
        ],
        temperature: 0.7,
        stream: isStreaming,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "word_categories",
            strict: true,
            schema: {
              type: "object",
              properties: {
                categories: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      category: { type: "string" },
                      words: { type: "array", items: { type: "string" } }
                    },
                    required: ["category", "words"],
                    additionalProperties: false
                  }
                }
              },
              required: ["categories"],
              additionalProperties: false
            }
          }
        }
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      
      // Fallback to mock data on OpenAI error
      console.log('Falling back to mock response due to OpenAI error');
      const mockData = getMockResponse(prompt);
      
      return new Response(JSON.stringify({
        categories: mockData
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    
    if (isStreaming) {
      // For streaming responses, process the stream and convert to our format
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.close();
            return;
          }
          
          let fullResponse = '';
          const emittedCategories = new Set<string>();

          // Emit a category over the stream and track it
          const emitCategory = (category: { category: string; words: string[] }) => {
            if (emittedCategories.has(category.category)) return;
            emittedCategories.add(category.category);
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ type: 'category', data: category })}\n\n`
            ));
          };

          // Regex to match a complete {"category":"...","words":[...]} object as it streams in.
          // Words are simple strings (no nested brackets), so [^\]]* is safe.
          const categoryPattern = /\{"category"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"words"\s*:\s*\[([^\]]*)\]\s*\}/g;

          const tryEmitFromBuffer = () => {
            categoryPattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = categoryPattern.exec(fullResponse)) !== null) {
              try {
                const parsed = JSON.parse(match[0]);
                emitCategory(parsed);
              } catch {
                // incomplete or malformed — skip
              }
            }
          };

          try {
            const decoder = new TextDecoder('utf-8', { fatal: false });
            let lineBuffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              // { stream: true } keeps the decoder stateful so multi-byte
              // Hebrew characters split across chunk boundaries are reassembled
              lineBuffer += decoder.decode(value, { stream: true });
              const lines = lineBuffer.split('\n');
              lineBuffer = lines.pop() ?? '';

              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;

                const data = line.slice(6).trim();
                if (data === '[DONE]') {
                  // Emit any categories not yet streamed (safety net)
                  const allCategories = parseOpenAIResponse(fullResponse);
                  for (const category of allCategories) emitCategory(category);

                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  controller.close();
                  return;
                }

                try {
                  const json = JSON.parse(data);
                  const token = json.choices?.[0]?.delta?.content;
                  if (token) {
                    fullResponse += token;
                    tryEmitFromBuffer();
                  }
                } catch {
                  // skip malformed SSE chunk
                }
              }
            }
          } catch (error) {
            console.error('Error processing stream:', error);

            const mockData = getMockResponse(prompt);
            for (const category of mockData) {
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'category', data: category })}\n\n`
              ));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        }
      });
      
      return new Response(stream, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    } else {
      // Non-streaming response
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      console.log('OpenAI response:', content);
      
      if (!content) {
        // Fallback to mock data if no content
        const mockData = getMockResponse(prompt);
        return new Response(JSON.stringify({
          categories: mockData
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      
      const categories = parseOpenAIResponse(content);
      
      return new Response(JSON.stringify({
        categories: categories
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
  } catch (error) {
    console.error('Error in ai-model-response function:', error);
    
    // Always fallback to mock data on any error
    console.log('Falling back to mock response due to error');
    const mockData = getMockResponse('default');
    
    return new Response(JSON.stringify({
      categories: mockData
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
