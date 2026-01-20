
import { GoogleGenAI, Type } from "@google/genai";
import { Subject, OutputLanguage, ProcessingResult, MCQQuestion, Flashcard } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Sanitizes JSON strings returned by Gemini by removing potential markdown code blocks.
 */
const parseJSONSafely = (text: string) => {
  try {
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON Parse Error on text:", text);
    throw new Error("Failed to parse AI response. The content might be too complex or formatted incorrectly.");
  }
};

export const extractOCRAndSubject = async (base64Images: string[]): Promise<ProcessingResult> => {
  const ai = getAI();
  const model = 'gemini-3-flash-preview';
  const imageParts = base64Images.map(img => ({
    inlineData: {
      mimeType: 'image/jpeg',
      data: img.split(',')[1] || img
    }
  }));

  const prompt = `Extract all text from these book pages (keep it exactly as written). Mixed Bangla and English is expected. 
  Detect the subject: Bangla 2nd Paper, English, Math, or GK.
  Return JSON: { "ocrText": "...", "subject": "..." }`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: { parts: [...imageParts, { text: prompt }] },
      config: {
        responseMimeType: "application/json",
      }
    });

    const data = parseJSONSafely(response.text || '{}');
    return {
      ocrText: data.ocrText || '',
      subject: data.subject as Subject || Subject.UNKNOWN
    };
  } catch (error) {
    console.error("Gemini OCR Error:", error);
    throw error;
  }
};

export const clarifyText = async (markedText: string, contextSentence: string, language: OutputLanguage): Promise<{ definition: string, fullExplanation: string }> => {
  const ai = getAI();
  const model = 'gemini-3-flash-preview';
  const prompt = `You are a helpful linguistic tutor. A student is struggling with a specific part of a sentence.
  Marked Text: "${markedText}"
  Full Context: "${contextSentence}"
  Language: ${language === OutputLanguage.BN ? 'Bengali' : 'English'}.

  Tasks:
  1. Define the "Marked Text" clearly and simply.
  2. Explain the "Full Context" sentence in plain language, showing how the marked text fits in.
  
  Return JSON with keys: "definition" and "fullExplanation".`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });
    return parseJSONSafely(response.text || '{}');
  } catch (error) {
    console.error("Clarification error:", error);
    throw error;
  }
};

export const generateMasterNote = async (ocrText: string, subject: Subject, language: OutputLanguage): Promise<{ layer1: string, layer2: string, layer3: string }> => {
  const ai = getAI();
  const model = 'gemini-3-flash-preview';
  const prompt = `You are a professional notes generator. Generate a 3-layer Master Note from OCR_TEXT: """${ocrText}"""
  Subject: ${subject}, Language: ${language}.

  LAYER 1: BOOK-EXACT (OCR-only)
  - Rules: 100% exact to OCR. Do NOT shorten. Use ONLY OCR facts.
  - Format: For each topic: Use Markdown Bold for headers, Bullet points for details.
  - Structure: 
    ### [Topic Name]
    - **Meaning**: ...
    - **Rules/Details**: ...
    - **Examples**: ...
  - End Layer 1 with a "BOOK-EXACT Quick Table" using Markdown Table format.

  LAYER 2: MEMORY TECHNIQUES
  - Use bold text for mnemonics. Add a specific "Shortcut" section for Math.
  - Add "Trap Alerts" in a blockquote format (> Trap Alert: ...).

  LAYER 3: JOB PREP BONUS (EXTREME DEPTH)
  - QUANTITY: Generate DOUBLE the amount of bonus content (400+ detailed bullet points).
  - CONTENT: Provide ultra-deep analysis, historical background, related terminology, and expert-level insights.
  - GOVT JOB SPECIAL: Include a sub-section "🎯 TOP RELEVANT GOVT JOB QUESTIONS" containing 30+ highly important questions and answers that frequently appear in BCS, Bank, and Primary exams related to this specific content.
  - FORMAT: Mark every item with 🧠 Bonus. Use bold text for keywords.

  Return as JSON with keys: layer1, layer2, layer3.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });
    return parseJSONSafely(response.text || '{}');
  } catch (error) {
    console.error("Gemini Notes Error:", error);
    throw error;
  }
};

export const generateMoreBonus = async (ocrText: string, existingBonus: string, subject: Subject, language: OutputLanguage): Promise<string> => {
  const ai = getAI();
  const model = 'gemini-3-flash-preview';
  const prompt = `Task: Generate ADDITIONAL High-Yield Job Prep Bonus Content.
  Original Context: """${ocrText}"""
  Subject: ${subject}
  Language: ${language}
  Existing Bonus Snippet: """${existingBonus.substring(0, 500)}..."""

  Requirements:
  1. Generate 40+ NEW specific related questions and detailed answers for Bangladesh Govt Jobs (BCS, Bank, Primary).
  2. Focus on topics related to the text that haven't been fully explored.
  3. Format: Mark every line with 🧠 Bonus.
  4. Include "🎯 EXTRA GOVT JOB INSIGHTS" header.
  
  Return the raw text only.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });
    return response.text || '';
  } catch (error) {
    console.error("Gemini More Bonus Error:", error);
    throw error;
  }
};

export const generateSummary = async (ocrText: string, layer1: string, language: OutputLanguage): Promise<string> => {
  const ai = getAI();
  const model = 'gemini-3-flash-preview';
  const prompt = `Generate a clean, readable Summary. Language: ${language}.
  Use Markdown Headers (##) and Lists (-).
  Include: 10 key points, 10 Q/A one-liners, 5 traps, 1-min script.
  OCR: ${ocrText}`;
  try {
    const response = await ai.models.generateContent({ model, contents: prompt });
    return response.text || '';
  } catch (error) {
    console.error("Gemini Summary Error:", error);
    return "Summary generation failed.";
  }
};

export const generateMCQBatch = async (
  ocrText: string, 
  language: OutputLanguage, 
  batchNum: number, 
  prevContext: string = ""
): Promise<{ questions: MCQQuestion[]; coverageReport: any }> => {
  const ai = getAI();
  const model = 'gemini-3-flash-preview';
  const prompt = `Generate 50 MCQs for Batch ${batchNum} from OCR_TEXT: """${ocrText}"""
  Language: ${language}. 
  Rules: Exact 50 MCQs, JSON format, briefExplanation for each. Focus on unused facts: ${prevContext}`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const data = parseJSONSafely(response.text || '{}');
    const root = data.practice || data; // Handle both potential structures
    return {
      questions: root.questions || [],
      coverageReport: (root.endOfBatch?.coverageReport || root.coverageReport || { usedFactsCount: 0, unusedFactsCount: 0, unusedFactsPreview: [] })
    };
  } catch (error) {
    console.error("Gemini MCQ Error:", error);
    throw error;
  }
};

export const generateFlashcards = async (ocrText: string, language: OutputLanguage): Promise<Flashcard[]> => {
  const ai = getAI();
  const model = 'gemini-3-flash-preview';
  const prompt = `Generate exactly 10 short flashcards from: ${ocrText}. Language: ${language}. JSON format. { "cards": [{ "id": 1, "question": "..." }] }`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });
    const data = parseJSONSafely(response.text || '{}');
    return data.cards || [];
  } catch (error) {
    console.error("Flashcard error:", error);
    return [];
  }
};
