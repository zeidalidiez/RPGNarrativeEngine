import { parseProjectManifest } from '@rpgnarrativeengine/project';

/**
 * Rename the project entry scene without reserializing the creator's TOML.
 * The original quote style, comments, spacing, and unrelated sections remain intact.
 */
export function renameProjectEntryScene(source: string, from: string, to: string): string {
  const manifest = parseProjectManifest(source);
  if (String(manifest.project.entryScene) !== from) return source;

  const projectHeader = /^[ \t]*\[project\][ \t]*(?:#.*)?$/gmu.exec(source);
  if (projectHeader === null) throw new Error('project.toml has no [project] section.');

  const sectionStart = projectHeader.index + projectHeader[0].length;
  const nextHeader = /^[ \t]*\[[^\u005d\r\n]+\][ \t]*(?:#.*)?$/gmu;
  nextHeader.lastIndex = sectionStart;
  const sectionEnd = nextHeader.exec(source)?.index ?? source.length;
  const section = source.slice(sectionStart, sectionEnd);
  const entry = /^([ \t]*entry_scene[ \t]*=[ \t]*)(["'])([^"'\r\n]*)(\2)([ \t]*(?:#.*)?)$/mu.exec(
    section,
  );
  if (entry === null) throw new Error('project.toml is missing project.entry_scene.');

  const valueStart = sectionStart + entry.index + (entry[1]?.length ?? 0) + 1;
  const valueEnd = valueStart + (entry[3]?.length ?? 0);
  const updated = source.slice(0, valueStart) + to + source.slice(valueEnd);
  if (String(parseProjectManifest(updated).project.entryScene) !== to) {
    throw new Error('The project entry scene could not be updated safely.');
  }
  return updated;
}
