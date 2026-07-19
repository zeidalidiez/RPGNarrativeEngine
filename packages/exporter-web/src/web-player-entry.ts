import type { CompiledGame } from '@rpgnarrativeengine/ir';
import { mountNarrativePlayer } from '@rpgnarrativeengine/player';

function playerRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>('#player');
  if (root === null) throw new Error('The exported game is missing its player mount.');
  return root;
}

function parseGame(value: string): CompiledGame {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('format' in parsed) ||
    parsed.format !== 'rpg-narrative-engine' ||
    !('formatVersion' in parsed) ||
    parsed.formatVersion !== 1
  ) {
    throw new Error('The exported game bundle has an unsupported format.');
  }
  return parsed as CompiledGame;
}

async function loadGame(root: HTMLElement): Promise<CompiledGame> {
  const embedded = document.querySelector<HTMLScriptElement>('#rpgne-game');
  if (embedded !== null) return parseGame(embedded.textContent);

  const bundleUrl = root.dataset['gameBundle'];
  if (bundleUrl === undefined) throw new Error('The exported game does not name a game bundle.');
  const response = await fetch(bundleUrl);
  if (!response.ok) throw new Error(`Could not load the game bundle (${response.status}).`);
  return parseGame(await response.text());
}

function showLoadFailure(root: HTMLElement, error: unknown): void {
  const message = document.createElement('p');
  message.className = 'nre-load-error';
  message.setAttribute('role', 'alert');
  message.textContent =
    error instanceof Error ? error.message : 'The exported game could not start.';
  root.replaceChildren(message);
}

const root = playerRoot();
void loadGame(root)
  .then((game) => mountNarrativePlayer(root, game))
  .catch((error: unknown) => showLoadFailure(root, error));
