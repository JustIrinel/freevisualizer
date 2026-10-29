// Lets Node tests import browser modules that use the page's import map ('three', 'three/addons/…').
import { register } from 'node:module';
register(new URL('./three-hooks.mjs', import.meta.url));
