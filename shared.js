// Shared model + category definitions for EcoSort AI (used by app.js and benchmark.js).
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

export const MODEL_ID = "Xenova/clip-vit-base-patch32";

// Zero-shot candidate labels: CLIP scores the image against each sentence.
export const CANDIDATES = [
  { id: "plastic", label: "a plastic waste item such as a plastic bottle or plastic packaging" },
  { id: "glass", label: "a glass waste item such as a glass bottle or glass jar" },
  { id: "metal", label: "a metal waste item such as an aluminum can or steel tin" },
  { id: "paper", label: "a paper waste item such as a sheet of paper or newspaper" },
  { id: "cardboard", label: "a cardboard waste item such as a cardboard box" },
  { id: "organic", label: "food scraps or organic compostable waste such as fruit peel" },
  { id: "battery", label: "a battery or electronic waste item that needs special disposal" },
  { id: "textile", label: "discarded clothing or textile waste" },
  { id: "general", label: "mixed or non-recyclable general household trash" }
];

export const CATEGORIES = {
  plastic: { name: "Plastic", icon: "🧴", type: "recyclable", subtitle: "Plastic material", steps: "Empty and rinse the item if appropriate. Check the resin code and your local collection rules. Plastic bags and soft films often need a separate store drop-off and should not go in many curbside bins.", tip: "Choose refillable or reusable containers and avoid unnecessary single-use packaging." },
  glass: { name: "Glass", icon: "🍾", type: "recyclable", subtitle: "Glass material", steps: "Empty the container and check local rules for glass collection. Do not place broken glass in a recycling bin unless your local service explicitly accepts it; wrap it safely for disposal.", tip: "Reuse jars and bottles when safe and practical." },
  metal: { name: "Metal", icon: "🥫", type: "recyclable", subtitle: "Metal material", steps: "Empty and rinse cans or containers. Check whether your local program accepts the specific metal item. Sharp edges should be handled carefully.", tip: "Prefer durable, reusable products and recycle accepted metal packaging." },
  paper: { name: "Paper", icon: "📄", type: "recyclable", subtitle: "Paper material", steps: "Keep paper clean and dry. Remove plastic coverings where possible and follow local rules for coated, waxed, or contaminated paper.", tip: "Use both sides, reuse scrap paper, and choose digital documents when practical." },
  cardboard: { name: "Cardboard", icon: "📦", type: "recyclable", subtitle: "Cardboard material", steps: "Keep cardboard dry, flatten boxes, and remove excess plastic, foam, or food contamination. Follow local collection rules.", tip: "Reuse shipping boxes and choose products with minimal packaging." },
  organic: { name: "Food / organic waste", icon: "🍌", type: "compostable", subtitle: "Organic material", steps: "Separate food scraps from packaging. Use a local food-waste collection or compost system that accepts the specific material. Meat, dairy, and cooked food rules vary by system.", tip: "Plan meals, store food correctly, and use leftovers to prevent food waste." },
  battery: { name: "Battery / e-waste", icon: "🔋", type: "hazardous", subtitle: "Special collection required", steps: "Do not put batteries or electronics in household recycling or general waste unless local guidance says so. Use an approved battery or e-waste collection point. Tape battery terminals when required by the collection provider.", tip: "Repair, reuse, donate working electronics, and choose rechargeable batteries where suitable." },
  textile: { name: "Textiles", icon: "👕", type: "general", subtitle: "Clothing and fabric", steps: "Donate or repair wearable items. Use a textile collection point if available. Wet, mouldy, or heavily contaminated textiles may need different handling.", tip: "Repair clothes, swap items, buy second-hand, and donate usable textiles." },
  general: { name: "General waste", icon: "🗑️", type: "general", subtitle: "Residual or mixed waste", steps: "This may not fit common recyclable material groups. Check local guidance before disposal. Keep batteries, chemicals, medicines, and electronics out of ordinary trash.", tip: "Reduce purchases, choose reusable items, and avoid products with hard-to-separate mixed materials." }
};

let classifier = null;
let loading = null;

export function isModelReady() {
  return classifier !== null;
}

// Loads the CLIP pipeline once. onProgress receives Hugging Face download events.
export function loadClassifier(onProgress) {
  if (classifier) return Promise.resolve(classifier);
  if (loading) return loading;
  loading = (async () => {
    try {
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      classifier = await pipeline("zero-shot-image-classification", MODEL_ID, {
        progress_callback: onProgress
      });
      return classifier;
    } catch (error) {
      loading = null;
      throw error;
    }
  })();
  return loading;
}

// Classify a Blob/File. Returns [{ id, score }] sorted from best to worst.
export async function classifyBlob(blob) {
  const pipe = await loadClassifier();
  const labels = CANDIDATES.map((c) => c.label);
  const output = await pipe(blob, labels);
  const idByLabel = new Map(CANDIDATES.map((c) => [c.label, c.id]));
  return output
    .map((item) => ({ id: idByLabel.get(item.label) || "general", score: Number(item.score) || 0 }))
    .sort((a, b) => b.score - a.score);
}
