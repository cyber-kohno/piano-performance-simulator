import { mount, tick } from 'svelte';
import App from './App.svelte';
import DesktopStartup from './infra/tauri/desktop-startup.ts';
import SpessaSynthInstrument from './infra/audio/spessasynth-instrument.ts';
import NotePreview from './service/playback/note-preview.ts';
import './style.css';

const target = document.getElementById('app');
if (!target) throw new Error('Editor mount target is missing.');

async function start(target: HTMLElement) {
  let notePreview: NotePreview.Value | null = null;
  let audioPreviewError: string | null = null;
  try {
    notePreview = NotePreview.create(await SpessaSynthInstrument.loadPiano());
  } catch (error) {
    console.error('Piano preview initialization:', error);
    audioPreviewError = error instanceof Error ? error.message : 'Unable to load the piano SoundFont.';
  }

  try {
    mount(App, { target, props: { notePreview, audioPreviewError } });
    await tick();
  } catch (error) {
    console.error('Editor initialization:', error);
    target.textContent = 'Unable to start ClavierDesk. Please restart the app.';
  }
  // Reveal even an initialization error instead of leaving a hidden editor behind the splash.
  await DesktopStartup.complete();
}
void start(target).catch(error => console.error('Desktop startup:', error));
