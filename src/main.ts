import { loadConfig } from './systems/config';
import { PsxRenderer } from './systems/psxRenderer';
import { Input } from './systems/input';
import { Game } from './systems/game';
import { Settings } from './systems/settings';
import { Gamepad } from './systems/gamepad';

async function boot(): Promise<void> {
  const config = await loadConfig();

  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  if (!canvas) {
    throw new Error('No se encontró el canvas #game');
  }

  const input = new Input(canvas);
  const psx = new PsxRenderer(canvas, config, input.touchCapable);
  const settings = new Settings();
  const gamepad = new Gamepad();
  const game = new Game(config, psx, input, settings, gamepad);
  await game.start();

  if (import.meta.env.DEV) {
    (window as unknown as { __mondyi?: Game }).__mondyi = game;
  }

  window.addEventListener('keydown', (event) => {
    let label = '';
    switch (event.code) {
      case 'Digit1':
        config.effects.vertex_snap = !config.effects.vertex_snap;
        label = `vertex_snap=${config.effects.vertex_snap}`;
        break;
      case 'Digit2':
        config.effects.affine_mapping = !config.effects.affine_mapping;
        label = `affine_mapping=${config.effects.affine_mapping}`;
        break;
      case 'Digit3':
        config.effects.dither = !config.effects.dither;
        label = `dither=${config.effects.dither}`;
        break;
      case 'Digit4':
        config.effects.fog.enabled = !config.effects.fog.enabled;
        label = `fog=${config.effects.fog.enabled}`;
        break;
      case 'Digit5':
        config.effects.integer_scaling = !config.effects.integer_scaling;
        psx.refresh();
        label = `integer_scaling=${config.effects.integer_scaling}`;
        break;
      case 'Digit6':
        config.loading.authentic = !config.loading.authentic;
        label = `cargas_autenticas=${config.loading.authentic}`;
        break;
      case 'KeyT':
        settings.set(
          'controlScheme',
          settings.get('controlScheme') === 'modern' ? 'tank' : 'modern',
        );
        label = `control_scheme=${settings.get('controlScheme')}`;
        break;
      case 'KeyL':
        settings.set('language', settings.get('language') === 'es' ? 'en' : 'es');
        label = `language=${settings.get('language')}`;
        break;
      case 'KeyG':
        game.gameOver();
        label = 'gameover';
        break;
      default:
        return;
    }
    game.syncConfig();
    console.log(`[debug] ${label}`);
  });
}

boot().catch((error) => {
  console.error(error);
});
