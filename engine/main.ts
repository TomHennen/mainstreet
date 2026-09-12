import Phaser from 'phaser';
import { bindControls } from './input';
import { BootScene } from './scenes/boot';
import { MapScene } from './scenes/map';
import { TitleScene } from './scenes/title';
import { TravelScene } from './scenes/travel';
import { UiScene } from './scenes/ui';
import { setTimeScale } from './timescale';

bindControls(document);

// `?timescale=` (engine/timescale.ts), for the headless playtest harness
// only — dev builds only, and only when the URL actually asks for one, so
// ordinary play never runs at anything but the real speed.
if (import.meta.env.DEV) {
  const requested = Number(new URLSearchParams(location.search).get('timescale'));
  if (requested) setTimeScale(requested);
}

const parent = document.getElementById('stage');
if (!parent) throw new Error('#stage is missing from index.html');

new Phaser.Game({
  type: Phaser.AUTO,
  parent,
  backgroundColor: '#12160f',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
  // Order is display order: the title, the map, then the interstitial, then
  // dialogue over any of them.
  scene: [BootScene, TitleScene, MapScene, TravelScene, UiScene]
});
