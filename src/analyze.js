import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['arabic_text', 'people', 'entities', 'countries', 'category', 'person_photo_unsafe'],
  properties: {
    arabic_text: {
      type: 'string',
      description: 'The news item translated into concise formal news Arabic (فصحى)',
    },
    people: {
      type: 'array',
      description:
        'At most 2 people whose faces best represent this story — the decision-makers or protagonists. Ordered by relevance. Empty when no person is meaningfully involved.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'value'],
        properties: {
          type: {
            type: 'string',
            enum: ['named_person', 'office'],
            description:
              "'named_person' only when the headline names the individual explicitly. 'office' whenever the actor is a country, government, central bank, or institution — never guess who currently holds an office.",
          },
          value: {
            type: 'string',
            description:
              "For 'named_person', the person's full name as commonly written in English. For 'office', the formal English title of the position exactly as an encyclopedia would name it, e.g. 'President of the United States', 'Prime Minister of the United Kingdom', 'Chair of the Federal Reserve', 'Secretary-General of the United Nations'.",
          },
        },
      },
    },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'wikimedia_query'],
        properties: {
          name: { type: 'string' },
          wikimedia_query: {
            type: 'string',
            description:
              'A concrete photographable subject for Wikimedia Commons search: a person full name, landmark, city skyline, institution building, or vehicle/hardware type. Never abstract concepts.',
          },
        },
      },
    },
    countries: {
      type: 'array',
      items: { type: 'string', description: 'ISO 3166-1 alpha-2 code' },
    },
    category: {
      type: 'string',
      enum: ['geopolitics', 'military', 'economy', 'markets', 'disaster', 'politics', 'sports', 'other'],
    },
    person_photo_unsafe: {
      type: 'boolean',
      description:
        "true only when putting a person's face on this story could wrongly imply they are a victim, a suspect, under arrest, accused of a crime, or dead. Routine political, military, diplomatic and economic news is NOT unsafe — a leader's face on a story about their own government's decision is normal news presentation.",
    },
  },
};

const SYSTEM = `You prepare English breaking-news one-liners from The Spectator Index for an Arabic Snapchat news channel.

Translation rules:
- Translate into concise formal news Arabic (فصحى) in the register of Arabic news channels.
- Drop the leading "BREAKING:" — the template adds عاجل itself. Drop flag emojis and any emojis.
- Keep numbers as digits. Use the established Arabic form of proper names (e.g. "رويترز" for Reuters); keep an unfamiliar name in Latin script if there is no common Arabic form.
- One tight paragraph, no added commentary, nothing invented beyond the source line.

Analysis rules:
- people: this drives the card's background, so it matters most. Give the 1-2 people whose faces a viewer would associate with the story.
  - The headline names someone → {"type": "named_person", "value": "<their full name>"}.
  - A country, government, central bank, or institution acted → {"type": "office", "value": "<formal title of the office responsible>"}. Examples: US stock market or interest rates → "Chair of the Federal Reserve"; a US government decision → "President of the United States"; a UK government decision → "Prime Minister of the United Kingdom".
  - Two countries or institutions in one story → one entry for each, most central first.
  - **Never** write a person's name for an office holder. Emit the office title and let the database resolve who currently holds it — your training data may be out of date and naming the wrong person would put the wrong face on the news.
  - No person meaningfully involved (natural disaster, market statistic with no clear actor, sports result) → empty array.
- entities: 1-3 photographable non-person subjects as a fallback when no portrait is available: a landmark, city skyline, institution building, vehicle, or concrete scene (e.g. "oil tanker sea", "stock exchange trading floor"). Never abstract concepts.
- countries: ISO alpha-2 codes of countries central to the story, most central first.
- person_photo_unsafe: reserve this for stories where a face would imply victimhood, guilt, arrest, or death. Ordinary politics, diplomacy, military and economic news is not unsafe.`;

let client;

export async function analyzePost(text) {
  if (!config.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — add it to .env');
  }
  client ??= new Anthropic({ apiKey: config.anthropicApiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2048,
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    messages: [{ role: 'user', content: text }],
  });

  if (response.stop_reason === 'refusal') {
    return { refused: true };
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error(`No text block in Claude response (stop_reason=${response.stop_reason})`);
  return { refused: false, ...JSON.parse(textBlock.text) };
}
