// Pixel art de la barre du haut : un joueur LoL joue, se lève, va au frigo, mange, revient.
// scene(t, px) ne fait que dessiner (testable hors navigateur) ; px(x, y, w, h, couleur) remplit un rectangle.
const LOOP = 14000;
const C = {
  hair: '#2a1a12', skin: '#f2c29b', eye: '#111', set: '#3a3f55', shirt: '#1f6bff', shirtDark: '#1546b8',
  pants: '#2b2f45', shoe: '#111', wood: '#7a4b2a', woodDark: '#5a3519', metal: '#9aa3b5', frame: '#20263a',
  key: '#596079', fridge: '#e8ecf4', fridgeEdge: '#aab2c5', light: '#fff4c2', pizza: '#ffcc4d', crust: '#c9852c', pep: '#e0393e',
};
const SIT_X = 17, FRIDGE_X = 44;

function state(t) {
  t %= LOOP;
  if (t < 5000) return { pose: 'sit', x: SIT_X, left: true, t };
  if (t < 7500) { const k = (t - 5000) / 2500; return { pose: 'walk', x: Math.round(SIT_X + k * (FRIDGE_X - SIT_X)), left: false, t }; }
  if (t < 10000) return { pose: 'eat', x: FRIDGE_X, left: false, t, bite: Math.floor((t - 7500) / 600) };
  if (t < 12500) { const k = (t - 10000) / 2500; return { pose: 'walk', x: Math.round(FRIDGE_X - k * (FRIDGE_X - SIT_X)), left: true, t }; }
  return { pose: 'sit', x: SIT_X, left: true, t };
}

function scene(t, px) {
  const s = state(t);
  // Bureau, clavier, écran
  px(2, 12, 15, 1, C.wood); px(3, 13, 1, 9, C.woodDark); px(15, 13, 1, 9, C.woodDark);
  px(12, 11, 4, 1, C.key);
  px(4, 3, 9, 7, C.frame); px(8, 10, 1, 1, C.metal); px(7, 11, 3, 1, C.metal);
  const playing = s.pose === 'sit';
  px(5, 4, 7, 5, playing ? '#1c5b3a' : '#141a2b'); // carte de la Faille, ou écran de veille
  if (playing) {
    const f = Math.floor(s.t / 250);
    px(5 + (f % 6), 5 + (f % 3), 1, 1, '#4fb3ff'); px(10 - (f % 5), 7 - (f % 2), 1, 1, '#ff5a5a');
    px(5, 8, 7, 1, '#0d2a1c'); px(6 + (f % 2) * 3, 8, 1, 1, '#ffd84d');
  } else px(7, 6, 3, 1, '#2a3554');
  // Chaise
  px(22, 10, 1, 7, C.metal); px(17, 17, 6, 1, C.metal); px(20, 18, 1, 4, C.metal); px(18, 21, 5, 1, C.metal);
  // Frigo (porte ouverte quand il mange)
  const open = s.pose === 'eat';
  px(52, 4, 9, 18, C.fridgeEdge);
  if (open) {
    px(53, 5, 7, 16, C.light); px(53, 10, 7, 1, C.fridgeEdge); px(53, 15, 7, 1, C.fridgeEdge);
    px(54, 8, 2, 2, '#7bd88f'); px(57, 13, 2, 2, C.pizza); px(55, 18, 3, 2, '#ff9f43');
    px(61, 4, 2, 18, C.fridge);
  } else { px(53, 5, 7, 16, C.fridge); px(53, 11, 7, 1, C.fridgeEdge); px(54, 7, 1, 3, C.metal); px(54, 13, 1, 3, C.metal); }
  // Joueur, dessiné tourné vers la droite puis retourné si besoin (6 px de large)
  const p = (x, y, w, h, c) => px(s.left ? s.x + 6 - x - w : s.x + x, y, w, h, c);
  if (s.pose === 'sit') {
    const bob = Math.floor(s.t / 150) % 2;
    p(1, 6, 4, 1, C.hair); p(1, 7, 4, 3, C.skin); p(1, 7, 1, 2, C.hair); p(4, 8, 1, 1, C.eye); p(2, 8, 1, 1, C.set);
    p(1, 10, 4, 5, C.shirt); p(1, 14, 4, 1, C.shirtDark);
    p(4, 11 - bob, 3, 1, C.skin);
    p(2, 15, 5, 2, C.pants); p(5, 17, 2, 4, C.pants); p(5, 21, 3, 1, C.shoe);
    return;
  }
  p(1, 10, 4, 1, C.hair); p(1, 11, 4, 3, C.skin); p(1, 11, 1, 2, C.hair); p(4, 12, 1, 1, C.eye); p(2, 12, 1, 1, C.set);
  p(1, 14, 4, 4, C.shirt); p(1, 17, 4, 1, C.shirtDark);
  if (s.pose === 'walk') {
    const step = Math.floor(s.x / 3) % 2;
    p(3, 15, 1, 2, C.skin);
    if (step) { p(1, 18, 1, 3, C.pants); p(4, 18, 1, 3, C.pants); p(0, 21, 2, 1, C.shoe); p(4, 21, 2, 1, C.shoe); }
    else { p(2, 18, 2, 3, C.pants); p(2, 21, 3, 1, C.shoe); }
    return;
  }
  // Mange une part de pizza, qui rétrécit à chaque bouchée
  p(2, 18, 2, 3, C.pants); p(2, 21, 3, 1, C.shoe);
  p(4, 14, 1, 1, C.skin);
  const left = Math.max(0, 3 - s.bite);
  if (left) { p(5, 13, 1, 2, C.crust); p(6, 13, left, 2, C.pizza); p(6, 13, 1, 1, C.pep); }
  if (s.bite % 2) p(4, 13, 1, 1, '#c0392b'); // bouche qui mâche
}

if (typeof document !== 'undefined') {
  const cv = document.getElementById('pixel');
  if (cv) {
    const ctx = cv.getContext('2d');
    const draw = (t) => { ctx.clearRect(0, 0, 64, 24); scene(t, (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }); };
    // shortcut: le réglage Animations est lu au chargement seulement, le changer demande de recharger la page
    const still = document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) draw(1000);
    else { const loop = (t) => { draw(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
  }
}
