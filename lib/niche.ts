import { normalizeWord, tokenizeTranscript } from "./align";
import type { NicheDetection, NicheId } from "./types";

/**
 * Keyword stems per niche. A transcript word matches a stem if it starts with
 * it ("workout" matches "workouts"), so stems must be distinctive. Weight 2 =
 * strongly tied to the niche, 1 = suggestive.
 */
const KEYWORDS: Record<Exclude<NicheId, "general">, [string, number][]> = {
  tech: [
    ["software", 2], ["app", 1], ["apps", 1], ["code", 2], ["coding", 2], ["developer", 2], ["programm", 2],
    ["ai", 2], ["artificial", 1], ["algorithm", 2], ["computer", 2], ["laptop", 2], ["smartphone", 2], ["iphone", 2],
    ["android", 2], ["gadget", 2], ["tech", 2], ["startup", 1], ["cloud", 1], ["data", 1], ["chip", 1],
    ["processor", 2], ["gpu", 2], ["robot", 2], ["automat", 1], ["digital", 1], ["internet", 1], ["website", 1],
    ["cyber", 2], ["crypto", 1], ["blockchain", 2], ["api", 2], ["server", 1], ["neural", 2], ["machine", 1],
    ["model", 1], ["device", 1], ["upgrade", 1], ["benchmark", 2], ["javascript", 2], ["python", 2], ["editor", 1],
  ],
  travel: [
    ["travel", 2], ["trip", 2], ["journey", 1], ["destination", 2], ["visit", 1], ["explore", 1], ["adventure", 1],
    ["beach", 2], ["mountain", 2], ["lake", 1], ["island", 2], ["ocean", 1], ["coast", 2], ["sunset", 1],
    ["sunrise", 1], ["hike", 2], ["hiking", 2], ["flight", 1], ["hotel", 2], ["passport", 2], ["backpack", 2],
    ["city", 1], ["country", 1], ["village", 1], ["tour", 1], ["vacation", 2], ["holiday", 1], ["road", 1],
    ["forest", 1], ["waterfall", 2], ["landscape", 2], ["scenery", 2], ["places", 1], ["summer", 1], ["nature", 1],
  ],
  business: [
    ["business", 2], ["company", 1], ["revenue", 2], ["profit", 2], ["market", 1], ["marketing", 2], ["sales", 2],
    ["customer", 2], ["client", 1], ["invest", 2], ["stock", 2], ["finance", 2], ["financial", 2], ["money", 1],
    ["income", 2], ["budget", 2], ["strategy", 1], ["growth", 1], ["entrepreneur", 2], ["brand", 1], ["team", 1],
    ["manager", 1], ["leader", 1], ["career", 2], ["salary", 2], ["economy", 2], ["tax", 2], ["dollar", 1],
    ["percent", 1], ["productiv", 2], ["lesson", 1], ["learn", 1], ["tips", 1], ["course", 1], ["explain", 1],
  ],
  fitness: [
    ["workout", 2], ["exercise", 2], ["gym", 2], ["muscle", 2], ["fitness", 2], ["training", 1], ["train", 1],
    ["cardio", 2], ["squat", 2], ["pushup", 2], ["reps", 2], ["sets", 1], ["weight", 1], ["protein", 2],
    ["calorie", 2], ["fat", 1], ["strength", 2], ["strong", 1], ["run", 1], ["running", 2], ["athlete", 2],
    ["sport", 2], ["coach", 1], ["goal", 1], ["discipline", 2], ["motivat", 2], ["grind", 2], ["push", 1],
    ["sweat", 2], ["body", 1], ["health", 1], ["champion", 2], ["win", 1], ["never", 1], ["quit", 2],
  ],
  food: [
    ["recipe", 2], ["cook", 2], ["cooking", 2], ["kitchen", 2], ["bake", 2], ["baking", 2], ["delicious", 2],
    ["taste", 2], ["flavor", 2], ["flavour", 2], ["ingredient", 2], ["dish", 1], ["meal", 2], ["dinner", 2],
    ["lunch", 2], ["breakfast", 2], ["restaurant", 2], ["chef", 2], ["sauce", 2], ["cheese", 2], ["chicken", 2],
    ["pasta", 2], ["pizza", 2], ["dessert", 2], ["chocolate", 2], ["coffee", 1], ["sugar", 1], ["salt", 1],
    ["oven", 2], ["fry", 2], ["spice", 2], ["fresh", 1], ["eat", 1], ["food", 2], ["cafe", 1], ["lifestyle", 1],
  ],
  gaming: [
    ["game", 2], ["gaming", 2], ["gamer", 2], ["player", 1], ["level", 1], ["boss", 1], ["quest", 2],
    ["console", 2], ["playstation", 2], ["xbox", 2], ["nintendo", 2], ["steam", 1], ["multiplayer", 2],
    ["fps", 2], ["rpg", 2], ["speedrun", 2], ["stream", 1], ["twitch", 2], ["esports", 2], ["minecraft", 2],
    ["fortnite", 2], ["loot", 2], ["respawn", 2], ["controller", 1], ["character", 1], ["skin", 1],
    ["squad", 1], ["match", 1], ["ranked", 2], ["epic", 1], ["insane", 1], ["clutch", 2],
  ],
  documentary: [
    ["history", 2], ["historic", 2], ["century", 2], ["ancient", 2], ["war", 2], ["empire", 2], ["king", 1],
    ["queen", 1], ["story", 1], ["mystery", 2], ["murder", 2], ["crime", 2], ["detective", 2], ["evidence", 2],
    ["discovered", 1], ["archive", 2], ["decade", 1], ["legend", 1], ["civilization", 2], ["revolution", 2],
    ["tragedy", 2], ["disappear", 2], ["investigat", 2], ["documentary", 2], ["remember", 1], ["forgotten", 2],
    ["secret", 1], ["truth", 1], ["years", 1], ["ago", 1], ["born", 1], ["died", 2], ["battle", 2],
  ],
};

