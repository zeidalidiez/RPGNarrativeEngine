import type { BuildOutputFile } from '@rpgnarrativeengine/build';
import type { ProjectFileInput } from '@rpgnarrativeengine/project';

export interface NativeProject {
  readonly sessionId: string;
  readonly rootName: string;
  readonly files: readonly ProjectFileInput[];
}

export interface NativeSaveResult {
  readonly savedFiles: number;
  readonly changedPaths: readonly string[];
}

export interface NativeBuildResult {
  readonly outputPath: string;
}

export interface NativeHost {
  readonly openProject: () => Promise<NativeProject | null>;
  readonly reloadProject: (sessionId: string) => Promise<NativeProject>;
  readonly checkProjectChanges: (sessionId: string) => Promise<readonly string[]>;
  readonly saveProject: (
    sessionId: string,
    files: readonly ProjectFileInput[],
  ) => Promise<NativeSaveResult>;
  readonly writeProjectBuild: (
    sessionId: string,
    outputPath: string,
    projectId: string,
    files: readonly BuildOutputFile[],
  ) => Promise<NativeBuildResult>;
  readonly openProjectOutput: (sessionId: string) => Promise<void>;
  readonly guardWindowClose: (isDirty: () => boolean) => Promise<() => void>;
}

interface NativeBuildFile {
  readonly path: string;
  readonly contentBase64: string;
}

function base64Content(content: string | Uint8Array): string {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.length);
    chunks.push(String.fromCharCode(...bytes.subarray(offset, end)));
  }
  return btoa(chunks.join(''));
}

/** Return the capability-limited desktop bridge, or null in an ordinary browser. */
export async function createNativeHost(): Promise<NativeHost | null> {
  if (!('__TAURI_INTERNALS__' in window)) return null;

  const [{ invoke }, { getCurrentWindow }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/window'),
  ]);

  return {
    openProject: () => invoke<NativeProject | null>('open_project'),
    reloadProject: (sessionId) =>
      invoke<NativeProject>('reload_project', { request: { sessionId } }),
    checkProjectChanges: async (sessionId) => {
      const result = await invoke<{ readonly changedPaths: readonly string[] }>(
        'check_project_changes',
        { request: { sessionId } },
      );
      return result.changedPaths;
    },
    saveProject: (sessionId, files) =>
      invoke<NativeSaveResult>('save_project', {
        request: { sessionId, files },
      }),
    writeProjectBuild: (sessionId, outputPath, projectId, files) => {
      const encodedFiles: NativeBuildFile[] = files.map((file) => ({
        path: file.path,
        contentBase64: base64Content(file.content),
      }));
      return invoke<NativeBuildResult>('write_project_build', {
        request: { sessionId, outputPath, projectId, files: encodedFiles },
      });
    },
    openProjectOutput: (sessionId) =>
      invoke<void>('open_project_output', { request: { sessionId } }),
    async guardWindowClose(isDirty) {
      return getCurrentWindow().onCloseRequested((event) => {
        if (
          isDirty() &&
          !window.confirm('This project has unsaved changes. Close Creator Studio anyway?')
        ) {
          event.preventDefault();
        }
      });
    },
  };
}
