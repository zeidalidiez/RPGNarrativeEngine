export const EDITOR_METADATA_PATH = '.rpgne/editor.json';
export const EDITOR_METADATA_SCHEMA = 1;

export interface StoryMapPosition {
  readonly x: number;
  readonly y: number;
}

export interface StoryMapLayout {
  readonly positions: Readonly<Record<string, StoryMapPosition>>;
}

export class EditorMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditorMetadataError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRoot(source: string | null): Record<string, unknown> {
  if (source === null || source.trim().length === 0) return { schema: EDITOR_METADATA_SCHEMA };
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new EditorMetadataError(`${EDITOR_METADATA_PATH} is not valid JSON.`);
  }
  if (!isRecord(parsed)) {
    throw new EditorMetadataError(`${EDITOR_METADATA_PATH} must contain a JSON object.`);
  }
  if (parsed['schema'] !== EDITOR_METADATA_SCHEMA) {
    throw new EditorMetadataError(
      `${EDITOR_METADATA_PATH} schema must be ${EDITOR_METADATA_SCHEMA}.`,
    );
  }
  return parsed;
}

function validCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000;
}

export function parseStoryMapLayout(source: string | null): StoryMapLayout {
  const root = parseRoot(source);
  const storyMap = root['storyMap'];
  if (storyMap === undefined) return Object.freeze({ positions: Object.freeze({}) });
  if (!isRecord(storyMap)) {
    throw new EditorMetadataError('editor.json storyMap must be an object.');
  }
  const rawPositions = storyMap['positions'];
  if (rawPositions === undefined) return Object.freeze({ positions: Object.freeze({}) });
  if (!isRecord(rawPositions)) {
    throw new EditorMetadataError('editor.json storyMap.positions must be an object.');
  }

  const positions: Record<string, StoryMapPosition> = {};
  for (const [sceneId, rawPosition] of Object.entries(rawPositions)) {
    if (
      !isRecord(rawPosition) ||
      !validCoordinate(rawPosition['x']) ||
      !validCoordinate(rawPosition['y'])
    ) {
      throw new EditorMetadataError(`Story Map position for ${sceneId} is invalid.`);
    }
    positions[sceneId] = Object.freeze({ x: rawPosition['x'], y: rawPosition['y'] });
  }
  return Object.freeze({ positions: Object.freeze(positions) });
}

/** Serialize map positions while preserving unrelated future editor metadata fields. */
export function serializeStoryMapLayout(
  source: string | null,
  positions: Readonly<Record<string, StoryMapPosition>>,
): string {
  const root = parseRoot(source);
  const currentStoryMap = isRecord(root['storyMap']) ? root['storyMap'] : {};
  const orderedPositions = Object.fromEntries(
    Object.entries(positions)
      .filter(([, position]) => validCoordinate(position.x) && validCoordinate(position.y))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([sceneId, position]) => [sceneId, { x: position.x, y: position.y }]),
  );
  return `${JSON.stringify(
    {
      ...root,
      schema: EDITOR_METADATA_SCHEMA,
      storyMap: { ...currentStoryMap, positions: orderedPositions },
    },
    null,
    2,
  )}\n`;
}
