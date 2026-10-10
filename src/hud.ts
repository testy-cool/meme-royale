const FEED_LINES = 4;
const FEED_LIFE = 6; // seconds a kill feed line stays, the last one fading out

/** What the HUD shows, read off the game each frame. */
export interface HudState {
  hp: number;
  cooling: number[]; // per power key, the cooldown still to wait: 1 (just used) to 0 (ready)
  playersLeft: number;
  inStorm: boolean;
  bow: boolean; // out
  hasBow: boolean;
  arrows: number;
  draw: number; // 0..1
}

/**
 * The in-game HUD: health, the two power keys and their cooldowns, fists and the bow, the bow's
 * crosshair, players left, the kill feed, and a purple edge while in the storm.
 */
export class Hud {
  private readonly root = document.getElementById('hud')!;
  private readonly hpFill = this.root.querySelector<HTMLElement>('.hp-fill')!;
  private readonly hpText = this.root.querySelector<HTMLElement>('.hp-text')!;
  private readonly keys = [...this.root.querySelectorAll<HTMLElement>('.key')];
  private readonly slots = [...this.root.querySelectorAll<HTMLElement>('.slot')];
  private readonly arrows = this.root.querySelector<HTMLElement>('.arrows')!;
  private readonly crosshair = this.root.querySelector<HTMLElement>('.crosshair')!;
  private readonly left = this.root.querySelector<HTMLElement>('.left')!;
  private readonly feed = this.root.querySelector<HTMLElement>('.feed')!;
  private readonly storm = this.root.querySelector<HTMLElement>('.storm-edge')!;
  private readonly lines: { el: HTMLElement; born: number }[] = [];
  private shown = '';

  show(visible: boolean) {
    this.root.hidden = !visible;
  }

  clear() {
    this.feed.replaceChildren();
    this.lines.length = 0;
    this.shown = '';
  }

  /** Adds a kill feed line. Lines about the player stand out. */
  notice(text: string, you: boolean) {
    const el = document.createElement('div');
    el.className = you ? 'line you' : 'line';
    el.textContent = text;
    this.feed.append(el);
    this.lines.push({ el, born: performance.now() });
    while (this.lines.length > FEED_LINES) this.lines.shift()!.el.remove();
  }

  update(s: HudState) {
    const now = performance.now();
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const age = (now - this.lines[i].born) / 1000;
      if (age > FEED_LIFE) {
        this.lines[i].el.remove();
        this.lines.splice(i, 1);
      } else if (age > FEED_LIFE - 1) {
        this.lines[i].el.classList.add('fading');
      }
    }
    this.crosshair.hidden = !s.bow;
    if (s.bow) this.crosshair.style.setProperty('--gap', `${Math.round(14 - 9 * s.draw)}px`);
    const hpRounded = Math.ceil(hp(s.hp)), cooling = s.cooling.map((c) => Math.ceil(c * 20) * 5);
    const key = `${hpRounded}|${cooling.join(',')}|${s.playersLeft}|${s.inStorm}|${s.bow}|${s.hasBow}|${s.arrows}`;
    if (key === this.shown) return;
    this.shown = key;
    this.hpFill.style.width = `${hpRounded}%`;
    this.hpFill.style.background = hpRounded > 50 ? '#5bd15b' : hpRounded > 25 ? '#f2c94c' : '#ef5350';
    this.hpText.textContent = String(hpRounded);
    this.keys.forEach((el, i) => {
      const pct = cooling[i] ?? 0;
      el.hidden = i >= cooling.length;
      el.querySelector<HTMLElement>('.key-fill')!.style.height = `${pct}%`;
      el.classList.toggle('ready', pct === 0);
    });
    this.slots[0].classList.toggle('on', !s.bow);
    this.slots[1].classList.toggle('on', s.bow);
    this.slots[1].hidden = !s.hasBow;
    this.arrows.textContent = String(s.arrows);
    this.left.textContent = `${s.playersLeft} left`;
    this.storm.classList.toggle('on', s.inStorm);
  }
}

const hp = (n: number) => Math.max(0, n);
