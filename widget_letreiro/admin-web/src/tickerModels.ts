export const TICKER_CARD_MODELS = [
  { id: "fx-01-solid", label: "01. Sólido clássico" },
  { id: "fx-02-shimmer", label: "02. Shimmer" },
  { id: "fx-03-accent-scan", label: "03. Scanner na faixa" },
  { id: "fx-04-accent-pulse", label: "04. Pulso na faixa" },
  { id: "fx-05-inset-pulse", label: "05. Glow interno" },
  { id: "fx-06-laser-line", label: "06. Laser" },
  { id: "fx-07-diagonal-stream", label: "07. Stream diagonal" },
  { id: "fx-08-strobe", label: "08. Giroflex" },
  { id: "fx-09-sonar", label: "09. Sonar" },
  { id: "fx-10-metallic", label: "10. Varredura metálica" },
  { id: "fx-11-inspect-spot", label: "11. Holofote" },
  { id: "fx-12-enter-slide", label: "12. Entrada deslize" },
  { id: "fx-13-enter-wipe", label: "13. Entrada cortina" },
  { id: "fx-14-enter-crt", label: "14. Entrada CRT" },
  { id: "fx-15-bottom-progress", label: "15. Progresso" },
  { id: "fx-16-heartbeat-in", label: "16. Batimento" },
  { id: "fx-17-conic-border", label: "17. Borda cônica" },
  { id: "fx-18-stagger", label: "18. Cascata" },
  { id: "fx-19-tesla", label: "19. Tesla" },
  { id: "fx-20-siren", label: "20. Sirene" },
  { id: "fx-21-gold-vip", label: "21. Ouro VIP" },
  { id: "fx-22-nuclear", label: "22. Núcleo nuclear" },
  { id: "fx-23-twin-laser", label: "23. Laser duplo" },
  { id: "fx-24-forcefield", label: "24. Campo de força" },
  { id: "fx-25-crystal", label: "25. Cristal" },
  { id: "fx-26-solar", label: "26. Explosão solar" },
  { id: "fx-27-terminal", label: "27. Terminal" },
  { id: "fx-28-hud", label: "28. HUD" },
  { id: "fx-29-kinetic", label: "29. Gradiente cinético" },
  { id: "fx-30-stroke-wave", label: "30. Contorno pulsante" },
  { id: "fx-31-cyber", label: "31. Fatiamento cyber" },
  { id: "fx-32-inferno", label: "32. Inferno" },
  { id: "fx-33-neon", label: "33. Neon Vegas" },
  { id: "fx-34-matrix", label: "34. Matrix" },
  { id: "fx-35-xray", label: "35. Raio-X" },
  { id: "fx-36-glitch", label: "36. Glitch RGB" },
  { id: "fx-37-iris", label: "37. Íris portal" },
  { id: "fx-38-shutter", label: "38. Obturador" },
  { id: "fx-39-warp", label: "39. Dobra espacial" },
  { id: "fx-40-rubber", label: "40. Impacto elástico" },
  { id: "fx-41-carimbo", label: "41. Carimbo" },
  { id: "fx-42-aurora", label: "42. Aurora" },
] as const;

export const DEFAULT_TICKER_CARD_MODEL = "fx-02-shimmer";
export const SOLID_TICKER_CARD_MODEL = "fx-01-solid";

const KNOWN = new Set<string>(TICKER_CARD_MODELS.map((item) => item.id));

export function clampTickerModel(value?: string | null): string {
  if (!value || !value.trim()) return DEFAULT_TICKER_CARD_MODEL;
  const id = value.trim();
  return KNOWN.has(id) ? id : SOLID_TICKER_CARD_MODEL;
}
