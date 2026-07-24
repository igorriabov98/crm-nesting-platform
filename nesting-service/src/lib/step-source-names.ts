import { TextDecoder } from 'node:util';
import { normalizeCadText } from './text-encoding';

const windows1251Decoder = new TextDecoder('windows-1251');
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

type StepEntity = {
  id: number;
  type: string;
  args: string;
};

export type StepOccurrenceMetadata = {
  name: string;
  assemblyPath: string[];
};

export function extractStepOccurrenceMetadata(fileContent: Buffer): Map<number, StepOccurrenceMetadata> {
  const text = fileContent.toString('latin1');
  const products = new Map<number, string>();
  const formationProducts = new Map<number, number>();
  const definitionFormations = new Map<number, number>();
  const occurrences: Array<{ parentDefinitionId: number; childDefinitionId: number }> = [];

  for (const entity of parseStepEntities(text)) {
    if (entity.type === 'PRODUCT') {
      const productStrings = readStepStrings(entity.args);
      const name = productStrings[0] || null;
      if (name) {
        products.set(entity.id, name);
      }
      continue;
    }

    if (entity.type === 'PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE') {
      const productId = extractReferenceIds(entity.args)[0];
      if (productId !== undefined) {
        formationProducts.set(entity.id, productId);
      }
      continue;
    }

    if (entity.type === 'PRODUCT_DEFINITION') {
      const formationId = extractReferenceIds(entity.args)[0];
      if (formationId !== undefined) {
        definitionFormations.set(entity.id, formationId);
      }
      continue;
    }

    if (entity.type === 'NEXT_ASSEMBLY_USAGE_OCCURRENCE') {
      const [parentDefinitionId, childDefinitionId] = extractReferenceIds(entity.args);
      if (parentDefinitionId !== undefined && childDefinitionId !== undefined) {
        occurrences.push({ parentDefinitionId, childDefinitionId });
      }
    }
  }

  const incomingParents = new Map<number, number[]>();
  for (const occurrence of occurrences) {
    const parents = incomingParents.get(occurrence.childDefinitionId) ?? [];
    parents.push(occurrence.parentDefinitionId);
    incomingParents.set(occurrence.childDefinitionId, parents);
  }

  const definitionName = (definitionId: number): string => {
    const formationId = definitionFormations.get(definitionId);
    const productId = formationId === undefined ? undefined : formationProducts.get(formationId);
    return productId === undefined ? '' : products.get(productId) ?? '';
  };

  const pathCache = new Map<number, string[]>();
  const buildDefinitionPath = (definitionId: number, seen = new Set<number>()): string[] => {
    const cached = pathCache.get(definitionId);
    if (cached) return cached;
    if (seen.has(definitionId)) return [];
    const nextSeen = new Set(seen).add(definitionId);
    const parentDefinitionId = incomingParents.get(definitionId)?.[0];
    const parentPath = parentDefinitionId === undefined
      ? []
      : buildDefinitionPath(parentDefinitionId, nextSeen);
    const name = definitionName(definitionId);
    const path = appendStepAssemblyPath(parentPath, name);
    pathCache.set(definitionId, path);
    return path;
  };

  const metadata = new Map<number, StepOccurrenceMetadata>();
  occurrences.forEach((occurrence, index) => {
    const name = definitionName(occurrence.childDefinitionId);
    const parentPath = buildDefinitionPath(occurrence.parentDefinitionId);
    const assemblyPath = appendStepAssemblyPath(parentPath, name);
    if (name) {
      metadata.set(index, { name, assemblyPath });
    }
  });

  return metadata;
}

export function extractStepOccurrenceNames(fileContent: Buffer): Map<number, string> {
  const names = new Map<number, string>();
  for (const [index, metadata] of extractStepOccurrenceMetadata(fileContent)) {
    names.set(index, metadata.name);
  }
  return names;
}

export function appendStepAssemblyPath(parentPath: string[], name: string): string[] {
  const normalizedName = normalizeCadText(name.trim());
  if (!normalizedName) return parentPath;
  if (parentPath.length === 0 && isSyntheticStepRootLabel(normalizedName)) return parentPath;
  return [...parentPath, normalizedName];
}

