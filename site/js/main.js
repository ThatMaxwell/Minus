import { installDefs } from './shape.js';
import { keepNames } from './names.js';
import { initLanding, revealHero, heroFinal, startLive } from './landing.js';
import { runIntro } from './intro.js';

window.__minus = true;
installDefs();
keepNames();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
initLanding({ hideHero: !reduced });
const uiIn = () => document.documentElement.classList.add('ui-in');

if (reduced || !document.getElementById('intro')) {
  // The OS asks for less motion: no intro, straight to the page.
  document.getElementById('intro')?.remove();
  document.documentElement.classList.remove('intro-on');
  document.querySelector('.nav-logo').classList.add('on');
  heroFinal(); uiIn(); startLive();
} else if (location.search.includes('nointro')) {
  // For working on the page: skip the intro, still play the hero.
  document.getElementById('intro')?.remove();
  document.documentElement.classList.remove('intro-on');
  document.querySelector('.nav-logo').classList.add('on');
  uiIn(); revealHero(); startLive();
} else {
  scrollTo(0, 0);
  runIntro({ onReveal: () => { uiIn(); revealHero(); startLive(); } });
}
