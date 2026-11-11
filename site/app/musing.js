// What an agent is "doing" while it thinks or works: a word that changes every couple of
// seconds, picked at random from a long list, in the agent's own color. Every place that shows
// an agent at work (the typing row, the chat header, a live work card) shows the same word, and
// they all change together.
import { esc } from './ui.js';

export const WORDS = `Minusing Thinking Working Frying Boiling Eating Drinking Booting Deciding Pondering Brewing
Simmering Marinating Toasting Whisking Kneading Baking Sautéing Steaming Grilling Roasting Blending Stirring
Seasoning Tasting Plating Garnishing Fermenting Percolating Steeping Sizzling Flambéing Caramelizing Glazing
Juggling Doodling Noodling Tinkering Fiddling Wrangling Untangling Polishing Sharpening Sanding Buffing
Calibrating Computing Calculating Crunching Compiling Assembling Building Crafting Forging Welding Soldering
Sketching Drafting Scribbling Jotting Outlining Plotting Scheming Strategizing Plotting Mapping Charting
Wandering Roaming Exploring Spelunking Scouting Sleuthing Investigating Snooping Rummaging Digging Mining
Fishing Foraging Gathering Harvesting Picking Sorting Shuffling Stacking Filing Tidying Organizing Labeling
Daydreaming Dreaming Imagining Envisioning Conjuring Summoning Manifesting Channeling Divining Pondering
Musing Mulling Ruminating Contemplating Deliberating Reflecting Considering Weighing Evaluating Judging
Reasoning Deducing Inferring Concluding Figuring Solving Cracking Decoding Deciphering Translating Parsing
Reading Skimming Studying Learning Memorizing Reviewing Revising Editing Proofreading Rewriting Wordsmithing
Typing Clicking Scrolling Swiping Tapping Dragging Hovering Zooming Squinting Peeking Glancing Gazing
Listening Humming Whistling Singing Rapping Beatboxing Drumming Strumming Jamming Composing Remixing
Dancing Shimmying Wiggling Wobbling Bouncing Hopping Skipping Twirling Spinning Pirouetting Moonwalking
Stretching Yawning Blinking Breathing Meditating Centering Focusing Zoning Vibing Chilling Lounging
Sipping Slurping Munching Nibbling Snacking Chewing Gulping Savoring Digesting Feasting Brunching
Caffeinating Recaffeinating Decaffeinating Hydrating Refueling Recharging Rebooting Reloading Refreshing
Loading Buffering Syncing Downloading Uploading Streaming Rendering Indexing Caching Hashing Encrypting
Debugging Refactoring Optimizing Benchmarking Profiling Linting Testing Shipping Deploying Patching
Minusifying Subtracting Negating Dividing Multiplying Adding Rounding Estimating Approximating Tallying
Counting Measuring Weighing Balancing Leveling Aligning Centering Nudging Tweaking Adjusting Fine-tuning
Hatching Incubating Germinating Sprouting Blooming Growing Ripening Flourishing Blossoming Photosynthesizing
Gardening Weeding Pruning Watering Planting Composting Mulching Raking Mowing Trimming Landscaping
Knitting Crocheting Sewing Stitching Weaving Quilting Embroidering Darning Hemming Tailoring Patchworking
Painting Drawing Sculpting Molding Carving Whittling Etching Engraving Inking Shading Coloring Illustrating
Origami-ing Folding Unfolding Crumpling Smoothing Ironing Pressing Steaming Fluffing Puffing Plumping
Brainstorming Ideating Riffing Improvising Freestyling Hypothesizing Theorizing Speculating Wondering
Questioning Probing Interrogating Cross-examining Fact-checking Verifying Validating Confirming Double-checking
Triple-checking Quadruple-checking Overthinking Underthinking Rethinking Thinking_harder
Accelerating Revving Zooming Sprinting Dashing Racing Jogging Strolling Sauntering Moseying Meandering
Teleporting Time-traveling Warping Phasing Hyperspacing Orbiting Launching Landing Docking Undocking
Beeping Booping Whirring Buzzing Clanking Ticking Tocking Chiming Dinging Pinging Ponging Bleeping
Pixelating Vectorizing Rasterizing Antialiasing Upscaling Sharpening Denoising Dithering Shading
Befriending Charming Schmoozing Networking Negotiating Haggling Bartering Bargaining Persuading Pitching
Herding Shepherding Wrangling Corralling Lassoing Taming Training Coaching Mentoring Nurturing Babysitting
Sleuthing Detecting Profiling Tailing Staking-out Shadowing Eavesdropping Surveilling Reconnoitering
Juicing Squeezing Zesting Peeling Slicing Dicing Chopping Mincing Julienning Grating Shredding Mashing
Frosting Icing Sprinkling Dusting Drizzling Topping Layering Stacking Rolling Folding Wrapping Bundling
Microwaving Defrosting Thawing Chilling Freezing Melting Bubbling Fizzing Popping Crackling Sparkling
Shuffling_cards Rolling_dice Flipping_coins Spinning_plates Herding_cats Counting_sheep Connecting_dots
Reticulating_splines Aligning_chakras Consulting_the_oracle Reading_tea_leaves Asking_the_rubber_duck
Warming_up Gearing_up Powering_up Leveling_up Buckling_up Lacing_up Suiting_up Firing_up Spinning_up
Hmm-ing Ahh-ing Ooh-ing Aha-ing Umm-ing Tsk-ing Mm-hmm-ing Pshh-ing Brrr-ing Zzz-ing Wheee-ing
Frolicking Gallivanting Cavorting Romping Prancing Galumphing Lollygagging Dillydallying Shillyshallying
Bamboozling Hornswoggling Discombobulating Recombobulating Flabbergasting Kerfuffling Hullabalooing
Noodle-boiling Pancake-flipping Egg-cracking Bread-rising Soup-stirring Tea-brewing Toast-buttering
Coffee-grinding Pasta-twirling Pizza-tossing Taco-folding Sushi-rolling Dumpling-pinching Brigadeiro-rolling
Pão-de-queijo-baking Feijoada-simmering Coxinha-frying Açaí-blending Guaraná-sipping Samba-dancing`
  .split(/\s+/)
  .filter(Boolean)
  .map((w) => w.replace(/_/g, ' ') + '…') // "Herding_cats" is two words
  .filter((w, i, all) => all.indexOf(w) === i);

