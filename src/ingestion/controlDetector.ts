export class ControlDetector {
  static controlKeywords: Record<string, string[]> = {
    "AC-1": ["access control", "authentication", "authorization"],
    "IR-1": ["incident response", "security incident", "breach handling"],
    "CM-1": ["change management", "change control"],
    "BC-1": ["business continuity", "disaster recovery", "drp"]
  };

  static detect(text: string) {
    const lower = text.toLowerCase();
    const found: string[] = [];

    for (const control of Object.keys(this.controlKeywords)) {
      const keywords: string[] = this.controlKeywords[control];
      if (keywords.some((k: string) => lower.includes(k))) {
        found.push(control);
      }
    }

    return found;
  }
}
