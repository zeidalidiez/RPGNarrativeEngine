import { compileStory, StoryCompileError } from '@rpgnarrativeengine/compiler';
import { webPlayerStyles } from '@rpgnarrativeengine/exporter-web/styles';
import { mountNarrativePlayer, type NarrativePlayerSaveOptions } from '@rpgnarrativeengine/player';

import storySource from '../story/lighthouse.story?raw';
import './style.css';

const playerStyle = document.createElement('style');
playerStyle.dataset['rpgnePlayerStyles'] = '';
playerStyle.textContent = webPlayerStyles;
document.head.prepend(playerStyle);

const player = document.querySelector<HTMLElement>('#player');
const atmosphere = document.querySelector<HTMLElement>('#atmosphere');

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function showcaseSaveOptions(buildIdentity: string): NarrativePlayerSaveOptions | undefined {
  try {
    return {
      buildIdentity,
      key: 'rpgnarrativeengine.save.org.rpgne.showcase',
      storage: globalThis.localStorage,
    };
  } catch {
    return undefined;
  }
}

function showFailure(error: unknown): void {
  if (player === null) return;
  const heading = document.createElement('h2');
  heading.textContent = 'The story could not be compiled';
  const details = document.createElement('pre');
  details.textContent =
    error instanceof StoryCompileError
      ? error.issues.map((issue) => issue.message).join('\n')
      : error instanceof Error
        ? error.message
        : String(error);
  player.replaceChildren(heading, details);
}

async function startShowcase(): Promise<void> {
  if (player === null) throw new Error('The showcase player mount is missing.');
  const game = compileStory(storySource, {
    title: 'The Light at Brinewatch',
    startSceneId: 'brinewatch.arrival',
  });
  const save = showcaseSaveOptions(await sha256(JSON.stringify(game)));
  mountNarrativePlayer(player, game, {
    ...(save === undefined ? {} : { save }),
    onEffect(effect) {
      if (atmosphere !== null && (effect.name === 'music' || effect.name === 'ambient')) {
        atmosphere.textContent = `${effect.name}: ${effect.arguments}`;
      }
    },
  });
}

void startShowcase().catch(showFailure);
