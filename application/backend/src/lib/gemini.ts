import { GoogleGenAI, Type } from '@google/genai';
import { TARGET_FIELDS } from './transform.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const FIELD_DESCRIPTIONS: Record<(typeof TARGET_FIELDS)[number], string> = {
  title: 'Property title/name',
  price: 'Price, numeric, in PHP',
  bedrooms: 'Number of bedrooms',
  bathrooms: 'Number of bathrooms',
  address: 'Street address',
  city: 'City',
  province: 'Province',
  type: 'Property type — one of: condo_unit, house_and_lot, lot_only, townhouse, commercial, warehouse, agricultural, industrial',
  owner_type: 'Owner type — one of: developer, individual, company',
  floor_area_sqm: 'Floor area in square meters',
  lot_area_sqm: 'Lot area in square meters',
  parking_slots: 'Number of parking slots',
};

export type FieldMappingSuggestion = {
  csv_column: string;
  residoro_field: string;
  confidence: number;
};

export type SuggestMappingsResult = {
  mappings: FieldMappingSuggestion[];
  unmapped_columns: string[];
  warnings: string[];
};

const MAPPING_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    mappings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          csv_column: { type: Type.STRING },
          residoro_field: { type: Type.STRING, enum: [...TARGET_FIELDS, 'unmapped'] },
          confidence: { type: Type.NUMBER },
        },
        required: ['csv_column', 'residoro_field', 'confidence'],
      },
    },
    warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['mappings', 'warnings'],
} as const;

export async function suggestFieldMappings(
  headers: string[],
  sampleRows: Record<string, string>[],
): Promise<SuggestMappingsResult> {
  const fieldList = TARGET_FIELDS.map((field) => `- ${field}: ${FIELD_DESCRIPTIONS[field]}`).join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-flash-latest',
    contents: `You are helping migrate property listing data into Residoro, a Philippine real estate brokerage platform. Suggest how each CSV column maps to a Residoro property field.

CSV headers: ${JSON.stringify(headers)}

Sample rows:
${JSON.stringify(sampleRows, null, 2)}

Available Residoro fields:
${fieldList}

For each CSV column, suggest the best-matching Residoro field, or "unmapped" if none fits, with a confidence score from 0.0 to 1.0. Be conservative — only assign high confidence when the match is clear from the header name and sample values. Include a warnings array noting anything worth flagging (e.g. ambiguous data types, values that don't look valid for the suggested field).`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: MAPPING_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Gemini did not return a structured response');
  }

  const parsed = JSON.parse(text) as { mappings: FieldMappingSuggestion[]; warnings: string[] };
  const unmapped_columns = parsed.mappings
    .filter((mapping) => mapping.residoro_field === 'unmapped')
    .map((mapping) => mapping.csv_column);

  return { mappings: parsed.mappings, unmapped_columns, warnings: parsed.warnings };
}