export const NICHE_LABELS: Record<NicheId, string> = {
  general: "General",
  tech: "Tech & AI",
  travel: "Travel & nature",
  business: "Business & education",
  fitness: "Fitness & motivation",
  food: "Food & lifestyle",
  gaming: "Gaming & entertainment",
  documentary: "Documentary & story",
};

/** Guess the video's niche from the transcript's vocabulary. */
export function detectNicheFromText(transcript: string): NicheDetection {
  const words = tokenizeTranscript(transcript).map(normalizeWord).filter(Boolean);
  const scores = new Map<NicheId, { score: number; hits: Map<string, number> }>();

  for (const [niche, stems] of Object.entries(KEYWORDS) as [Exclude<NicheId, "general">, [string, number][]][]) {
    const entry = { score: 0, hits: new Map<string, number>() };
    for (const word of words) {
      for (const [stem, weight] of stems) {
        // Short stems must match exactly ("ai" shouldn't match "aim").
        const match = stem.length <= 3 ? word === stem : word.startsWith(stem);
        if (match) {
          entry.score += weight;
          entry.hits.set(word, (entry.hits.get(word) ?? 0) + 1);
          break;
        }
      }
    }
    scores.set(niche, entry);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const [topNiche, top] = ranked[0];
  const second = ranked[1]?.[1].score ?? 0;

  // Needs a few distinct signals and a clear lead; otherwise stay general.
  if (top.score < 3 || top.hits.size < 2 || top.score < second * 1.25) {
    return {
      niche: "general",
      confidence: 0,
      signals: top.score > 0 ? [...top.hits.keys()].slice(0, 4) : [],
      source: "keywords",
    };
  }
  const confidence = Math.min(1, (top.score - second) / Math.max(top.score, 1) + Math.min(top.score, 12) / 24);
  const signals = [...top.hits.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 5);
  return { niche: topNiche, confidence: Math.round(confidence * 100) / 100, signals, source: "keywords" };
}