// A bag: every word comes up once before any comes up again.
let bag = [];
function pick(not) {
  if (!bag.length) bag = WORDS.slice().sort(() => Math.random() - 0.5);
  let w = bag.pop();
  if (w === not && bag.length) w = bag.pop();
  return w;
}
const cur = new Map(); // agent -> { word, next }
const wait = () => 1900 + Math.random() * 1500;
function now(aid) {
  let c = cur.get(aid);
  if (!c) cur.set(aid, (c = { word: aid === 'minus' || Math.random() < 0.18 ? 'Minusing…' : pick(), next: performance.now() + wait() }));
  return c;
}

// The agent's color, or white when it's too dark to read on the dark app (black agents).
export function tone(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#f2f2ef';
  const n = parseInt(m[1], 16), [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.06 ? '#f2f2ef' : '#' + m[1];
}

const letters = (w, anim) => `<span class="mw${anim ? ' in' : ''}" aria-hidden="true">${[...w].map((ch, i) => `<i style="--i:${i}">${ch === ' ' ? '&nbsp;' : esc(ch)}</i>`).join('')}</span>`;

/** The word, live: put this wherever the agent is thinking or working. */
export function musingHTML(a, cls = '') {
  const w = now(a.id).word;
  return `<span class="musing ${cls}" data-musing="${esc(a.id)}" style="--mc:${tone(a.color)}" role="status" aria-label="${esc(a.name)} is ${esc(w.replace('…', ''))}">${letters(w, false)}</span>`;
}

const still = matchMedia('(prefers-reduced-motion: reduce)');
function swap(el, w) {
  el.querySelectorAll('.mw.out').forEach((x) => x.remove());
  const old = el.querySelector('.mw');
  el.insertAdjacentHTML('beforeend', letters(w, !still.matches));
  el.setAttribute('aria-label', el.getAttribute('aria-label').replace(/ is .*$/, ` is ${w.replace('…', '')}`));
  if (!old) return;
  if (still.matches) return old.remove();
  old.classList.add('out');
  setTimeout(() => old.remove(), 420);
}

// One clock for every word on screen.
setInterval(() => {
  if (document.hidden) return;
  const els = document.querySelectorAll('[data-musing]');
  if (!els.length) return;
  const t = performance.now(), changed = new Map();
  for (const el of els) {
    const aid = el.dataset.musing;
    if (!changed.has(aid)) {
      const c = now(aid);
      if (t >= c.next) { c.word = pick(c.word); c.next = t + wait(); changed.set(aid, c.word); }
      else changed.set(aid, null);
    }
    const w = changed.get(aid);
    if (w) swap(el, w);
  }
}, 200);
