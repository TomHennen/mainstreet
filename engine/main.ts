import Phaser from 'phaser';
import { bindControls } from './input';
import { BootScene } from './scenes/boot';
import { MapScene } from './scenes/map';
import { TitleScene } from './scenes/title';
import { TravelScene } from './scenes/travel';
import { UiScene } from './scenes/ui';

bindControls(document);

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
