// Visual speech for text-only replies. It never creates an audio context or a TTS request.
class TextMouthDriver {
    constructor(setMouth) {
        this.setMouth = setMouth;
        this.timer = null;
        this.until = 0;
        this.startedAt = 0;
    }

    push(text) {
        const letters = String(text || '').match(/[\p{L}\p{N}]/gu);
        if (!letters?.length) return;
        const now = Date.now();
        this.until = Math.max(this.until, now + Math.min(3000, letters.length * 90 + 180));
        if (this.timer !== null) return;
        this.startedAt = now;
        this.tick();
    }

    tick() {
        if (Date.now() >= this.until) { this.stop(); return; }
        const phase = (Date.now() - this.startedAt) / 1000;
        this.setMouth(0.12 + 0.5 * Math.abs(Math.sin(phase * Math.PI * 7)));
        this.timer = setTimeout(() => this.tick(), 50);
    }

    stop() {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.until = 0;
        this.setMouth(0);
    }
}

module.exports = { TextMouthDriver };
