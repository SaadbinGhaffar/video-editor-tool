// One-time install of local speech-to-text (whisper.cpp + model), used when
// OPENAI_API_KEY isn't set: `npm run setup:whisper`
import { downloadWhisperModel, installWhisperCpp } from "@remotion/install-whisper-cpp";
import path from "node:path";

const dir = path.join(process.cwd(), ".whisper", "whisper.cpp");

async function main() {
  await installWhisperCpp({ to: dir, version: "1.5.5", printOutput: true });
  await downloadWhisperModel({ model: "base.en", folder: dir, printOutput: true });
  console.log(`\nLocal whisper ready in ${dir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