export function isSyntheticStepRootLabel(value: string): boolean {
  const normalized = normalizeCadText(value.trim());
  return /^open\s+cascade\s+step\s+translator\b/i.test(normalized) ||
    /\.(?:step|stp)$/i.test(normalized);
}

function parseStepEntities(text: string): StepEntity[] {
  const entities: StepEntity[] = [];
  let index = 0;

  while (index < text.length) {
    const hashIndex = text.indexOf('#', index);
    if (hashIndex === -1) break;

    let cursor = hashIndex + 1;
    let idText = '';
    while (cursor < text.length && isDigit(text[cursor])) {
      idText += text[cursor];
      cursor += 1;
    }

    if (!idText) {
      index = cursor;
      continue;
    }

    cursor = skipWhitespace(text, cursor);
    if (text[cursor] !== '=') {
      index = cursor;
      continue;
    }

    cursor = skipWhitespace(text, cursor + 1);
    let type = '';
    while (cursor < text.length && /[A-Z0-9_]/.test(text[cursor])) {
      type += text[cursor];
      cursor += 1;
    }

    cursor = skipWhitespace(text, cursor);
    if (!type || text[cursor] !== '(') {
      index = cursor;
      continue;
    }

    const argsStart = cursor + 1;
    const argsEnd = findMatchingParen(text, cursor);
    if (argsEnd === -1) {
      break;
    }

    entities.push({
      id: Number(idText),
      type,
      args: text.slice(argsStart, argsEnd),
    });
    index = argsEnd + 1;
  }

  return entities;
}

function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0;
  let inString = false;

  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (char === "'" && text[index + 1] === "'") {
        index += 1;
      } else if (char === "'") {
        inString = false;
      }
      continue;
    }

    if (char === "'") {
      inString = true;
      continue;
    }

    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function splitStepArguments(args: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let inString = false;

  for (let index = 0; index < args.length; index += 1) {
    const char = args[index];

    if (inString) {
      if (char === "'" && args[index + 1] === "'") {
        index += 1;
      } else if (char === "'") {
        inString = false;
      }
      continue;
    }

    if (char === "'") {
      inString = true;
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      continue;
    }

    if (char === ',' && depth === 0) {
      result.push(args.slice(start, index).trim());
      start = index + 1;
    }
  }

  result.push(args.slice(start).trim());
  return result;
}

function readStepStrings(args: string): string[] {
  return splitStepArguments(args)
    .filter((argument) => argument.startsWith("'"))
    .map(readStepString)
    .filter((value): value is string => value !== null);
}

function readStepString(argument: string): string | null {
  if (!argument.startsWith("'")) return null;
  let content = '';
  for (let index = 1; index < argument.length; index += 1) {
    const char = argument[index];
    if (char === "'" && argument[index + 1] === "'") {
      content += "'";
      index += 1;
      continue;
    }
    if (char === "'") {
      break;
    }
    content += char;
  }

  return decodeStepText(content);
}

function decodeStepText(value: string): string {
  const withEscapes = decodeStepEscapes(value);
  const bytes = Uint8Array.from(Array.from(withEscapes, (char) => char.charCodeAt(0) & 0xff));
  const decoded = decodeUtf8(bytes) ?? windows1251Decoder.decode(bytes);
  return normalizeCadText(decoded.trim());
}

function decodeStepEscapes(value: string): string {
  return value
    .replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_match, hex: string) => decodeHexCodePoints(hex, 4))
    .replace(/\\X4\\([0-9A-Fa-f]+)\\X0\\/g, (_match, hex: string) => decodeHexCodePoints(hex, 8))
    .replace(/\\X\\([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\S\\(.)/g, (_match, char: string) => String.fromCharCode((char.charCodeAt(0) + 0x80) & 0xff));
}

function decodeHexCodePoints(hex: string, width: number): string {
  let output = '';
  for (let index = 0; index + width <= hex.length; index += width) {
    const codePoint = Number.parseInt(hex.slice(index, index + width), 16);
    if (Number.isFinite(codePoint)) {
      output += String.fromCodePoint(codePoint);
    }
  }
  return output;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

function extractReferenceIds(args: string): number[] {
  const ids: number[] = [];
  const re = /#(\d+)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(args)) !== null) {
    ids.push(Number(match[1]));
  }

  return ids;
}

function skipWhitespace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}
