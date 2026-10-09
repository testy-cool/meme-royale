/** The in-game HUD: health and the slam cooldown, plus a notice while you are knocked out. */
export class Hud {
  private readonly root = document.getElementById('hud')!;
  private readonly hpFill = this.root.querySelector<HTMLElement>('.hp-fill')!;
  private readonly hpText = this.root.querySelector<HTMLElement>('.hp-text')!;
  private readonly slam = this.root.querySelector<HTMLElement>('.slam')!;
  private readonly slamFill = this.root.querySelector<HTMLElement>('.slam-fill')!;
  private readonly ko = this.root.querySelector<HTMLElement>('.ko')!;
  private shown = '';

  show(visible: boolean) {
    this.root.hidden = !visible;
  }

  /** `slamLeft` is the cooldown still to wait, from 1 (just used) to 0 (ready). */
  update(hp: number, slamLeft: number, knockedOut: boolean) {
    const hpRounded = Math.ceil(hp), slamPct = Math.ceil(slamLeft * 20) * 5;
    const key = `${hpRounded}|${slamPct}|${knockedOut}`;
    if (key === this.shown) return;
    this.shown = key;
    this.hpFill.style.width = `${hpRounded}%`;
    this.hpFill.style.background = hpRounded > 50 ? '#5bd15b' : hpRounded > 25 ? '#f2c94c' : '#ef5350';
    this.hpText.textContent = String(hpRounded);
    this.slamFill.style.height = `${slamPct}%`;
    this.slam.classList.toggle('ready', slamPct === 0);
    this.ko.hidden = !knockedOut;
  }
}
