import { compileStory, StoryCompileError } from '@rpgnarrativeengine/compiler';
import { mountNarrativePlayer } from '@rpgnarrativeengine/player';

import storySource from '../story/lighthouse.story?raw';
import './style.css';

const player = document.querySelector<HTMLElement>('#player');
const atmosphere = document.querySelector<HTMLElement>('#atmosphere');

if (player === null) {
  throw new Error('The showcase player mount is missing.');
}

try {
  const game = compileStory(storySource, {
    title: 'The Light at Brinewatch',
    startSceneId: 'brinewatch.arrival',
  });
  mountNarrativePlayer(player, game, {
    onEffect(effect) {
      if (atmosphere !== null && (effect.name === 'music' || effect.name === 'ambient')) {
        atmosphere.textContent = `${effect.name}: ${effect.arguments}`;
      }
    },
  });
} catch (error) {
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
