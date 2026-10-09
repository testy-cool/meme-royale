const FEED_LINES = 4;
const FEED_LIFE = 6; // seconds a kill feed line stays, the last one fading out

/** The in-game HUD: health, the slam cooldown, players left, the kill feed, and a purple edge while in the storm. */
export class Hud {
  private readonly root = document.getElementById('hud')!;
  private readonly hpFill = this.root.querySelector<HTMLElement>('.hp-fill')!;
  private readonly hpText = this.root.querySelector<HTMLElement>('.hp-text')!;
  private readonly slam = this.root.querySelector<HTMLElement>('.slam')!;
  private readonly slamFill = this.root.querySelector<HTMLElement>('.slam-fill')!;
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

  /** `slamLeft` is the cooldown still to wait, from 1 (just used) to 0 (ready). */
  update(hp: number, slamLeft: number, playersLeft: number, inStorm: boolean) {
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
    const hpRounded = Math.ceil(hp), slamPct = Math.ceil(slamLeft * 20) * 5;
    const key = `${hpRounded}|${slamPct}|${playersLeft}|${inStorm}`;
    if (key === this.shown) return;
    this.shown = key;
    this.hpFill.style.width = `${hpRounded}%`;
    this.hpFill.style.background = hpRounded > 50 ? '#5bd15b' : hpRounded > 25 ? '#f2c94c' : '#ef5350';
    this.hpText.textContent = String(hpRounded);
    this.slamFill.style.height = `${slamPct}%`;
    this.slam.classList.toggle('ready', slamPct === 0);
    this.left.textContent = `${playersLeft} left`;
    this.storm.classList.toggle('on', inStorm);
  }
}
